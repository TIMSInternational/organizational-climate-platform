using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using ClimateProject.Application.Auth;
using ClimateProject.Application.Microclimates;
using ClimateProject.Application.Notifications;
using ClimateProject.Domain.Entities;
using ClimateProject.Infrastructure.Persistence;
using ClimateProject.IntegrationTests.Support;
using ClimateProject.IntegrationTests.Surveys;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace ClimateProject.IntegrationTests.Microclimates;

/// <summary>
/// Microclimate invitations, their state tracking and the anonymity boundary (#130).
///
/// <para>
/// Three groups of assertion carry most of the weight here and none is provable from a unit
/// test:
/// </para>
/// <list type="bullet">
/// <item><b>The anonymity guarantee, against the actual columns.</b> An anonymous
/// microclimate's <c>started_at</c> and <c>completed_at</c> must still be NULL after the
/// respondent has walked the whole flow. A response-shape assertion alone would pass against
/// an implementation that wrote the timestamps and merely declined to echo them, which is the
/// exact failure this boundary exists to prevent.</item>
/// <item><b>Tokens never leaving the admin surface.</b> Asserted against the raw response
/// body rather than against the DTO, because a DTO that omits a property proves nothing about
/// a handler that serialises an anonymous object.</item>
/// <item><b>The notification payload naming the right table.</b> Asserted by reading the
/// queued <c>notifications.data</c> back and resolving it through BOTH readers -- the
/// microclimate one must find the row, and the survey one must find nothing. A payload
/// written with the survey key would name a <c>microclimate_invitations</c> primary key in a
/// field only ever looked up in <c>survey_invitations</c>: no exception, no failed test, and
/// a link-less mail to every invitee.</item>
/// </list>
/// </summary>
[Collection("Postgres")]
public class MicroclimateInvitationEndpointsTests : IAsyncLifetime
{
    private readonly AuthWebApplicationFactory _factory;
    private readonly SurveyTestHarness _harness;
    private Guid _companyAId;
    private Guid _companyBId;
    private Guid _engineeringId;

    public MicroclimateInvitationEndpointsTests(PostgresContainerFixture postgres)
    {
        _factory = postgres.App;
        _harness = new SurveyTestHarness(_factory, $"mcinv-{Guid.NewGuid():N}.test");
    }

    public async Task InitializeAsync()
    {
        _companyAId = await _harness.SeedCompanyAsync("Microclimate Invite Co A");
        _companyBId = await _harness.SeedCompanyAsync("Microclimate Invite Co B");
        _engineeringId = await _harness.SeedDepartmentAsync(_companyAId, "Engineering");
    }

    public Task DisposeAsync() => Task.CompletedTask;

    // ------------------------------------------------------------------
    // Local scaffolding
    // ------------------------------------------------------------------

    private Task<HttpClient> AdminAAsync() => _harness.ClientAsync(Roles.CompanyAdmin, _companyAId);

    /// <summary>
    /// A client with no <c>Authorization</c> header at all. Every token route below is
    /// exercised through this one -- an invitee arriving from a mail client has no session,
    /// and that is the acceptance criterion, not an incidental detail.
    /// </summary>
    private HttpClient Anonymous() => _factory.CreateClient();

    /// <summary>An employee row to invite. Seeded directly: these never authenticate, they only receive.</summary>
    private Task<Guid> SeedEmployeeAsync(Guid companyId, Guid? departmentId = null, string? email = null)
        => _harness.WithDbAsync(async db =>
        {
            var user = new User
            {
                Id = Guid.NewGuid(),
                CompanyId = companyId,
                DepartmentId = departmentId,

                // `.test` is reserved by RFC 6761 so no mailbox can exist behind it, which is
                // exactly what a fixture address must be now that production mail is armed:
                // nothing here can reach a real inbox even if a sweep ran.
                Email = email ?? $"{Guid.NewGuid():N}@invitee.test",
                Name = "Invitee",
                Role = Roles.Employee,
                IsActive = true,
                CreatedAt = DateTimeOffset.UtcNow,
            };
            db.Users.Add(user);
            await db.SaveChangesAsync();
            return user.Id;
        });

    /// <summary>
    /// An ACTIVE microclimate, because a draft cannot be distributed and every invitation test
    /// needs one that can.
    /// </summary>
    private async Task<Guid> SeedMicroclimateAsync(
        Guid companyId,
        bool anonymous = true,
        string status = MicroclimateStatuses.Active,
        DateTimeOffset? endTime = null)
    {
        // `microclimates.created_by` is a real foreign key into `users`. Guid.Empty parses,
        // reads like an "unknown author" sentinel, and is refused by the database -- which is
        // the honest behaviour and the reason the author is a seeded row here.
        var author = await SeedEmployeeAsync(companyId);

        return await _harness.WithDbAsync(async db =>
        {
            var now = DateTimeOffset.UtcNow;
            var microclimate = new Microclimate
            {
                Id = Guid.NewGuid(),
                TitleEn = "Weekly pulse",
                TitleEs = "Pulso semanal",
                DescriptionEn = "How is the team feeling",
                DescriptionEs = "Cómo se siente el equipo",
                Language = "both",
                CompanyId = companyId,
                CreatedBy = author,
                Status = status,
                TargetParticipantCount = 10,
            };
            microclimate.Scheduling.StartTime = now.AddMinutes(-5);
            microclimate.Scheduling.EndTime = endTime ?? now.AddHours(4);
            microclimate.RealtimeSettings.AnonymousResponses = anonymous;
            microclimate.CreatedAt = now;
            microclimate.UpdatedAt = now;
            db.Microclimates.Add(microclimate);
            await db.SaveChangesAsync();
            return microclimate.Id;
        });
    }

