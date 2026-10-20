using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using ClimateProject.Application.Auth;
using ClimateProject.Application.Localization;
using ClimateProject.Application.Notifications;
using ClimateProject.Application.Surveys;
using ClimateProject.Domain.Entities;
using ClimateProject.Infrastructure.Persistence;
using ClimateProject.IntegrationTests.Support;
using Microsoft.EntityFrameworkCore;

namespace ClimateProject.IntegrationTests.Surveys;

/// <summary>
/// Distribution, invitations, their state tracking and the anonymity boundary (#116).
///
/// Two groups of assertion carry most of the weight here and neither is provable from a unit
/// test:
///
/// <list type="bullet">
/// <item><b>The anonymity guarantee.</b> Asserted against the actual columns -- an anonymous
/// survey's <c>started_at</c> and <c>completed_at</c> must still be NULL after the respondent
/// has walked the whole flow. A response-shape assertion alone would pass against an
/// implementation that wrote the timestamps and merely declined to echo them.</item>
/// <item><b>Tokens never leaving the admin surface.</b> Asserted against the raw response
/// body rather than against the DTO, because a DTO that omits a property proves nothing about
/// a handler that serialises an anonymous object.</item>
/// </list>
/// </summary>
[Collection("Postgres")]
public class SurveyDistributionEndpointsTests : IAsyncLifetime
{
    private readonly AuthWebApplicationFactory _factory;
    private readonly SurveyTestHarness _harness;
    private Guid _companyAId;
    private Guid _companyBId;
    private Guid _engineeringId;
    private Guid _salesId;

    public SurveyDistributionEndpointsTests(PostgresContainerFixture postgres)
    {
        _factory = postgres.App;
        _harness = new SurveyTestHarness(_factory, $"dist-{Guid.NewGuid():N}.test");
    }

    public async Task InitializeAsync()
    {
        _companyAId = await _harness.SeedCompanyAsync("Distribution Co A");
        _companyBId = await _harness.SeedCompanyAsync("Distribution Co B");
        _engineeringId = await _harness.SeedDepartmentAsync(_companyAId, "Engineering");
        _salesId = await _harness.SeedDepartmentAsync(_companyAId, "Sales");
    }

    public Task DisposeAsync() => Task.CompletedTask;

    // ------------------------------------------------------------------
    // Local scaffolding
    // ------------------------------------------------------------------

    private Task<HttpClient> AdminAAsync() => _harness.ClientAsync(Roles.CompanyAdmin, _companyAId);

    private HttpClient Anonymous() => _factory.CreateClient();

    /// <summary>An employee row to invite. Seeded directly: these never authenticate, they only receive.</summary>
    private Task<Guid> SeedEmployeeAsync(
        Guid companyId,
        Guid? departmentId = null,
        string language = "en",
        bool isActive = true,
        string? email = null)
        => _harness.WithDbAsync(async db =>
        {
            var user = new User
            {
                Id = Guid.NewGuid(),
                CompanyId = companyId,
                DepartmentId = departmentId,
                Email = email ?? $"{Guid.NewGuid():N}@invitee.test",
                Name = "Invitee",
                Role = Roles.Employee,
                IsActive = isActive,
                CreatedAt = DateTimeOffset.UtcNow,
                UpdatedAt = DateTimeOffset.UtcNow,
            };
            user.Preferences.Language = language;
            db.Users.Add(user);
            await db.SaveChangesAsync();
            return user.Id;
        });

    /// <summary>An active survey, published through the real status route so the publish gate runs.</summary>
    /// <param name="sendInvitations">
    /// Turned ON for this class by default, and that is the opposite of the product's own
    /// default since 2026-10-19 -- a survey is created with `NotificationSendInvitations`
    /// false, because the credentials mail already carries the sign-in button and the
    /// invitation mail's button answers the survey without signing in (the reasoning is in
    /// SurveyEndpoints' create path). These tests are about what the invitation MACHINERY
    /// does once a tenant has asked for it, so they ask for it explicitly rather than lean
    /// on a default that no longer means what they were written against.
    /// `A_survey_is_created_with_the_invitation_email_off` is where the default itself is
    /// pinned, and two tests below deliberately pass false.
    /// </param>
    /// <param name="sendReminders">
    /// On for this class by default, and the product's own default is off since 2026-10-19
    /// for the same sentence that silenced the invitation: "just one email, with the
    /// credentials to login". The reminder tests below are about what the sweep DOES once a
    /// tenant has asked for reminders, so they ask.
    /// </param>
    private async Task<SurveyDetail> CreateActiveSurveyAsync(
        HttpClient client,
        bool anonymous = false,
        string? language = null,
        List<Guid>? departmentIds = null,
        bool sendInvitations = true,
        bool sendReminders = true)
    {
        var created = await SurveyTestHarness.CreateSurveyAsync(
            client, SurveyTestHarness.MinimalRequest(_companyAId, language: language, departmentIds: departmentIds));

        if (anonymous || sendInvitations || sendReminders)
        {
            var patched = await client.PutAsJsonAsync(
                $"/surveys/{created.Id}",
                new UpdateSurveyRequest(Settings: new SurveySettingsInput(
                    Anonymous: anonymous ? true : null,
                    NotificationSendInvitations: sendInvitations ? true : null,
                    NotificationSendReminders: sendReminders ? true : null)));
            patched.EnsureSuccessStatusCode();
        }

        (await SurveyTestHarness.SetStatusAsync(client, created.Id, SurveyStatuses.Active)).EnsureSuccessStatusCode();
        return created;
    }

    private Task<string> TokenOfAsync(Guid invitationId)
        => _harness.WithDbAsync(async db =>
            (await db.SurveyInvitations.AsNoTracking().FirstAsync(i => i.Id == invitationId)).InvitationToken);

    private Task<SurveyInvitation> InvitationRowAsync(Guid invitationId)
        => _harness.WithDbAsync(db => db.SurveyInvitations.AsNoTracking().FirstAsync(i => i.Id == invitationId));

    private static async Task<SurveyInvitationBatchResult> InviteAsync(
        HttpClient client, Guid surveyId, CreateSurveyInvitationsRequest request)
    {
        var response = await client.PostAsJsonAsync($"/surveys/{surveyId}/invitations", request);
        response.EnsureSuccessStatusCode();
        return (await response.Content.ReadFromJsonAsync<SurveyInvitationBatchResult>())!;
    }

    // ------------------------------------------------------------------
    // Distribution configuration
    // ------------------------------------------------------------------

