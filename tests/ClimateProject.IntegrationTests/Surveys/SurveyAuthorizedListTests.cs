using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using ClimateProject.Api.Endpoints;
using ClimateProject.Application.Auth;
using ClimateProject.Application.Surveys;
using ClimateProject.Domain.Entities;
using ClimateProject.Infrastructure.Persistence;
using ClimateProject.IntegrationTests.Support;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace ClimateProject.IntegrationTests.Surveys;

/// <summary>
/// «Lista autorizada del cliente» (ruled 2026-11-19, <c>docs/decisions/editable-respondent-content.md</c>,
/// ruling 3 -- REFUSE): while a survey has a non-empty list, every send, resend, reissue or
/// reminder to anybody whose address is not on it is refused with 409
/// <c>survey_recipient_not_authorized</c>, naming them, and NOTHING is minted, written or mailed.
/// No list is today's behaviour. One test per sending handler, read off the captured mail and the
/// rows the product wrote; the list itself is always written through its own routes.
/// </summary>
[Collection("Postgres")]
public class SurveyAuthorizedListTests(PostgresContainerFixture postgres, CapturingCredentialsHostFixture credentials)
    : IAsyncLifetime, IClassFixture<CapturingCredentialsHostFixture>
{
    private static readonly JsonSerializerOptions Web = new(JsonSerializerDefaults.Web);

    private readonly string _domain = $"aut-{Guid.NewGuid():N}.test";
    private Guid _companyId;
    private Guid _otherCompanyId;
    private Guid _comercio;
    private CapturingCredentialsFactory _factory = null!;

    public async Task InitializeAsync()
    {
        _factory = credentials.HostFor(postgres.ConnectionString);
        await WithDbAsync(async db =>
        {
            var now = DateTimeOffset.UtcNow;
            var company = new Company
            {
                Id = Guid.NewGuid(),
                Name = "Servicio Público de Heredia",
                EmailDomain = _domain,
                CreatedAt = now,
                Settings = new CompanySettings { Language = "es", CredentialMode = CredentialModes.Shared, Timezone = "America/Costa_Rica" },
            };
            var other = new Company
            {
                Id = Guid.NewGuid(),
                Name = "Otra empresa",
                EmailDomain = $"otra-{Guid.NewGuid():N}.test",
                CreatedAt = now,
                Settings = new CompanySettings { Language = "es" },
            };
            db.Companies.AddRange(company, other);
            _companyId = company.Id;
            _otherCompanyId = other.Id;
            _comercio = Guid.NewGuid();
            db.Departments.Add(new Department { Id = _comercio, CompanyId = _companyId, Name = "Comercio", IsActive = true, CreatedAt = now, UpdatedAt = now });
            await db.SaveChangesAsync();
            return 0;
        });
    }

    public Task DisposeAsync() => Task.CompletedTask;

    // ------------------------------------------------------------------ helpers

    private async Task<T> WithDbAsync<T>(Func<ClimateProjectDbContext, Task<T>> action)
    {
        using var scope = _factory.Services.CreateScope();
        return await action(scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>());
    }

    /// <summary>A company admin of <paramref name="companyId"/> (the test company by default), or a company-less TIMS operator.</summary>
    private async Task<HttpClient> ClientAsync(string role = Roles.CompanyAdmin, Guid? companyId = null)
    {
        var client = _factory.CreateClient();
        var email = $"admin-{Guid.NewGuid():N}@{_domain}";
        (await client.PostAsJsonAsync("/auth/signup", new SignupRequest("Quien administra", email, "A-good-passw0rd"))).EnsureSuccessStatusCode();
        await WithDbAsync(async db =>
        {
            var user = await db.Users.FirstAsync(u => u.Email == email);
            user.Role = role;
            user.CompanyId = role == Roles.SuperAdmin ? null : companyId ?? _companyId;
            return await db.SaveChangesAsync();
        });
        var login = await client.PostAsJsonAsync("/auth/login", new LoginRequest(email, "A-good-passw0rd"));
        var token = (await login.Content.ReadFromJsonAsync<TokenResponse>())!.Token;
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);
        return client;
    }

    private async Task<(Guid Id, string Email, string Name)> SeedPersonAsync(string name, string? emailOverride = null)
    {
        var email = emailOverride ?? $"{Guid.NewGuid():N}@persona.example.com";
        var id = Guid.NewGuid();
        await WithDbAsync(async db =>
        {
            db.Users.Add(new User
            {
                Id = id, CompanyId = _companyId, DepartmentId = _comercio, Email = email, Name = name,
                Role = Roles.Employee, IsActive = true, CreatedAt = DateTimeOffset.UtcNow, UpdatedAt = DateTimeOffset.UtcNow,
            });
            return await db.SaveChangesAsync();
        });
        return (id, email, name);
    }

    private async Task<SurveyDetail> ActiveSurveyAsync(HttpClient admin, string mode)
    {
        var created = await SurveyTestHarness.CreateSurveyAsync(
            admin,
            SurveyTestHarness.MinimalRequest(_companyId, title: SurveyTestHarness.Both("Climate", "Clima")) with
            {
                Settings = new SurveySettingsInput(Anonymous: true, CredentialMode: mode),
            });
        (await SurveyTestHarness.SetStatusAsync(admin, created.Id, SurveyStatuses.Active)).EnsureSuccessStatusCode();
        return created;
    }

    private static string ListRoute(Guid surveyId) => $"/surveys/{surveyId}/authorized-people";

    private static async Task<SurveyAuthorizedPersonDto> AddAsync(HttpClient client, Guid surveyId, string email, string? name = null)
    {
        var response = await client.PostAsJsonAsync(ListRoute(surveyId), new AddSurveyAuthorizedPersonRequest(email, name));
        var raw = await response.Content.ReadAsStringAsync();
        Assert.True(response.StatusCode == HttpStatusCode.Created, $"Expected 201, got {(int)response.StatusCode}: {raw}");
        return JsonSerializer.Deserialize<SurveyAuthorizedPersonDto>(raw, Web)!;
    }

    private static async Task<SurveyAuthorizedListView> ListAsync(HttpClient client, Guid surveyId)
    {
        var response = await client.GetAsync(ListRoute(surveyId));
        var raw = await response.Content.ReadAsStringAsync();
        Assert.True(response.StatusCode == HttpStatusCode.OK, raw);
        return JsonSerializer.Deserialize<SurveyAuthorizedListView>(raw, Web)!;
    }

    private static async Task<JsonElement> RefusalAsync(HttpResponseMessage response, HttpStatusCode status, string code)
    {
        var raw = await response.Content.ReadAsStringAsync();
        Assert.True(response.StatusCode == status, $"Expected {(int)status}, got {(int)response.StatusCode}: {raw}");
        var body = JsonDocument.Parse(raw).RootElement.Clone();
        Assert.Equal(code, body.GetProperty("code").GetString());
        return body;
    }

    /// <summary>The 409 names exactly these people, by id, address and name -- and nobody else.</summary>
    private static async Task AssertNotAuthorizedAsync(HttpResponseMessage response, params (Guid Id, string Email, string Name)[] outsiders)
    {
        var body = await RefusalAsync(response, HttpStatusCode.Conflict, AdminRefusals.SurveyRecipientNotAuthorized);
        var named = body.GetProperty("notAuthorized").Deserialize<List<SurveyRecipientNotAuthorized>>(Web)!;
        Assert.Equal(
            outsiders.Select(o => (o.Id, o.Email, (string?)o.Name)).OrderBy(o => o.Id),
            named.Select(n => (n.UserId, n.Email, n.Name)).OrderBy(o => o.UserId));
        foreach (var outsider in outsiders)
        {
            Assert.Contains(outsider.Email, body.GetProperty("message").GetString(), StringComparison.Ordinal);
        }
    }

    private static Task<HttpResponseMessage> InviteAsync(HttpClient admin, Guid surveyId, CreateSurveyInvitationsRequest request)
        => admin.PostAsJsonAsync($"/surveys/{surveyId}/invitations", request);

    private bool AnyMailTo(params string[] emails)
        => _factory.Sent.Any(m => emails.Contains(m.ToEmail))
           || _factory.Links.Any(l => emails.Contains(l.ToEmail))
           || _factory.Reminders.Any(r => emails.Contains(r.ToEmail));

    private Task<int> InvitationRowsAsync(Guid surveyId)
        => WithDbAsync(db => db.SurveyInvitations.CountAsync(i => i.SurveyId == surveyId));

    private Task<int> CredentialRowsAsync(Guid surveyId)
        => WithDbAsync(db => db.SurveyCredentials.CountAsync(c => c.SurveyId == surveyId));

    // ------------------------------------------------------------------ no list = today

    [Fact]
    public async Task With_no_list_every_send_goes_exactly_as_before()
    {
        var admin = await ClientAsync();
        var keys = await ActiveSurveyAsync(admin, CredentialModes.PerSurvey);
        var links = await ActiveSurveyAsync(admin, CredentialModes.PersonalLink);
        var ana = await SeedPersonAsync("Ana Pérez");
        var bea = await SeedPersonAsync("Bea Solís");

        Assert.Equal(0, (await ListAsync(admin, keys.Id)).Count);

        (await InviteAsync(admin, keys.Id, new CreateSurveyInvitationsRequest(UserIds: [ana.Id, bea.Id]))).EnsureSuccessStatusCode();
        (await InviteAsync(admin, links.Id, new CreateSurveyInvitationsRequest(UserIds: [ana.Id, bea.Id]))).EnsureSuccessStatusCode();

        Assert.Equal(2, _factory.Sent.Count(m => m.ToEmail == ana.Email || m.ToEmail == bea.Email));
        Assert.Equal(2, _factory.Links.Count(l => l.ToEmail == ana.Email || l.ToEmail == bea.Email));
        Assert.Equal(2, await CredentialRowsAsync(keys.Id));

        // The one-person routes too.
        (await admin.PostAsync($"/surveys/{keys.Id}/credentials/{ana.Id}/remind", content: null)).EnsureSuccessStatusCode();
        Assert.Single(_factory.Reminders, r => r.ToEmail == ana.Email);
        (await admin.PostAsync($"/surveys/{keys.Id}/credentials/{bea.Id}/reissue", content: null)).EnsureSuccessStatusCode();
        Assert.Equal(2, _factory.Sent.Count(m => m.ToEmail == bea.Email));
        var invitation = await WithDbAsync(db => db.SurveyInvitations.AsNoTracking().SingleAsync(i => i.SurveyId == links.Id && i.UserId == ana.Id));
        (await admin.PostAsync($"/surveys/{links.Id}/invitations/{invitation.Id}/resend", content: null)).EnsureSuccessStatusCode();
        Assert.Equal(2, _factory.Links.Count(l => l.ToEmail == ana.Email));
    }

    // ------------------------------------------------------------------ one test per sender

    /// <summary>
    /// <c>CreateInvitationsAsync</c>, per-survey keys: a bulk send naming one outsider is refused
    /// WHOLE, naming her -- no invitation, no key, no mail for anybody, including the person who IS
    /// on the list. Widening the list is the way through, and then both go.
    /// </summary>
    [Fact]
    public async Task A_key_send_with_one_outsider_is_refused_whole_naming_her_and_nothing_is_minted_or_mailed()
    {
        var admin = await ClientAsync();
        var survey = await ActiveSurveyAsync(admin, CredentialModes.PerSurvey);
        var ana = await SeedPersonAsync("Ana Pérez");
        var bea = await SeedPersonAsync("Bea Solís");
        // Typed the way a client's spreadsheet types it: the match is on the normalised address.
        await AddAsync(admin, survey.Id, $"  {ana.Email.ToUpperInvariant()} ", "Ana Pérez");

        await AssertNotAuthorizedAsync(
            await InviteAsync(admin, survey.Id, new CreateSurveyInvitationsRequest(UserIds: [ana.Id, bea.Id])),
            bea);

        Assert.Equal(0, await InvitationRowsAsync(survey.Id));
        Assert.Equal(0, await CredentialRowsAsync(survey.Id));
        Assert.False(AnyMailTo(ana.Email, bea.Email));

        await AddAsync(admin, survey.Id, bea.Email);
        (await InviteAsync(admin, survey.Id, new CreateSurveyInvitationsRequest(UserIds: [ana.Id, bea.Id]))).EnsureSuccessStatusCode();
        Assert.Single(_factory.Sent, m => m.ToEmail == ana.Email);
        Assert.Single(_factory.Sent, m => m.ToEmail == bea.Email);
    }

    /// <summary><c>CreateInvitationsAsync</c>, personal links, sent by department: the department is not the list.</summary>
    [Fact]
    public async Task A_link_send_by_department_names_whoever_in_it_is_not_on_the_list_and_mails_nobody()
    {
        var admin = await ClientAsync();
        var survey = await ActiveSurveyAsync(admin, CredentialModes.PersonalLink);
        var ana = await SeedPersonAsync("Ana Pérez");
        var carlos = await SeedPersonAsync("Carlos Mora");
        await AddAsync(admin, survey.Id, ana.Email);

        await AssertNotAuthorizedAsync(
            await InviteAsync(admin, survey.Id, new CreateSurveyInvitationsRequest(DepartmentIds: [_comercio])),
            carlos);

        Assert.Equal(0, await InvitationRowsAsync(survey.Id));
        Assert.False(AnyMailTo(ana.Email, carlos.Email));
    }

    /// <summary><c>CreateInvitationsAsync</c>, shared accounts: it mints invitation tokens and mails none, and is refused all the same.</summary>
    [Fact]
    public async Task A_shared_mode_invitation_to_an_outsider_mints_no_invitation()
    {
        var admin = await ClientAsync();
        var survey = await ActiveSurveyAsync(admin, CredentialModes.Shared);
        var ana = await SeedPersonAsync("Ana Pérez");
        var dani = await SeedPersonAsync("Dani Rojas");
        await AddAsync(admin, survey.Id, ana.Email);

        await AssertNotAuthorizedAsync(
            await InviteAsync(admin, survey.Id, new CreateSurveyInvitationsRequest(UserIds: [dani.Id])),
            dani);
        Assert.Equal(0, await InvitationRowsAsync(survey.Id));

        // Somebody on it is invited as before.
        (await InviteAsync(admin, survey.Id, new CreateSurveyInvitationsRequest(UserIds: [ana.Id]))).EnsureSuccessStatusCode();
        Assert.Equal(1, await InvitationRowsAsync(survey.Id));
    }

    /// <summary>
    /// <c>ResendPersonalLinkAsync</c> (through <c>ResendInvitationAsync</c>): somebody mailed before
    /// they were taken off the list keeps the link they hold -- the token is not rotated -- and gets
    /// no new one.
    /// </summary>
    [Fact]
    public async Task A_link_resend_to_somebody_taken_off_the_list_rotates_nothing_and_mails_nothing()
    {
        var admin = await ClientAsync();
        var survey = await ActiveSurveyAsync(admin, CredentialModes.PersonalLink);
        var ana = await SeedPersonAsync("Ana Pérez");
        var keeper = await AddAsync(admin, survey.Id, "otra.persona@cliente.example.com");
        var anaRow = await AddAsync(admin, survey.Id, ana.Email);
        (await InviteAsync(admin, survey.Id, new CreateSurveyInvitationsRequest(UserIds: [ana.Id]))).EnsureSuccessStatusCode();
        var before = await WithDbAsync(db => db.SurveyInvitations.AsNoTracking().SingleAsync(i => i.SurveyId == survey.Id && i.UserId == ana.Id));
        Assert.Single(_factory.Links, l => l.ToEmail == ana.Email);

        Assert.Equal(HttpStatusCode.NoContent, (await admin.DeleteAsync($"{ListRoute(survey.Id)}/{anaRow.Id}")).StatusCode);
        Assert.Equal([keeper.Email], (await ListAsync(admin, survey.Id)).People.Select(p => p.Email));

        await AssertNotAuthorizedAsync(
            await admin.PostAsync($"/surveys/{survey.Id}/invitations/{before.Id}/resend", content: null),
            ana);

        var after = await WithDbAsync(db => db.SurveyInvitations.AsNoTracking().SingleAsync(i => i.Id == before.Id));
        Assert.Equal(before.InvitationToken, after.InvitationToken);
        Assert.Equal(before.SentAt, after.SentAt);
        Assert.Single(_factory.Links, l => l.ToEmail == ana.Email);
    }

    /// <summary><c>ReissueAsync</c>: by email or handed over in person, no key is rotated for somebody off the list.</summary>
    [Fact]
    public async Task A_reissue_for_somebody_off_the_list_keeps_their_key_and_mails_nothing_by_either_delivery()
    {
        var admin = await ClientAsync();
        var survey = await ActiveSurveyAsync(admin, CredentialModes.PerSurvey);
        var ana = await SeedPersonAsync("Ana Pérez");
        await AddAsync(admin, survey.Id, "otra.persona@cliente.example.com");
        var anaRow = await AddAsync(admin, survey.Id, ana.Email);
        (await InviteAsync(admin, survey.Id, new CreateSurveyInvitationsRequest(UserIds: [ana.Id]))).EnsureSuccessStatusCode();
        var hashBefore = await WithDbAsync(db => db.SurveyCredentials.AsNoTracking()
            .Where(c => c.SurveyId == survey.Id && c.UserId == ana.Id).Select(c => c.PasswordHash).SingleAsync());
        (await admin.DeleteAsync($"{ListRoute(survey.Id)}/{anaRow.Id}")).EnsureSuccessStatusCode();

        await AssertNotAuthorizedAsync(await admin.PostAsync($"/surveys/{survey.Id}/credentials/{ana.Id}/reissue", content: null), ana);
        var timsOperator = await ClientAsync(Roles.SuperAdmin);
        await AssertNotAuthorizedAsync(
            await timsOperator.PostAsJsonAsync(
                $"/surveys/{survey.Id}/credentials/{ana.Id}/reissue",
                new SurveyCredentialReissueRequest(Delivery: SurveyCredentialDeliveries.Handover)),
            ana);

        var hashAfter = await WithDbAsync(db => db.SurveyCredentials.AsNoTracking()
            .Where(c => c.SurveyId == survey.Id && c.UserId == ana.Id).Select(c => c.PasswordHash).SingleAsync());
        Assert.Equal(hashBefore, hashAfter);
        Assert.Single(_factory.Sent, m => m.ToEmail == ana.Email);
    }

    /// <summary><c>RemindAsync</c>: no reminder, and the reminder count is not touched.</summary>
    [Fact]
    public async Task A_reminder_to_somebody_off_the_list_is_refused_and_nothing_is_stamped()
    {
        var admin = await ClientAsync();
        var survey = await ActiveSurveyAsync(admin, CredentialModes.PerSurvey);
        var ana = await SeedPersonAsync("Ana Pérez");
        await AddAsync(admin, survey.Id, "otra.persona@cliente.example.com");
        var anaRow = await AddAsync(admin, survey.Id, ana.Email);
        (await InviteAsync(admin, survey.Id, new CreateSurveyInvitationsRequest(UserIds: [ana.Id]))).EnsureSuccessStatusCode();
        (await admin.DeleteAsync($"{ListRoute(survey.Id)}/{anaRow.Id}")).EnsureSuccessStatusCode();

        await AssertNotAuthorizedAsync(await admin.PostAsync($"/surveys/{survey.Id}/credentials/{ana.Id}/remind", content: null), ana);

        Assert.DoesNotContain(_factory.Reminders, r => r.ToEmail == ana.Email);
        var credential = await WithDbAsync(db => db.SurveyCredentials.AsNoTracking().SingleAsync(c => c.SurveyId == survey.Id && c.UserId == ana.Id));
        Assert.Equal(0, credential.ReminderCount);
        Assert.Null(credential.LastRemindedAt);
    }

    /// <summary>
    /// <c>SendRemindersAsync</c> sends nothing to anybody (its mail was ruled out on 2026-10-19), so
    /// it has nobody to refuse: with a list and an outsider in the audience it still answers zeroes
    /// and mails nobody. Stated so that a reminder producer coming back meets this test.
    /// </summary>
    [Fact]
    public async Task The_bulk_reminder_route_still_mails_nobody_with_a_list_set()
    {
        var admin = await ClientAsync();
        var survey = await ActiveSurveyAsync(admin, CredentialModes.PerSurvey);
        var ana = await SeedPersonAsync("Ana Pérez");
        var bea = await SeedPersonAsync("Bea Solís");
        await AddAsync(admin, survey.Id, ana.Email);
        (await InviteAsync(admin, survey.Id, new CreateSurveyInvitationsRequest(UserIds: [ana.Id]))).EnsureSuccessStatusCode();
        (await admin.PutAsJsonAsync($"/surveys/{survey.Id}", new UpdateSurveyRequest(
            Settings: new SurveySettingsInput(NotificationSendReminders: true)))).EnsureSuccessStatusCode();

        var response = await admin.PostAsync($"/surveys/{survey.Id}/invitations/reminders", content: null);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var result = (await response.Content.ReadFromJsonAsync<SurveyReminderResult>())!;
        Assert.Equal(0, result.Queued);
        Assert.DoesNotContain(_factory.Reminders, r => r.ToEmail == ana.Email || r.ToEmail == bea.Email);
    }

    /// <summary>
    /// The shared-mode roster's «Enviar datos de acceso» (<c>POST /admin/users/credentials</c> with
    /// the survey's id): one person off the list refuses the batch WHOLE, naming her, before any
    /// password is re-hashed -- nobody's old password dies, no session ends, nobody is mailed. With
    /// her added to the list, both are sent.
    /// </summary>
    [Fact]
    public async Task A_roster_credentials_resend_with_one_outsider_rehashes_nothing_and_mails_nobody()
    {
        var admin = await ClientAsync();
        var survey = await ActiveSurveyAsync(admin, CredentialModes.Shared);
        var ana = await SeedPersonAsync("Ana Pérez");
        var dani = await SeedPersonAsync("Dani Rojas");
        var before = await WithDbAsync(async db =>
        {
            foreach (var user in await db.Users.Where(u => u.Id == ana.Id || u.Id == dani.Id).ToListAsync())
            {
                user.Username = $"u{Guid.NewGuid():N}"[..12];
                user.PasswordHash = $"hash-{user.Id:N}";
            }

            await db.SaveChangesAsync();
            return await db.Users.AsNoTracking()
                .Where(u => u.Id == ana.Id || u.Id == dani.Id)
                .ToDictionaryAsync(u => u.Id, u => (u.PasswordHash, u.SecurityStamp));
        });
        await AddAsync(admin, survey.Id, ana.Email);

        await AssertNotAuthorizedAsync(
            await admin.PostAsJsonAsync("/admin/users/credentials", new ResendCredentialsBatchRequest([ana.Id, dani.Id], survey.Id)),
            dani);

        var after = await WithDbAsync(db => db.Users.AsNoTracking()
            .Where(u => u.Id == ana.Id || u.Id == dani.Id)
            .ToDictionaryAsync(u => u.Id, u => (u.PasswordHash, u.SecurityStamp)));
        Assert.Equal(before[ana.Id], after[ana.Id]);
        Assert.Equal(before[dani.Id], after[dani.Id]);
        Assert.False(AnyMailTo(ana.Email, dani.Email));

        // Another company's admin cannot use a survey id to reach this list, or learn it exists.
        var stranger = await ClientAsync(companyId: _otherCompanyId);
        var foreign = await stranger.PostAsJsonAsync("/admin/users/credentials", new ResendCredentialsBatchRequest([ana.Id], survey.Id));
        Assert.Equal(HttpStatusCode.NotFound, foreign.StatusCode);

        await AddAsync(admin, survey.Id, dani.Email);
        var sent = await admin.PostAsJsonAsync("/admin/users/credentials", new ResendCredentialsBatchRequest([ana.Id, dani.Id], survey.Id));
        Assert.Equal(HttpStatusCode.OK, sent.StatusCode);
        Assert.Equal(2, (await sent.Content.ReadFromJsonAsync<CredentialsResendBatchResult>())!.Sent);
        Assert.Single(_factory.Sent, m => m.ToEmail == ana.Email);
        Assert.Single(_factory.Sent, m => m.ToEmail == dani.Email);
    }

    // ------------------------------------------------------------------ the list's routes

    [Fact]
    public async Task Adding_records_who_and_when_and_refuses_a_duplicate_or_a_non_address()
    {
        var admin = await ClientAsync();
        var survey = await ActiveSurveyAsync(admin, CredentialModes.PerSurvey);
        var before = DateTimeOffset.UtcNow.AddSeconds(-5);

        var added = await AddAsync(admin, survey.Id, " Ana.Perez@Cliente.Example.com ", "  Ana   Pérez ");

        Assert.Equal("ana.perez@cliente.example.com", added.Email);
        Assert.Equal("Ana Pérez", added.DisplayName);
        Assert.Equal("Quien administra", added.AddedByName);
        Assert.NotNull(added.AddedBy);
        Assert.True(added.AddedAt >= before);

        await RefusalAsync(
            await admin.PostAsJsonAsync(ListRoute(survey.Id), new AddSurveyAuthorizedPersonRequest("ANA.PEREZ@cliente.example.com")),
            HttpStatusCode.Conflict, AdminRefusals.SurveyAuthorizedEmailDuplicate);
        await RefusalAsync(
            await admin.PostAsJsonAsync(ListRoute(survey.Id), new AddSurveyAuthorizedPersonRequest("no es un correo")),
            HttpStatusCode.BadRequest, AdminRefusals.SurveyAuthorizedEmailInvalid);

        var list = await ListAsync(admin, survey.Id);
        Assert.Equal(1, list.Count);
        Assert.True(list.Editable);
        Assert.Null(list.LockReason);
    }

    [Fact]
    public async Task A_paste_reports_duplicates_and_what_was_there_and_a_bad_paste_writes_nothing()
    {
        var admin = await ClientAsync();
        var survey = await ActiveSurveyAsync(admin, CredentialModes.PerSurvey);
        await AddAsync(admin, survey.Id, "ana@cliente.example.com");

        var bad = await admin.PostAsJsonAsync($"{ListRoute(survey.Id)}/bulk", new BulkSurveyAuthorizedPeopleRequest(
            [new("bea@cliente.example.com"), new("no-es-correo")], Replace: true));
        var refusal = await RefusalAsync(bad, HttpStatusCode.BadRequest, AdminRefusals.SurveyAuthorizedListInvalid);
        Assert.Equal(["no-es-correo"], refusal.GetProperty("invalid").Deserialize<List<string>>()!);
        await RefusalAsync(
            await admin.PostAsJsonAsync($"{ListRoute(survey.Id)}/bulk", new BulkSurveyAuthorizedPeopleRequest([], Replace: true)),
            HttpStatusCode.BadRequest, AdminRefusals.SurveyAuthorizedListInvalid);
        Assert.Equal(["ana@cliente.example.com"], (await ListAsync(admin, survey.Id)).People.Select(p => p.Email));

        var response = await admin.PostAsJsonAsync($"{ListRoute(survey.Id)}/bulk", new BulkSurveyAuthorizedPeopleRequest(
            [new("ANA@cliente.example.com"), new("bea@cliente.example.com", "Bea Solís"), new(" Bea@Cliente.example.com "), new("carlos@cliente.example.com")]));
        response.EnsureSuccessStatusCode();
        var result = (await response.Content.ReadFromJsonAsync<BulkSurveyAuthorizedPeopleResult>(Web))!;
        Assert.Equal(["bea@cliente.example.com", "carlos@cliente.example.com"], result.Added);
        Assert.Equal(["ana@cliente.example.com"], result.AlreadyOnList);
        Assert.Equal(["bea@cliente.example.com"], result.DuplicatesInPaste);
        Assert.Empty(result.Removed);
        Assert.Equal(3, result.List.Count);
        Assert.Equal("Bea Solís", result.List.People.Single(p => p.Email == "bea@cliente.example.com").DisplayName);

        // Replace: the list becomes the paste; a row kept keeps who added it.
        var anaBefore = result.List.People.Single(p => p.Email == "ana@cliente.example.com");
        var replaced = (await (await admin.PostAsJsonAsync($"{ListRoute(survey.Id)}/bulk", new BulkSurveyAuthorizedPeopleRequest(
            [new("ana@cliente.example.com"), new("dani@cliente.example.com")], Replace: true))).Content.ReadFromJsonAsync<BulkSurveyAuthorizedPeopleResult>(Web))!;
        Assert.Equal(["bea@cliente.example.com", "carlos@cliente.example.com"], replaced.Removed);
        Assert.Equal(["ana@cliente.example.com", "dani@cliente.example.com"], replaced.List.People.Select(p => p.Email));
        Assert.Equal(anaBefore.AddedAt, replaced.List.People.Single(p => p.Email == "ana@cliente.example.com").AddedAt);
    }

    /// <summary>
    /// The survey's respondent-text rule, applied to its list: another company's admin is 403; its
    /// own company admin writes while it is active and not once it closes; a TIMS operator writes a
    /// closed survey -- filed under the survey's company -- and nobody writes an archived one.
    /// </summary>
    [Fact]
    public async Task Who_may_change_the_list_follows_the_survey_status_and_every_write_is_audited_to_the_company()
    {
        var admin = await ClientAsync();
        var survey = await ActiveSurveyAsync(admin, CredentialModes.PerSurvey);
        var outsider = await ClientAsync(Roles.CompanyAdmin, _otherCompanyId);

        Assert.Equal(HttpStatusCode.Forbidden, (await outsider.GetAsync(ListRoute(survey.Id))).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await outsider.PostAsJsonAsync(ListRoute(survey.Id), new AddSurveyAuthorizedPersonRequest("x@cliente.example.com"))).StatusCode);

        await WithDbAsync(async db =>
        {
            var row = await db.Surveys.FirstAsync(s => s.Id == survey.Id);
            row.Status = SurveyStatuses.Closed;
            return await db.SaveChangesAsync();
        });
        await RefusalAsync(
            await admin.PostAsJsonAsync(ListRoute(survey.Id), new AddSurveyAuthorizedPersonRequest("x@cliente.example.com")),
            HttpStatusCode.Conflict, AdminRefusals.SurveyAuthorizedListLocked);
        var locked = await ListAsync(admin, survey.Id);
        Assert.False(locked.Editable);
        Assert.Equal(AdminRefusals.SurveyAuthorizedListLocked, locked.LockReason);

        var timsOperator = await ClientAsync(Roles.SuperAdmin);
        var added = await AddAsync(timsOperator, survey.Id, "x@cliente.example.com");
        var audit = await WithDbAsync(db => db.AuditLogs.AsNoTracking()
            .Where(a => a.Action == "surveys.authorized-people.create" && a.ResourceId == survey.Id.ToString() && a.Success)
            .ToListAsync());
        Assert.Equal(_companyId, Assert.Single(audit).CompanyId);

        await WithDbAsync(async db =>
        {
            var row = await db.Surveys.FirstAsync(s => s.Id == survey.Id);
            row.Status = SurveyStatuses.Archived;
            return await db.SaveChangesAsync();
        });
        await RefusalAsync(
            await timsOperator.DeleteAsync($"{ListRoute(survey.Id)}/{added.Id}"),
            HttpStatusCode.Conflict, AdminRefusals.SurveyAuthorizedListArchived);
        Assert.Equal(1, (await ListAsync(timsOperator, survey.Id)).Count);
    }

    /// <summary>«Duplicar» copies words, not the people the client named for one survey.</summary>
    [Fact]
    public async Task Duplicar_does_not_copy_the_list()
    {
        var admin = await ClientAsync();
        var survey = await ActiveSurveyAsync(admin, CredentialModes.PerSurvey);
        await AddAsync(admin, survey.Id, "ana@cliente.example.com");

        foreach (var includeAudience in new[] { true, false })
        {
            var response = await admin.PostAsJsonAsync($"/surveys/{survey.Id}/duplicate", new DuplicateSurveyRequest(IncludeAudience: includeAudience));
            Assert.Equal(HttpStatusCode.Created, response.StatusCode);
            var copy = (await response.Content.ReadFromJsonAsync<SurveyDetail>())!;
            Assert.Equal(0, (await ListAsync(admin, copy.Id)).Count);
        }

        Assert.Equal(1, (await ListAsync(admin, survey.Id)).Count);
    }
}