    private async Task<Guid> InviteAsync(HttpClient admin, Guid microclimateId, Guid userId)
    {
        var response = await admin.PostAsJsonAsync(
            $"/microclimates/{microclimateId}/invitations",
            new CreateMicroclimateInvitationsRequest(UserIds: [userId]));
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        var batch = await response.Content.ReadFromJsonAsync<MicroclimateInvitationBatchResult>();
        return Assert.Single(batch!.InvitationIds);
    }

    /// <summary>
    /// The token, read straight out of the table.
    ///
    /// <para>It cannot come from the API: no read DTO on this surface carries one, and
    /// <see cref="No_admin_read_ever_carries_a_token"/> is the test that keeps it that way. So
    /// the tests below stand in for the mail the sweep would have sent.</para>
    /// </summary>
    private Task<string> TokenOfAsync(Guid invitationId)
        => _harness.WithDbAsync(async db =>
            (await db.MicroclimateInvitations.AsNoTracking().SingleAsync(i => i.Id == invitationId)).InvitationToken);

    private Task<MicroclimateInvitation> RowAsync(Guid invitationId)
        => _harness.WithDbAsync(db =>
            db.MicroclimateInvitations.AsNoTracking().SingleAsync(i => i.Id == invitationId));

    private static async Task<(HttpStatusCode Status, string? Reason)> ReadFailureAsync(HttpResponseMessage response)
    {
        var body = await response.Content.ReadFromJsonAsync<JsonElement>();
        return (response.StatusCode, body.TryGetProperty("reason", out var reason) ? reason.GetString() : null);
    }

    // ------------------------------------------------------------------
    // The anonymity boundary -- asserted against the columns
    // ------------------------------------------------------------------

    /// <summary>
    /// The guarantee, end to end and at the storage layer.
    ///
    /// <para>The respondent's client posts all three steps -- it does not branch on anonymity,
    /// deliberately -- and the server records the first and refuses the other two. What makes
    /// this test worth having is the last block: it reads the row back and asserts the two
    /// columns are still NULL. A handler that wrote them and returned
    /// <c>recorded: false</c> would satisfy every response-shape assertion and break the only
    /// promise this surface makes.</para>
    /// </summary>
    [Fact]
    public async Task An_anonymous_microclimate_records_opened_and_refuses_to_store_started_or_completed()
    {
        var admin = await AdminAAsync();
        var microclimateId = await SeedMicroclimateAsync(_companyAId, anonymous: true);
        var invitationId = await InviteAsync(admin, microclimateId, await SeedEmployeeAsync(_companyAId));
        var token = await TokenOfAsync(invitationId);
        var anonymous = Anonymous();

        var opened = await anonymous.PostAsync($"/microclimate-invitations/{token}/opened", null);
        var openedResult = await opened.Content.ReadFromJsonAsync<MicroclimateInvitationStateResult>();
        Assert.Equal(HttpStatusCode.OK, opened.StatusCode);
        Assert.True(openedResult!.Recorded);
        Assert.Equal(MicroclimateInvitationStatuses.Opened, openedResult.Status);

        foreach (var step in new[] { "started", "completed" })
        {
            var response = await anonymous.PostAsync($"/microclimate-invitations/{token}/{step}", null);
            var result = await response.Content.ReadFromJsonAsync<MicroclimateInvitationStateResult>();

            // 200, not an error: refusing the respondent's own client would be punishing them
            // for the session's configuration.
            Assert.Equal(HttpStatusCode.OK, response.StatusCode);
            Assert.False(result!.Recorded);

            // And the caller is told WHICH refusal it was. `suppressedForAnonymity` is the
            // difference between "we did not store this because of the guarantee" and "we did
            // not store this because it was a replay", and a client that could not tell them
            // apart would be unable to report either honestly.
            Assert.True(result.SuppressedForAnonymity);
            Assert.Equal(MicroclimateInvitationStatuses.Opened, result.Status);
            Assert.Contains("anonymous", result.Reason!, StringComparison.OrdinalIgnoreCase);
            Assert.True(result.Anonymity.Anonymous);
            Assert.Equal(MicroclimateInvitationStatuses.Opened, result.Anonymity.HighestRecordableState);
            Assert.Equal(["started", "completed"], result.Anonymity.SuppressedStates);
        }

        // The assertion the whole file exists for.
        var row = await RowAsync(invitationId);
        Assert.Equal(MicroclimateInvitationStatuses.Opened, row.Status);
        Assert.NotNull(row.OpenedAt);
        Assert.Null(row.StartedAt);
        Assert.Null(row.CompletedAt);
    }