    [Fact]
    public async Task A_survey_has_no_distribution_until_one_is_configured()
    {
        var client = await AdminAAsync();
        var survey = await CreateActiveSurveyAsync(client);

        var response = await client.GetAsync($"/surveys/{survey.Id}/distribution");

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    [Fact]
    public async Task Configuring_a_tokenized_distribution_mints_no_public_link()
    {
        var client = await AdminAAsync();
        var survey = await CreateActiveSurveyAsync(client);

        var response = await client.PutAsJsonAsync(
            $"/surveys/{survey.Id}/distribution",
            new UpsertSurveyDistributionRequest(
                AccessType: SurveyAccessTypes.Tokenized,
                AccessRules: new SurveyAccessRulesInput(RequireLogin: true, MaxResponses: 250)));

        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        var detail = (await response.Content.ReadFromJsonAsync<SurveyDistributionDetail>())!;

        Assert.Equal(SurveyAccessTypes.Tokenized, detail.AccessType);
        Assert.Null(detail.PublicLink);
        Assert.True(detail.AccessRules.RequireLogin);
        Assert.Equal(250, detail.AccessRules.MaxResponses);

        // Defaults the caller never mentioned survive untouched -- the same "omitted means
        // leave it alone" rule the survey settings patch obeys.
        Assert.True(detail.AccessRules.SingleResponse);
        Assert.False(detail.AccessRules.AllowAnonymous);
        Assert.Equal("#000000", detail.QrCustomization.ForegroundColor);
    }

    [Fact]
    public async Task A_second_upsert_updates_the_one_row_rather_than_creating_a_second()
    {
        var client = await AdminAAsync();
        var survey = await CreateActiveSurveyAsync(client);

        var first = await client.PutAsJsonAsync($"/surveys/{survey.Id}/distribution", new UpsertSurveyDistributionRequest());
        Assert.Equal(HttpStatusCode.Created, first.StatusCode);

        var second = await client.PutAsJsonAsync(
            $"/surveys/{survey.Id}/distribution",
            new UpsertSurveyDistributionRequest(QrCustomization: new SurveyQrCustomizationInput(ForegroundColor: "#123456", Size: 512)));
        Assert.Equal(HttpStatusCode.OK, second.StatusCode);

        var detail = (await second.Content.ReadFromJsonAsync<SurveyDistributionDetail>())!;
        Assert.Equal("#123456", detail.QrCustomization.ForegroundColor);
        Assert.Equal(512, detail.QrCustomization.Size);

        // survey_distributions.survey_id is uniquely indexed; a second insert would have been
        // a 409 out of the global handler rather than an update.
        var rowCount = await _harness.WithDbAsync(db => db.SurveyDistributions.CountAsync(d => d.SurveyId == survey.Id));
        Assert.Equal(1, rowCount);
    }

    [Fact]
    public async Task An_unknown_access_type_is_refused()
    {
        var client = await AdminAAsync();
        var survey = await CreateActiveSurveyAsync(client);

        var response = await client.PutAsJsonAsync(
            $"/surveys/{survey.Id}/distribution", new UpsertSurveyDistributionRequest(AccessType: "private"));

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    // ------------------------------------------------------------------
    // Share links: expiry, rotation, revocation
    // ------------------------------------------------------------------

    [Fact]
    public async Task A_public_distribution_mints_an_opaque_link_that_resolves_without_authentication()
    {
        var client = await AdminAAsync();
        var survey = await CreateActiveSurveyAsync(client, anonymous: true);

        var response = await client.PutAsJsonAsync(
            $"/surveys/{survey.Id}/distribution", new UpsertSurveyDistributionRequest(AccessType: SurveyAccessTypes.Public));
        var detail = (await response.Content.ReadFromJsonAsync<SurveyDistributionDetail>())!;

        Assert.NotNull(detail.PublicLink);
        Assert.StartsWith(SurveyAccessTokens.PublicLinkPrefix, detail.PublicLink, StringComparison.Ordinal);

        var token = detail.PublicLink![SurveyAccessTokens.PublicLinkPrefix.Length..];
        Assert.True(SurveyAccessTokens.HasExpectedShape(token));

        var resolved = await Anonymous().GetFromJsonAsync<SurveyPublicLinkDetail>($"/survey-links/{token}");
        Assert.Equal(survey.Id, resolved!.SurveyId);
        Assert.Equal("Q3 Climate Survey", resolved.SurveyTitle);
    }

    // -- respondents never log in (ruled 2026-10-12) ---------------------------------------
    //
    // A QR on "Q4 Climate Survey (open)" asked a phone to "inicie sesión". The survey was
    // identified, and `ResolveRespondentAsync` serves an unauthenticated visitor only on an
    // anonymous one, so the link could be scanned by everyone and answered by no one.

    [Fact]
    public async Task A_survey_created_without_a_word_about_anonymity_is_anonymous()
    {
        var client = await AdminAAsync();

        var created = await SurveyTestHarness.CreateSurveyAsync(
            client, SurveyTestHarness.MinimalRequest(_companyAId) with { Settings = null });

        Assert.True(created.Settings.Anonymous);
    }

    // Every survey has a link and a QR, whatever it records (ruled 2026-10-12, reversing #540):
    // nobody who opens one logs in, and ResolveRespondentAsync answers an unauthenticated
    // visitor anonymously on every survey -- SurveyResponseEndpointsTests pins that half.

    [Fact]
    public async Task A_public_link_is_minted_on_a_survey_that_records_who_answers()
    {
        var client = await AdminAAsync();
        var survey = await CreateActiveSurveyAsync(client); // identified, stated explicitly

        var response = await client.PutAsJsonAsync(
            $"/surveys/{survey.Id}/distribution", new UpsertSurveyDistributionRequest(AccessType: SurveyAccessTypes.Public));

        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        var detail = await response.Content.ReadFromJsonAsync<SurveyDistributionDetail>();
        Assert.NotNull(detail!.PublicLink);

        var stored = await _harness.WithDbAsync(db => db.SurveyDistributions
            .AsNoTracking().Where(d => d.SurveyId == survey.Id).Select(d => d.PublicUrl).SingleAsync());
        Assert.NotNull(stored);
    }

    [Fact]
    public async Task Regenerating_a_link_works_on_a_survey_that_records_who_answers()
    {
        var client = await AdminAAsync();
        var survey = await CreateActiveSurveyAsync(client);
        (await client.PutAsJsonAsync(
            $"/surveys/{survey.Id}/distribution",
            new UpsertSurveyDistributionRequest(AccessType: SurveyAccessTypes.Tokenized))).EnsureSuccessStatusCode();

        var regenerated = await client.PostAsync($"/surveys/{survey.Id}/distribution/link/regenerate", null);

        Assert.Equal(HttpStatusCode.OK, regenerated.StatusCode);
        var detail = await regenerated.Content.ReadFromJsonAsync<SurveyDistributionDetail>();
        Assert.NotNull(detail!.PublicLink);
    }

    [Fact]
    public async Task A_survey_with_a_live_link_can_be_made_one_that_records_who_answers()
    {
        var client = await AdminAAsync();

        // A draft -- the only status whose content, anonymity included, may still change
        // (`SurveyStatuses.AllowsContentEdit`) -- that has already been given its link.
        var draft = await SurveyTestHarness.CreateSurveyAsync(
            client, SurveyTestHarness.MinimalRequest(_companyAId) with { Settings = new SurveySettingsInput(Anonymous: true) });
        (await client.PutAsJsonAsync(
            $"/surveys/{draft.Id}/distribution",
            new UpsertSurveyDistributionRequest(AccessType: SurveyAccessTypes.Public))).EnsureSuccessStatusCode();

        var flipped = await client.PutAsJsonAsync(
            $"/surveys/{draft.Id}", new UpdateSurveyRequest(Settings: new SurveySettingsInput(Anonymous: false)));

        Assert.Equal(HttpStatusCode.OK, flipped.StatusCode);
        var (anonymous, link) = await _harness.WithDbAsync(async db => (
            await db.Surveys.AsNoTracking().Where(x => x.Id == draft.Id).Select(x => x.Settings.Anonymous).SingleAsync(),
            await db.SurveyDistributions.AsNoTracking().Where(d => d.SurveyId == draft.Id).Select(d => d.PublicUrl).SingleAsync()));
        Assert.False(anonymous);
        Assert.NotNull(link); // the link survives the flip: its holders can still answer
    }

    [Fact]
    public async Task Regenerating_a_link_kills_the_previous_one()
    {
        var client = await AdminAAsync();
        var survey = await CreateActiveSurveyAsync(client, anonymous: true);

        var first = await client.PutAsJsonAsync(
            $"/surveys/{survey.Id}/distribution", new UpsertSurveyDistributionRequest(AccessType: SurveyAccessTypes.Public));
        var oldLink = (await first.Content.ReadFromJsonAsync<SurveyDistributionDetail>())!.PublicLink!;
        var oldToken = oldLink[SurveyAccessTokens.PublicLinkPrefix.Length..];

        var regenerated = await client.PostAsync($"/surveys/{survey.Id}/distribution/link/regenerate", null);
        var detail = (await regenerated.Content.ReadFromJsonAsync<SurveyDistributionDetail>())!;

        Assert.NotEqual(oldLink, detail.PublicLink);
        Assert.Equal(1, detail.RegeneratedCount);
        Assert.NotNull(detail.LastRegeneratedAt);

        var anonymous = Anonymous();
        Assert.Equal(HttpStatusCode.NotFound, (await anonymous.GetAsync($"/survey-links/{oldToken}")).StatusCode);

        var newToken = detail.PublicLink![SurveyAccessTokens.PublicLinkPrefix.Length..];
        Assert.Equal(HttpStatusCode.OK, (await anonymous.GetAsync($"/survey-links/{newToken}")).StatusCode);
    }

    [Fact]
    public async Task A_revoked_link_returns_404_and_revoking_twice_is_not_an_error()
    {
        var client = await AdminAAsync();
        var survey = await CreateActiveSurveyAsync(client, anonymous: true);

        var created = await client.PutAsJsonAsync(
            $"/surveys/{survey.Id}/distribution", new UpsertSurveyDistributionRequest(AccessType: SurveyAccessTypes.Public));
        var token = (await created.Content.ReadFromJsonAsync<SurveyDistributionDetail>())!
            .PublicLink![SurveyAccessTokens.PublicLinkPrefix.Length..];

        var revoked = await client.PostAsync($"/surveys/{survey.Id}/distribution/link/revoke", null);
        Assert.Equal(HttpStatusCode.OK, revoked.StatusCode);
        var detail = (await revoked.Content.ReadFromJsonAsync<SurveyDistributionDetail>())!;
        Assert.Null(detail.PublicLink);
        Assert.Equal(SurveyAccessTypes.Tokenized, detail.AccessType);

        Assert.Equal(HttpStatusCode.NotFound, (await Anonymous().GetAsync($"/survey-links/{token}")).StatusCode);

        // Idempotent: a retried "kill this link" must not look like a failure to kill it.
        var again = await client.PostAsync($"/surveys/{survey.Id}/distribution/link/revoke", null);
        Assert.Equal(HttpStatusCode.OK, again.StatusCode);
    }

    [Fact]
    public async Task Switching_back_to_tokenized_revokes_the_link_rather_than_leaving_it_live()
    {
        var client = await AdminAAsync();
        var survey = await CreateActiveSurveyAsync(client, anonymous: true);

        var created = await client.PutAsJsonAsync(
            $"/surveys/{survey.Id}/distribution", new UpsertSurveyDistributionRequest(AccessType: SurveyAccessTypes.Public));
        var token = (await created.Content.ReadFromJsonAsync<SurveyDistributionDetail>())!
            .PublicLink![SurveyAccessTokens.PublicLinkPrefix.Length..];

        await client.PutAsJsonAsync(
            $"/surveys/{survey.Id}/distribution", new UpsertSurveyDistributionRequest(AccessType: SurveyAccessTypes.Tokenized));

        Assert.Equal(HttpStatusCode.NotFound, (await Anonymous().GetAsync($"/survey-links/{token}")).StatusCode);
    }

    [Fact]
    public async Task A_share_link_stops_resolving_once_the_survey_stops_collecting()
    {
        var client = await AdminAAsync();
        var survey = await CreateActiveSurveyAsync(client, anonymous: true);

        var created = await client.PutAsJsonAsync(
            $"/surveys/{survey.Id}/distribution", new UpsertSurveyDistributionRequest(AccessType: SurveyAccessTypes.Public));
        var token = (await created.Content.ReadFromJsonAsync<SurveyDistributionDetail>())!
            .PublicLink![SurveyAccessTokens.PublicLinkPrefix.Length..];

        // The survey's own window is the link's expiry. There is no separate expiry column
        // and no sweep -- a link to a closed survey is dead the moment the survey closes.
        (await SurveyTestHarness.SetStatusAsync(client, survey.Id, SurveyStatuses.Closed)).EnsureSuccessStatusCode();

        Assert.Equal(HttpStatusCode.NotFound, (await Anonymous().GetAsync($"/survey-links/{token}")).StatusCode);
    }

    [Fact]
    public async Task Resolving_a_link_counts_the_access_without_fingerprinting_the_visitor()
    {
        var client = await AdminAAsync();
        var survey = await CreateActiveSurveyAsync(client, anonymous: true);

        var created = await client.PutAsJsonAsync(
            $"/surveys/{survey.Id}/distribution", new UpsertSurveyDistributionRequest(AccessType: SurveyAccessTypes.Public));
        var token = (await created.Content.ReadFromJsonAsync<SurveyDistributionDetail>())!
            .PublicLink![SurveyAccessTokens.PublicLinkPrefix.Length..];

        var anonymous = Anonymous();
        await anonymous.GetAsync($"/survey-links/{token}");
        await anonymous.GetAsync($"/survey-links/{token}");
        await anonymous.GetAsync($"/survey-links/{token}");

        var detail = await client.GetFromJsonAsync<SurveyDistributionDetail>($"/surveys/{survey.Id}/distribution");
        Assert.Equal(3, detail!.TotalAccesses);
        Assert.NotNull(detail.LastAccessedAt);

        // Counting distinct visitors of an anonymous link means fingerprinting them. The
        // column stays at zero on purpose.
        Assert.Equal(0, detail.UniqueVisitors);
    }

    [Fact]
    public async Task A_malformed_or_unknown_share_token_is_a_404_and_never_says_why()
    {
        var anonymous = Anonymous();

        foreach (var token in new[] { "nonsense", SurveyAccessTokens.Mint() })
        {
            var response = await anonymous.GetAsync($"/survey-links/{token}");
            Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);

            // Unlike an invitation token -- which identifies one named person entitled to
            // know why their link died -- a share link is held by anyone, so revoked,
            // expired and never-existed are deliberately indistinguishable.
            var body = await response.Content.ReadAsStringAsync();
            Assert.DoesNotContain("revoked", body, StringComparison.OrdinalIgnoreCase);
            Assert.DoesNotContain("expired", body, StringComparison.OrdinalIgnoreCase);
        }
    }

    // ------------------------------------------------------------------
    // Authorization
    // ------------------------------------------------------------------

    [Fact]
    public async Task Another_tenants_admin_cannot_touch_this_surveys_distribution()
    {
        var owner = await AdminAAsync();
        var survey = await CreateActiveSurveyAsync(owner);
        var intruder = await _harness.ClientAsync(Roles.CompanyAdmin, _companyBId);

        Assert.Equal(HttpStatusCode.Forbidden, (await intruder.GetAsync($"/surveys/{survey.Id}/distribution")).StatusCode);
        Assert.Equal(
            HttpStatusCode.Forbidden,
            (await intruder.PutAsJsonAsync($"/surveys/{survey.Id}/distribution", new UpsertSurveyDistributionRequest())).StatusCode);
        Assert.Equal(
            HttpStatusCode.Forbidden,
            (await intruder.PostAsJsonAsync($"/surveys/{survey.Id}/invitations", new CreateSurveyInvitationsRequest(AllTargeted: true))).StatusCode);
    }

    [Fact]
    public async Task An_employee_of_the_owning_company_cannot_invite_anyone()
    {
        var owner = await AdminAAsync();
        var survey = await CreateActiveSurveyAsync(owner);

        // Deliberately an employee of the SAME company: a bare company match would let any
        // employee mail their entire organisation.
        var employee = await _harness.ClientAsync(Roles.Employee, _companyAId);

        Assert.Equal(
            HttpStatusCode.Forbidden,
            (await employee.PostAsJsonAsync($"/surveys/{survey.Id}/invitations", new CreateSurveyInvitationsRequest(AllTargeted: true))).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await employee.GetAsync($"/surveys/{survey.Id}/invitations")).StatusCode);
    }

