using System.Net.Http.Headers;
using System.Net.Http.Json;
using ClimateProject.Api.Endpoints;
using ClimateProject.Application.Auth;
using ClimateProject.Application.Localization;
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