    /// <summary>
    /// The complement, and the reason the test above is not vacuous: a NON-anonymous
    /// microclimate records the whole ladder in the same columns. Without this, an
    /// implementation that never wrote <c>started_at</c> or <c>completed_at</c> at all would
    /// pass the guarantee test perfectly.
    /// </summary>
    [Fact]
    public async Task A_non_anonymous_microclimate_records_the_whole_ladder()
    {
        var admin = await AdminAAsync();
        var microclimateId = await SeedMicroclimateAsync(_companyAId, anonymous: false);
        var invitationId = await InviteAsync(admin, microclimateId, await SeedEmployeeAsync(_companyAId));
        var token = await TokenOfAsync(invitationId);
        var anonymousClient = Anonymous();

        foreach (var step in new[] { "opened", "started", "completed" })
        {
            var response = await anonymousClient.PostAsync($"/microclimate-invitations/{token}/{step}", null);
            var result = await response.Content.ReadFromJsonAsync<MicroclimateInvitationStateResult>();
            Assert.Equal(HttpStatusCode.OK, response.StatusCode);
            Assert.True(result!.Recorded);
            Assert.False(result.SuppressedForAnonymity);
            Assert.Equal(step, result.Status);
            Assert.False(result.Anonymity.Anonymous);
            Assert.Empty(result.Anonymity.SuppressedStates);
        }

        var row = await RowAsync(invitationId);
        Assert.Equal(MicroclimateInvitationStatuses.Completed, row.Status);
        Assert.NotNull(row.OpenedAt);
        Assert.NotNull(row.StartedAt);
        Assert.NotNull(row.CompletedAt);
    }

    /// <summary>
    /// The legacy verb. <c>invitations/[id]/participated</c> was the legacy route for this
    /// rung; it lands on the same handler and writes the same <c>completed</c> status, so a
    /// link still pointing at that word reaches the ladder rather than the 404 boundary.
    /// </summary>
    [Fact]
    public async Task The_legacy_participated_route_writes_the_same_completed_state()
    {
        var admin = await AdminAAsync();
        var microclimateId = await SeedMicroclimateAsync(_companyAId, anonymous: false);
        var invitationId = await InviteAsync(admin, microclimateId, await SeedEmployeeAsync(_companyAId));
        var token = await TokenOfAsync(invitationId);

        var response = await Anonymous().PostAsync($"/microclimate-invitations/{token}/participated", null);
        var result = await response.Content.ReadFromJsonAsync<MicroclimateInvitationStateResult>();

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.True(result!.Recorded);

        // `completed`, never the word in the URL. A row reading "participated" would be
        // counted by nothing -- it is not a member of the vocabulary.
        Assert.Equal(MicroclimateInvitationStatuses.Completed, result.Status);
        var row = await RowAsync(invitationId);
        Assert.Equal(MicroclimateInvitationStatuses.Completed, row.Status);
        Assert.NotNull(row.CompletedAt);
    }

    // ------------------------------------------------------------------
    // Monotonicity
    // ------------------------------------------------------------------

    /// <summary>
    /// A replayed ping does not move the recorded moment, and an out-of-order one does not
    /// walk the invitation backwards. Both happen in the field: mail clients prefetch links,
    /// and a retried request arrives after the one that superseded it.
    /// </summary>
    [Fact]
    public async Task A_replayed_or_out_of_order_step_changes_nothing()
    {
        var admin = await AdminAAsync();
        var microclimateId = await SeedMicroclimateAsync(_companyAId, anonymous: false);
        var invitationId = await InviteAsync(admin, microclimateId, await SeedEmployeeAsync(_companyAId));
        var token = await TokenOfAsync(invitationId);
        var anonymous = Anonymous();

        await anonymous.PostAsync($"/microclimate-invitations/{token}/opened", null);
        var openedAt = (await RowAsync(invitationId)).OpenedAt;
        Assert.NotNull(openedAt);

        await anonymous.PostAsync($"/microclimate-invitations/{token}/started", null);

        // The replay, and the out-of-order arrival.
        var replay = await anonymous.PostAsync($"/microclimate-invitations/{token}/started", null);
        var backwards = await anonymous.PostAsync($"/microclimate-invitations/{token}/opened", null);

        foreach (var response in new[] { replay, backwards })
        {
            var result = await response.Content.ReadFromJsonAsync<MicroclimateInvitationStateResult>();
            Assert.Equal(HttpStatusCode.OK, response.StatusCode);
            Assert.False(result!.Recorded);

            // Not the anonymity refusal. Reporting the wrong reason for a refusal is worse
            // than reporting none.
            Assert.False(result.SuppressedForAnonymity);
            Assert.Equal(MicroclimateInvitationStatuses.Started, result.Status);
        }

        var row = await RowAsync(invitationId);
        Assert.Equal(MicroclimateInvitationStatuses.Started, row.Status);
        Assert.Equal(openedAt, row.OpenedAt);
    }

    // ------------------------------------------------------------------
    // Expired, revoked and unknown -- three distinct answers
    // ------------------------------------------------------------------

    [Fact]
    public async Task An_unknown_or_malformed_token_is_one_undifferentiated_not_found()
    {
        var anonymous = Anonymous();

        // 43 base64url characters that match no row, and a string that is not even the right
        // shape. Answering these differently would be an oracle telling a guesser their shape
        // was right.
        foreach (var token in new[] { new string('a', 43), "hello", "../../etc/passwd" })
        {
            var (status, reason) = await ReadFailureAsync(
                await anonymous.GetAsync($"/microclimate-invitations/{Uri.EscapeDataString(token)}"));
            Assert.Equal(HttpStatusCode.NotFound, status);
            Assert.Equal("not_found", reason);
        }
    }

