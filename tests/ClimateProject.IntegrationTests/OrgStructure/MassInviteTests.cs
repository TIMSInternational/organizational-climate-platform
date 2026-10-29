using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using ClimateProject.Api.Endpoints;
using ClimateProject.Application.Auth;
using ClimateProject.Application.Email;
using ClimateProject.Application.Localization;
using ClimateProject.Application.OrgStructure;
using ClimateProject.Application.Questions;
using ClimateProject.Application.Surveys;
using ClimateProject.Domain.Entities;
using ClimateProject.Infrastructure.Persistence;
using ClimateProject.IntegrationTests.Support;
using ClimateProject.IntegrationTests.Surveys;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.TestHost;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;

namespace ClimateProject.IntegrationTests.OrgStructure;

/// <summary>
/// Mass invite (ruled 2026-10-13): the roster import creates each person's account with a
/// generated username and password, emails both, and the person signs in with them and is
/// never asked their demographics. Every password here is read from the captured email,
/// because that is the only place the product ever puts one.
/// </summary>
[Collection("Postgres")]
public class MassInviteTests(PostgresContainerFixture postgres, CapturingCredentialsHostFixture credentials)
    : IAsyncLifetime, IClassFixture<CapturingCredentialsHostFixture>
{
    private readonly string _companyDomain = $"massinvite-{Guid.NewGuid():N}.test";
    private Guid _companyId;
    private Guid _otherCompanyId;
    private Guid _areaFieldId;
    private CapturingCredentialsFactory _factory = null!;

    public async Task InitializeAsync()
    {
        _factory = credentials.HostFor(postgres.ConnectionString);
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>();

        var company = new Company
        {
            Id = Guid.NewGuid(),
            Name = "Empresa de Servicios Públicos",
            EmailDomain = _companyDomain,
            CreatedAt = DateTimeOffset.UtcNow,
            Settings = new CompanySettings { Language = "es" },
        };
        var other = new Company
        {
            Id = Guid.NewGuid(),
            Name = "Other Co",
            EmailDomain = $"massinvite-other-{Guid.NewGuid():N}.test",
            CreatedAt = DateTimeOffset.UtcNow,
        };
        db.Companies.AddRange(company, other);
        _companyId = company.Id;
        _otherCompanyId = other.Id;

        var now = DateTimeOffset.UtcNow;
        var field = new DemographicField { Id = Guid.NewGuid(), CompanyId = _companyId, Field = "sede", LabelEs = "Sede", Type = "select", Order = 1, CreatedAt = now, UpdatedAt = now };
        db.DemographicFields.Add(field);
        db.DemographicFieldOptions.AddRange(
            new DemographicFieldOption { DemographicFieldId = field.Id, Order = 1, Value = "heredia", LabelEs = "Heredia" },
            new DemographicFieldOption { DemographicFieldId = field.Id, Order = 2, Value = "belen", LabelEs = "Belén" });
        _areaFieldId = field.Id;

        await db.SaveChangesAsync();
    }

    /// <summary>
    /// Deliberately does NOT dispose the host: it is the run's single credentials-capturing
    /// host, held by <see cref="CapturingCredentialsHostFixture"/> and reused by every test
    /// case here. Disposing it after the first one would leave the rest holding a dead host.
    /// </summary>
    public Task DisposeAsync() => Task.CompletedTask;

    private async Task<HttpClient> AdminClientAsync(Guid companyId)
    {
        var client = _factory.CreateClient();
        var email = $"{Guid.NewGuid():N}@{_companyDomain}";
        var signup = await client.PostAsJsonAsync("/auth/signup", new SignupRequest("Mass Admin", email, "A-good-passw0rd"));
        Assert.True(signup.IsSuccessStatusCode, $"signup returned {signup.StatusCode}");

        using (var scope = _factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>();
            var user = await db.Users.FirstAsync(u => u.Email == email);
            user.Role = Roles.CompanyAdmin;
            user.CompanyId = companyId;
            await db.SaveChangesAsync();
        }

        var login = await client.PostAsJsonAsync("/auth/login", new LoginRequest(email, "A-good-passw0rd"));
        var token = (await login.Content.ReadFromJsonAsync<TokenResponse>())!.Token;
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);
        return client;
    }

    private Task<HttpResponseMessage> ImportAsync(HttpClient client, bool preview, params BulkImportRowInput[] rows)
        => client.PostAsJsonAsync("/admin/users/bulk-import/rows", new BulkImportRowsRequest(
            _companyId, preview, rows, WithCredentials: true));

    private static async Task<HttpStatusCode> LoginStatusAsync(HttpClient client, string identifier, string password)
        => (await client.PostAsJsonAsync("/auth/login", new LoginRequest(identifier, password))).StatusCode;

    [Fact]
    public async Task An_imported_person_gets_an_account_with_their_demographics_and_signs_in_with_the_emailed_username()
    {
        var client = await AdminClientAsync(_companyId);
        var email = $"ana-{Guid.NewGuid():N}@example.com";

        var response = await ImportAsync(client, preview: false,
            new BulkImportRowInput(3, "Ana Rojas", email, "Colaborador", null, new() { ["sede"] = "heredia" }));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadAsStringAsync();
        var result = System.Text.Json.JsonSerializer.Deserialize<BulkImportResponse>(body, new System.Text.Json.JsonSerializerOptions(System.Text.Json.JsonSerializerDefaults.Web))!;
        Assert.Equal("created", Assert.Single(result.Rows).Status);
        Assert.Empty(result.Rows[0].Issues);
        // This company is `shared`, so the flag still decides, and still says so.
        Assert.Equal(BulkImportDelivery.Credentials, result.Delivery);

        var sent = Assert.Single(_factory.Sent, s => s.ToEmail == email);
        Assert.Matches("^empresad-[23456789abcdefghjkmnpqrstuvwxyz]{8}$", sent.Username);
        Assert.Matches("^[A-HJ-NP-Za-hjkmnp-z2-9]{10}$", sent.Password);
        Assert.Equal("es", sent.Language);
        // The API never hands the password to the administrator: the email is its only copy.
        Assert.DoesNotContain(sent.Password, body, StringComparison.Ordinal);

        using (var scope = _factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>();
            var user = await db.Users.SingleAsync(u => u.Email == email);
            Assert.Equal(sent.Username, user.Username);
            Assert.Equal("Ana Rojas", user.Name);
            Assert.Equal(_companyId, user.CompanyId);
            Assert.Equal(Roles.Employee, user.Role);
            Assert.NotEqual(sent.Password, user.PasswordHash);
            var demographic = await db.UserDemographics.SingleAsync(d => d.UserId == user.Id);
            Assert.Equal(_areaFieldId, demographic.DemographicFieldId);
            Assert.Equal("heredia", demographic.Value);
            Assert.False(await db.UserInvitations.AnyAsync(i => i.Email == email));
        }

        var anonymous = _factory.CreateClient();
        Assert.Equal(HttpStatusCode.OK, await LoginStatusAsync(anonymous, sent.Username, sent.Password));
        // Typed from a phone, with a capital and a trailing space: still the same person.
        Assert.Equal(HttpStatusCode.OK, await LoginStatusAsync(anonymous, " " + sent.Username.ToUpperInvariant() + " ", sent.Password));
        Assert.Equal(HttpStatusCode.Unauthorized, await LoginStatusAsync(anonymous, sent.Username, sent.Password + "x"));
    }

    /// <summary>
    /// The seam ESPH launches on, and the one thing no test spanned: an account the roster
    /// import created, authenticated with the credentials it EMAILED, answering a survey.
    /// </summary>
    /// <remarks>
    /// <para>
    /// Each half was already covered and the join was not.
    /// <c>An_imported_person_gets_an_account_...</c> proves the import and the sign-in but
    /// never asks for a survey; <c>A_signed_in_respondent_resumes_even_when_the_survey_says
    /// _one_session_only</c> proves a signed-in respondent answers, but with an employee the
    /// harness built. Nothing proved that the token a USERNAME login mints is one the respond
    /// endpoints accept, and no test that touches <c>bulk-import/rows</c> posts a response.
    /// </para>
    /// <para>
    /// <c>SelfDeclaredDemographics: true</c> deliberately, because that is the configuration
    /// ESPH will actually run: mode 2's backfill turns the flag on for every answerable
    /// survey. The guarantee is that it changes nothing for these respondents --
    /// <c>AsksSelfDeclaredDemographics</c> keys on <c>ActingUserId is null</c>, so somebody
    /// who signed in is never asked an área the roster already stated. A prelude here would
    /// ask eighty-item respondents to re-type what the import knows.
    /// </para>
    /// <para>
    /// Identified rather than anonymous: on an anonymous survey the department is kept only
    /// when the respondent's own department clears the write-time cohort floor, so a
    /// one-person department would drop it BY DESIGN and this would be asserting about the
    /// floor instead of about the seam.
    /// </para>
    /// </remarks>
    [Fact]
    public async Task An_imported_person_answers_a_survey_with_the_credentials_they_were_emailed()
    {
        var admin = await AdminClientAsync(_companyId);

        Guid departmentId;
        using (var scope = _factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>();
            var department = new Department
            {
                Id = Guid.NewGuid(),
                CompanyId = _companyId,
                Name = "Operaciones",
                CreatedAt = DateTimeOffset.UtcNow,
                UpdatedAt = DateTimeOffset.UtcNow,
            };
            db.Departments.Add(department);
            await db.SaveChangesAsync();
            departmentId = department.Id;
        }

        var email = $"luis-{Guid.NewGuid():N}@example.com";
        var import = await ImportAsync(admin, preview: false,
            new BulkImportRowInput(2, "Luis Mora", email, "Colaborador", "Operaciones", new() { ["sede"] = "belen" }));
        Assert.Equal(HttpStatusCode.OK, import.StatusCode);
        var sent = Assert.Single(_factory.Sent, s => s.ToEmail == email);

        var survey = await SurveyTestHarness.CreateSurveyAsync(admin, new CreateSurveyRequest(
            Title: LocalizedInput.FromBare("Clima 2026"),
            CompanyId: _companyId,
            Type: "periodic",
            StartDate: DateTimeOffset.UtcNow.AddDays(-1),
            EndDate: DateTimeOffset.UtcNow.AddDays(14),
            DepartmentIds: [departmentId],
            Questions:
            [
                new CreateSurveyQuestionInput(
                    LocalizedInput.FromBare("¿Dónde trabajas?"),
                    QuestionTypes.MultipleChoice,
                    Options:
                    [
                        new CreateSurveyQuestionOptionInput("remote", LocalizedInput.FromBare("Remoto")),
                        new CreateSurveyQuestionOptionInput("hybrid", LocalizedInput.FromBare("Híbrido")),
                    ],
                    Order: 0),
            ],
            Settings: new SurveySettingsInput(Anonymous: false, SelfDeclaredDemographics: true)));
        (await SurveyTestHarness.SetStatusAsync(admin, survey.Id, SurveyStatuses.Active))
            .EnsureSuccessStatusCode();

        // Signing in exactly as the person does: the username and the password off the email,
        // on a client that has never held an administrator's token.
        var person = _factory.CreateClient();
        var login = await person.PostAsJsonAsync("/auth/login", new LoginRequest(sent.Username, sent.Password));
        Assert.Equal(HttpStatusCode.OK, login.StatusCode);
        person.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue(
            "Bearer", (await login.Content.ReadFromJsonAsync<TokenResponse>())!.Token);

        var sessionId = Guid.NewGuid().ToString("N");
        var view = (await person.GetFromJsonAsync<SurveyRespondView>(
            $"/surveys/{survey.Id}/respond?sessionId={sessionId}"))!;

        // Asked no demographics though the survey asks for them, and never asked who they are.
        Assert.Empty(view.Demographics);
        Assert.False(view.AsksParticipantIdentity);

        var submit = await person.PostAsJsonAsync(
            $"/surveys/{survey.Id}/responses",
            new SubmitSurveyResponseRequest(
                Answers: [new SurveyAnswerInput(view.Questions.Single().Id, "hybrid")],
                SessionId: sessionId,
                IsComplete: true));
        Assert.Equal(HttpStatusCode.Created, submit.StatusCode);

        using (var scope = _factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>();
            var user = await db.Users.SingleAsync(u => u.Email == email);
            var stored = await db.Responses.SingleAsync(r => r.SurveyId == survey.Id);
            Assert.Equal(user.Id, stored.UserId);
            // The department the ROSTER placed them in, which is what puts this answer on the
            // department climate map rather than in an unplaceable total.
            Assert.Equal(departmentId, stored.DepartmentId);
        }
    }

    /// <summary>
    /// A half-finished ANONYMOUS survey is still there when the same person signs in from a
    /// second device.
    /// </summary>
    /// <remarks>
    /// <para>
    /// The cross-device half of the 2026-10-15 ruling. On an anonymous survey nothing writes
    /// <c>responses.user_id</c>, so the only handle on a partial was the session id the browser
    /// invented -- which a second device has never seen, and the partial read as somebody
    /// else's. <c>ResumeSessionIdFor</c> derives an id from (surveyId, userId) under the
    /// application key and <c>FindExistingResponseAsync</c> tries it BEFORE the browser's own,
    /// so the person is recognised on the second device while the row still names nobody.
    /// </para>
    /// <para>
    /// Two independent <c>CreateClient()</c> instances are the two devices: each mints its own
    /// token from the emailed credentials and carries a session id the other has never used,
    /// which is what a phone and a desktop actually do. The existing
    /// <c>Repeated_partial_saves_accumulate_into_one_response_rather_than_many</c> covers the
    /// same-browser case and cannot see this one, because there one session id does both halves.
    /// </para>
    /// <para>
    /// The last assertions are the guarantee that makes the trade acceptable: ONE response row
    /// for the survey, its <c>user_id</c> still null, and a session id that is neither device's
    /// -- so a reader holding the database alone sees an opaque token and no person.
    /// </para>
    /// </remarks>
    [Fact]
    public async Task A_half_finished_anonymous_survey_resumes_on_a_second_device()
    {
        var admin = await AdminClientAsync(_companyId);

        var email = $"marta-{Guid.NewGuid():N}@example.com";
        var import = await ImportAsync(admin, preview: false,
            new BulkImportRowInput(2, "Marta Rojas", email, "Colaborador", null, new() { ["sede"] = "belen" }));
        Assert.Equal(HttpStatusCode.OK, import.StatusCode);
        var sent = Assert.Single(_factory.Sent, s => s.ToEmail == email);

        var survey = await SurveyTestHarness.CreateSurveyAsync(admin, new CreateSurveyRequest(
            Title: LocalizedInput.FromBare("Clima 2026"),
            CompanyId: _companyId,
            Type: "periodic",
            StartDate: DateTimeOffset.UtcNow.AddDays(-1),
            EndDate: DateTimeOffset.UtcNow.AddDays(14),
            Questions:
            [
                new CreateSurveyQuestionInput(
                    LocalizedInput.FromBare("¿Dónde trabajas?"),
                    QuestionTypes.MultipleChoice,
                    Options:
                    [
                        new CreateSurveyQuestionOptionInput("remote", LocalizedInput.FromBare("Remoto")),
                        new CreateSurveyQuestionOptionInput("hybrid", LocalizedInput.FromBare("Híbrido")),
                    ],
                    Order: 0),
            ],
            Settings: new SurveySettingsInput(
                Anonymous: true, AllowPartialResponses: true, SelfDeclaredDemographics: true)));
        (await SurveyTestHarness.SetStatusAsync(admin, survey.Id, SurveyStatuses.Active))
            .EnsureSuccessStatusCode();

        // A device is a client that has signed in with the emailed credentials and holds its own
        // token -- never the admin's, and never the other device's.
        async Task<HttpClient> DeviceAsync()
        {
            var device = _factory.CreateClient();
            var login = await device.PostAsJsonAsync("/auth/login", new LoginRequest(sent.Username, sent.Password));
            Assert.Equal(HttpStatusCode.OK, login.StatusCode);
            device.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue(
                "Bearer", (await login.Content.ReadFromJsonAsync<TokenResponse>())!.Token);
            return device;
        }

        // The first device leaves the survey half finished.
        var first = await DeviceAsync();
        var firstSessionId = Guid.NewGuid().ToString("N");
        var firstView = (await first.GetFromJsonAsync<SurveyRespondView>(
            $"/surveys/{survey.Id}/respond?sessionId={firstSessionId}"))!;
        Assert.Null(firstView.InProgress);

        var questionId = firstView.Questions.Single().Id;
        var partial = await first.PostAsJsonAsync(
            $"/surveys/{survey.Id}/responses",
            new SubmitSurveyResponseRequest(
                Answers: [new SurveyAnswerInput(questionId, "hybrid")],
                SessionId: firstSessionId,
                IsComplete: false));
        Assert.Equal(HttpStatusCode.Created, partial.StatusCode);

        // The second device: the same person, its own token, and a session id the first device
        // never used.
        var second = await DeviceAsync();
        var secondSessionId = Guid.NewGuid().ToString("N");
        Assert.NotEqual(firstSessionId, secondSessionId);
        var secondView = (await second.GetFromJsonAsync<SurveyRespondView>(
            $"/surveys/{survey.Id}/respond?sessionId={secondSessionId}"))!;

        // What the ruling asked for: the half-finished answer comes back on the new device.
        Assert.NotNull(secondView.InProgress);
        Assert.False(secondView.InProgress!.IsComplete);
        Assert.Equal("hybrid", secondView.InProgress.Answers.Single(a => a.QuestionId == questionId).Value);

        // Finishing from the second device completes the SAME response rather than opening a
        // second one: OK, not Created.
        var finish = await second.PostAsJsonAsync(
            $"/surveys/{survey.Id}/responses",
            new SubmitSurveyResponseRequest(
                Answers: [new SurveyAnswerInput(questionId, "remote")],
                SessionId: secondSessionId,
                IsComplete: true));
        Assert.Equal(HttpStatusCode.OK, finish.StatusCode);

        using (var scope = _factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>();
            var stored = await db.Responses.SingleAsync(r => r.SurveyId == survey.Id);
            Assert.True(stored.IsComplete);
            Assert.Null(stored.UserId);
            Assert.NotEqual(firstSessionId, stored.SessionId);
            Assert.NotEqual(secondSessionId, stored.SessionId);
        }
    }

    /// <summary>
    /// The client's bitácora, on an ANONYMOUS survey, end to end: *"quiénes fueron invitados y
    /// todavía no han ingresado. Quiénes lo han comenzado pero no lo han terminado."*
    /// </summary>
    /// <remarks>
    /// <para>
    /// Both halves run through the real endpoints on purpose. The respond flow writes the
    /// derived session id and the roster recomputes it, and the only thing that makes those two
    /// agree is that they share <c>SurveyResumeSession</c>. A test that seeded a hand-computed
    /// id would pass against two implementations that had drifted apart, which is the failure
    /// worth catching: a respondent whose answers cannot be found again.
    /// </para>
    /// <para>
    /// The guarantee is asserted alongside the states, not instead of them: every answer on the
    /// survey still carries a NULL <c>user_id</c> while the roster names who is halfway.
    /// </para>
    /// </remarks>
    [Fact]
    public async Task An_anonymous_roster_tells_never_opened_from_started_and_stopped()
    {
        var admin = await AdminClientAsync(_companyId);

        var startedEmail = $"empezo-{Guid.NewGuid():N}@example.com";
        var absentEmail = $"nunca-{Guid.NewGuid():N}@example.com";
        var import = await ImportAsync(admin, preview: false,
            new BulkImportRowInput(2, "Empezo Sin Terminar", startedEmail, "Colaborador", null),
            new BulkImportRowInput(3, "Nunca Ingreso", absentEmail, "Colaborador", null));
        Assert.Equal(HttpStatusCode.OK, import.StatusCode);
        var sent = Assert.Single(_factory.Sent, s => s.ToEmail == startedEmail);

        var survey = await SurveyTestHarness.CreateSurveyAsync(admin, new CreateSurveyRequest(
            Title: LocalizedInput.FromBare("Clima ESPH"),
            CompanyId: _companyId,
            Type: "periodic",
            StartDate: DateTimeOffset.UtcNow.AddDays(-1),
            EndDate: DateTimeOffset.UtcNow.AddDays(14),
            Questions:
            [
                new CreateSurveyQuestionInput(
                    LocalizedInput.FromBare("¿Cómo va?"),
                    QuestionTypes.MultipleChoice,
                    Options:
                    [
                        new CreateSurveyQuestionOptionInput("bien", LocalizedInput.FromBare("Bien")),
                        new CreateSurveyQuestionOptionInput("mal", LocalizedInput.FromBare("Mal")),
                    ],
                    Order: 0),
            ],
            Settings: new SurveySettingsInput(
                Anonymous: true, AllowPartialResponses: true, SelfDeclaredDemographics: true)));
        (await SurveyTestHarness.SetStatusAsync(admin, survey.Id, SurveyStatuses.Active))
            .EnsureSuccessStatusCode();

        // Before anybody opens it, nobody has started -- and that is now a statement the survey
        // can make, where it used to have to say only "has not finished".
        var before = (await admin.GetFromJsonAsync<SurveyParticipationView>(
            $"/surveys/{survey.Id}/participation"))!;
        Assert.True(before.TracksIndividuals);
        Assert.False(before.TracksCompletionOnly);
        Assert.All(before.Roster, row =>
            Assert.Equal(SurveyParticipantStatuses.NotStarted, row.Status));

        // One of them signs in with the emailed credentials and stops halfway.
        var person = _factory.CreateClient();
        var login = await person.PostAsJsonAsync("/auth/login", new LoginRequest(sent.Username, sent.Password));
        Assert.Equal(HttpStatusCode.OK, login.StatusCode);
        person.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue(
            "Bearer", (await login.Content.ReadFromJsonAsync<TokenResponse>())!.Token);

        var browserSessionId = Guid.NewGuid().ToString("N");
        var view = (await person.GetFromJsonAsync<SurveyRespondView>(
            $"/surveys/{survey.Id}/respond?sessionId={browserSessionId}"))!;
        var partial = await person.PostAsJsonAsync(
            $"/surveys/{survey.Id}/responses",
            new SubmitSurveyResponseRequest(
                Answers: [new SurveyAnswerInput(view.Questions.Single().Id, "bien")],
                SessionId: browserSessionId,
                IsComplete: false));
        Assert.Equal(HttpStatusCode.Created, partial.StatusCode);

        var midway = (await admin.GetFromJsonAsync<SurveyParticipationView>(
            $"/surveys/{survey.Id}/participation"))!;

        // The distinction the client asked for, and the one an administrator acts on: the first
        // person needs a nudge, the second needs their sign-in details again.
        var started = Assert.Single(midway.Roster, row => row.Email == startedEmail);
        var absent = Assert.Single(midway.Roster, row => row.Email == absentEmail);
        Assert.Equal(SurveyParticipantStatuses.Started, started.Status);
        Assert.Equal(SurveyParticipantStatuses.NotStarted, absent.Status);
        Assert.Equal(1, midway.StartedCount);
        Assert.Equal(0, midway.AnsweredCount);

        // Finishing moves that same person to completed without opening a second row.
        var finish = await person.PostAsJsonAsync(
            $"/surveys/{survey.Id}/responses",
            new SubmitSurveyResponseRequest(
                Answers: [new SurveyAnswerInput(view.Questions.Single().Id, "bien")],
                SessionId: browserSessionId,
                IsComplete: true));
        Assert.Equal(HttpStatusCode.OK, finish.StatusCode);

        var after = (await admin.GetFromJsonAsync<SurveyParticipationView>(
            $"/surveys/{survey.Id}/participation"))!;
        Assert.Equal(
            SurveyParticipantStatuses.Completed,
            Assert.Single(after.Roster, row => row.Email == startedEmail).Status);
        Assert.Equal(0, after.StartedCount);
        Assert.Equal(1, after.AnsweredCount);

        // And the promise, unchanged by any of the above: not one answer carries a user id.
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>();
        Assert.Equal(0, await db.Responses.CountAsync(r => r.SurveyId == survey.Id && r.UserId != null));
        Assert.Equal(1, await db.Responses.CountAsync(r => r.SurveyId == survey.Id));
    }

    [Fact]
    public async Task A_preview_creates_no_account_and_sends_nothing()
    {
        var client = await AdminClientAsync(_companyId);
        var email = $"preview-{Guid.NewGuid():N}@example.com";

        var response = await ImportAsync(client, preview: true, new BulkImportRowInput(2, "Preview Person", email, "Colaborador", null));

        Assert.Equal("valid", Assert.Single((await response.Content.ReadFromJsonAsync<BulkImportResponse>())!.Rows).Status);
        Assert.DoesNotContain(_factory.Sent, s => s.ToEmail == email);
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>();
        Assert.False(await db.Users.AnyAsync(u => u.Email == email));
    }

    [Fact]
    public async Task A_failed_email_is_named_on_its_row_and_the_account_still_exists()
    {
        var client = await AdminClientAsync(_companyId);
        var email = $"bounce-{Guid.NewGuid():N}@example.com";
        _factory.FailFor.Add(email);

        var response = await ImportAsync(client, preview: false, new BulkImportRowInput(2, "Bounce Person", email, "Colaborador", null));

        var row = Assert.Single((await response.Content.ReadFromJsonAsync<BulkImportResponse>())!.Rows);
        Assert.Equal("created", row.Status);
        Assert.Contains(row.Issues, i => i.Code == "credentials_not_sent");
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>();
        Assert.True(await db.Users.AnyAsync(u => u.Email == email && u.Username != null));
    }

    [Fact]
    public async Task Without_the_flag_the_import_still_sends_invitations_and_creates_no_account()
    {
        var client = await AdminClientAsync(_companyId);
        var email = $"invite-{Guid.NewGuid():N}@example.com";

        var response = await client.PostAsJsonAsync("/admin/users/bulk-import/rows", new BulkImportRowsRequest(
            _companyId, false, [new BulkImportRowInput(2, "Invited Person", email, "Colaborador", null)]));

        var body = (await response.Content.ReadFromJsonAsync<BulkImportResponse>())!;
        Assert.Equal("invited", Assert.Single(body.Rows).Status);
        Assert.Equal(BulkImportDelivery.Invitation, body.Delivery);
        Assert.DoesNotContain(_factory.Sent, s => s.ToEmail == email);
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>();
        Assert.False(await db.Users.AnyAsync(u => u.Email == email));
    }

    [Fact]
    public async Task Resend_replaces_the_password_keeps_the_username_and_never_returns_the_password()
    {
        var client = await AdminClientAsync(_companyId);
        var email = $"resend-{Guid.NewGuid():N}@example.com";
        await ImportAsync(client, preview: false, new BulkImportRowInput(2, "Resend Person", email, "Colaborador", null));
        var first = Assert.Single(_factory.Sent, s => s.ToEmail == email);
        Guid userId;
        using (var scope = _factory.Services.CreateScope())
        {
            userId = await scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>().Users
                .Where(u => u.Email == email).Select(u => u.Id).SingleAsync();
        }

        var resend = await client.PostAsync($"/admin/users/{userId}/credentials", null);

        Assert.Equal(HttpStatusCode.OK, resend.StatusCode);
        var body = await resend.Content.ReadAsStringAsync();
        Assert.Contains("\"delivered\":true", body, StringComparison.Ordinal);
        var second = _factory.Sent.Where(s => s.ToEmail == email).Last();
        Assert.NotSame(first, second);
        Assert.Equal(first.Username, second.Username);
        Assert.NotEqual(first.Password, second.Password);
        Assert.DoesNotContain(second.Password, body, StringComparison.Ordinal);

        var anonymous = _factory.CreateClient();
        Assert.Equal(HttpStatusCode.Unauthorized, await LoginStatusAsync(anonymous, first.Username, first.Password));
        Assert.Equal(HttpStatusCode.OK, await LoginStatusAsync(anonymous, second.Username, second.Password));
    }

    [Fact]
    public async Task Resend_refuses_an_account_that_signs_in_by_email()
    {
        var client = await AdminClientAsync(_companyId);
        Guid adminId;
        using (var scope = _factory.Services.CreateScope())
        {
            adminId = await scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>().Users
                .Where(u => u.CompanyId == _companyId && u.Role == Roles.CompanyAdmin).Select(u => u.Id).FirstAsync();
        }

        var response = await client.PostAsync($"/admin/users/{adminId}/credentials", null);

        Assert.Equal(HttpStatusCode.Conflict, response.StatusCode);
    }

    [Fact]
    public async Task Another_companys_admin_cannot_resend_and_learns_nothing()
    {
        var owner = await AdminClientAsync(_companyId);
        var email = $"tenant-{Guid.NewGuid():N}@example.com";
        await ImportAsync(owner, preview: false, new BulkImportRowInput(2, "Tenant Person", email, "Colaborador", null));
        Guid userId;
        using (var scope = _factory.Services.CreateScope())
        {
            userId = await scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>().Users
                .Where(u => u.Email == email).Select(u => u.Id).SingleAsync();
        }

        var stranger = await AdminClientAsync(_otherCompanyId);
        var sentBefore = _factory.Sent.Count(s => s.ToEmail == email);

        var response = await stranger.PostAsync($"/admin/users/{userId}/credentials", null);

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
        Assert.Equal(sentBefore, _factory.Sent.Count(s => s.ToEmail == email));
    }

    [Fact]
    public async Task The_user_list_shows_which_accounts_have_a_generated_username()
    {
        var client = await AdminClientAsync(_companyId);
        var email = $"listed-{Guid.NewGuid():N}@example.com";
        await ImportAsync(client, preview: false, new BulkImportRowInput(2, "Listed Person", email, "Colaborador", null));

        var list = await client.GetFromJsonAsync<UserListResponse>($"/admin/users?companyId={_companyId}");

        var listed = Assert.Single(list!.Users, u => u.Email == email);
        Assert.Equal(Assert.Single(_factory.Sent, s => s.ToEmail == email).Username, listed.Username);
        Assert.All(list.Users.Where(u => u.Email != email && !u.Email.StartsWith("ana-") && !u.Email.StartsWith("resend-")
                                         && !u.Email.StartsWith("bounce-") && !u.Email.StartsWith("tenant-")),
            u => Assert.Null(u.Username));
    }
    /// <summary>
    /// The launch-day batch: pick the people who have not finished and send them all their
    /// sign-in details again. Ruled 2026-10-14 -- the reminder carries the username AND a
    /// password, which can only be a NEW one, because the first was discarded after hashing.
    /// </summary>
    [Fact]
    public async Task A_batch_gives_every_person_a_new_password_and_invalidates_the_old_one()
    {
        var client = await AdminClientAsync(_companyId);
        var one = $"batch-one-{Guid.NewGuid():N}@example.com";
        var two = $"batch-two-{Guid.NewGuid():N}@example.com";
        await ImportAsync(
            client,
            preview: false,
            new BulkImportRowInput(2, "Batch One", one, "Colaborador", null),
            new BulkImportRowInput(3, "Batch Two", two, "Colaborador", null));

        var firstOne = Assert.Single(_factory.Sent, s => s.ToEmail == one);
        var firstTwo = Assert.Single(_factory.Sent, s => s.ToEmail == two);
        var ids = await IdsOfAsync(one, two);

        var response = await client.PostAsJsonAsync("/admin/users/credentials", new { userIds = ids });

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var result = (await response.Content.ReadFromJsonAsync<CredentialsResendBatchResult>())!;
        Assert.Equal(2, result.Requested);
        Assert.Equal(2, result.Sent);
        Assert.Equal(0, result.Failed);
        Assert.All(result.Outcomes, o => Assert.True(o.Delivered));

        // The password is never in the response body: its owner reads it in their inbox.
        var body = await response.Content.ReadAsStringAsync();
        var secondOne = _factory.Sent.Where(s => s.ToEmail == one).Last();
        Assert.DoesNotContain(secondOne.Password, body, StringComparison.Ordinal);

        // The username is kept and the old password is dead -- for every person in the batch.
        Assert.Equal(firstOne.Username, secondOne.Username);
        var anonymous = _factory.CreateClient();
        Assert.Equal(HttpStatusCode.Unauthorized, await LoginStatusAsync(anonymous, firstOne.Username, firstOne.Password));
        Assert.Equal(HttpStatusCode.OK, await LoginStatusAsync(anonymous, secondOne.Username, secondOne.Password));

        var secondTwo = _factory.Sent.Where(s => s.ToEmail == two).Last();
        Assert.Equal(HttpStatusCode.Unauthorized, await LoginStatusAsync(anonymous, firstTwo.Username, firstTwo.Password));
        Assert.Equal(HttpStatusCode.OK, await LoginStatusAsync(anonymous, secondTwo.Username, secondTwo.Password));
    }

    /// <summary>
    /// Every person is accounted for, including the ones who got nothing -- the #558 defect one
    /// layer up, where a count that silently shrank read as "all sent".
    /// </summary>
    [Fact]
    public async Task A_batch_names_the_people_it_could_not_send_to_and_still_sends_the_rest()
    {
        var client = await AdminClientAsync(_companyId);
        var good = $"batch-good-{Guid.NewGuid():N}@example.com";
        await ImportAsync(client, preview: false, new BulkImportRowInput(2, "Batch Good", good, "Colaborador", null));
        var goodId = (await IdsOfAsync(good)).Single();

        Guid adminId;
        using (var scope = _factory.Services.CreateScope())
        {
            adminId = await scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>().Users
                .Where(u => u.CompanyId == _companyId && u.Role == Roles.CompanyAdmin).Select(u => u.Id).FirstAsync();
        }
        var ghost = Guid.NewGuid();
        var before = _factory.Sent.Count(s => s.ToEmail == good);

        var response = await client.PostAsJsonAsync(
            "/admin/users/credentials", new { userIds = new[] { goodId, adminId, ghost } });

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var result = (await response.Content.ReadFromJsonAsync<CredentialsResendBatchResult>())!;
        Assert.Equal(3, result.Requested);
        Assert.Equal(1, result.Sent);
        Assert.Equal(2, result.Failed);
        Assert.Equal("not_mass_invite", result.Outcomes.Single(o => o.UserId == adminId).Code);
        Assert.Equal("not_found", result.Outcomes.Single(o => o.UserId == ghost).Code);
        Assert.True(result.Outcomes.Single(o => o.UserId == goodId).Delivered);
        Assert.Equal(before + 1, _factory.Sent.Count(s => s.ToEmail == good));
    }

    /// <summary>
    /// The cap exists because the send is inline and holds a database connection; a request
    /// over it must change nothing at all rather than send part of a roster.
    /// </summary>
    [Fact]
    public async Task A_batch_over_the_cap_is_refused_before_anything_is_sent()
    {
        var client = await AdminClientAsync(_companyId);
        var email = $"batch-cap-{Guid.NewGuid():N}@example.com";
        await ImportAsync(client, preview: false, new BulkImportRowInput(2, "Batch Cap", email, "Colaborador", null));
        var id = (await IdsOfAsync(email)).Single();
        var before = _factory.Sent.Count(s => s.ToEmail == email);

        var tooMany = Enumerable.Range(0, MassInviteEndpoints.MaxBatch).Select(_ => Guid.NewGuid()).Append(id).ToArray();
        var response = await client.PostAsJsonAsync("/admin/users/credentials", new { userIds = tooMany });

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Contains("batch_too_large", await response.Content.ReadAsStringAsync(), StringComparison.Ordinal);
        Assert.Equal(before, _factory.Sent.Count(s => s.ToEmail == email));
    }

    [Fact]
    public async Task Another_companys_admin_cannot_batch_send_and_no_mail_leaves()
    {
        var owner = await AdminClientAsync(_companyId);
        var email = $"batch-tenant-{Guid.NewGuid():N}@example.com";
        await ImportAsync(owner, preview: false, new BulkImportRowInput(2, "Batch Tenant", email, "Colaborador", null));
        var id = (await IdsOfAsync(email)).Single();
        var before = _factory.Sent.Count(s => s.ToEmail == email);

        var stranger = await AdminClientAsync(_otherCompanyId);
        var response = await stranger.PostAsJsonAsync("/admin/users/credentials", new { userIds = new[] { id } });

        // 200 with a per-row "not_found": the batch reports each id without confirming which
        // ones exist in another tenant, and nothing is mailed.
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var result = (await response.Content.ReadFromJsonAsync<CredentialsResendBatchResult>())!;
        Assert.Equal(0, result.Sent);
        Assert.Equal("not_found", Assert.Single(result.Outcomes).Code);
        Assert.Equal(before, _factory.Sent.Count(s => s.ToEmail == email));
    }

    /// <summary>
    /// WHICH message each route sends, which is the one thing the two routes do differently.
    ///
    /// <para>
    /// The bulk route re-sent the invitation -- *"Tu organización te invita a responder una
    /// encuesta"* -- to people who had already read exactly that, while the client had asked for
    /// *"un correo solicitándoles que por favor ingresen y lo hagan"*. Nothing failed, because
    /// both messages carry the same username and the same freshly generated password: the
    /// difference is only in the words, so only a test that reads the purpose can see it.
    /// </para>
    /// </summary>
    [Fact]
    public async Task The_batch_sends_a_reminder_while_a_single_resend_repeats_the_invitation()
    {
        var client = await AdminClientAsync(_companyId);
        var email = $"purpose-{Guid.NewGuid():N}@example.com";
        await ImportAsync(client, preview: false, new BulkImportRowInput(2, "Purpose Person", email, "Colaborador", null));

        // The import is first contact: its reader has never heard of the account.
        var invited = Assert.Single(_factory.Sent, s => s.ToEmail == email);
        Assert.Equal(CredentialsEmailPurpose.Invitation, invited.Purpose);

        var ids = await IdsOfAsync(email);

        // The bulk route is the roster's "Enviar recordatorio": everyone in the batch was picked
        // for NOT having finished, so it asks them to go in and finish.
        var batch = await client.PostAsJsonAsync("/admin/users/credentials", new { userIds = ids });
        Assert.Equal(HttpStatusCode.OK, batch.StatusCode);
        Assert.Equal(CredentialsEmailPurpose.Reminder, _factory.Sent.Where(s => s.ToEmail == email).Last().Purpose);

        // The single route stays an invitation: one administrator fixing one person, who most
        // often never received the first message or has lost it.
        var single = await client.PostAsync($"/admin/users/{ids[0]}/credentials", null);
        Assert.Equal(HttpStatusCode.OK, single.StatusCode);
        Assert.Equal(CredentialsEmailPurpose.Invitation, _factory.Sent.Where(s => s.ToEmail == email).Last().Purpose);

        // All three are `shared` account details, which open every survey their holder is
        // targeted by: none names a survey or a close day, so the composer sends the copy whose
        // "ask your administrator to send new ones" this very route makes true (audit R3/R4).
        Assert.All(_factory.Sent.Where(s => s.ToEmail == email), s =>
        {
            Assert.Null(s.SurveyName);
            Assert.Null(s.SurveyClosesOn);
        });
    }

    /// <summary>
    /// The account a mass invite creates speaks the COMPANY's language, not the <c>"en"</c> that
    /// <see cref="UserPreferences"/> defaults to.
    ///
    /// <para>
    /// Measured on ESPH, 2026-10-16. Its holder has chosen no language — the account was created
    /// from a spreadsheet row — and <c>UserPreferences.Language</c> is the FIRST thing every
    /// message to them is resolved against: <c>SurveyDistributionEndpoints.RecipientLocale</c>
    /// reads it before it will look at the survey's own language. Left at <c>"en"</c> it decides
    /// the invitation subject and body of any survey carrying no custom text, the title and body
    /// of the in-app notification rows, and — whatever any survey says — EVERY reminder subject,
    /// because <c>BuildReminderNotification</c> passes <c>custom: null</c> and
    /// <c>DefaultReminderSubject[locale]</c> is its only source. A Spanish survey, invited from a
    /// Spanish company, into a Costa Rican workforce, reminded in English.
    /// </para>
    /// <para>
    /// Both halves matter: the Spanish company proves the value is applied, and the company with
    /// no language set proves it is READ rather than hardcoded to Spanish — which would be the
    /// same defect pointing the other way for an English tenant.
    /// </para>
    /// </summary>
    [Fact]
    public async Task An_imported_account_speaks_its_companys_language_and_not_the_en_a_preference_defaults_to()
    {
        var spanishEmail = $"idioma-es-{Guid.NewGuid():N}@example.com";
        var client = await AdminClientAsync(_companyId);
        Assert.Equal(HttpStatusCode.OK, (await ImportAsync(client, preview: false,
            new BulkImportRowInput(2, "Ana Rojas", spanishEmail, "Colaborador", null))).StatusCode);

        // `other` is created with no Settings at all, so its language is the Company default.
        var englishEmail = $"idioma-en-{Guid.NewGuid():N}@example.com";
        var stranger = await AdminClientAsync(_otherCompanyId);
        var response = await stranger.PostAsJsonAsync("/admin/users/bulk-import/rows", new BulkImportRowsRequest(
            _otherCompanyId, false, [new BulkImportRowInput(2, "Ann Rogers", englishEmail, "employee", null)], WithCredentials: true));
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);

        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>();
        Assert.Equal("es", (await db.Users.FirstAsync(u => u.Email == spanishEmail)).Preferences.Language);
        Assert.Equal("en", (await db.Users.FirstAsync(u => u.Email == englishEmail)).Preferences.Language);
    }

    private async Task<Guid[]> IdsOfAsync(params string[] emails)
    {
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>();
        var found = await db.Users.Where(u => emails.Contains(u.Email))
            .Select(u => new { u.Id, u.Email }).ToListAsync();
        return [.. emails.Select(e => found.Single(f => f.Email == e).Id)];
    }
}
