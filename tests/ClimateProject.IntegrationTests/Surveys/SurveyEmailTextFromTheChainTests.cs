using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using ClimateProject.Api.Endpoints;
using ClimateProject.Application.Auth;
using ClimateProject.Application.RespondentContent;
using ClimateProject.Application.Surveys;
using ClimateProject.Domain.Entities;
using ClimateProject.Infrastructure.Persistence;
using ClimateProject.IntegrationTests.Support;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace ClimateProject.IntegrationTests.Surveys;

/// <summary>
/// The credentials mail and the no-password reminder take the survey's -- else the company's --
/// own subject and paragraph (lane L2 of <c>docs/decisions/editable-respondent-content.md</c>),
/// at EVERY route that sends them: the invite step (<c>POST /surveys/{id}/invitations</c>), the
/// reissue and the remind. Read off the capturing senders, i.e. what the route handed the mail.
/// </summary>
[Collection("Postgres")]
public class SurveyEmailTextFromTheChainTests(PostgresContainerFixture postgres, CapturingCredentialsHostFixture credentials)
    : IAsyncLifetime, IClassFixture<CapturingCredentialsHostFixture>
{
    private readonly string _domain = $"l2-{Guid.NewGuid():N}.test";
    private Guid _companyId;
    private CapturingCredentialsFactory _factory = null!;

    public async Task InitializeAsync()
    {
        _factory = credentials.HostFor(postgres.ConnectionString);
        await WithDbAsync(async db =>
        {
            var company = new Company
            {
                Id = Guid.NewGuid(),
                Name = "Servicio Público de Heredia",
                EmailDomain = _domain,
                CreatedAt = DateTimeOffset.UtcNow,
                Settings = new CompanySettings
                {
                    Language = "es",
                    CredentialMode = CredentialModes.PerSurvey,
                    Timezone = "America/Costa_Rica",
                },
            };
            db.Companies.Add(company);
            _companyId = company.Id;
            await db.SaveChangesAsync();
        });
    }

    public Task DisposeAsync() => Task.CompletedTask;

    private async Task WithDbAsync(Func<ClimateProjectDbContext, Task> action)
    {
        using var scope = _factory.Services.CreateScope();
        await action(scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>());
    }

    private async Task<HttpClient> AdminClientAsync(Guid? companyId = null)
    {
        var client = _factory.CreateClient();
        var email = $"{Guid.NewGuid():N}@{_domain}";
        (await client.PostAsJsonAsync("/auth/signup", new SignupRequest("Admin", email, "A-good-passw0rd")))
            .EnsureSuccessStatusCode();

        await WithDbAsync(async db =>
        {
            var user = await db.Users.FirstAsync(u => u.Email == email);
            user.Role = Roles.CompanyAdmin;
            user.CompanyId = companyId ?? _companyId;
            await db.SaveChangesAsync();
        });

        var login = await client.PostAsJsonAsync("/auth/login", new LoginRequest(email, "A-good-passw0rd"));
        var token = (await login.Content.ReadFromJsonAsync<TokenResponse>())!.Token;
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);
        return client;
    }

    private async Task<SurveyDetail> ActiveSurveyAsync(HttpClient client)
    {
        var created = await SurveyTestHarness.CreateSurveyAsync(
            client, SurveyTestHarness.MinimalRequest(_companyId, title: SurveyTestHarness.Both("Clima", "Clima")));
        (await SurveyTestHarness.SetStatusAsync(client, created.Id, SurveyStatuses.Active)).EnsureSuccessStatusCode();
        return created;
    }

    private async Task<(Guid Id, string Email)> SeedEmployeeAsync()
    {
        var email = $"{Guid.NewGuid():N}@persona.example.com";
        var id = Guid.NewGuid();
        await WithDbAsync(async db =>
        {
            db.Users.Add(new User
            {
                Id = id,
                CompanyId = _companyId,
                Email = email,
                Name = "Persona",
                Role = Roles.Employee,
                IsActive = true,
                CreatedAt = DateTimeOffset.UtcNow,
                UpdatedAt = DateTimeOffset.UtcNow,
            });
            await db.SaveChangesAsync();
        });
        return (id, email);
    }

    private static async Task InviteAsync(HttpClient admin, Guid surveyId, Guid userId)
        => (await admin.PostAsJsonAsync($"/surveys/{surveyId}/invitations", new CreateSurveyInvitationsRequest(UserIds: [userId])))
            .EnsureSuccessStatusCode();

    private static async Task PutAsync(HttpClient admin, string route, Dictionary<string, string?> spanish)
        => (await admin.PutAsJsonAsync(route, new UpdateRespondentContentRequest(new() { ["es"] = spanish })))
            .EnsureSuccessStatusCode();

    private string CompanyRoute => $"/admin/companies/{_companyId}/respondent-content";

    private const string CompanySubject = "Sus datos para {survey} — {company}";
    private const string CompanyMessage = "Muy buenas tardes, gracias por participar.";
    private const string CompanyReminderSubject = "Le falta {survey}";

    // ------------------------------------------------------------------ every send site

    [Fact]
    public async Task A_companys_words_reach_the_invitation_the_reissue_and_the_reminder_of_a_survey_that_wrote_none()
    {
        var admin = await AdminClientAsync();
        await PutAsync(admin, CompanyRoute, new()
        {
            [RespondentContentRegistry.EmailCredentialsSubject] = CompanySubject,
            [RespondentContentRegistry.EmailCredentialsMessage] = CompanyMessage,
            [RespondentContentRegistry.EmailReminderSubject] = CompanyReminderSubject,
        });
        var survey = await ActiveSurveyAsync(admin);
        var (userId, email) = await SeedEmployeeAsync();

        // 1. The invite step.
        await InviteAsync(admin, survey.Id, userId);
        var invited = Assert.Single(_factory.Sent, m => m.ToEmail == email);
        Assert.Equal(new SurveyEmailText(CompanySubject, null, CompanyMessage, null), invited.Text);

        // 2. The reissue (the key was never used, so a company admin may replace it).
        (await admin.PostAsync($"/surveys/{survey.Id}/credentials/{userId}/reissue", content: null)).EnsureSuccessStatusCode();
        var reissued = _factory.Sent.Where(m => m.ToEmail == email).ToList();
        Assert.Equal(2, reissued.Count);
        Assert.Equal(new SurveyEmailText(CompanySubject, null, CompanyMessage, null), reissued[1].Text);

        // 3. The no-password reminder, under its own keys.
        (await admin.PostAsync($"/surveys/{survey.Id}/credentials/{userId}/remind", content: null)).EnsureSuccessStatusCode();
        var reminder = Assert.Single(_factory.Reminders, r => r.ToEmail == email);
        Assert.Equal(new SurveyEmailText(CompanyReminderSubject, null, null, null), reminder.Text);
    }

    [Fact]
    public async Task A_surveys_own_words_win_over_its_companys_part_by_part()
    {
        var admin = await AdminClientAsync();
        await PutAsync(admin, CompanyRoute, new()
        {
            [RespondentContentRegistry.EmailCredentialsSubject] = CompanySubject,
            [RespondentContentRegistry.EmailCredentialsMessage] = CompanyMessage,
        });
        var survey = await ActiveSurveyAsync(admin);
        await PutAsync(admin, $"/surveys/{survey.Id}/respondent-content", new()
        {
            [RespondentContentRegistry.EmailCredentialsSubject] = "Clima: sus datos",
        });
        var (userId, email) = await SeedEmployeeAsync();

        await InviteAsync(admin, survey.Id, userId);

        // The subject is the survey's; the paragraph, which it did not write, the company's.
        Assert.Equal(
            new SurveyEmailText("Clima: sus datos", null, CompanyMessage, null),
            Assert.Single(_factory.Sent, m => m.ToEmail == email).Text);
    }

    [Fact]
    public async Task Nothing_written_anywhere_mails_todays_copy()
    {
        var admin = await AdminClientAsync();
        var survey = await ActiveSurveyAsync(admin);
        var (userId, email) = await SeedEmployeeAsync();

        await InviteAsync(admin, survey.Id, userId);
        (await admin.PostAsync($"/surveys/{survey.Id}/credentials/{userId}/remind", content: null)).EnsureSuccessStatusCode();

        Assert.Equal(SurveyEmailText.None, Assert.Single(_factory.Sent, m => m.ToEmail == email).Text);
        Assert.Equal(SurveyEmailText.None, Assert.Single(_factory.Reminders, r => r.ToEmail == email).Text);
    }

    // ------------------------------------------------------------------ the preview

    [Fact]
    public async Task The_preview_is_the_mail_the_route_would_compose_from_the_saved_words_and_sends_nothing()
    {
        var admin = await AdminClientAsync();
        await PutAsync(admin, CompanyRoute, new()
        {
            [RespondentContentRegistry.EmailCredentialsSubject] = CompanySubject,
            [RespondentContentRegistry.EmailCredentialsMessage] = CompanyMessage,
        });
        var survey = await ActiveSurveyAsync(admin);
        var sentBefore = _factory.Sent.Count + _factory.Reminders.Count + _factory.Links.Count;

        var credentialsPreview = await admin.GetFromJsonAsync<RespondentEmailPreview>(
            $"/surveys/{survey.Id}/respondent-content/email-preview/credentials");
        Assert.NotNull(credentialsPreview);
        Assert.Equal($"Sus datos para {survey.Title} — Servicio Público de Heredia", credentialsPreview.Subject);
        Assert.Contains(CompanyMessage, credentialsPreview.Text, StringComparison.Ordinal);
        // The code half is there, with a password that is plainly not one.
        Assert.Contains($"Contraseña: {RespondentEmailPreviewEndpoints.SamplePassword}", credentialsPreview.Text, StringComparison.Ordinal);
        Assert.Contains("Usuario: ", credentialsPreview.Text, StringComparison.Ordinal);

        // A blank field previews today's words.
        var reminderPreview = await admin.GetFromJsonAsync<RespondentEmailPreview>(
            $"/surveys/{survey.Id}/respondent-content/email-preview/reminder");
        Assert.Contains("Aún no hemos recibido su respuesta", reminderPreview!.Text, StringComparison.Ordinal);

        var companyPreview = await admin.GetFromJsonAsync<RespondentEmailPreview>(
            $"/admin/companies/{_companyId}/respondent-content/email-preview/credentials");
        Assert.Equal($"Sus datos para {RespondentEmailPreviewEndpoints.SampleSurveyEs} — Servicio Público de Heredia", companyPreview!.Subject);

        var linkPreview = await admin.GetFromJsonAsync<RespondentEmailPreview>(
            $"/surveys/{survey.Id}/respondent-content/email-preview/personalLink");
        Assert.Contains("Responder la encuesta", linkPreview!.Text, StringComparison.Ordinal);

        Assert.Equal(sentBefore, _factory.Sent.Count + _factory.Reminders.Count + _factory.Links.Count);
    }

    [Fact]
    public async Task The_preview_is_refused_to_another_company_and_knows_only_three_mails()
    {
        var admin = await AdminClientAsync();
        var survey = await ActiveSurveyAsync(admin);

        Guid otherCompany = Guid.Empty;
        await WithDbAsync(async db =>
        {
            var company = new Company { Id = Guid.NewGuid(), Name = "Otra", EmailDomain = $"o-{_domain}", CreatedAt = DateTimeOffset.UtcNow };
            db.Companies.Add(company);
            otherCompany = company.Id;
            await db.SaveChangesAsync();
        });
        var stranger = await AdminClientAsync(otherCompany);

        Assert.Equal(HttpStatusCode.Forbidden, (await stranger.GetAsync($"/surveys/{survey.Id}/respondent-content/email-preview/credentials")).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await stranger.GetAsync($"/admin/companies/{_companyId}/respondent-content/email-preview/reminder")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await admin.GetAsync($"/surveys/{survey.Id}/respondent-content/email-preview/welcome")).StatusCode);
    }
}