    [Fact]
    public async Task An_expired_invitation_says_expired()
    {
        var admin = await AdminAAsync();
        var microclimateId = await SeedMicroclimateAsync(_companyAId);
        var invitationId = await InviteAsync(admin, microclimateId, await SeedEmployeeAsync(_companyAId));
        var token = await TokenOfAsync(invitationId);

        await _harness.WithDbAsync(async db =>
        {
            var row = await db.MicroclimateInvitations.SingleAsync(i => i.Id == invitationId);
            row.ExpiresAt = DateTimeOffset.UtcNow.AddMinutes(-1);
            await db.SaveChangesAsync();
        });

        var (status, reason) = await ReadFailureAsync(
            await Anonymous().GetAsync($"/microclimate-invitations/{token}"));

        Assert.Equal(HttpStatusCode.Gone, status);
        Assert.Equal("expired", reason);

        // And the state routes are dead too, not merely the read. A token whose expiry only
        // closed the front door would still let a prefetcher advance the ladder.
        var stepStatus = (await ReadFailureAsync(
            await Anonymous().PostAsync($"/microclimate-invitations/{token}/opened", null))).Status;
        Assert.Equal(HttpStatusCode.Gone, stepStatus);
    }

    /// <summary>
    /// Revoked is its own answer, and this is the test that pins the CHECK ORDER.
    ///
    /// <para><c>RevokeInvitationAsync</c> also expires the row -- belt and braces, so a future
    /// path that forgets the status check still fails closed. That means expiry is true of
    /// every revoked invitation, and a handler that consulted expiry first would report an
    /// administrator's deliberate act as the passage of time. The holder is entitled to know
    /// the difference: one is asked about, the other is asked to be reissued.</para>
    /// </summary>
    [Fact]
    public async Task A_revoked_invitation_says_revoked_and_not_expired()
    {
        var admin = await AdminAAsync();
        var microclimateId = await SeedMicroclimateAsync(_companyAId);
        var invitationId = await InviteAsync(admin, microclimateId, await SeedEmployeeAsync(_companyAId));
        var token = await TokenOfAsync(invitationId);

        // Live before, dead after -- otherwise this passes for a token that never worked.
        Assert.Equal(HttpStatusCode.OK, (await Anonymous().GetAsync($"/microclimate-invitations/{token}")).StatusCode);

        var revoke = await admin.PostAsync(
            $"/microclimates/{microclimateId}/invitations/{invitationId}/revoke", null);
        Assert.Equal(HttpStatusCode.OK, revoke.StatusCode);

        var (status, reason) = await ReadFailureAsync(
            await Anonymous().GetAsync($"/microclimate-invitations/{token}"));

        Assert.Equal(HttpStatusCode.Gone, status);
        Assert.Equal("revoked", reason);

        var row = await RowAsync(invitationId);
        Assert.Equal(MicroclimateInvitationStatuses.Revoked, row.Status);
        Assert.True(row.ExpiresAt <= DateTimeOffset.UtcNow);

        // Revocation is terminal: the ladder cannot be advanced afterwards either.
        Assert.Equal(
            HttpStatusCode.Gone,
            (await Anonymous().PostAsync($"/microclimate-invitations/{token}/opened", null)).StatusCode);
    }

    /// <summary>
    /// An already-completed invitation is the fourth distinct answer, and deliberately not a
    /// 200: the client has to render "you already took part" rather than an answerable pulse.
    /// Only reachable on a non-anonymous session -- an anonymous one never records
    /// <c>completed</c> at all, which is the cost of the guarantee and is correct.
    /// </summary>
    [Fact]
    public async Task An_already_completed_invitation_says_so_distinctly()
    {
        var admin = await AdminAAsync();
        var microclimateId = await SeedMicroclimateAsync(_companyAId, anonymous: false);
        var invitationId = await InviteAsync(admin, microclimateId, await SeedEmployeeAsync(_companyAId));
        var token = await TokenOfAsync(invitationId);

        await Anonymous().PostAsync($"/microclimate-invitations/{token}/completed", null);

        var (status, reason) = await ReadFailureAsync(
            await Anonymous().GetAsync($"/microclimate-invitations/{token}"));

        Assert.Equal(HttpStatusCode.Conflict, status);
        Assert.Equal("already_completed", reason);
    }

    // ------------------------------------------------------------------
    // Unauthenticated by design
    // ------------------------------------------------------------------

    /// <summary>
    /// The acceptance criterion: "invitation page works without authentication". Asserted over
    /// every route in the group, with no <c>Authorization</c> header anywhere, because the
    /// invitee arriving from a mail client has no session and may have no account.
    /// </summary>
    [Fact]
    public async Task Every_token_route_answers_a_caller_with_no_session()
    {
        var admin = await AdminAAsync();
        var microclimateId = await SeedMicroclimateAsync(_companyAId, anonymous: false);
        var invitationId = await InviteAsync(admin, microclimateId, await SeedEmployeeAsync(_companyAId));
        var token = await TokenOfAsync(invitationId);
        var anonymous = Anonymous();

        Assert.Null(anonymous.DefaultRequestHeaders.Authorization);

        var detail = await anonymous.GetAsync($"/microclimate-invitations/{token}");
        Assert.Equal(HttpStatusCode.OK, detail.StatusCode);

        foreach (var step in new[] { "opened", "started", "completed", "participated" })
        {
            var response = await anonymous.PostAsync($"/microclimate-invitations/{token}/{step}", null);

            // The specific failure being excluded, named rather than folded into IsSuccess:
            // a group that grew a RequireAuthorization() would answer 401 here and nowhere
            // else, and "not 401" is the property the acceptance criterion is about.
            Assert.NotEqual(HttpStatusCode.Unauthorized, response.StatusCode);
            Assert.NotEqual(HttpStatusCode.Forbidden, response.StatusCode);
            Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        }
    }