    [Fact]
    public async Task An_unauthenticated_caller_cannot_reach_the_admin_routes()
    {
        var owner = await AdminAAsync();
        var survey = await CreateActiveSurveyAsync(owner);

        var response = await Anonymous().GetAsync($"/surveys/{survey.Id}/invitations");
        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    // ------------------------------------------------------------------
    // Minting invitations
    // ------------------------------------------------------------------

    [Fact]
    public async Task A_draft_survey_cannot_be_distributed()
    {
        var client = await AdminAAsync();
        var draft = await SurveyTestHarness.CreateSurveyAsync(client, SurveyTestHarness.MinimalRequest(_companyAId));
        await SeedEmployeeAsync(_companyAId);

        var response = await client.PostAsJsonAsync(
            $"/surveys/{draft.Id}/invitations", new CreateSurveyInvitationsRequest(AllTargeted: true));

        // The invitation carries the survey's title, and a draft's content is still
        // rewritable -- which is exactly why RespondentVisible is the set that runs the
        // translation gate.
        Assert.Equal(HttpStatusCode.Conflict, response.StatusCode);
    }

    [Fact]
    public async Task An_empty_selector_is_refused_rather_than_treated_as_everybody()
    {
        var client = await AdminAAsync();
        var survey = await CreateActiveSurveyAsync(client);

        var response = await client.PostAsJsonAsync(
            $"/surveys/{survey.Id}/invitations", new CreateSurveyInvitationsRequest());

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task Two_selectors_at_once_are_refused()
    {
        var client = await AdminAAsync();
        var survey = await CreateActiveSurveyAsync(client);
        var employee = await SeedEmployeeAsync(_companyAId, _engineeringId);

        var response = await client.PostAsJsonAsync(
            $"/surveys/{survey.Id}/invitations",
            new CreateSurveyInvitationsRequest(UserIds: [employee], DepartmentIds: [_engineeringId]));

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    /// <summary>
    /// The 2026-10-19 ruling, at the only place it can be observed: a survey nobody said
    /// anything to about invitations does not mail one.
    ///
    /// <para>
    /// The respondent gets exactly one email -- their credentials -- and the invitation mail
    /// that used to follow it is gone, because its button opened the survey WITHOUT signing
    /// in and because it repeated what the credentials mail already says. The invitation ROW
    /// is deliberately still minted: it is the audience artefact and the resend route's
    /// subject, and nothing per-person is lost by not mailing it -- on an anonymous survey
    /// `SurveyInvitationStatuses.AnonymityCeiling` already forbids recording `started` or
    /// `completed`, so the only state the mail could ever have produced is `opened`.
    /// </para>
    /// </summary>
    /// <summary>
    /// The last producer of a `survey_invitation` notification, and until 2026-10-19 the one
    /// that never consulted the flag. "Reenviar" is one click away in Distribucion, so a
    /// survey created with the mail off would still have mailed somebody the first time an
    /// administrator pressed it.
    /// </summary>
    [Fact]
    public async Task Resending_an_invitation_is_refused_because_the_platform_sends_no_invitation_email()
    {
        var client = await AdminAAsync();
        // sendInvitations is no longer passed: no setting can make a resend succeed. It is
        // refused for every survey, which is what 410 rather than 409 says.
        var survey = await CreateActiveSurveyAsync(client);
        var employee = await SeedEmployeeAsync(_companyAId);
        var result = await InviteAsync(client, survey.Id, new CreateSurveyInvitationsRequest(UserIds: [employee]));
        Assert.Equal(1, result.Created);
        Assert.Equal(0, result.NotificationsQueued);

        var before = await InvitationRowAsync(result.InvitationIds[0]);

        var resend = await client.PostAsync($"/surveys/{survey.Id}/invitations/{result.InvitationIds[0]}/resend", null);

        Assert.Equal(HttpStatusCode.Gone, resend.StatusCode);
        Assert.Contains(
            "does not send survey invitation email",
            await resend.Content.ReadAsStringAsync(),
            StringComparison.Ordinal);

        // Nothing queued, and the invitation left exactly as it was -- refused BEFORE the
        // token is re-minted, so the live one still works.
        Assert.False(await _harness.WithDbAsync(db => db.Notifications
            .AnyAsync(n => n.Type == NotificationTypes.SurveyInvitation && n.UserId == employee)));
        var after = await InvitationRowAsync(result.InvitationIds[0]);
        Assert.Equal(before.InvitationToken, after.InvitationToken);
        Assert.Equal(before.Status, after.Status);
        Assert.Null(after.SentAt);
    }

    /// <summary>
    /// "Just one email, with the credentials to login" -- so not a reminder either. A
    /// reminder is a second message to the same person, and on an anonymous survey it is one
    /// that can never be correct: the sweep selects on `completed_on IS NULL` and the
    /// anonymity ceiling forbids ever writing that column.
    /// </summary>
    [Fact]
    public async Task A_survey_is_created_with_reminders_off()
    {
        var client = await AdminAAsync();
        var created = await SurveyTestHarness.CreateSurveyAsync(client, SurveyTestHarness.MinimalRequest(_companyAId));

        Assert.False(created.Settings.NotificationSendReminders);
    }

    [Fact]
    public async Task A_survey_is_created_with_the_invitation_email_off()
    {
        var client = await AdminAAsync();

        // No Settings at all on the request -- which is what the climate workbook import and
        // every other caller send when nobody has mentioned invitations.
        var created = await SurveyTestHarness.CreateSurveyAsync(client, SurveyTestHarness.MinimalRequest(_companyAId));
        Assert.False(created.Settings.NotificationSendInvitations);

        (await SurveyTestHarness.SetStatusAsync(client, created.Id, SurveyStatuses.Active)).EnsureSuccessStatusCode();
        var employee = await SeedEmployeeAsync(_companyAId);
        var result = await InviteAsync(client, created.Id, new CreateSurveyInvitationsRequest(UserIds: [employee]));

        Assert.Equal(1, result.Created);
        Assert.Equal(0, result.NotificationsQueued);
        // The note no longer MENTIONS the mail. "No mail was queued" stopped being news when
        // the invitation email was deleted -- it is true of every batch now -- so the field
        // is reserved for what is actually wrong with this one.
        //
        // Not Assert.Null: `SeedEmployeeAsync` mints a reserved-domain address, so the
        // undeliverable warning legitimately fires here. Asserting null made this test about
        // the seed helper rather than about the setting. What it must prove is that no note
        // claims a survey-level mail setting is the reason.
        Assert.DoesNotContain("notificationSendInvitations", result.Note ?? string.Empty, StringComparison.Ordinal);

        Assert.False(await _harness.WithDbAsync(db => db.Notifications
            .AnyAsync(n => n.Type == NotificationTypes.SurveyInvitation && n.UserId == employee)));

        // Minted and left at the start of the ladder: `sent` would claim a mail that never
        // went, and `SentAt` anchors the reminder cadence.
        var invitation = await InvitationRowAsync(result.InvitationIds[0]);
        Assert.Equal(SurveyInvitationStatuses.Pending, invitation.Status);
        Assert.Null(invitation.SentAt);
    }

    [Fact]
    public async Task Inviting_by_department_reaches_only_that_department()
    {
        var client = await AdminAAsync();
        var survey = await CreateActiveSurveyAsync(client);
        var engineer = await SeedEmployeeAsync(_companyAId, _engineeringId);
        await SeedEmployeeAsync(_companyAId, _salesId);

        var result = await InviteAsync(client, survey.Id, new CreateSurveyInvitationsRequest(DepartmentIds: [_engineeringId]));

        Assert.Equal(1, result.Created);
        var invited = await _harness.WithDbAsync(db => db.SurveyInvitations
            .Where(i => i.SurveyId == survey.Id).Select(i => i.UserId).ToListAsync());
        Assert.Equal([engineer], invited);
    }

    [Fact]
    public async Task All_targeted_follows_the_surveys_own_audience()
    {
        var client = await AdminAAsync();

        // A survey targeting Engineering invites Engineering -- the same rule
        // SurveyQueries.AssignedTo applies to /surveys/my, so "who gets invited" and "who
        // sees it in their inbox" cannot drift apart.
        var survey = await CreateActiveSurveyAsync(client, departmentIds: [_engineeringId]);
        var engineer = await SeedEmployeeAsync(_companyAId, _engineeringId);
        await SeedEmployeeAsync(_companyAId, _salesId);

        var result = await InviteAsync(client, survey.Id, new CreateSurveyInvitationsRequest(AllTargeted: true));

        Assert.Equal(1, result.Created);
        var invited = await _harness.WithDbAsync(db => db.SurveyInvitations
            .Where(i => i.SurveyId == survey.Id).Select(i => i.UserId).ToListAsync());
        Assert.Equal([engineer], invited);
    }

    [Fact]
    public async Task A_user_from_another_tenant_cannot_be_invited_even_by_a_super_admin()
    {
        var superAdmin = await _harness.ClientAsync(Roles.SuperAdmin, companyId: null);
        var owner = await AdminAAsync();
        var survey = await CreateActiveSurveyAsync(owner);
        var outsider = await SeedEmployeeAsync(_companyBId);

        var response = await superAdmin.PostAsJsonAsync(
            $"/surveys/{survey.Id}/invitations", new CreateSurveyInvitationsRequest(UserIds: [outsider]));

        // Scoped to the SURVEY's company, not the caller's: otherwise a super_admin acting on
        // tenant A puts tenant B's employees into tenant A's audience.
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task An_inactive_user_is_not_invited()
    {
        var client = await AdminAAsync();
        var survey = await CreateActiveSurveyAsync(client);
        var leaver = await SeedEmployeeAsync(_companyAId, isActive: false);

        var response = await client.PostAsJsonAsync(
            $"/surveys/{survey.Id}/invitations", new CreateSurveyInvitationsRequest(UserIds: [leaver]));

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task Re_inviting_someone_who_already_has_an_invitation_skips_them_rather_than_colliding()
    {
        var client = await AdminAAsync();
        var survey = await CreateActiveSurveyAsync(client);
        var employee = await SeedEmployeeAsync(_companyAId);

        await InviteAsync(client, survey.Id, new CreateSurveyInvitationsRequest(UserIds: [employee]));
        var second = await InviteAsync(client, survey.Id, new CreateSurveyInvitationsRequest(UserIds: [employee]));

        // (survey_id, user_id) is uniquely indexed. Pre-checking turns what would be an
        // opaque 409 from the global handler into a named skip.
        Assert.Equal(0, second.Created);
        Assert.Equal([employee], second.SkippedUserIds);
    }

    [Fact]
    public async Task An_invitation_never_outlives_its_survey()
    {
        var client = await AdminAAsync();
        var survey = await CreateActiveSurveyAsync(client);
        var employee = await SeedEmployeeAsync(_companyAId);

        // MinimalRequest ends 14 days out; 365 must be clamped to that, not honoured.
        var result = await InviteAsync(
            client, survey.Id, new CreateSurveyInvitationsRequest(UserIds: [employee], ExpiresInDays: 365));

        var invitation = await InvitationRowAsync(result.InvitationIds[0]);

        // Compared at microsecond precision, not exactly. Postgres 'timestamptz' stores
        // microseconds while .NET DateTimeOffset ticks are 100ns, so a value that has been
        // through the database and one that has not can differ in the last digit --
        // 2026-08-20T23:10:30.2969884 vs ...2969880. survey.EndDate comes back from the create
        // response, invitation.ExpiresAt is read from the row, so exactly one side is
        // truncated. The clamp this test is about is a whole-day rule; sub-microsecond
        // equality was never the property, and asserting it makes the test fail on storage
        // precision rather than on behaviour.
        Assert.Equal(survey.EndDate, invitation.ExpiresAt, TimeSpan.FromMicroseconds(1));
    }

    [Fact]
    public async Task Expiry_can_be_brought_forward_but_not_pushed_back()
    {
        var client = await AdminAAsync();
        var survey = await CreateActiveSurveyAsync(client);
        var employee = await SeedEmployeeAsync(_companyAId);

        var result = await InviteAsync(
            client, survey.Id, new CreateSurveyInvitationsRequest(UserIds: [employee], ExpiresInDays: 2));

        var invitation = await InvitationRowAsync(result.InvitationIds[0]);
        Assert.True(invitation.ExpiresAt < survey.EndDate);
        Assert.True(invitation.ExpiresAt > DateTimeOffset.UtcNow.AddDays(1));
    }

    /// <summary>
    /// The creation-time half of the undeliverable-address guard, and the deliberate choice
    /// it encodes: the batch is REPORTED on, never refused.
    ///
    /// <para>
    /// Refusing would be wrong here. The invitation row is the artefact -- its link is
    /// distributable by hand, and this endpoint already supports a tenant with
    /// <c>notificationSendInvitations</c> off that mails nothing at all -- so a 400 would make
    /// the seeded demo tenant undistributable by any route, over a condition the send path
    /// already handles correctly. What an admin queueing 500 rows cannot do is find out
    /// afterwards, one failed row at a time, so the count comes back with the response.
    /// </para>
    /// </summary>
    [Fact]
    public async Task A_batch_reports_recipients_whose_address_can_never_receive_mail()
    {
        var client = await AdminAAsync();
        var survey = await CreateActiveSurveyAsync(client);
        var reserved = await SeedEmployeeAsync(_companyAId, email: $"{Guid.NewGuid():N}@demo.test");
        var deliverable = await SeedEmployeeAsync(_companyAId, email: $"{Guid.NewGuid():N}@procomer.go.cr");

        var result = await InviteAsync(
            client, survey.Id, new CreateSurveyInvitationsRequest(UserIds: [reserved, deliverable]));

        // Reported...
        Assert.Equal(1, result.UndeliverableRecipients);
        Assert.NotNull(result.Note);
        Assert.Contains("reserved domain", result.Note, StringComparison.Ordinal);

        // ...and not enforced. Both invitations exist. Neither queues mail -- nothing does.
        Assert.Equal(2, result.Created);
        Assert.Equal(0, result.NotificationsQueued);
    }

    /// <summary>
    /// The counterweight: a batch of ordinary addresses reports nothing and says nothing.
    /// Without this, an advisory that fired on every batch would satisfy the test above and
    /// would train an admin to ignore it.
    /// </summary>
    [Fact]
    public async Task A_batch_of_ordinary_addresses_reports_no_warning()
    {
        var client = await AdminAAsync();
        var survey = await CreateActiveSurveyAsync(client);
        var employee = await SeedEmployeeAsync(_companyAId, email: $"{Guid.NewGuid():N}@procomer.go.cr");

        var result = await InviteAsync(client, survey.Id, new CreateSurveyInvitationsRequest(UserIds: [employee]));

        Assert.Equal(0, result.UndeliverableRecipients);
        Assert.Null(result.Note);
    }

    [Fact]
    public async Task Turning_invitations_off_mints_them_without_queueing_anything_and_says_so()
    {
        var client = await AdminAAsync();
        var created = await SurveyTestHarness.CreateSurveyAsync(client, SurveyTestHarness.MinimalRequest(_companyAId));
        (await client.PutAsJsonAsync(
            $"/surveys/{created.Id}",
            new UpdateSurveyRequest(Settings: new SurveySettingsInput(NotificationSendInvitations: false)))).EnsureSuccessStatusCode();
        (await SurveyTestHarness.SetStatusAsync(client, created.Id, SurveyStatuses.Active)).EnsureSuccessStatusCode();

        var employee = await SeedEmployeeAsync(_companyAId);
        var result = await InviteAsync(client, created.Id, new CreateSurveyInvitationsRequest(UserIds: [employee]));

        Assert.Equal(1, result.Created);
        Assert.Equal(0, result.NotificationsQueued);
        Assert.NotNull(result.Note);

        var invitation = await InvitationRowAsync(result.InvitationIds[0]);
        Assert.Equal(SurveyInvitationStatuses.Pending, invitation.Status);
        Assert.Null(invitation.SentAt);
    }

    // ------------------------------------------------------------------
    // Tokens are secrets
    // ------------------------------------------------------------------

    [Fact]
    public async Task No_admin_route_ever_returns_an_invitation_token()
    {
        var client = await AdminAAsync();
        var survey = await CreateActiveSurveyAsync(client);
        var employee = await SeedEmployeeAsync(_companyAId);

        var mintResponse = await client.PostAsJsonAsync(
            $"/surveys/{survey.Id}/invitations", new CreateSurveyInvitationsRequest(UserIds: [employee]));
        var mintBody = await mintResponse.Content.ReadAsStringAsync();
        var result = JsonSerializer.Deserialize<SurveyInvitationBatchResult>(
            mintBody, new JsonSerializerOptions(JsonSerializerDefaults.Web))!;

        var token = await TokenOfAsync(result.InvitationIds[0]);

        // Asserted against the raw body, not the DTO: a DTO that omits a property proves
        // nothing about a handler that serialises an anonymous object. An admin who can read
        // tokens can open any employee's survey as that employee.
        Assert.DoesNotContain(token, mintBody, StringComparison.Ordinal);
        Assert.DoesNotContain(
            token,
            await (await client.GetAsync($"/surveys/{survey.Id}/invitations")).Content.ReadAsStringAsync(),
            StringComparison.Ordinal);
        Assert.DoesNotContain(
            token,
            await (await client.PostAsync($"/surveys/{survey.Id}/invitations/{result.InvitationIds[0]}/revoke", null))
                .Content.ReadAsStringAsync(),
            StringComparison.Ordinal);
    }

    [Fact]
    public async Task Two_invitations_never_share_a_token()
    {
        var client = await AdminAAsync();
        var survey = await CreateActiveSurveyAsync(client);
        var first = await SeedEmployeeAsync(_companyAId);
        var second = await SeedEmployeeAsync(_companyAId);

        var result = await InviteAsync(client, survey.Id, new CreateSurveyInvitationsRequest(UserIds: [first, second]));

        var tokens = await _harness.WithDbAsync(db => db.SurveyInvitations
            .Where(i => result.InvitationIds.Contains(i.Id)).Select(i => i.InvitationToken).ToListAsync());

        Assert.Equal(2, tokens.Distinct(StringComparer.Ordinal).Count());
        Assert.All(tokens, t => Assert.True(SurveyAccessTokens.HasExpectedShape(t)));
    }

    // ------------------------------------------------------------------
    // Token validation: unknown, revoked, expired and already-used are distinct
    // ------------------------------------------------------------------

    [Fact]
    public async Task A_valid_token_resolves_without_authentication_and_discloses_no_email()
    {
        var client = await AdminAAsync();
        var survey = await CreateActiveSurveyAsync(client);
        var employee = await SeedEmployeeAsync(_companyAId);
        var result = await InviteAsync(client, survey.Id, new CreateSurveyInvitationsRequest(UserIds: [employee]));
        var token = await TokenOfAsync(result.InvitationIds[0]);

        var response = await Anonymous().GetAsync($"/survey-invitations/{token}");
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);

        var body = await response.Content.ReadAsStringAsync();
        var detail = JsonSerializer.Deserialize<SurveyInvitationTokenDetail>(
            body, new JsonSerializerOptions(JsonSerializerDefaults.Web))!;

        Assert.Equal(survey.Id, detail.SurveyId);
        Assert.Equal("Q3 Climate Survey", detail.SurveyTitle);
        // `pending`, not `sent`: the one producer of `sent` was the invitation mail.
        Assert.Equal(SurveyInvitationStatuses.Pending, detail.Status);

        // A leaked token must not become a disclosure of whose it is.
        var email = await _harness.WithDbAsync(db => db.Users.Where(u => u.Id == employee).Select(u => u.Email).FirstAsync());
        Assert.DoesNotContain(email, body, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task An_unknown_token_is_a_404()
    {
        var response = await Anonymous().GetAsync($"/survey-invitations/{SurveyAccessTokens.Mint()}");
        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    [Fact]
    public async Task A_revoked_token_reports_revoked_and_not_merely_expired()
    {
        var client = await AdminAAsync();
        var survey = await CreateActiveSurveyAsync(client);
        var employee = await SeedEmployeeAsync(_companyAId);
        var result = await InviteAsync(client, survey.Id, new CreateSurveyInvitationsRequest(UserIds: [employee]));
        var token = await TokenOfAsync(result.InvitationIds[0]);

        (await client.PostAsync($"/surveys/{survey.Id}/invitations/{result.InvitationIds[0]}/revoke", null))
            .EnsureSuccessStatusCode();

        var response = await Anonymous().GetAsync($"/survey-invitations/{token}");
        Assert.Equal(HttpStatusCode.Gone, response.StatusCode);

        // Revocation also expires the row as defence in depth, so the ORDER of the two checks
        // is what keeps an admin's deliberate act from being reported as the passage of time.
        var body = await response.Content.ReadAsStringAsync();
        Assert.Contains("revoked", body, StringComparison.Ordinal);
        Assert.DoesNotContain("expired", body, StringComparison.Ordinal);
    }

    [Fact]
    public async Task An_expired_token_reports_expired()
    {
        var client = await AdminAAsync();
        var survey = await CreateActiveSurveyAsync(client);
        var employee = await SeedEmployeeAsync(_companyAId);
        var result = await InviteAsync(client, survey.Id, new CreateSurveyInvitationsRequest(UserIds: [employee]));
        var token = await TokenOfAsync(result.InvitationIds[0]);

        await _harness.WithDbAsync(async db =>
        {
            var invitation = await db.SurveyInvitations.FirstAsync(i => i.Id == result.InvitationIds[0]);
            invitation.ExpiresAt = DateTimeOffset.UtcNow.AddMinutes(-1);
            await db.SaveChangesAsync();
        });

        var response = await Anonymous().GetAsync($"/survey-invitations/{token}");
        Assert.Equal(HttpStatusCode.Gone, response.StatusCode);
        Assert.Contains("expired", await response.Content.ReadAsStringAsync(), StringComparison.Ordinal);
    }

    [Fact]
    public async Task An_already_completed_token_is_distinct_from_both()
    {
        var client = await AdminAAsync();
        var survey = await CreateActiveSurveyAsync(client);
        var employee = await SeedEmployeeAsync(_companyAId);
        var result = await InviteAsync(client, survey.Id, new CreateSurveyInvitationsRequest(UserIds: [employee]));
        var token = await TokenOfAsync(result.InvitationIds[0]);

        var anonymous = Anonymous();
        (await anonymous.PostAsync($"/survey-invitations/{token}/completed", null)).EnsureSuccessStatusCode();

        var response = await anonymous.GetAsync($"/survey-invitations/{token}");
        Assert.Equal(HttpStatusCode.Conflict, response.StatusCode);
        Assert.Contains("already_completed", await response.Content.ReadAsStringAsync(), StringComparison.Ordinal);
    }

    [Fact]
    public async Task A_revoked_token_cannot_record_any_further_state()
    {
        var client = await AdminAAsync();
        var survey = await CreateActiveSurveyAsync(client);
        var employee = await SeedEmployeeAsync(_companyAId);
        var result = await InviteAsync(client, survey.Id, new CreateSurveyInvitationsRequest(UserIds: [employee]));
        var token = await TokenOfAsync(result.InvitationIds[0]);

        (await client.PostAsync($"/surveys/{survey.Id}/invitations/{result.InvitationIds[0]}/revoke", null))
            .EnsureSuccessStatusCode();

        var anonymous = Anonymous();
        foreach (var state in new[] { "opened", "started", "completed" })
        {
            Assert.Equal(HttpStatusCode.Gone, (await anonymous.PostAsync($"/survey-invitations/{token}/{state}", null)).StatusCode);
        }

        var invitation = await InvitationRowAsync(result.InvitationIds[0]);
        Assert.Equal(SurveyInvitationStatuses.Revoked, invitation.Status);
        Assert.Null(invitation.OpenedAt);
    }

    // ------------------------------------------------------------------
    // State transitions
    // ------------------------------------------------------------------

    [Fact]
    public async Task A_named_survey_records_the_whole_ladder()
    {
        var client = await AdminAAsync();
        var survey = await CreateActiveSurveyAsync(client);
        var employee = await SeedEmployeeAsync(_companyAId);
        var result = await InviteAsync(client, survey.Id, new CreateSurveyInvitationsRequest(UserIds: [employee]));
        var invitationId = result.InvitationIds[0];
        var token = await TokenOfAsync(invitationId);

        var anonymous = Anonymous();
        foreach (var state in new[] { "opened", "started", "completed" })
        {
            var response = await anonymous.PostAsync($"/survey-invitations/{token}/{state}", null);
            response.EnsureSuccessStatusCode();
            var recorded = (await response.Content.ReadFromJsonAsync<SurveyInvitationStateResult>())!;
            Assert.True(recorded.Recorded);
            Assert.False(recorded.SuppressedForAnonymity);
            Assert.Equal(state, recorded.Status);
        }

        var invitation = await InvitationRowAsync(invitationId);
        Assert.Equal(SurveyInvitationStatuses.Completed, invitation.Status);
        Assert.NotNull(invitation.OpenedAt);
        Assert.NotNull(invitation.CompletedOn);
    }

    /// <summary>
    /// Ruled 2026-10-12: on an IDENTIFIED survey the invitation keeps only the DAY its invitee
    /// finished. A start or completion instant -- or an <c>updated_at</c> stamped at that
    /// instant, which is the same fact under another name -- lines up with
    /// <c>responses.start_time</c> / <c>completion_time</c> and says which response is whose.
    /// The day is the company's, so it is asserted in a zone whose day is not UTC's.
    /// </summary>
    [Fact]
    public async Task A_named_survey_records_the_day_its_invitee_finished_and_never_the_time()
    {
        var client = await AdminAAsync();
        var zone = await _harness.SetCompanyTimezoneOffUtcDayAsync(_companyAId);
        var survey = await CreateActiveSurveyAsync(client);
        var employee = await SeedEmployeeAsync(_companyAId);
        var result = await InviteAsync(client, survey.Id, new CreateSurveyInvitationsRequest(UserIds: [employee]));
        var invitationId = result.InvitationIds[0];
        var token = await TokenOfAsync(invitationId);

        var anonymous = Anonymous();
        (await anonymous.PostAsync($"/survey-invitations/{token}/opened", null)).EnsureSuccessStatusCode();
        var updatedAtAfterOpen = (await InvitationRowAsync(invitationId)).UpdatedAt;

        var before = DateTimeOffset.UtcNow;
        foreach (var state in new[] { "started", "completed" })
        {
            var response = await anonymous.PostAsync($"/survey-invitations/{token}/{state}", null);
            response.EnsureSuccessStatusCode();
            var recorded = (await response.Content.ReadFromJsonAsync<SurveyInvitationStateResult>())!;
            Assert.True(recorded.Recorded);
            Assert.Equal(state, recorded.Status);
        }
        var after = DateTimeOffset.UtcNow;

        var invitation = await InvitationRowAsync(invitationId);
        Assert.Equal(SurveyInvitationStatuses.Completed, invitation.Status);
        Assert.Null(invitation.StartedAt);
        Assert.Null(invitation.CompletedAt);
        Assert.Equal(updatedAtAfterOpen, invitation.UpdatedAt);

        // The company's day, not UTC's: the zone was chosen so the two differ right now.
        var localBefore = DateOnly.FromDateTime(TimeZoneInfo.ConvertTime(before, zone).DateTime);
        var localAfter = DateOnly.FromDateTime(TimeZoneInfo.ConvertTime(after, zone).DateTime);
        Assert.NotEqual(DateOnly.FromDateTime(before.UtcDateTime), localBefore);
        Assert.NotNull(invitation.CompletedOn);
        Assert.Contains(invitation.CompletedOn!.Value, new[] { localBefore, localAfter });

        // And the admin list carries the day, with both instants null.
        var listed = (await client.GetFromJsonAsync<SurveyInvitationListResponse>($"/surveys/{survey.Id}/invitations"))!
            .Invitations.Single(i => i.Id == invitationId);
        Assert.Equal(invitation.CompletedOn, listed.CompletedOn);
        Assert.Null(listed.StartedAt);
        Assert.Null(listed.CompletedAt);
    }

    [Fact]
    public async Task A_replayed_open_does_not_move_the_recorded_timestamp()
    {
        var client = await AdminAAsync();
        var survey = await CreateActiveSurveyAsync(client);
        var employee = await SeedEmployeeAsync(_companyAId);
        var result = await InviteAsync(client, survey.Id, new CreateSurveyInvitationsRequest(UserIds: [employee]));
        var token = await TokenOfAsync(result.InvitationIds[0]);

        var anonymous = Anonymous();
        (await anonymous.PostAsync($"/survey-invitations/{token}/opened", null)).EnsureSuccessStatusCode();
        var firstOpenedAt = (await InvitationRowAsync(result.InvitationIds[0])).OpenedAt;

        // A mail client's link prefetcher fires this more than once. "First opened at" has to
        // stay true.
        var replay = await anonymous.PostAsync($"/survey-invitations/{token}/opened", null);
        replay.EnsureSuccessStatusCode();
        var outcome = (await replay.Content.ReadFromJsonAsync<SurveyInvitationStateResult>())!;

        Assert.False(outcome.Recorded);
        Assert.False(outcome.SuppressedForAnonymity);
        Assert.Equal(firstOpenedAt, (await InvitationRowAsync(result.InvitationIds[0])).OpenedAt);
    }

    [Fact]
    public async Task An_out_of_order_state_never_walks_the_invitation_backwards()
    {
        var client = await AdminAAsync();
        var survey = await CreateActiveSurveyAsync(client);
        var employee = await SeedEmployeeAsync(_companyAId);
        var result = await InviteAsync(client, survey.Id, new CreateSurveyInvitationsRequest(UserIds: [employee]));
        var token = await TokenOfAsync(result.InvitationIds[0]);

        var anonymous = Anonymous();
        (await anonymous.PostAsync($"/survey-invitations/{token}/started", null)).EnsureSuccessStatusCode();

        var late = await anonymous.PostAsync($"/survey-invitations/{token}/opened", null);
        var outcome = (await late.Content.ReadFromJsonAsync<SurveyInvitationStateResult>())!;

        Assert.False(outcome.Recorded);
        Assert.Equal(SurveyInvitationStatuses.Started, outcome.Status);
        Assert.Equal(SurveyInvitationStatuses.Started, (await InvitationRowAsync(result.InvitationIds[0])).Status);
    }

    // ------------------------------------------------------------------
    // THE ANONYMITY BOUNDARY
    // ------------------------------------------------------------------

    [Fact]
    public async Task An_anonymous_survey_records_nothing_past_opened_and_says_so()
    {
        var client = await AdminAAsync();
        var survey = await CreateActiveSurveyAsync(client, anonymous: true);
        var employee = await SeedEmployeeAsync(_companyAId);
        var result = await InviteAsync(client, survey.Id, new CreateSurveyInvitationsRequest(UserIds: [employee]));
        var invitationId = result.InvitationIds[0];
        var token = await TokenOfAsync(invitationId);

        var anonymousClient = Anonymous();

        var opened = await anonymousClient.PostAsync($"/survey-invitations/{token}/opened", null);
        opened.EnsureSuccessStatusCode();
        Assert.True((await opened.Content.ReadFromJsonAsync<SurveyInvitationStateResult>())!.Recorded);

        foreach (var suppressed in new[] { "started", "completed" })
        {
            var response = await anonymousClient.PostAsync($"/survey-invitations/{token}/{suppressed}", null);
            response.EnsureSuccessStatusCode();
            var outcome = (await response.Content.ReadFromJsonAsync<SurveyInvitationStateResult>())!;

            // Accepted so the respondent's client need not branch on anonymity, and reported
            // honestly rather than as a successful write.
            Assert.False(outcome.Recorded);
            Assert.True(outcome.SuppressedForAnonymity);
            Assert.Equal(SurveyInvitationStatuses.Opened, outcome.Status);
            Assert.NotNull(outcome.Reason);
        }

        // THE ACCEPTANCE CRITERION, asserted against the columns rather than the payload.
        // A per-person started_at/completed_at can be joined on time against
        // responses.start_time / completion_time and re-identifies the respondent. If either
        // of these is ever non-null for an anonymous survey, the survey is not anonymous --
        // however the API chooses to describe itself.
        var invitation = await InvitationRowAsync(invitationId);
        Assert.Equal(SurveyInvitationStatuses.Opened, invitation.Status);
        Assert.NotNull(invitation.OpenedAt);
        Assert.Null(invitation.StartedAt);
        Assert.Null(invitation.CompletedAt);
        Assert.Null(invitation.CompletedOn);
    }

    [Fact]
    public async Task An_anonymous_survey_publishes_its_guarantee_on_every_surface_that_shows_tracking()
    {
        var client = await AdminAAsync();
        var survey = await CreateActiveSurveyAsync(client, anonymous: true);
        var employee = await SeedEmployeeAsync(_companyAId);
        var result = await InviteAsync(client, survey.Id, new CreateSurveyInvitationsRequest(UserIds: [employee]));
        var token = await TokenOfAsync(result.InvitationIds[0]);

        // A client that renders "3 of 12 completed" for a named survey and the same widget for
        // an anonymous one would be reporting zeroes as a completion rate. So the guarantee
        // ships with the payload, machine-readable, everywhere tracking is shown.
        var listing = await client.GetFromJsonAsync<SurveyInvitationListResponse>($"/surveys/{survey.Id}/invitations");
        Assert.True(listing!.Anonymity.Anonymous);
        Assert.Equal(SurveyInvitationStatuses.Opened, listing.Anonymity.HighestRecordableState);
        Assert.Equal(
            [SurveyInvitationStatuses.Started, SurveyInvitationStatuses.Completed],
            listing.Anonymity.SuppressedStates);
        Assert.NotEmpty(listing.Anonymity.Guarantee);

        var byToken = await Anonymous().GetFromJsonAsync<SurveyInvitationTokenDetail>($"/survey-invitations/{token}");
        Assert.True(byToken!.Anonymity.Anonymous);
        Assert.Equal(SurveyInvitationStatuses.Opened, byToken.Anonymity.HighestRecordableState);
    }

    [Fact]
    public async Task A_named_survey_reports_no_suppressed_states()
    {
        var client = await AdminAAsync();
        var survey = await CreateActiveSurveyAsync(client);

        var listing = await client.GetFromJsonAsync<SurveyInvitationListResponse>($"/surveys/{survey.Id}/invitations");

        Assert.False(listing!.Anonymity.Anonymous);
        Assert.Empty(listing.Anonymity.SuppressedStates);
        Assert.Equal(SurveyInvitationStatuses.Completed, listing.Anonymity.HighestRecordableState);
    }

    [Fact]
    public async Task An_anonymous_surveys_completion_count_stays_zero_because_it_is_never_attributed()
    {
        var client = await AdminAAsync();
        var survey = await CreateActiveSurveyAsync(client, anonymous: true);
        var employee = await SeedEmployeeAsync(_companyAId);
        var result = await InviteAsync(client, survey.Id, new CreateSurveyInvitationsRequest(UserIds: [employee]));
        var token = await TokenOfAsync(result.InvitationIds[0]);

        var anonymousClient = Anonymous();
        await anonymousClient.PostAsync($"/survey-invitations/{token}/opened", null);
        await anonymousClient.PostAsync($"/survey-invitations/{token}/completed", null);

        var listing = await client.GetFromJsonAsync<SurveyInvitationListResponse>($"/surveys/{survey.Id}/invitations");

        // Completion for an anonymous survey is only ever an aggregate over
        // surveys.response_count, never a per-invitation bucket. Zero here is the design
        // working, and the Anonymity block beside it is what stops a client reading it as 0%.
        Assert.Equal(0, listing!.Summary.Completed);
        Assert.Equal(1, listing.Summary.Opened);
    }

    // ------------------------------------------------------------------
    // Reminders
    // ------------------------------------------------------------------

    /// <summary>Backdates the invitation's contact anchor so the reminder cadence has elapsed.</summary>
    private Task AgeInvitationAsync(Guid invitationId, int days)
        => _harness.WithDbAsync(async db =>
        {
            var invitation = await db.SurveyInvitations.FirstAsync(i => i.Id == invitationId);
            invitation.SentAt = DateTimeOffset.UtcNow.AddDays(-days);
            await db.SaveChangesAsync();
        });

    [Fact]
    public async Task A_completed_or_revoked_invitation_is_not_reminded()
    {
        var client = await AdminAAsync();
        var survey = await CreateActiveSurveyAsync(client);
        var finisher = await SeedEmployeeAsync(_companyAId);
        var quitter = await SeedEmployeeAsync(_companyAId);
        var result = await InviteAsync(client, survey.Id, new CreateSurveyInvitationsRequest(UserIds: [finisher, quitter]));

        var finisherInvitation = await _harness.WithDbAsync(db => db.SurveyInvitations
            .AsNoTracking().FirstAsync(i => i.SurveyId == survey.Id && i.UserId == finisher));
        (await Anonymous().PostAsync($"/survey-invitations/{finisherInvitation.InvitationToken}/completed", null))
            .EnsureSuccessStatusCode();

        var quitterInvitation = result.InvitationIds.Single(id => id != finisherInvitation.Id);
        (await client.PostAsync($"/surveys/{survey.Id}/invitations/{quitterInvitation}/revoke", null)).EnsureSuccessStatusCode();

        // Aged past the cadence, so it is the STATUS filter being tested here and not the
        // cadence quietly excluding both for the wrong reason.
        foreach (var id in result.InvitationIds)
        {
            await AgeInvitationAsync(id, days: 5);
        }

        var reminders = await client.PostAsync($"/surveys/{survey.Id}/invitations/reminders", null);
        var reminderResult = (await reminders.Content.ReadFromJsonAsync<SurveyReminderResult>())!;

        Assert.Equal(0, reminderResult.Eligible);
        Assert.Equal(0, reminderResult.Queued);
    }

    [Fact]
    public async Task A_deactivated_invitee_is_not_reminded_by_the_manual_route_either()
    {
        var client = await AdminAAsync();
        var survey = await CreateActiveSurveyAsync(client);
        var leaver = await SeedEmployeeAsync(_companyAId);
        var result = await InviteAsync(client, survey.Id, new CreateSurveyInvitationsRequest(UserIds: [leaver]));
        await AgeInvitationAsync(result.InvitationIds[0], days: 5);

        // Invited while active, deactivated since. The scheduled sweep
        // (InvitationReminderJob.LoadRecipientsAsync) already skips this person; this route
        // reminded them, advanced their invitation's counters and reported the reminder as
        // queued -- one invitation, two answers, depending on who asked.
        await _harness.WithDbAsync(async db =>
        {
            var user = await db.Users.FirstAsync(u => u.Id == leaver);
            user.IsActive = false;
            await db.SaveChangesAsync();
        });

        var response = await client.PostAsync($"/surveys/{survey.Id}/invitations/reminders", null);
        response.EnsureSuccessStatusCode();
        var reminderResult = (await response.Content.ReadFromJsonAsync<SurveyReminderResult>())!;

        // Not eligible either: a reminder that cannot be sent is not a reminder that is owed.
        Assert.Equal(0, reminderResult.Eligible);
        Assert.Equal(0, reminderResult.Queued);
        Assert.False(await _harness.WithDbAsync(db => db.Notifications
            .AnyAsync(n => n.UserId == leaver && n.Type == NotificationTypes.SurveyReminder)));

        var invitation = await InvitationRowAsync(result.InvitationIds[0]);
        Assert.Equal(0, invitation.ReminderCount);
        Assert.Null(invitation.LastReminderSent);
    }

    [Fact]
    public async Task A_pending_invitation_is_not_reminded_because_it_was_never_sent()
    {
        var client = await AdminAAsync();
        var created = await SurveyTestHarness.CreateSurveyAsync(client, SurveyTestHarness.MinimalRequest(_companyAId));
        (await client.PutAsJsonAsync(
            $"/surveys/{created.Id}",
            new UpdateSurveyRequest(Settings: new SurveySettingsInput(NotificationSendInvitations: false)))).EnsureSuccessStatusCode();
        (await SurveyTestHarness.SetStatusAsync(client, created.Id, SurveyStatuses.Active)).EnsureSuccessStatusCode();

        var employee = await SeedEmployeeAsync(_companyAId);
        await InviteAsync(client, created.Id, new CreateSurveyInvitationsRequest(UserIds: [employee]));

        var reminders = await client.PostAsync($"/surveys/{created.Id}/invitations/reminders", null);
        var result = (await reminders.Content.ReadFromJsonAsync<SurveyReminderResult>())!;

        // A "reminder" to someone who was never mailed would be the first thing they ever
        // heard about the survey.
        Assert.Equal(0, result.Eligible);
    }

    [Fact]
    public async Task Reminders_are_refused_outright_when_the_survey_has_them_turned_off()
    {
        var client = await AdminAAsync();
        var created = await SurveyTestHarness.CreateSurveyAsync(client, SurveyTestHarness.MinimalRequest(_companyAId));
        (await client.PutAsJsonAsync(
            $"/surveys/{created.Id}",
            new UpdateSurveyRequest(Settings: new SurveySettingsInput(NotificationSendReminders: false)))).EnsureSuccessStatusCode();
        (await SurveyTestHarness.SetStatusAsync(client, created.Id, SurveyStatuses.Active)).EnsureSuccessStatusCode();

        var response = await client.PostAsync($"/surveys/{created.Id}/invitations/reminders", null);

        // 409 rather than a 200 with a zero count: an admin who asked for reminders and
        // silently got none would conclude the feature is broken.
        Assert.Equal(HttpStatusCode.Conflict, response.StatusCode);
    }

    // ------------------------------------------------------------------
    // Resend
    // ------------------------------------------------------------------

    [Fact]
    public async Task A_completed_invitation_cannot_be_resent()
    {
        var client = await AdminAAsync();
        var survey = await CreateActiveSurveyAsync(client);
        var employee = await SeedEmployeeAsync(_companyAId);
        var result = await InviteAsync(client, survey.Id, new CreateSurveyInvitationsRequest(UserIds: [employee]));
        var token = await TokenOfAsync(result.InvitationIds[0]);

        (await Anonymous().PostAsync($"/survey-invitations/{token}/completed", null)).EnsureSuccessStatusCode();

        var response = await client.PostAsync($"/surveys/{survey.Id}/invitations/{result.InvitationIds[0]}/resend", null);
        Assert.Equal(HttpStatusCode.Conflict, response.StatusCode);
    }

    // ------------------------------------------------------------------
    // Content i18n (#195)
    // ------------------------------------------------------------------

    [Fact]
    public async Task A_spanish_only_survey_fetched_in_english_comes_back_in_spanish_and_says_so()
    {
        var client = await AdminAAsync();
        var created = await SurveyTestHarness.CreateSurveyAsync(
            client,
            SurveyTestHarness.MinimalRequest(
                _companyAId, title: LocalizedInput.FromBare("Encuesta de clima"), language: ContentLanguages.Spanish));
        (await SurveyTestHarness.SetStatusAsync(client, created.Id, SurveyStatuses.Active)).EnsureSuccessStatusCode();

        var employee = await SeedEmployeeAsync(_companyAId);
        var result = await InviteAsync(client, created.Id, new CreateSurveyInvitationsRequest(UserIds: [employee]));
        var token = await TokenOfAsync(result.InvitationIds[0]);

        var detail = await Anonymous().GetFromJsonAsync<SurveyInvitationTokenDetail>($"/survey-invitations/{token}?lang=en");

        // ResolvedLocale names the language the text is ACTUALLY in, not the one requested.
        // Reporting 'en' here is the silent substitution the paired columns exist to prevent.
        Assert.Equal("Encuesta de clima", detail!.SurveyTitle);
        Assert.Equal(ContentLanguages.Spanish, detail.ResolvedLocale);
        Assert.Equal(ContentLanguages.Spanish, detail.Language);
    }

    [Fact]
    public async Task The_guarantee_sentence_follows_the_lang_the_reader_asked_for()
    {
        // The sentence is authored by the server and rendered verbatim by the distribution
        // page, so it has to follow `?lang` like every other string in the payload. It used to
        // exist in English only, and a Spanish administrator read an English sentence over an
        // otherwise Spanish screen. The machine-readable half does not move with the locale.
        var client = await AdminAAsync();
        var anonymousSurvey = await CreateActiveSurveyAsync(client, anonymous: true);
        var employee = await SeedEmployeeAsync(_companyAId);
        var result = await InviteAsync(client, anonymousSurvey.Id, new CreateSurveyInvitationsRequest(UserIds: [employee]));
        var token = await TokenOfAsync(result.InvitationIds[0]);

        var spanish = await client.GetFromJsonAsync<SurveyInvitationListResponse>(
            $"/surveys/{anonymousSurvey.Id}/invitations?lang=es");
        Assert.True(spanish!.Anonymity.Anonymous);
        Assert.Contains("Esta encuesta es anónima", spanish.Anonymity.Guarantee);
        Assert.DoesNotContain("anonymous", spanish.Anonymity.Guarantee);
        Assert.Equal(SurveyInvitationStatuses.Opened, spanish.Anonymity.HighestRecordableState);

        var english = await client.GetFromJsonAsync<SurveyInvitationListResponse>(
            $"/surveys/{anonymousSurvey.Id}/invitations?lang=en");
        Assert.Contains("This survey is anonymous", english!.Anonymity.Guarantee);
        Assert.Contains("finished from unfinished", english.Anonymity.Guarantee);
        Assert.DoesNotContain("only ever available as an aggregate", english.Anonymity.Guarantee);

        // The respondent-facing token surface follows the same `lang`.
        var byToken = await Anonymous().GetFromJsonAsync<SurveyInvitationTokenDetail>($"/survey-invitations/{token}?lang=es");
        Assert.Contains("Esta encuesta es anónima", byToken!.Anonymity.Guarantee);

        // A named survey, in the reader's language too. Both modes now open with "Esta
        // encuesta es anónima" -- ruled 2026-10-16: the company never sees an individual
        // answer either way, so the product never calls a survey "no anónima". The
        // discriminator is the named-only sentence about the invitation lifecycle.
        var namedSurvey = await CreateActiveSurveyAsync(client, anonymous: false);
        var named = await client.GetFromJsonAsync<SurveyInvitationListResponse>(
            $"/surveys/{namedSurvey.Id}/invitations?lang=es");
        Assert.False(named!.Anonymity.Anonymous);
        Assert.Contains("Esta encuesta es anónima", named.Anonymity.Guarantee);
        Assert.Contains("El ciclo completo de la invitación se registra", named.Anonymity.Guarantee);
        Assert.DoesNotContain("no es anónima", named.Anonymity.Guarantee);
    }
}
