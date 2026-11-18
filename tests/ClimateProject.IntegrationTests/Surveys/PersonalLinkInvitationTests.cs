using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using ClimateProject.Api.Endpoints;
using ClimateProject.Application.Auth;
using ClimateProject.Application.Localization;
using ClimateProject.Application.Surveys;
using ClimateProject.Domain.Entities;
using ClimateProject.Infrastructure.Persistence;
using ClimateProject.Infrastructure.Scheduling;
using ClimateProject.IntegrationTests.Support;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging.Abstractions;

namespace ClimateProject.IntegrationTests.Surveys;

/// <summary>
/// `personal_link`, ruled 2026-11-18 for PROCOMER's application on 1 December: «Enviar
/// invitaciones» mails each invitee their own <c>/survey-invitations/{token}</c> link and nothing
/// else, and that link opens the climate survey as that person -- department and demographics
/// from the account, the survey's anonymity unchanged. Read off the captured mail and the rows
/// the product actually wrote.
/// </summary>
[Collection("Postgres")]
public class PersonalLinkInvitationTests(PostgresContainerFixture postgres, CapturingCredentialsHostFixture credentials)
    : IAsyncLifetime, IClassFixture<CapturingCredentialsHostFixture>
{
    private const string Subject = "Encuesta de Clima Organizacional 2026: ¡Tu participación es importante!";
    private const string Body = "¡Tu opinión cuenta! Te invitamos a participar en la Encuesta de Clima Organizacional.";

    private readonly string _domain = $"plk-{Guid.NewGuid():N}.test";
    private Guid _companyId;
    private Guid _comercio;
    private Guid _finanzas;
    private Guid _sedeFieldId;
    private CapturingCredentialsFactory _factory = null!;

    public async Task InitializeAsync()
    {
        _factory = credentials.HostFor(postgres.ConnectionString);
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>();
        var now = DateTimeOffset.UtcNow;

        var company = new Company
        {
            Id = Guid.NewGuid(),
            Name = "PROCOMER",
            EmailDomain = _domain,
            CreatedAt = now,
            Settings = new CompanySettings { Language = "es", CredentialMode = CredentialModes.Shared },
        };
        db.Companies.Add(company);
        _companyId = company.Id;

        _comercio = Guid.NewGuid();
        _finanzas = Guid.NewGuid();
        db.Departments.Add(new Department { Id = _comercio, CompanyId = _companyId, Name = "Comercio", IsActive = true, CreatedAt = now, UpdatedAt = now });
        db.Departments.Add(new Department { Id = _finanzas, CompanyId = _companyId, Name = "Finanzas", IsActive = true, CreatedAt = now, UpdatedAt = now });

        var field = new DemographicField
        {
            Id = Guid.NewGuid(), CompanyId = _companyId, Field = "sede", LabelEs = "Sede",
            Type = "select", Order = 1, CreatedAt = now, UpdatedAt = now,
        };
        db.DemographicFields.Add(field);
        db.DemographicFieldOptions.Add(new DemographicFieldOption { DemographicFieldId = field.Id, Order = 1, Value = "heredia", LabelEs = "Heredia" });
        _sedeFieldId = field.Id;

        await db.SaveChangesAsync();
    }

    public Task DisposeAsync() => Task.CompletedTask;

    // ------------------------------------------------------------------ helpers

    private async Task<HttpClient> AdminClientAsync()
    {
        var client = _factory.CreateClient();
        var email = $"admin-{Guid.NewGuid():N}@{_domain}";
        (await client.PostAsJsonAsync("/auth/signup", new SignupRequest("Admin", email, "A-good-passw0rd"))).EnsureSuccessStatusCode();

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

    /// <summary>An active employee in <paramref name="department"/>, with sede = heredia on the account.</summary>
    private async Task<(Guid Id, string Email)> SeedPersonAsync(Guid department)
    {
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>();
        var now = DateTimeOffset.UtcNow;
        var email = $"{Guid.NewGuid():N}@persona.example.com";
        var user = new User
        {
            Id = Guid.NewGuid(), CompanyId = _companyId, DepartmentId = department, Email = email,
            Name = "Persona", Role = Roles.Employee, IsActive = true, CreatedAt = now, UpdatedAt = now,
        };
        db.Users.Add(user);
        db.UserDemographics.Add(new UserDemographic { UserId = user.Id, DemographicFieldId = _sedeFieldId, Value = "heredia" });
        await db.SaveChangesAsync();
        return (user.Id, email);
    }

    private async Task<SurveyDetail> ActiveSurveyAsync(HttpClient admin, string mode, bool anonymous = true)
    {
        var created = await SurveyTestHarness.CreateSurveyAsync(
            admin,
            SurveyTestHarness.MinimalRequest(_companyId) with
            {
                Settings = new SurveySettingsInput(Anonymous: anonymous, CredentialMode: mode),
            });
        (await admin.PutAsJsonAsync($"/surveys/{created.Id}", new UpdateSurveyRequest(
            Settings: new SurveySettingsInput(
                InvitationCustomSubject: LocalizedInput.FromBare(Subject),
                InvitationCustomMessage: LocalizedInput.FromBare(Body))))).EnsureSuccessStatusCode();
        (await SurveyTestHarness.SetStatusAsync(admin, created.Id, SurveyStatuses.Active)).EnsureSuccessStatusCode();
        return created;
    }

    private static async Task<SurveyInvitationBatchResult> InviteAsync(HttpClient admin, Guid surveyId, CreateSurveyInvitationsRequest request)
    {
        var response = await admin.PostAsJsonAsync($"/surveys/{surveyId}/invitations", request);
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        return (await response.Content.ReadFromJsonAsync<SurveyInvitationBatchResult>())!;
    }

    private List<SentPersonalLink> LinksTo(params string[] emails)
        => [.. _factory.Links.Where(l => emails.Contains(l.ToEmail))];

    private Task<SurveyInvitation> InvitationAsync(Guid surveyId, Guid userId) => WithDbAsync(db =>
        db.SurveyInvitations.AsNoTracking().SingleAsync(i => i.SurveyId == surveyId && i.UserId == userId));

    private async Task<T> WithDbAsync<T>(Func<ClimateProjectDbContext, Task<T>> action)
    {
        using var scope = _factory.Services.CreateScope();
        return await action(scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>());
    }

    /// <summary>A browser that followed the link out of the mail: no session, the token in the header.</summary>
    private HttpClient LinkHolder(string token)
    {
        var client = _factory.CreateClient();
        client.DefaultRequestHeaders.Add(SurveyResponseEndpoints.PersonalLinkHeader, token);
        return client;
    }

    // ------------------------------------------------------------------ sending

    /// <summary>
    /// The 28 Oct 2026 rule, as a test: a send list holds only the people named. A first call
    /// names one person; a second names a department; a person whose mail failed in an earlier
    /// call is NOT swept up by a later call that does not name them; and nobody is mailed twice.
    /// </summary>
    [Fact]
    public async Task A_personal_link_goes_exactly_to_the_people_the_request_resolves_and_no_one_else()
    {
        var admin = await AdminClientAsync();
        var survey = await ActiveSurveyAsync(admin, CredentialModes.PersonalLink);
        var ana = await SeedPersonAsync(_comercio);
        var bea = await SeedPersonAsync(_comercio);
        var caro = await SeedPersonAsync(_comercio);
        var dani = await SeedPersonAsync(_finanzas);
        var everyone = new[] { ana.Email, bea.Email, caro.Email, dani.Email };

        // Ana and Bea, by name -- and Bea's mail fails.
        _factory.FailFor.Add(bea.Email);
        var first = await InviteAsync(admin, survey.Id, new CreateSurveyInvitationsRequest(UserIds: [ana.Id, bea.Id]));
        Assert.Equal(1, first.LinksSent);
        Assert.Equal(1, first.LinksNotSent);
        Assert.Equal([bea.Email], first.LinksNotSentEmails);
        Assert.Equal(1, first.Remaining);
        Assert.Equal([ana.Email], LinksTo(everyone).Select(l => l.ToEmail));

        // Bea's address works again BEFORE the next call, so a send that wrongly included her
        // would reach her and show up below. (Measured: with her address still refused, a
        // mutation that mailed every unsent invitation passed this test -- the extra attempt
        // failed silently. 2026-11-18, mutation I1.)
        _factory.FailFor.Clear();

        // Dani, by name. Bea is still unsent, and is NOT mailed -- nor even attempted -- by a
        // request that does not name her.
        var second = await InviteAsync(admin, survey.Id, new CreateSurveyInvitationsRequest(UserIds: [dani.Id]));
        Assert.Equal(1, second.LinksSent);
        Assert.Equal(0, second.LinksNotSent);
        Assert.Equal(0, second.Remaining);
        Assert.Equal(new[] { ana.Email, dani.Email }.Order(StringComparer.Ordinal), LinksTo(everyone).Select(l => l.ToEmail).Order(StringComparer.Ordinal));
        Assert.Empty(LinksTo(bea.Email, caro.Email));

        // Comercio: Bea and Caro. Ana already has hers and is not mailed again.
        var third = await InviteAsync(admin, survey.Id, new CreateSurveyInvitationsRequest(DepartmentIds: [_comercio]));
        Assert.Equal(2, third.LinksSent);
        Assert.Equal(0, third.Remaining);
        Assert.Equal(4, LinksTo(everyone).Count);
        Assert.Single(LinksTo(ana.Email));

        // Each mail carries THAT person's own token, and their invitation says it went.
        foreach (var person in new[] { ana, bea, caro, dani })
        {
            var invitation = await InvitationAsync(survey.Id, person.Id);
            Assert.Equal(SurveyInvitationStatuses.Sent, invitation.Status);
            Assert.NotNull(invitation.SentAt);
            Assert.Equal(invitation.InvitationToken, Assert.Single(LinksTo(person.Email)).Token);
        }

        // A re-run of everything mails nobody.
        var again = await InviteAsync(admin, survey.Id, new CreateSurveyInvitationsRequest(UserIds: [ana.Id, bea.Id, caro.Id, dani.Id]));
        Assert.Equal(0, again.LinksSent);
        Assert.Equal(4, LinksTo(everyone).Count);

        // And no credentials of any kind were minted or mailed.
        Assert.DoesNotContain(_factory.Sent, s => everyone.Contains(s.ToEmail));
        Assert.False(await WithDbAsync(db => db.SurveyCredentials.AnyAsync(c => c.SurveyId == survey.Id)));
    }

    /// <summary>The mail is composed from the survey's own words, in the company's language.</summary>
    [Fact]
    public async Task The_mail_carries_the_surveys_subject_and_message_and_the_company()
    {
        var admin = await AdminClientAsync();
        var survey = await ActiveSurveyAsync(admin, CredentialModes.PersonalLink);
        var ana = await SeedPersonAsync(_comercio);

        await InviteAsync(admin, survey.Id, new CreateSurveyInvitationsRequest(UserIds: [ana.Id]));

        var mail = Assert.Single(LinksTo(ana.Email)).Mail;
        Assert.Equal("es", mail.CompanyLanguage);
        Assert.Equal("PROCOMER", mail.Brand.CompanyName);
        var (subject, message) = PersonalLinkEmailComposer.WordsFor(mail, spanish: true);
        Assert.Equal(Subject, subject);
        Assert.Equal(Body, message);
    }

    // ------------------------------------------------------------------ resend

    /// <summary>
    /// The resend answers again in this mode only: a new link with a new token, the old one
    /// dead. `per_survey` and `shared` keep their 410 and mail nothing.
    /// </summary>
    [Fact]
    public async Task Resending_one_link_rotates_it_in_personal_link_mode_only()
    {
        var admin = await AdminClientAsync();
        var survey = await ActiveSurveyAsync(admin, CredentialModes.PersonalLink);
        var ana = await SeedPersonAsync(_comercio);
        await InviteAsync(admin, survey.Id, new CreateSurveyInvitationsRequest(UserIds: [ana.Id]));
        var before = await InvitationAsync(survey.Id, ana.Id);

        var resent = await admin.PostAsync($"/surveys/{survey.Id}/invitations/{before.Id}/resend", null);

        Assert.Equal(HttpStatusCode.OK, resent.StatusCode);
        var links = LinksTo(ana.Email);
        Assert.Equal(2, links.Count);
        var after = await InvitationAsync(survey.Id, ana.Id);
        Assert.NotEqual(before.InvitationToken, after.InvitationToken);
        Assert.Equal(after.InvitationToken, links[^1].Token);
        var anonymousClient = _factory.CreateClient();
        Assert.Equal(HttpStatusCode.NotFound, (await anonymousClient.GetAsync($"/survey-invitations/{before.InvitationToken}")).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await anonymousClient.GetAsync($"/survey-invitations/{after.InvitationToken}")).StatusCode);

        foreach (var mode in new[] { CredentialModes.PerSurvey, CredentialModes.Shared })
        {
            var other = await ActiveSurveyAsync(admin, mode);
            var bea = await SeedPersonAsync(_comercio);
            await InviteAsync(admin, other.Id, new CreateSurveyInvitationsRequest(UserIds: [bea.Id]));
            var invitation = await InvitationAsync(other.Id, bea.Id);

            var refused = await admin.PostAsync($"/surveys/{other.Id}/invitations/{invitation.Id}/resend", null);

            Assert.Equal(HttpStatusCode.Gone, refused.StatusCode);
            Assert.Empty(LinksTo(bea.Email));
            Assert.Equal(invitation.InvitationToken, (await InvitationAsync(other.Id, bea.Id)).InvitationToken);
        }
    }

    /// <summary>A failed resend keeps the link the person already holds.</summary>
    [Fact]
    public async Task A_resend_whose_mail_fails_keeps_the_previous_link_working()
    {
        var admin = await AdminClientAsync();
        var survey = await ActiveSurveyAsync(admin, CredentialModes.PersonalLink);
        var ana = await SeedPersonAsync(_comercio);
        await InviteAsync(admin, survey.Id, new CreateSurveyInvitationsRequest(UserIds: [ana.Id]));
        var before = await InvitationAsync(survey.Id, ana.Id);

        _factory.FailFor.Add(ana.Email);
        var resent = await admin.PostAsync($"/surveys/{survey.Id}/invitations/{before.Id}/resend", null);
        _factory.FailFor.Clear();

        Assert.Equal(HttpStatusCode.BadGateway, resent.StatusCode);
        Assert.Equal(before.InvitationToken, (await InvitationAsync(survey.Id, ana.Id)).InvitationToken);
        Assert.Equal(HttpStatusCode.OK, (await _factory.CreateClient().GetAsync($"/survey-invitations/{before.InvitationToken}")).StatusCode);
    }

    // ------------------------------------------------------------------ the other modes, unchanged

    [Fact]
    public async Task Shared_and_per_survey_send_exactly_what_they_sent_before_and_no_link()
    {
        var admin = await AdminClientAsync();

        var shared = await ActiveSurveyAsync(admin, CredentialModes.Shared);
        var ana = await SeedPersonAsync(_comercio);
        var sharedBatch = await InviteAsync(admin, shared.Id, new CreateSurveyInvitationsRequest(UserIds: [ana.Id]));
        Assert.Equal(1, sharedBatch.Created);
        Assert.Equal(0, sharedBatch.LinksSent);
        Assert.Equal(0, sharedBatch.CredentialsIssued);
        var sharedRow = await InvitationAsync(shared.Id, ana.Id);
        Assert.Equal(SurveyInvitationStatuses.Pending, sharedRow.Status);
        Assert.Null(sharedRow.SentAt);

        var perSurvey = await ActiveSurveyAsync(admin, CredentialModes.PerSurvey);
        var bea = await SeedPersonAsync(_comercio);
        var keyBatch = await InviteAsync(admin, perSurvey.Id, new CreateSurveyInvitationsRequest(UserIds: [bea.Id]));
        Assert.Equal(1, keyBatch.CredentialsIssued);
        Assert.Equal(0, keyBatch.LinksSent);
        Assert.Single(_factory.Sent, s => s.ToEmail == bea.Email);
        Assert.Null((await InvitationAsync(perSurvey.Id, bea.Id)).SentAt);

        Assert.Empty(LinksTo(ana.Email, bea.Email));
        Assert.DoesNotContain(_factory.Sent, s => s.ToEmail == ana.Email);
    }

    // ------------------------------------------------------------------ reminders: never

    [Fact]
    public async Task No_reminder_is_ever_produced_for_a_personal_link()
    {
        var admin = await AdminClientAsync();
        var survey = await ActiveSurveyAsync(admin, CredentialModes.PersonalLink);
        var ana = await SeedPersonAsync(_comercio);
        await InviteAsync(admin, survey.Id, new CreateSurveyInvitationsRequest(UserIds: [ana.Id]));

        // Even with the survey's reminder switch ON and the invitation `sent` a week ago.
        (await admin.PutAsJsonAsync($"/surveys/{survey.Id}", new UpdateSurveyRequest(
            Settings: new SurveySettingsInput(NotificationSendReminders: true, NotificationReminderFrequencyDays: 1)))).EnsureSuccessStatusCode();
        await WithDbAsync(async db =>
        {
            var invitation = await db.SurveyInvitations.SingleAsync(i => i.SurveyId == survey.Id && i.UserId == ana.Id);
            invitation.SentAt = DateTimeOffset.UtcNow.AddDays(-7);
            return await db.SaveChangesAsync();
        });

        var route = await admin.PostAsync($"/surveys/{survey.Id}/invitations/reminders", null);
        Assert.Equal(HttpStatusCode.OK, route.StatusCode);
        var result = (await route.Content.ReadFromJsonAsync<SurveyReminderResult>())!;
        Assert.Equal(0, result.Queued);

        await WithDbAsync(db => InvitationReminderJob.RunAsync(db, NullLoggerFactory.Instance, DateTimeOffset.UtcNow, 500, CancellationToken.None));

        Assert.False(await WithDbAsync(db => db.Notifications.AnyAsync(n => n.UserId == ana.Id)));
        Assert.Single(LinksTo(ana.Email));
        Assert.DoesNotContain(_factory.Reminders, r => r.ToEmail == ana.Email);
        Assert.Equal(0, (await InvitationAsync(survey.Id, ana.Id)).ReminderCount);
    }

    // ------------------------------------------------------------------ the respondent

    /// <summary>
    /// The link opens the survey for a person with NO session. Nothing is asked about them; the
    /// response carries their department and their demographic from the account; it carries no
    /// user id (the survey is anonymous); and who answered is recorded where an anonymous
    /// survey records it -- the participation list -- while the invitation itself stays below the
    /// anonymity ceiling.
    /// </summary>
    [Fact]
    public async Task The_link_answers_an_anonymous_climate_survey_with_the_accounts_department_and_demographics()
    {
        var admin = await AdminClientAsync();
        var survey = await ActiveSurveyAsync(admin, CredentialModes.PersonalLink, anonymous: true);
        var ana = await SeedPersonAsync(_comercio);
        await SeedPersonAsync(_comercio);
        await SeedPersonAsync(_comercio); // Comercio and heredia at 3: above the floor, so both are kept.
        await InviteAsync(admin, survey.Id, new CreateSurveyInvitationsRequest(UserIds: [ana.Id]));
        var token = Assert.Single(LinksTo(ana.Email)).Token;
        var holder = LinkHolder(token);

        // Without the link the survey is closed to a visitor: no public link was ever opened.
        var bare = await _factory.CreateClient().GetAsync($"/surveys/{survey.Id}/respond");
        Assert.NotEqual(HttpStatusCode.OK, bare.StatusCode);

        var view = (await holder.GetFromJsonAsync<SurveyRespondView>($"/surveys/{survey.Id}/respond?lang=es"))!;
        Assert.True(view.Anonymous);
        Assert.Empty(view.Demographics);
        var question = Assert.Single(view.Questions);

        var submitted = await holder.PostAsJsonAsync($"/surveys/{survey.Id}/responses", new SubmitSurveyResponseRequest(
            Answers: [new SurveyAnswerInput(question.Id, Value: "Bien")],
            SessionId: Guid.NewGuid().ToString("N"),
            IsComplete: true));
        Assert.Equal(HttpStatusCode.Created, submitted.StatusCode);

        var response = await WithDbAsync(db => db.Responses.AsNoTracking().SingleAsync(r => r.SurveyId == survey.Id));
        Assert.True(response.IsComplete);
        Assert.True(response.IsAnonymous);
        Assert.Null(response.UserId);
        Assert.Equal(_comercio, response.DepartmentId);
        var demographic = await WithDbAsync(db => db.ResponseDemographics.AsNoTracking().SingleAsync(d => d.ResponseId == response.Id));
        Assert.Equal("sede", demographic.Field);
        Assert.Contains("heredia", demographic.Value, StringComparison.Ordinal);

        Assert.True(await WithDbAsync(db => db.SurveyParticipations.AnyAsync(p => p.SurveyId == survey.Id && p.Email == ana.Email)));
        Assert.Null((await InvitationAsync(survey.Id, ana.Id)).CompletedOn);
    }

    /// <summary>On an IDENTIFIED survey the same link completes the invitation itself.</summary>
    [Fact]
    public async Task On_an_identified_survey_the_link_records_completion_on_the_invitation()
    {
        var admin = await AdminClientAsync();
        var survey = await ActiveSurveyAsync(admin, CredentialModes.PersonalLink, anonymous: false);
        var ana = await SeedPersonAsync(_finanzas);
        await InviteAsync(admin, survey.Id, new CreateSurveyInvitationsRequest(UserIds: [ana.Id]));
        var holder = LinkHolder(Assert.Single(LinksTo(ana.Email)).Token);

        var view = (await holder.GetFromJsonAsync<SurveyRespondView>($"/surveys/{survey.Id}/respond"))!;
        var submitted = await holder.PostAsJsonAsync($"/surveys/{survey.Id}/responses", new SubmitSurveyResponseRequest(
            Answers: [new SurveyAnswerInput(view.Questions[0].Id, Value: "Bien")], IsComplete: true));
        Assert.Equal(HttpStatusCode.Created, submitted.StatusCode);

        var invitation = await InvitationAsync(survey.Id, ana.Id);
        Assert.Equal(SurveyInvitationStatuses.Completed, invitation.Status);
        Assert.NotNull(invitation.CompletedOn);
        var response = await WithDbAsync(db => db.Responses.AsNoTracking().SingleAsync(r => r.SurveyId == survey.Id));
        Assert.Equal(ana.Id, response.UserId);
        Assert.Equal(_finanzas, response.DepartmentId);
    }

    /// <summary>
    /// Leaving halfway and opening the link again -- on another device, with another browser
    /// session -- finds the saved answers: the signed-in resume path, keyed on the person and
    /// never on a user id stored with the answers.
    /// </summary>
    [Fact]
    public async Task Leaving_halfway_and_opening_the_link_again_resumes_on_any_device()
    {
        var admin = await AdminClientAsync();
        var survey = await ActiveSurveyAsync(admin, CredentialModes.PersonalLink, anonymous: true);
        var ana = await SeedPersonAsync(_comercio);
        await InviteAsync(admin, survey.Id, new CreateSurveyInvitationsRequest(UserIds: [ana.Id]));
        var token = Assert.Single(LinksTo(ana.Email)).Token;

        var phone = LinkHolder(token);
        var view = (await phone.GetFromJsonAsync<SurveyRespondView>($"/surveys/{survey.Id}/respond?sessionId=phone"))!;
        (await phone.PostAsJsonAsync($"/surveys/{survey.Id}/responses", new SubmitSurveyResponseRequest(
            Answers: [new SurveyAnswerInput(view.Questions[0].Id, Value: "A medias")], SessionId: "phone", IsComplete: false)))
            .EnsureSuccessStatusCode();

        var laptop = LinkHolder(token);
        var resumed = (await laptop.GetFromJsonAsync<SurveyRespondView>($"/surveys/{survey.Id}/respond?sessionId=laptop"))!;

        Assert.NotNull(resumed.InProgress);
        Assert.False(resumed.InProgress!.IsComplete);
        Assert.Equal("A medias", Assert.Single(resumed.InProgress.Answers).Value);
        Assert.Null((await WithDbAsync(db => db.Responses.AsNoTracking().SingleAsync(r => r.SurveyId == survey.Id))).UserId);
    }

    [Fact]
    public async Task A_revoked_link_opens_nothing_and_a_token_means_nothing_on_another_mode()
    {
        var admin = await AdminClientAsync();
        var survey = await ActiveSurveyAsync(admin, CredentialModes.PersonalLink);
        var ana = await SeedPersonAsync(_comercio);
        await InviteAsync(admin, survey.Id, new CreateSurveyInvitationsRequest(UserIds: [ana.Id]));
        var invitation = await InvitationAsync(survey.Id, ana.Id);
        (await admin.PostAsync($"/surveys/{survey.Id}/invitations/{invitation.Id}/revoke", null)).EnsureSuccessStatusCode();

        Assert.Equal(HttpStatusCode.Forbidden, (await LinkHolder(invitation.InvitationToken).GetAsync($"/surveys/{survey.Id}/respond")).StatusCode);

        // A shared survey's invitation token, presented the same way, opens nothing either: the
        // header is honoured on a personal_link survey and nowhere else.
        var shared = await ActiveSurveyAsync(admin, CredentialModes.Shared);
        var bea = await SeedPersonAsync(_comercio);
        await InviteAsync(admin, shared.Id, new CreateSurveyInvitationsRequest(UserIds: [bea.Id]));
        var sharedToken = (await InvitationAsync(shared.Id, bea.Id)).InvitationToken;
        Assert.NotEqual(HttpStatusCode.OK, (await LinkHolder(sharedToken).GetAsync($"/surveys/{shared.Id}/respond")).StatusCode);
    }

    // ------------------------------------------------------------------ the mode itself

    /// <summary>
    /// An existing survey may be moved to or from `personal_link` while nothing has been issued,
    /// and not after a link has gone. `shared` &lt;-&gt; `per_survey` stays frozen
    /// (<c>SurveyCredentialModeTests</c>).
    /// </summary>
    [Fact]
    public async Task An_existing_survey_moves_to_personal_link_until_a_link_has_gone()
    {
        var admin = await AdminClientAsync();
        var survey = await ActiveSurveyAsync(admin, CredentialModes.Shared);

        var moved = await admin.PutAsJsonAsync($"/surveys/{survey.Id}", new UpdateSurveyRequest(
            Settings: new SurveySettingsInput(CredentialMode: CredentialModes.PersonalLink)));
        Assert.Equal(HttpStatusCode.OK, moved.StatusCode);
        Assert.Equal(CredentialModes.PersonalLink, await WithDbAsync(db => db.Surveys.AsNoTracking().Where(s => s.Id == survey.Id).Select(s => s.Settings.CredentialMode).FirstAsync()));

        var ana = await SeedPersonAsync(_comercio);
        await InviteAsync(admin, survey.Id, new CreateSurveyInvitationsRequest(UserIds: [ana.Id]));

        var back = await admin.PutAsJsonAsync($"/surveys/{survey.Id}", new UpdateSurveyRequest(
            Settings: new SurveySettingsInput(CredentialMode: CredentialModes.Shared)));
        Assert.Equal(HttpStatusCode.BadRequest, back.StatusCode);
        Assert.Contains("credential_mode_in_use", await back.Content.ReadAsStringAsync(), StringComparison.Ordinal);
        Assert.Equal(CredentialModes.PersonalLink, await WithDbAsync(db => db.Surveys.AsNoTracking().Where(s => s.Id == survey.Id).Select(s => s.Settings.CredentialMode).FirstAsync()));
    }

    /// <summary>
    /// A mailed link lives as long as the survey: moving the close moves the links that followed
    /// it, so nobody holding one is locked out at the old close. A shared survey's invitations,
    /// which no mail carries, are left exactly as they were.
    /// </summary>
    [Fact]
    public async Task Moving_the_close_moves_the_mailed_links_with_it_in_personal_link_mode_only()
    {
        var admin = await AdminClientAsync();
        var personal = await ActiveSurveyAsync(admin, CredentialModes.PersonalLink);
        var shared = await ActiveSurveyAsync(admin, CredentialModes.Shared);
        var ana = await SeedPersonAsync(_comercio);
        await InviteAsync(admin, personal.Id, new CreateSurveyInvitationsRequest(UserIds: [ana.Id]));
        await InviteAsync(admin, shared.Id, new CreateSurveyInvitationsRequest(UserIds: [ana.Id]));
        var sharedBefore = (await InvitationAsync(shared.Id, ana.Id)).ExpiresAt;

        foreach (var survey in new[] { personal, shared })
        {
            (await admin.PutAsJsonAsync($"/surveys/{survey.Id}", new UpdateSurveyRequest(EndDate: survey.EndDate.AddDays(10))))
                .EnsureSuccessStatusCode();
        }

        var newClose = await WithDbAsync(db => db.Surveys.AsNoTracking().Where(s => s.Id == personal.Id).Select(s => s.EndDate).FirstAsync());
        Assert.Equal(newClose, (await InvitationAsync(personal.Id, ana.Id)).ExpiresAt);
        Assert.Equal(sharedBefore, (await InvitationAsync(shared.Id, ana.Id)).ExpiresAt);

        // And the link still opens after the old close would have passed.
        var token = Assert.Single(LinksTo(ana.Email)).Token;
        Assert.Equal(HttpStatusCode.OK, (await _factory.CreateClient().GetAsync($"/survey-invitations/{token}")).StatusCode);
    }

    [Fact]
    public async Task A_company_cannot_default_to_personal_link()
    {
        var admin = await AdminClientAsync();

        var response = await admin.PutAsJsonAsync(
            $"/admin/companies/{_companyId}/settings",
            new ClimateProject.Application.OrgStructure.UpdateCompanySettingsRequest(
                null, null, null, null, null, null, null, null, null, null, null, null,
                CredentialMode: CredentialModes.PersonalLink));

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }
}