    /// <summary>
    /// The payload an unauthenticated holder is served, and above all what it does NOT carry:
    /// the invitee's email address, the tenant, the author, the running response count. A
    /// leaked token must disclose the pulse and not the person.
    /// </summary>
    [Fact]
    public async Task The_token_payload_discloses_the_session_and_not_the_person()
    {
        var admin = await AdminAAsync();
        var microclimateId = await SeedMicroclimateAsync(_companyAId);
        var email = $"{Guid.NewGuid():N}@invitee.test";
        var invitationId = await InviteAsync(admin, microclimateId, await SeedEmployeeAsync(_companyAId, email: email));
        var token = await TokenOfAsync(invitationId);

        var response = await Anonymous().GetAsync($"/microclimate-invitations/{token}?lang=es");
        var raw = await response.Content.ReadAsStringAsync();
        var detail = JsonSerializer.Deserialize<MicroclimateInvitationTokenDetail>(
            raw, new JsonSerializerOptions(JsonSerializerDefaults.Web));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal(microclimateId, detail!.MicroclimateId);
        Assert.Equal("Pulso semanal", detail.MicroclimateTitle);
        Assert.Equal("es", detail.ResolvedLocale);
        Assert.Equal(MicroclimateStatuses.Active, detail.MicroclimateStatus);
        Assert.True(detail.Anonymity.Anonymous);

        // Against the raw body, not the DTO: a type that omits a field proves nothing about a
        // handler that serialises an anonymous object.
        Assert.DoesNotContain(email, raw, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain(token, raw, StringComparison.Ordinal);
        Assert.DoesNotContain(_companyAId.ToString(), raw, StringComparison.OrdinalIgnoreCase);
    }

    // ------------------------------------------------------------------
    // The admin surface
    // ------------------------------------------------------------------

    [Fact]
    public async Task No_admin_read_ever_carries_a_token()
    {
        var admin = await AdminAAsync();
        var microclimateId = await SeedMicroclimateAsync(_companyAId);
        var invitationId = await InviteAsync(admin, microclimateId, await SeedEmployeeAsync(_companyAId));
        var token = await TokenOfAsync(invitationId);

        var listing = await (await admin.GetAsync($"/microclimates/{microclimateId}/invitations"))
            .Content.ReadAsStringAsync();
        var resend = await (await admin.PostAsync(
                $"/microclimates/{microclimateId}/invitations/{invitationId}/resend", null))
            .Content.ReadAsStringAsync();
        var revoke = await (await admin.PostAsync(
                $"/microclimates/{microclimateId}/invitations/{invitationId}/revoke", null))
            .Content.ReadAsStringAsync();

        // The rotated token too -- resend mints a new one, and a body that echoed THAT would
        // be just as much a bearer credential as echoing the old one.
        var rotated = await TokenOfAsync(invitationId);

        foreach (var body in new[] { listing, resend, revoke })
        {
            Assert.DoesNotContain(token, body, StringComparison.Ordinal);
            Assert.DoesNotContain(rotated, body, StringComparison.Ordinal);
            Assert.DoesNotContain("invitationToken", body, StringComparison.OrdinalIgnoreCase);
        }
    }

    /// <summary>
    /// Resend rotates the token, which is the only way an administrator can recover from a
    /// forwarded or logged link without deleting the row and losing its history. The old token
    /// must stop working; the progress already recorded must not be erased.
    /// </summary>
    [Fact]
    public async Task Resend_rotates_the_token_and_keeps_the_history()
    {
        var admin = await AdminAAsync();
        var microclimateId = await SeedMicroclimateAsync(_companyAId, anonymous: false);
        var invitationId = await InviteAsync(admin, microclimateId, await SeedEmployeeAsync(_companyAId));
        var original = await TokenOfAsync(invitationId);

        await Anonymous().PostAsync($"/microclimate-invitations/{original}/opened", null);
        var openedAt = (await RowAsync(invitationId)).OpenedAt;
        Assert.NotNull(openedAt);

        Assert.Equal(
            HttpStatusCode.OK,
            (await admin.PostAsync($"/microclimates/{microclimateId}/invitations/{invitationId}/resend", null)).StatusCode);

        var rotated = await TokenOfAsync(invitationId);
        Assert.NotEqual(original, rotated);

        Assert.Equal(
            HttpStatusCode.NotFound,
            (await Anonymous().GetAsync($"/microclimate-invitations/{original}")).StatusCode);
        Assert.Equal(
            HttpStatusCode.OK,
            (await Anonymous().GetAsync($"/microclimate-invitations/{rotated}")).StatusCode);

        // Whether this person opened the previous invitation is a fact about them. Erasing it
        // to make the new send look pristine would corrupt the only engagement history the
        // session has.
        Assert.Equal(openedAt, (await RowAsync(invitationId)).OpenedAt);
    }

    [Fact]
    public async Task Revocation_is_not_undone_by_a_resend()
    {
        var admin = await AdminAAsync();
        var microclimateId = await SeedMicroclimateAsync(_companyAId);
        var invitationId = await InviteAsync(admin, microclimateId, await SeedEmployeeAsync(_companyAId));

        await admin.PostAsync($"/microclimates/{microclimateId}/invitations/{invitationId}/revoke", null);
        var resend = await admin.PostAsync(
            $"/microclimates/{microclimateId}/invitations/{invitationId}/resend", null);

        Assert.Equal(HttpStatusCode.Conflict, resend.StatusCode);
        Assert.Equal(MicroclimateInvitationStatuses.Revoked, (await RowAsync(invitationId)).Status);
    }

    [Fact]
    public async Task A_draft_microclimate_cannot_be_distributed()
    {
        var admin = await AdminAAsync();
        var microclimateId = await SeedMicroclimateAsync(_companyAId, status: MicroclimateStatuses.Draft);

        var response = await admin.PostAsJsonAsync(
            $"/microclimates/{microclimateId}/invitations",
            new CreateMicroclimateInvitationsRequest(UserIds: [await SeedEmployeeAsync(_companyAId)]));

        Assert.Equal(HttpStatusCode.Conflict, response.StatusCode);
        Assert.Empty(await _harness.WithDbAsync(db =>
            db.MicroclimateInvitations.Where(i => i.MicroclimateId == microclimateId).ToListAsync()));
    }

    /// <summary>
    /// An invitation never outlives its session, whatever the caller asks for. A token that
    /// still opens a closed pulse is a token with nothing to protect and everything to leak.
    /// </summary>
    [Fact]
    public async Task An_invitation_expires_no_later_than_the_session_it_opens()
    {
        var admin = await AdminAAsync();

        // Five days, deliberately longer than the one-day ask below. A pulse whose whole
        // window is two hours clamps EVERY request, including the short one, so the
        // "a shorter ask is honoured" half would pass against a handler that ignored
        // ExpiresInDays entirely -- the exact vacuous pass this branch has to avoid.
        var endTime = DateTimeOffset.UtcNow.AddDays(5);
        var microclimateId = await SeedMicroclimateAsync(_companyAId, endTime: endTime);

        // A ludicrous ask, clamped to the session's own deadline.
        var far = await admin.PostAsJsonAsync(
            $"/microclimates/{microclimateId}/invitations",
            new CreateMicroclimateInvitationsRequest(UserIds: [await SeedEmployeeAsync(_companyAId)], ExpiresInDays: 365));
        var farId = Assert.Single((await far.Content.ReadFromJsonAsync<MicroclimateInvitationBatchResult>())!.InvitationIds);
        Assert.Equal(endTime, (await RowAsync(farId)).ExpiresAt, TimeSpan.FromSeconds(1));

        // And a shorter one is honoured, so the clamp is a ceiling rather than an override.
        var near = await admin.PostAsJsonAsync(
            $"/microclimates/{microclimateId}/invitations",
            new CreateMicroclimateInvitationsRequest(UserIds: [await SeedEmployeeAsync(_companyAId)], ExpiresInDays: 1));
        var nearId = Assert.Single((await near.Content.ReadFromJsonAsync<MicroclimateInvitationBatchResult>())!.InvitationIds);
        var nearExpiry = (await RowAsync(nearId)).ExpiresAt;
        Assert.True(nearExpiry < endTime, $"{nearExpiry:o} should be inside the session's {endTime:o}");
        Assert.Equal(DateTimeOffset.UtcNow.AddDays(1), nearExpiry, TimeSpan.FromMinutes(1));

        Assert.Equal(HttpStatusCode.BadRequest, (await admin.PostAsJsonAsync(
            $"/microclimates/{microclimateId}/invitations",
            new CreateMicroclimateInvitationsRequest(UserIds: [await SeedEmployeeAsync(_companyAId)], ExpiresInDays: 0))).StatusCode);
    }

    [Fact]
    public async Task An_empty_audience_is_refused_rather_than_read_as_everyone()
    {
        var admin = await AdminAAsync();
        var microclimateId = await SeedMicroclimateAsync(_companyAId);
        await SeedEmployeeAsync(_companyAId);

        var none = await admin.PostAsJsonAsync(
            $"/microclimates/{microclimateId}/invitations",
            new CreateMicroclimateInvitationsRequest());
        var both = await admin.PostAsJsonAsync(
            $"/microclimates/{microclimateId}/invitations",
            new CreateMicroclimateInvitationsRequest(UserIds: [await SeedEmployeeAsync(_companyAId)], AllCompanyUsers: true));

        Assert.Equal(HttpStatusCode.BadRequest, none.StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, both.StatusCode);
        Assert.Empty(await _harness.WithDbAsync(db =>
            db.MicroclimateInvitations.Where(i => i.MicroclimateId == microclimateId).ToListAsync()));
    }

    [Fact]
    public async Task A_department_audience_resolves_to_that_departments_active_users()
    {
        var admin = await AdminAAsync();
        var microclimateId = await SeedMicroclimateAsync(_companyAId);
        var inEngineering = await SeedEmployeeAsync(_companyAId, _engineeringId);
        var elsewhere = await SeedEmployeeAsync(_companyAId);

        var response = await admin.PostAsJsonAsync(
            $"/microclimates/{microclimateId}/invitations",
            new CreateMicroclimateInvitationsRequest(DepartmentIds: [_engineeringId]));
        var batch = await response.Content.ReadFromJsonAsync<MicroclimateInvitationBatchResult>();

        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        Assert.Equal(1, batch!.Created);

        var invited = await _harness.WithDbAsync(db => db.MicroclimateInvitations
            .Where(i => i.MicroclimateId == microclimateId)
            .Select(i => i.UserId)
            .ToListAsync());
        Assert.Equal([inEngineering], invited);
        Assert.DoesNotContain(elsewhere, invited);
    }

    /// <summary>
    /// The unique index on <c>(microclimate_id, user_id)</c> means a second invitation for the
    /// same person is impossible, so the batch route must skip rather than fail the whole
    /// request -- an admin re-running an invitation after adding three people should invite
    /// the three, not get a 500.
    /// </summary>
    [Fact]
    public async Task Inviting_the_same_person_twice_skips_rather_than_failing_the_batch()
    {
        var admin = await AdminAAsync();
        var microclimateId = await SeedMicroclimateAsync(_companyAId);
        var first = await SeedEmployeeAsync(_companyAId);
        await InviteAsync(admin, microclimateId, first);

        var second = await SeedEmployeeAsync(_companyAId);
        var response = await admin.PostAsJsonAsync(
            $"/microclimates/{microclimateId}/invitations",
            new CreateMicroclimateInvitationsRequest(UserIds: [first, second]));
        var batch = await response.Content.ReadFromJsonAsync<MicroclimateInvitationBatchResult>();

        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        Assert.Equal(2, batch!.Requested);
        Assert.Equal(1, batch.Created);
        Assert.Equal([first], batch.SkippedUserIds);
    }

    [Fact]
    public async Task The_listing_reports_per_status_counts_and_the_anonymity_contract()
    {
        var admin = await AdminAAsync();
        var microclimateId = await SeedMicroclimateAsync(_companyAId);
        var openedId = await InviteAsync(admin, microclimateId, await SeedEmployeeAsync(_companyAId));
        var revokedId = await InviteAsync(admin, microclimateId, await SeedEmployeeAsync(_companyAId));

        await Anonymous().PostAsync($"/microclimate-invitations/{await TokenOfAsync(openedId)}/opened", null);
        await admin.PostAsync($"/microclimates/{microclimateId}/invitations/{revokedId}/revoke", null);

        var listing = await (await admin.GetAsync($"/microclimates/{microclimateId}/invitations"))
            .Content.ReadFromJsonAsync<MicroclimateInvitationListResponse>();

        Assert.Equal(2, listing!.Summary.Total);
        Assert.Equal(1, listing.Summary.Opened);
        Assert.Equal(1, listing.Summary.Revoked);
        Assert.Equal(0, listing.Summary.Completed);

        // Expired counts the revoked row -- revocation expires it too -- and that overlap is
        // deliberate: expiry is derived, not a status, so it cannot be mutually exclusive with
        // one.
        Assert.Equal(0, listing.Summary.Expired);

        Assert.True(listing.Anonymity.Anonymous);
        Assert.Equal(MicroclimateInvitationStatuses.Opened, listing.Anonymity.HighestRecordableState);
        Assert.Contains("aggregate", listing.Anonymity.Guarantee, StringComparison.OrdinalIgnoreCase);

        var filtered = await (await admin.GetAsync($"/microclimates/{microclimateId}/invitations?status=revoked"))
            .Content.ReadFromJsonAsync<MicroclimateInvitationListResponse>();
        Assert.Equal(revokedId, Assert.Single(filtered!.Invitations).Id);

        Assert.Equal(
            HttpStatusCode.BadRequest,
            (await admin.GetAsync($"/microclimates/{microclimateId}/invitations?status=participated")).StatusCode);
    }

    // ------------------------------------------------------------------
    // Tenancy
    // ------------------------------------------------------------------

    [Fact]
    public async Task Another_tenants_admin_cannot_read_or_write_this_microclimates_invitations()
    {
        var adminA = await AdminAAsync();
        var adminB = await _harness.ClientAsync(Roles.CompanyAdmin, _companyBId);
        var microclimateId = await SeedMicroclimateAsync(_companyAId);
        var invitationId = await InviteAsync(adminA, microclimateId, await SeedEmployeeAsync(_companyAId));

        Assert.Equal(
            HttpStatusCode.Forbidden,
            (await adminB.GetAsync($"/microclimates/{microclimateId}/invitations")).StatusCode);
        Assert.Equal(
            HttpStatusCode.Forbidden,
            (await adminB.PostAsJsonAsync(
                $"/microclimates/{microclimateId}/invitations",
                new CreateMicroclimateInvitationsRequest(AllCompanyUsers: true))).StatusCode);
        Assert.Equal(
            HttpStatusCode.Forbidden,
            (await adminB.PostAsync($"/microclimates/{microclimateId}/invitations/{invitationId}/revoke", null)).StatusCode);

        Assert.Equal(MicroclimateInvitationStatuses.Sent, (await RowAsync(invitationId)).Status);
    }

    /// <summary>
    /// The audience is scoped to the MICROCLIMATE's company, not the caller's, so a SuperAdmin
    /// acting on tenant A cannot pull tenant B's employees into tenant A's pulse. A SuperAdmin
    /// is used deliberately: for a CompanyAdmin the two scopes coincide and the test would
    /// prove nothing.
    /// </summary>
    [Fact]
    public async Task A_super_admin_cannot_invite_another_tenants_employees_into_this_one()
    {
        var superAdmin = await _harness.ClientAsync(Roles.SuperAdmin, _companyAId);
        var microclimateId = await SeedMicroclimateAsync(_companyAId);
        var foreigner = await SeedEmployeeAsync(_companyBId);

        var named = await superAdmin.PostAsJsonAsync(
            $"/microclimates/{microclimateId}/invitations",
            new CreateMicroclimateInvitationsRequest(UserIds: [foreigner]));
        Assert.Equal(HttpStatusCode.BadRequest, named.StatusCode);

        // And the company-wide selector does not reach them either.
        await superAdmin.PostAsJsonAsync(
            $"/microclimates/{microclimateId}/invitations",
            new CreateMicroclimateInvitationsRequest(AllCompanyUsers: true));

        var invited = await _harness.WithDbAsync(db => db.MicroclimateInvitations
            .Where(i => i.MicroclimateId == microclimateId)
            .Select(i => i.UserId)
            .ToListAsync());
        Assert.DoesNotContain(foreigner, invited);
    }

    // ------------------------------------------------------------------
    // The notification seam -- the right table, and only for the right person
    // ------------------------------------------------------------------

    /// <summary>
    /// The queued notification names a <c>microclimate_invitations</c> row and carries no
    /// token, and -- the assertion that matters -- the survey reader finds nothing in it.
    ///
    /// <para>Written with the survey key instead, the payload would carry a
    /// <c>microclimate_invitations</c> primary key in a field only ever looked up in
    /// <c>survey_invitations</c>. That is not an exception, a 500 or a failed row: it is a
    /// null, a link-less mail, and a green build. Hence both directions.</para>
    /// </summary>
    [Fact]
    public async Task The_queued_notification_names_the_microclimate_invitation_and_no_survey_one()
    {
        var admin = await AdminAAsync();
        var microclimateId = await SeedMicroclimateAsync(_companyAId);
        var userId = await SeedEmployeeAsync(_companyAId);
        var invitationId = await InviteAsync(admin, microclimateId, userId);
        var token = await TokenOfAsync(invitationId);

        var notification = await _harness.WithDbAsync(db => db.Notifications
            .AsNoTracking()
            .SingleAsync(n => n.UserId == userId && n.Type == NotificationTypes.MicroclimateInvitation));

        Assert.Equal(_companyAId, notification.CompanyId);
        Assert.Equal(NotificationChannels.Email, notification.Channel);

        // The right reader finds the row this notification is actually about.
        Assert.Equal(invitationId, MicroclimateNotificationData.InvitationIdOrNull(notification.Data));

        // The wrong reader finds nothing at all. This is the trap, closed.
        Assert.Null(SurveyNotificationData.InvitationIdOrNull(notification.Data));

        // And the token is not in the blob. GET /notifications?companyId= returns `data`
        // verbatim to any CompanyAdmin.
        Assert.DoesNotContain(token, notification.Data!, StringComparison.Ordinal);
    }

    /// <summary>
    /// The token resolver's scope, which is the whole of the cross-tenant defence on the mail
    /// path.
    ///
    /// <para>The id reaching <c>LiveTokenAsync</c> comes out of <c>notifications.data</c>, and
    /// <c>POST /notifications</c> writes that column from the request body verbatim -- so a
    /// CompanyAdmin chooses which invitation id is looked up. Keyed on the id alone that is an
    /// exfiltration primitive: name another employee's, or another tenant's, invitation and
    /// have the sender mail you their token. All three predicates are asserted separately, so
    /// dropping any one of them fails here.</para>
    /// </summary>
    [Fact]
    public async Task A_token_is_only_ever_resolved_for_its_own_recipient_in_its_own_tenant()
    {
        var admin = await AdminAAsync();
        var microclimateId = await SeedMicroclimateAsync(_companyAId);
        var userId = await SeedEmployeeAsync(_companyAId);
        var invitationId = await InviteAsync(admin, microclimateId, userId);
        var token = await TokenOfAsync(invitationId);

        using var scope = _factory.Services.CreateScope();
        var tokens = scope.ServiceProvider.GetRequiredService<IMicroclimateInvitationTokens>();

        // The honest lookup succeeds -- otherwise every refusal below passes for the wrong
        // reason.
        Assert.Equal(
            token,
            await tokens.LiveTokenAsync(invitationId, userId, _companyAId, CancellationToken.None));

        // Somebody else's mailbox.
        Assert.Null(await tokens.LiveTokenAsync(invitationId, Guid.NewGuid(), _companyAId, CancellationToken.None));

        // Another tenant's notification.
        Assert.Null(await tokens.LiveTokenAsync(invitationId, userId, _companyBId, CancellationToken.None));

        // An id that names nothing.
        Assert.Null(await tokens.LiveTokenAsync(Guid.NewGuid(), userId, _companyAId, CancellationToken.None));

        // And revocation is real at send time: an invitation revoked between queueing and the
        // sweep has no live token left to find, so nobody is mailed a link that greets them
        // with "this invitation has been revoked".
        await admin.PostAsync($"/microclimates/{microclimateId}/invitations/{invitationId}/revoke", null);
        using var afterScope = _factory.Services.CreateScope();
        Assert.Null(await afterScope.ServiceProvider
            .GetRequiredService<IMicroclimateInvitationTokens>()
            .LiveTokenAsync(invitationId, userId, _companyAId, CancellationToken.None));
    }
}
