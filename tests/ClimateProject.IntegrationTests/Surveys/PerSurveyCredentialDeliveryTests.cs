using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using ClimateProject.Api.Endpoints;
using ClimateProject.Application.Auth;
using ClimateProject.Application.Localization;
using ClimateProject.Application.OrgStructure;
using ClimateProject.Application.Surveys;
using ClimateProject.Domain.Entities;
using ClimateProject.Infrastructure.Persistence;
using ClimateProject.IntegrationTests.Support;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace ClimateProject.IntegrationTests.Surveys;

/// <summary>
/// ESPH's requirement, end to end, read off the messages the product actually composed.
///
/// <para>
/// From the call on 2026-10-19: "Cada usuario y cada contraseña son diferentes ... Por cada
/// encuesta hay que generar un usuario y contraseña diferente ... Se puede repetir un correo
/// varias veces." One person is in Clima and in Teletrabajo; they must receive two messages,
/// with two different usernames and two different passwords, and the subject must say which
/// survey each one opens.
/// </para>
/// <para>
/// Every password is read from the captured email, because that is the only place the
/// product ever puts one -- it is hashed before the row is saved and the plaintext exists
/// only between the save and the send.
/// </para>
/// </summary>
[Collection("Postgres")]
public class PerSurveyCredentialDeliveryTests(PostgresContainerFixture postgres, CapturingCredentialsHostFixture credentials)
    : IAsyncLifetime, IClassFixture<CapturingCredentialsHostFixture>
{
    private readonly string _domain = $"psc-{Guid.NewGuid():N}.test";
    private Guid _companyId;
    private Guid _sedeFieldId;
    private CapturingCredentialsFactory _factory = null!;

    public async Task InitializeAsync()
    {
        _factory = credentials.HostFor(postgres.ConnectionString);
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>();

        var company = new Company
        {
            Id = Guid.NewGuid(),
            Name = "Servicio Público de Heredia",
            EmailDomain = _domain,
            CreatedAt = DateTimeOffset.UtcNow,
            Settings = new CompanySettings { Language = "es", CredentialMode = CredentialModes.PerSurvey },
        };
        db.Companies.Add(company);
        _companyId = company.Id;

        var now = DateTimeOffset.UtcNow;
        var field = new DemographicField
        {
            Id = Guid.NewGuid(), CompanyId = _companyId, Field = "sede", LabelEs = "Sede",
            Type = "select", Order = 1, CreatedAt = now, UpdatedAt = now,
        };
        db.DemographicFields.Add(field);
        db.DemographicFieldOptions.Add(new DemographicFieldOption
        {
            DemographicFieldId = field.Id, Order = 1, Value = "heredia", LabelEs = "Heredia",
        });
        _sedeFieldId = field.Id;

        await db.SaveChangesAsync();
    }

    public Task DisposeAsync() => Task.CompletedTask;

    private async Task<HttpClient> AdminClientAsync()
    {
        var client = _factory.CreateClient();
        var email = $"{Guid.NewGuid():N}@{_domain}";
        (await client.PostAsJsonAsync("/auth/signup", new SignupRequest("Admin", email, "A-good-passw0rd")))
            .EnsureSuccessStatusCode();

        using (var scope = _factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>();
            var user = await db.Users.FirstAsync(u => u.Email == email);
            user.Role = Roles.CompanyAdmin;
            user.CompanyId = _companyId;
            await db.SaveChangesAsync();
        }

        var login = await client.PostAsJsonAsync("/auth/login", new LoginRequest(email, "A-good-passw0rd"));
        var token = (await login.Content.ReadFromJsonAsync<TokenResponse>())!.Token;
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);
        return client;
    }

    private async Task<SurveyDetail> ActiveSurveyAsync(HttpClient client, string titleEs)
    {
        var created = await SurveyTestHarness.CreateSurveyAsync(
            client,
            SurveyTestHarness.MinimalRequest(_companyId, title: SurveyTestHarness.Both(titleEs, titleEs)));
        (await SurveyTestHarness.SetStatusAsync(client, created.Id, SurveyStatuses.Active)).EnsureSuccessStatusCode();
        return created;
    }

    private async Task<Guid> SeedEmployeeAsync(string email)
    {
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>();
        var user = new User
        {
            Id = Guid.NewGuid(),
            CompanyId = _companyId,
            Email = email,
            Name = "Persona",
            Role = Roles.Employee,
            IsActive = true,
            CreatedAt = DateTimeOffset.UtcNow,
            UpdatedAt = DateTimeOffset.UtcNow,
        };
        db.Users.Add(user);
        await db.SaveChangesAsync();
        return user.Id;
    }

    private Task<SurveyInvitationBatchResult> InviteAsync(HttpClient client, Guid surveyId, Guid userId)
        => client.PostAsJsonAsync($"/surveys/{surveyId}/invitations", new CreateSurveyInvitationsRequest(UserIds: [userId]))
            .ContinueWith(t => t.Result.Content.ReadFromJsonAsync<SurveyInvitationBatchResult>().Result!);

    private Task<HttpResponseMessage> ImportAsync(
        HttpClient client, string email, bool withCredentials = false, bool preview = false)
        => client.PostAsJsonAsync("/admin/users/bulk-import/rows", new BulkImportRowsRequest(
            _companyId, preview,
            [new BulkImportRowInput(3, "Persona Importada", email, "employee", null, new() { ["sede"] = "heredia" })],
            WithCredentials: withCredentials));

    /// <summary>
    /// The roster import, in this mode, creates the accounts and mails NOTHING.
    ///
    /// <para>Measured on 2026-10-20: both importer paths mailed an account message --
    /// <c>withCredentials</c> an account username and password, and without it an account
    /// INVITATION to choose a password. Either one is a THIRD message for somebody in two
    /// surveys, where the 2026-10-19 ruling allows two: one per survey, with the code.</para>
    ///
    /// <para>The account is deliberately keyless. A username or a password hash on
    /// <c>users</c> would be a second, WIDER key than the one this mode hands out -- it opens
    /// every survey its holder is targeted by, which is what the mode exists to deny.</para>
    /// </summary>
    [Fact]
    public async Task The_roster_import_creates_a_keyless_account_and_mails_nothing()
    {
        var admin = await AdminClientAsync();
        var email = $"{Guid.NewGuid():N}@persona.example.com";

        var response = await ImportAsync(admin, email);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = (await response.Content.ReadFromJsonAsync<BulkImportResponse>())!;
        Assert.Equal(BulkImportDelivery.None, body.Delivery);
        Assert.Equal("created", Assert.Single(body.Rows).Status);

        // Nothing left, through either sender: no account credentials...
        Assert.DoesNotContain(_factory.Sent, m => m.ToEmail == email);

        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>();

        // ...and no account INVITATION either, which is the half that was still mailing.
        Assert.False(await db.UserInvitations.AnyAsync(i => i.Email == email));

        var user = await db.Users.SingleAsync(u => u.Email == email);
        Assert.Null(user.Username);
        Assert.Null(user.PasswordHash);
        Assert.Equal(Roles.Employee, user.Role);

        // The company's language, not the "en" a UserPreferences defaults to: this row is
        // what every later message to this person is resolved against.
        Assert.Equal("es", user.Preferences.Language);

        // And their demographics are on the account, so the survey never asks them.
        Assert.Equal(
            "heredia",
            (await db.UserDemographics.SingleAsync(d => d.UserId == user.Id && d.DemographicFieldId == _sedeFieldId)).Value);
    }

    /// <summary>
    /// A preview is refused exactly as an apply is, so the refusal cannot be learned after
    /// rows have been written. Nothing is created and nothing is mailed by either.
    /// </summary>
    [Theory]
    [InlineData(true)]
    [InlineData(false)]
    public async Task An_import_that_asks_to_mail_account_credentials_is_refused(bool preview)
    {
        var admin = await AdminClientAsync();
        var email = $"{Guid.NewGuid():N}@persona.example.com";

        var response = await ImportAsync(admin, email, withCredentials: true, preview: preview);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Contains("per_survey", await response.Content.ReadAsStringAsync());
        Assert.DoesNotContain(_factory.Sent, m => m.ToEmail == email);

        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>();
        Assert.False(await db.Users.AnyAsync(u => u.Email == email));
        Assert.False(await db.UserInvitations.AnyAsync(i => i.Email == email));
    }

    /// <summary>
    /// The rehearsal, end to end and through the routes a launch actually uses: the person is
    /// created by the ROSTER IMPORT, not seeded, and receives exactly two messages -- one per
    /// survey -- each of which opens its own survey and nothing else.
    ///
    /// <para>The separate pieces are pinned above against a seeded user. This is the one that
    /// proves the keyless account the import now creates is a person the invite route can
    /// credential and who can then sign in: three routes that each worked alone, in the order
    /// Wednesday runs them.</para>
    /// </summary>
    [Fact]
    public async Task An_imported_person_receives_one_key_per_survey_and_each_opens_only_its_own()
    {
        var admin = await AdminClientAsync();
        var email = $"{Guid.NewGuid():N}@persona.example.com";
        (await ImportAsync(admin, email)).EnsureSuccessStatusCode();

        Guid userId;
        using (var scope = _factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>();
            userId = (await db.Users.SingleAsync(u => u.Email == email)).Id;
        }

        var clima = await ActiveSurveyAsync(admin, "Clima Organizacional");
        var teletrabajo = await ActiveSurveyAsync(admin, "Teletrabajo");
        Assert.Equal(1, (await InviteAsync(admin, clima.Id, userId)).CredentialsIssued);
        Assert.Equal(1, (await InviteAsync(admin, teletrabajo.Id, userId)).CredentialsIssued);

        var mail = _factory.Sent.Where(m => m.ToEmail == email).ToList();
        Assert.Equal(2, mail.Count);
        Assert.Equal(2, mail.Select(m => m.Username).Distinct().Count());
        Assert.Equal(2, mail.Select(m => m.Password).Distinct().Count());
        Assert.Contains(mail, m => m.SurveyName == "Clima Organizacional");
        Assert.Contains(mail, m => m.SurveyName == "Teletrabajo");

        var climaMail = mail.Single(m => m.SurveyName == "Clima Organizacional");
        var client = _factory.CreateClient();
        var login = await client.PostAsJsonAsync("/auth/login", new LoginRequest(climaMail.Username, climaMail.Password));
        login.EnsureSuccessStatusCode();
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue(
            "Bearer", (await login.Content.ReadFromJsonAsync<TokenResponse>())!.Token);

        var mine = await client.GetFromJsonAsync<MySurveyListResponse>("/surveys/my");
        Assert.Equal([clima.Id], mine!.Surveys.Select(s => s.Id).ToList());

        // And the account itself opens nothing: the address it was imported under has no
        // password at all, so the only way in is the key that names one survey.
        Assert.Equal(
            HttpStatusCode.Unauthorized,
            (await client.PostAsJsonAsync("/auth/login", new LoginRequest(email, climaMail.Password))).StatusCode);
    }

    /// <summary>
    /// The requirement itself. One address, two surveys, two messages that can be told
    /// apart -- which is the part that matters, because two "Tu acceso a OCC" carrying two
    /// different passwords is how somebody uses the wrong one and is told it is invalid.
    /// </summary>
    [Fact]
    public async Task One_person_in_two_surveys_receives_two_distinguishable_messages()
    {
        var admin = await AdminClientAsync();
        var clima = await ActiveSurveyAsync(admin, "Encuesta de Clima Organizacional");
        var teletrabajo = await ActiveSurveyAsync(admin, "Encuesta de Teletrabajo");
        var email = $"{Guid.NewGuid():N}@persona.example.com";
        var employee = await SeedEmployeeAsync(email);

        var first = await InviteAsync(admin, clima.Id, employee);
        var second = await InviteAsync(admin, teletrabajo.Id, employee);

        Assert.Equal(1, first.CredentialsIssued);
        Assert.Equal(1, second.CredentialsIssued);

        var mail = _factory.Sent.Where(m => m.ToEmail == email).ToList();
        Assert.Equal(2, mail.Count);

        // Different username AND different password, which is what the client asked for.
        Assert.Equal(2, mail.Select(m => m.Username).Distinct().Count());
        Assert.Equal(2, mail.Select(m => m.Password).Distinct().Count());

        // And each names its own survey, so the inbox can tell them apart.
        Assert.Contains(mail, m => m.SurveyName == "Encuesta de Clima Organizacional");
        Assert.Contains(mail, m => m.SurveyName == "Encuesta de Teletrabajo");

        // ...and the employer, which the call also asked for: "de la empresa Servicio
        // Público de Heredia".
        Assert.All(mail, m => Assert.Equal("Servicio Público de Heredia", m.CompanyName));
    }

    /// <summary>
    /// The password in the mail is the one that works, and it opens only its own survey.
    /// Proves the row and the message agree -- a password hashed into a row that the mail
    /// does not carry would sign nobody in, and nothing else would notice.
    /// </summary>
    [Fact]
    public async Task The_mailed_password_signs_in_and_opens_only_that_survey()
    {
        var admin = await AdminClientAsync();
        var clima = await ActiveSurveyAsync(admin, "Clima");
        var teletrabajo = await ActiveSurveyAsync(admin, "Teletrabajo");
        var email = $"{Guid.NewGuid():N}@persona.example.com";
        var employee = await SeedEmployeeAsync(email);

        await InviteAsync(admin, clima.Id, employee);
        await InviteAsync(admin, teletrabajo.Id, employee);

        var climaMail = _factory.Sent.Single(m => m.ToEmail == email && m.SurveyName == "Clima");

        var client = _factory.CreateClient();
        var login = await client.PostAsJsonAsync("/auth/login", new LoginRequest(climaMail.Username, climaMail.Password));
        login.EnsureSuccessStatusCode();
        var token = (await login.Content.ReadFromJsonAsync<TokenResponse>())!.Token;
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);

        var mine = await client.GetFromJsonAsync<MySurveyListResponse>("/surveys/my");
        Assert.Equal([clima.Id], mine!.Surveys.Select(s => s.Id).ToList());
        Assert.DoesNotContain(teletrabajo.Id, mine.Surveys.Select(s => s.Id));
    }

    /// <summary>
    /// Re-runnable. This route is called again whenever an audience grows, and re-minting
    /// would silently invalidate a password somebody is already holding.
    /// </summary>
    [Fact]
    public async Task Inviting_the_same_person_again_does_not_reissue_their_credential()
    {
        var admin = await AdminClientAsync();
        var survey = await ActiveSurveyAsync(admin, "Clima");
        var email = $"{Guid.NewGuid():N}@persona.example.com";
        var employee = await SeedEmployeeAsync(email);

        await InviteAsync(admin, survey.Id, employee);
        var again = await InviteAsync(admin, survey.Id, employee);

        Assert.Equal(0, again.CredentialsIssued);
        Assert.Single(_factory.Sent, m => m.ToEmail == email);
    }

    /// <summary>
    /// A key whose only copy never left is withdrawn, so the state is repairable.
    ///
    /// <para>The password is hashed before the row is saved and the plaintext dies with the
    /// request, so a kept row would be a person who can never sign in: the account resend
    /// refuses an account with no username, and this route would skip them for ever because
    /// they "already hold" a credential. Dropping it leaves them invited with no key.</para>
    /// </summary>
    [Fact]
    public async Task A_credential_whose_mail_failed_is_withdrawn_and_the_invitation_stands()
    {
        var admin = await AdminClientAsync();
        var survey = await ActiveSurveyAsync(admin, "Clima");
        var email = $"{Guid.NewGuid():N}@persona.example.com";
        _factory.FailFor.Add(email);
        var employee = await SeedEmployeeAsync(email);

        var result = await InviteAsync(admin, survey.Id, employee);

        Assert.Equal(1, result.Created);
        Assert.Equal(0, result.CredentialsIssued);
        Assert.Equal(1, result.CredentialsNotSent);
        Assert.DoesNotContain(_factory.Sent, m => m.ToEmail == email);

        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>();
        // No key, because nobody was told it...
        Assert.False(await db.SurveyCredentials.AnyAsync(c => c.SurveyId == survey.Id && c.UserId == employee));
        // ...and the invitation stands, because it is the completion-tracking artefact and
        // its token was never the thing that failed.
        Assert.True(await db.SurveyInvitations.AnyAsync(i => i.SurveyId == survey.Id && i.UserId == employee));
    }

    /// <summary>
    /// The repair itself: re-running the same request mints and mails a FRESH pair to somebody
    /// who is already invited and holds no key.
    ///
    /// <para>This is the half that the route could not do before. Credentials used to be
    /// minted only for invitations created by that same call, and an invitation row is created
    /// once -- so after the first run this loop walked an empty list for ever, whatever the
    /// state of the keys. It now walks the audience the request resolved.</para>
    /// </summary>
    [Fact]
    public async Task Re_running_mints_a_fresh_key_for_somebody_invited_who_holds_none()
    {
        var admin = await AdminClientAsync();
        var survey = await ActiveSurveyAsync(admin, "Clima");
        var email = $"{Guid.NewGuid():N}@persona.example.com";
        var employee = await SeedEmployeeAsync(email);

        Assert.Equal(1, (await InviteAsync(admin, survey.Id, employee)).CredentialsIssued);
        var first = Assert.Single(_factory.Sent, m => m.ToEmail == email);

        // The state a failed send leaves behind, and the one an operator reaches by deleting
        // the row: invited, with no key.
        using (var scope = _factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>();
            db.SurveyCredentials.RemoveRange(
                await db.SurveyCredentials.Where(c => c.SurveyId == survey.Id && c.UserId == employee).ToListAsync());
            await db.SaveChangesAsync();
        }

        var again = await InviteAsync(admin, survey.Id, employee);

        // No new invitation -- they already held one, which is exactly why this used to be
        // unreachable -- and a new key all the same.
        Assert.Equal(0, again.Created);
        Assert.Equal(1, again.CredentialsIssued);

        var mail = _factory.Sent.Where(m => m.ToEmail == email).ToList();
        Assert.Equal(2, mail.Count);
        Assert.NotEqual(first.Password, mail[1].Password);

        // And the fresh one is the one that works.
        var client = _factory.CreateClient();
        Assert.Equal(
            HttpStatusCode.OK,
            (await client.PostAsJsonAsync("/auth/login", new LoginRequest(mail[1].Username, mail[1].Password))).StatusCode);
        Assert.Equal(
            HttpStatusCode.Unauthorized,
            (await client.PostAsJsonAsync("/auth/login", new LoginRequest(first.Username, first.Password))).StatusCode);
    }

    /// <summary>
    /// The mode is opt-in, so a `shared` survey must mint nothing at all -- its people
    /// already hold an account that opens every survey they are targeted by.
    /// </summary>
    [Fact]
    public async Task A_shared_survey_mints_no_credential_and_sends_nothing()
    {
        var admin = await AdminClientAsync();
        var created = await SurveyTestHarness.CreateSurveyAsync(
            admin,
            SurveyTestHarness.MinimalRequest(_companyId) with
            {
                Settings = new SurveySettingsInput(CredentialMode: CredentialModes.Shared),
            });
        (await SurveyTestHarness.SetStatusAsync(admin, created.Id, SurveyStatuses.Active)).EnsureSuccessStatusCode();

        var email = $"{Guid.NewGuid():N}@persona.example.com";
        var employee = await SeedEmployeeAsync(email);
        var result = await InviteAsync(admin, created.Id, employee);

        Assert.Equal(1, result.Created);
        Assert.Equal(0, result.CredentialsIssued);
        Assert.DoesNotContain(_factory.Sent, m => m.ToEmail == email);

        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>();
        Assert.False(await db.SurveyCredentials.AnyAsync(c => c.SurveyId == created.Id));
    }
}
