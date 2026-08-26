using System.Net;
using System.Net.Http.Json;
using ClimateProject.Api.Endpoints;
using ClimateProject.Application.Auth;
using ClimateProject.Application.Email;
using ClimateProject.Application.Localization;
using ClimateProject.Application.Notifications;
using ClimateProject.Application.Surveys;
using ClimateProject.Domain.Entities;
using ClimateProject.Infrastructure.Notifications;
using ClimateProject.Infrastructure.Persistence;
using ClimateProject.Infrastructure.Scheduling;
using ClimateProject.IntegrationTests.Support;
using ClimateProject.IntegrationTests.Surveys;
using Microsoft.AspNetCore.Hosting;
using Microsoft.Extensions.Configuration;
using Microsoft.AspNetCore.TestHost;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.DependencyInjection.Extensions;

namespace ClimateProject.IntegrationTests.Notifications;

/// <summary>
/// The one host in this assembly whose mail provider is <b>configured</b> and whose transport
/// <b>captures</b> what the product actually composed.
///
/// <para>
/// A class fixture, not a field: xUnit constructs a test class once per <c>[Fact]</c>, and
/// this host is billed against <see cref="AuthWebApplicationFactory.HostBudget"/>. Built
/// lazily on first use so it can be handed the connection string the collection fixture owns
/// -- a class fixture cannot take the collection fixture as a constructor argument, and
/// nothing here should hard-code a database.
/// </para>
/// </summary>
public sealed class CapturingMailHostFixture : IDisposable
{
    private readonly Lock _gate = new();
    private CapturingMailFactory? _factory;

    /// <summary>Everything the product handed to a transport during this class's tests.</summary>
    public CapturedMailbox Mailbox { get; } = new();

    public AuthWebApplicationFactory HostFor(string connectionString)
    {
        lock (_gate)
        {
            return _factory ??= new CapturingMailFactory(connectionString, Mailbox);
        }
    }

    public void Dispose() => _factory?.Dispose();

    private sealed class CapturingMailFactory(string connectionString, CapturedMailbox mailbox)
        : AuthWebApplicationFactory(connectionString)
    {
        protected override void ConfigureWebHost(IWebHostBuilder builder)
        {
            base.ConfigureWebHost(builder);

            // A configured provider, so Program.cs's own selection rule picks
            // EmailNotificationSender rather than the stub. That selection is part of what
            // this class proves: a link rendered by a sender the container never hands out
            // is a link nobody receives.
            builder.ConfigureAppConfiguration((_, config) => config.AddInMemoryCollection(
                new Dictionary<string, string?>
                {
                    ["Email:Provider"] = EmailOptions.ProviderSmtp,
                    ["Email:SmtpHost"] = "smtp.example.invalid",
                    ["Email:FromAddress"] = "no-reply@example.com",
                    ["Email:AppBaseUrl"] = AppBaseUrl,
                }));

            // ...and a transport that records instead of dialling. Replacing the TRANSPORT
            // rather than the sender is the point: stubbing INotificationSender would skip
            // the composer entirely and prove nothing about what a recipient reads.
            builder.ConfigureTestServices(services =>
            {
                services.RemoveAll<IEmailTransport>();
                services.AddScoped<IEmailTransport>(_ => new CapturingEmailTransport(mailbox));
            });
        }
    }

    /// <summary>
    /// The origin this host is configured for. Deliberately not the production one: a link
    /// built by concatenating something other than <c>Email:AppBaseUrl</c> would still look
    /// plausible, and would still send a recipient to the wrong deployment.
    /// </summary>
    public const string AppBaseUrl = "https://climate.test";

    private sealed class CapturingEmailTransport(CapturedMailbox mailbox) : IEmailTransport
    {
        public Task<EmailSendOutcome> SendAsync(EmailMessage message, CancellationToken cancellationToken)
        {
            mailbox.Add(message);
            return Task.FromResult(EmailSendOutcome.Success());
        }
    }
}

/// <summary>Thread-safe because the dispatch sweep may deliver concurrently.</summary>
public sealed class CapturedMailbox
{
    private readonly Lock _gate = new();
    private readonly List<EmailMessage> _messages = [];

    public void Add(EmailMessage message)
    {
        lock (_gate) { _messages.Add(message); }
    }

    /// <summary>Forgets everything captured so far, so one test can measure two sends separately.</summary>
    public void Clear()
    {
        lock (_gate) { _messages.Clear(); }
    }

    public IReadOnlyList<EmailMessage> To(string address)
    {
        lock (_gate)
        {
            return [.. _messages.Where(m => string.Equals(m.ToAddress, address, StringComparison.OrdinalIgnoreCase))];
        }
    }
}

/// <summary>
/// <b>The invitation email carries a link that opens the survey.</b>
///
/// <para>
/// This is the end of the invite-to-respond chain and the only place it is asserted against
/// the artefact a person receives. Everything upstream was already green while the product
/// mailed invitations with no link in them at all: the endpoint queued a row, the sweep marked
/// it <c>sent</c>, the transport was handed a message, and nothing anywhere read the body. So
/// the assertions here are on <see cref="EmailMessage.TextBody"/> and
/// <see cref="EmailMessage.HtmlBody"/>, and the token they look for is read out of the
/// database rather than predicted.
/// </para>
/// <para>
/// The unit suite covers the sender's branches exhaustively and without a container
/// (<c>EmailNotificationSenderTests</c>). What only this class can prove is that the token in
/// the mail is the token in <c>survey_invitations</c>, minted by the real endpoint, resolved
/// by the real EF lookup, through the real DI wiring of the API host.
/// </para>
/// </summary>
[Collection("Postgres")]
public class InvitationEmailLinkTests : IAsyncLifetime, IClassFixture<CapturingMailHostFixture>
{
    private readonly CapturingMailHostFixture _mail;
    private readonly AuthWebApplicationFactory _factory;
    private readonly SurveyTestHarness _harness;
    private Guid _companyId;

    public InvitationEmailLinkTests(PostgresContainerFixture postgres, CapturingMailHostFixture mail)
    {
        _mail = mail;
        _factory = mail.HostFor(postgres.ConnectionString);
        _harness = new SurveyTestHarness(_factory, $"maillink-{Guid.NewGuid():N}.test");
    }

    public async Task InitializeAsync() => _companyId = await _harness.SeedCompanyAsync("Mail Link Co");

    public Task DisposeAsync() => Task.CompletedTask;

    private Task<HttpClient> AdminAsync() => _harness.ClientAsync(Roles.CompanyAdmin, _companyId);

    /// <summary>An employee row to invite. Seeded directly: these never authenticate, they only receive.</summary>
    private Task<(Guid Id, string Email)> SeedEmployeeAsync(string language = ContentLanguages.English)
        => _harness.WithDbAsync(async db =>
        {
            var user = new User
            {
                Id = Guid.NewGuid(),
                CompanyId = _companyId,
                Email = $"{Guid.NewGuid():N}@invitee.test",
                Name = "Invitee",
                Role = Roles.Employee,
                IsActive = true,
                CreatedAt = DateTimeOffset.UtcNow,
                UpdatedAt = DateTimeOffset.UtcNow,
            };
            user.Preferences.Language = language;
            db.Users.Add(user);
            await db.SaveChangesAsync();
            return (user.Id, user.Email);
        });

    private async Task<SurveyDetail> CreateActiveSurveyAsync(HttpClient client)
    {
        var created = await SurveyTestHarness.CreateSurveyAsync(client, SurveyTestHarness.MinimalRequest(_companyId));
        (await SurveyTestHarness.SetStatusAsync(client, created.Id, SurveyStatuses.Active)).EnsureSuccessStatusCode();
        return created;
    }

    private async Task<NotificationProcessResult> SweepAsync(HttpClient adminClient)
    {
        var response = await adminClient.PostAsync($"/notifications/process?companyId={_companyId}", null);
        response.EnsureSuccessStatusCode();
        return (await response.Content.ReadFromJsonAsync<NotificationProcessResult>())!;
    }

    // ------------------------------------------------------------------

    /// <summary>
    /// <b>G1.</b> The mail a recipient gets contains an absolute
    /// <c>/survey-invitations/{token}</c> URL, and the token in it is the one on their row.
    /// </summary>
    [Fact]
    public async Task An_invitation_email_carries_an_absolute_link_built_from_the_recipients_own_token()
    {
        var client = await AdminAsync();
        var survey = await CreateActiveSurveyAsync(client);
        var (employeeId, employeeEmail) = await SeedEmployeeAsync();

        var invited = await client.PostAsJsonAsync(
            $"/surveys/{survey.Id}/invitations", new CreateSurveyInvitationsRequest(UserIds: [employeeId]));
        invited.EnsureSuccessStatusCode();

        var sweep = await SweepAsync(client);
        Assert.Equal(1, sweep.Sent);

        // Read AFTER the send, from the row itself: predicting the token would prove only that
        // this test can do base64.
        var token = await _harness.WithDbAsync(db => db.SurveyInvitations
            .AsNoTracking().Where(i => i.SurveyId == survey.Id && i.UserId == employeeId)
            .Select(i => i.InvitationToken).FirstAsync());

        var expected = $"{CapturingMailHostFixture.AppBaseUrl}/survey-invitations/{token}";
        var message = Assert.Single(_mail.Mailbox.To(employeeEmail));

        // Both parts. A call to action present only in the HTML is a dead end for every
        // plain-text reader.
        Assert.Contains(expected, message.TextBody, StringComparison.Ordinal);
        Assert.Contains($"href=\"{expected}\"", message.HtmlBody, StringComparison.Ordinal);

        // And it is the token route, not the authenticated survey page: /surveys/{id}/respond
        // sits behind RequireAuth, which destroys the destination on redirect and lands the
        // recipient on the dashboard.
        Assert.DoesNotContain("/respond", message.TextBody, StringComparison.Ordinal);
        Assert.DoesNotContain(survey.Id.ToString(), message.TextBody, StringComparison.Ordinal);

        // The link the mail carries is the link the API actually honours. This is the
        // assertion no string comparison can fake: the unauthenticated token route resolves
        // it to this survey.
        using var anonymous = _factory.CreateClient();
        var opened = await anonymous.GetAsync($"/survey-invitations/{token}");
        opened.EnsureSuccessStatusCode();
        var detail = await opened.Content.ReadFromJsonAsync<SurveyInvitationTokenDetail>();
        Assert.Equal(survey.Id, detail!.SurveyId);
    }

    /// <summary>
    /// The Spanish half of the same guarantee. The URL is identical -- a token is not
    /// translated -- and the label around it is not.
    /// </summary>
    [Fact]
    public async Task The_call_to_action_is_written_in_the_recipients_own_language()
    {
        var client = await AdminAsync();
        var survey = await CreateActiveSurveyAsync(client);
        var (employeeId, employeeEmail) = await SeedEmployeeAsync(ContentLanguages.Spanish);

        (await client.PostAsJsonAsync(
            $"/surveys/{survey.Id}/invitations",
            new CreateSurveyInvitationsRequest(UserIds: [employeeId]))).EnsureSuccessStatusCode();
        await SweepAsync(client);

        var message = Assert.Single(_mail.Mailbox.To(employeeEmail));
        Assert.Contains("Abrir la encuesta", message.TextBody, StringComparison.Ordinal);
        Assert.Contains("Abrir la encuesta", message.HtmlBody, StringComparison.Ordinal);
        Assert.Contains($"{CapturingMailHostFixture.AppBaseUrl}/survey-invitations/", message.TextBody, StringComparison.Ordinal);
    }

    /// <summary>
    /// <b>G3 (#383).</b> Revoked between queueing and sending: nothing is mailed at all.
    ///
    /// <para>
    /// This test previously asserted the opposite -- that the mail still went out, minus its
    /// link -- and that was the defect, not the guarantee. A revoked invitee received a message
    /// inviting them to a survey they can no longer open, whose body tells them to follow a
    /// link that is not in it. Withholding the token was correct and was never the whole
    /// answer: the message itself must not go.
    /// </para>
    /// <para>
    /// Asserted at the mailbox, because that is the only place the difference is visible. The
    /// notification row's status is checked too, but a row marked <c>cancelled</c> next to a
    /// captured message would still be a mail somebody received.
    /// </para>
    /// </summary>
    [Fact]
    public async Task A_revoked_invitation_is_not_mailed_at_all()
    {
        var client = await AdminAsync();
        var survey = await CreateActiveSurveyAsync(client);
        var (employeeId, employeeEmail) = await SeedEmployeeAsync();

        var invited = await client.PostAsJsonAsync(
            $"/surveys/{survey.Id}/invitations", new CreateSurveyInvitationsRequest(UserIds: [employeeId]));
        invited.EnsureSuccessStatusCode();
        var batch = (await invited.Content.ReadFromJsonAsync<SurveyInvitationBatchResult>())!;

        // The precondition the defect needs: a real notification row, queued by the real
        // endpoint, still waiting for a sweep.
        Assert.Equal(1, batch.NotificationsQueued);
        Assert.Equal(
            NotificationStatuses.Pending,
            await _harness.WithDbAsync(db => db.Notifications
                .AsNoTracking().Where(n => n.UserId == employeeId).Select(n => n.Status).FirstAsync()));

        // The administrator changes their mind, through the real route, before the sweep runs.
        (await client.PostAsync(
            $"/surveys/{survey.Id}/invitations/{batch.InvitationIds[0]}/revoke", null)).EnsureSuccessStatusCode();

        var sweep = await SweepAsync(client);
        Assert.Equal(0, sweep.Sent);
        Assert.Equal(0, sweep.Failed);

        // Nothing reached a transport. Not "a mail without a link" -- no mail.
        Assert.Empty(_mail.Mailbox.To(employeeEmail));

        // And the row says why, in the vocabulary the dispatch path already uses for
        // "nothing broke, this must not go".
        var notification = await _harness.WithDbAsync(db => db.Notifications
            .AsNoTracking().FirstAsync(n => n.UserId == employeeId));
        Assert.Equal(NotificationStatuses.Cancelled, notification.Status);
        Assert.Null(notification.SentAt);
        Assert.False(string.IsNullOrWhiteSpace(notification.FailureReason));

        // `cancelled` is not retryable, so a later sweep cannot resurrect it. Asserted by
        // running one rather than by reading the array.
        var again = await SweepAsync(client);
        Assert.Equal(0, again.Sent);
        Assert.Empty(_mail.Mailbox.To(employeeEmail));
    }

    /// <summary>
    /// <b>#383, the scenario the issue actually describes.</b> <c>InvitationSendImmediately</c>
    /// is off by default, so an invitation queued against a survey that has not opened yet
    /// carries <c>ScheduledFor = survey.StartDate</c> and sits <c>pending</c> for however long
    /// that is -- days or weeks in which an administrator may revoke it. The sweep that finally
    /// runs when the survey opens is the one that mailed it.
    ///
    /// <para>
    /// Driven through <c>NotificationDelivery.ProcessDueAsync</c> with the clock advanced past
    /// the survey's opening, in a scope of the real host with the real sender -- the sweep the
    /// scheduler ticks, at the moment it would tick. Going through
    /// <c>POST /notifications/process</c> instead would prove nothing here: the row is not due
    /// yet, so it would be skipped for a reason that has nothing to do with the revoke.
    /// </para>
    /// </summary>
    [Fact]
    public async Task An_invitation_held_until_the_survey_opens_is_not_mailed_when_it_opens_if_it_was_revoked()
    {
        var client = await AdminAsync();
        var (employeeId, employeeEmail) = await SeedEmployeeAsync();

        var opensAt = DateTimeOffset.UtcNow.AddDays(3);
        var request = SurveyTestHarness.MinimalRequest(_companyId) with
        {
            StartDate = opensAt,
            EndDate = opensAt.AddDays(14),
        };
        var survey = await SurveyTestHarness.CreateSurveyAsync(client, request);

        // `scheduled`, not `active`: a survey queued to open is exactly when invitations are
        // held, and it is a status invitations may be sent from.
        (await SurveyTestHarness.SetStatusAsync(client, survey.Id, SurveyStatuses.Scheduled)).EnsureSuccessStatusCode();

        // Stated rather than assumed. The whole scenario rests on this being off.
        Assert.False(survey.Settings.InvitationSendImmediately);

        var invited = await client.PostAsJsonAsync(
            $"/surveys/{survey.Id}/invitations", new CreateSurveyInvitationsRequest(UserIds: [employeeId]));
        invited.EnsureSuccessStatusCode();
        var batch = (await invited.Content.ReadFromJsonAsync<SurveyInvitationBatchResult>())!;

        var queued = await _harness.WithDbAsync(db => db.Notifications
            .AsNoTracking().FirstAsync(n => n.UserId == employeeId));
        Assert.Equal(NotificationStatuses.Pending, queued.Status);

        // The issue's precondition, verbatim: the notification is held until the survey opens.
        Assert.Equal(survey.StartDate, queued.ScheduledFor);
        Assert.True(queued.ScheduledFor > DateTimeOffset.UtcNow);

        (await client.PostAsync(
            $"/surveys/{survey.Id}/invitations/{batch.InvitationIds[0]}/revoke", null)).EnsureSuccessStatusCode();

        // The sweep that runs once the survey has opened, with the real sender and the real
        // capturing transport behind it.
        using (var scope = _factory.Services.CreateScope())
        {
            var swept = await NotificationDelivery.ProcessDueAsync(
                scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>(),
                scope.ServiceProvider.GetRequiredService<INotificationSender>(),
                scope.ServiceProvider.GetRequiredService<ILoggerFactory>(),
                _companyId,
                survey.StartDate.AddMinutes(1),
                NotificationDelivery.DefaultBatchSize,
                CancellationToken.None);

            Assert.Equal(0, swept.Attempted);
            Assert.Equal(0, swept.Sent);
        }

        Assert.Empty(_mail.Mailbox.To(employeeEmail));
    }

    /// <summary>
    /// <b>#383, decision 1.</b> A message that has already gone is left exactly as it was.
    /// Nothing written to a row recalls an email, so rewriting one to <c>cancelled</c> would
    /// only make the product's record disagree with what the recipient actually received.
    /// </summary>
    [Fact]
    public async Task A_notification_that_has_already_been_sent_is_left_alone_by_a_revoke()
    {
        var client = await AdminAsync();
        var survey = await CreateActiveSurveyAsync(client);
        var (employeeId, employeeEmail) = await SeedEmployeeAsync();

        var invited = await client.PostAsJsonAsync(
            $"/surveys/{survey.Id}/invitations", new CreateSurveyInvitationsRequest(UserIds: [employeeId]));
        invited.EnsureSuccessStatusCode();
        var batch = (await invited.Content.ReadFromJsonAsync<SurveyInvitationBatchResult>())!;

        // It goes out FIRST. This is the revoke that arrives too late.
        Assert.Equal(1, (await SweepAsync(client)).Sent);
        var delivered = Assert.Single(_mail.Mailbox.To(employeeEmail));
        Assert.False(string.IsNullOrWhiteSpace(delivered.TextBody));

        var before = await _harness.WithDbAsync(db => db.Notifications
            .AsNoTracking().FirstAsync(n => n.UserId == employeeId));
        Assert.Equal(NotificationStatuses.Sent, before.Status);
        Assert.NotNull(before.SentAt);

        (await client.PostAsync(
            $"/surveys/{survey.Id}/invitations/{batch.InvitationIds[0]}/revoke", null)).EnsureSuccessStatusCode();

        var after = await _harness.WithDbAsync(db => db.Notifications
            .AsNoTracking().FirstAsync(n => n.UserId == employeeId));
        Assert.Equal(NotificationStatuses.Sent, after.Status);
        Assert.Equal(before.SentAt, after.SentAt);
        Assert.Null(after.FailureReason);

        // The invitation itself is still revoked -- leaving the sent mail alone is not
        // declining to revoke.
        var invitations = await client.GetFromJsonAsync<SurveyInvitationListResponse>(
            $"/surveys/{survey.Id}/invitations");
        Assert.Equal(
            SurveyInvitationStatuses.Revoked,
            Assert.Single(invitations!.Invitations, i => i.Id == batch.InvitationIds[0]).Status);
    }

    /// <summary>
    /// <b>#383, scope.</b> A revoke cancels the mail queued for <i>that invitation</i> and
    /// nothing else -- not this person's invitation to a different survey, and not another
    /// invitee's to the same one.
    ///
    /// <para>
    /// The same-person-two-surveys half is the one that matters. The candidate query narrows on
    /// recipient and tenant, and both of this person's queued messages pass that filter; only
    /// the invitation id inside <c>notifications.data</c> tells them apart. A cancellation that
    /// stopped at the recipient would silently un-invite somebody from a survey nobody revoked
    /// them from, and every cheaper test would stay green.
    /// </para>
    /// </summary>
    [Fact]
    public async Task A_revoke_cancels_only_the_mail_queued_for_that_one_invitation()
    {
        var client = await AdminAsync();
        var revokedSurvey = await CreateActiveSurveyAsync(client);
        var otherSurvey = await CreateActiveSurveyAsync(client);

        var (employeeId, employeeEmail) = await SeedEmployeeAsync();
        var (colleagueId, colleagueEmail) = await SeedEmployeeAsync();

        var invitedToRevoked = await client.PostAsJsonAsync(
            $"/surveys/{revokedSurvey.Id}/invitations",
            new CreateSurveyInvitationsRequest(UserIds: [employeeId, colleagueId]));
        invitedToRevoked.EnsureSuccessStatusCode();

        (await client.PostAsJsonAsync(
            $"/surveys/{otherSurvey.Id}/invitations",
            new CreateSurveyInvitationsRequest(UserIds: [employeeId]))).EnsureSuccessStatusCode();

        var revokedInvitationId = await _harness.WithDbAsync(db => db.SurveyInvitations
            .AsNoTracking()
            .Where(i => i.SurveyId == revokedSurvey.Id && i.UserId == employeeId)
            .Select(i => i.Id)
            .FirstAsync());

        (await client.PostAsync(
            $"/surveys/{revokedSurvey.Id}/invitations/{revokedInvitationId}/revoke", null)).EnsureSuccessStatusCode();

        // Three queued, one revoked, so two go out.
        var sweep = await SweepAsync(client);
        Assert.Equal(2, sweep.Sent);

        // The colleague's invitation to the very same survey is untouched, and openable.
        var colleagueToken = await _harness.WithDbAsync(db => db.SurveyInvitations
            .AsNoTracking()
            .Where(i => i.SurveyId == revokedSurvey.Id && i.UserId == colleagueId)
            .Select(i => i.InvitationToken)
            .FirstAsync());
        var toColleague = Assert.Single(_mail.Mailbox.To(colleagueEmail));
        Assert.Contains(
            $"{CapturingMailHostFixture.AppBaseUrl}/survey-invitations/{colleagueToken}",
            toColleague.TextBody,
            StringComparison.Ordinal);

        // ...and so is this person's invitation to the OTHER survey. Exactly one mail, and it
        // is the one carrying the other survey's token.
        var otherToken = await _harness.WithDbAsync(db => db.SurveyInvitations
            .AsNoTracking()
            .Where(i => i.SurveyId == otherSurvey.Id && i.UserId == employeeId)
            .Select(i => i.InvitationToken)
            .FirstAsync());
        var toEmployee = Assert.Single(_mail.Mailbox.To(employeeEmail));
        Assert.Contains(
            $"{CapturingMailHostFixture.AppBaseUrl}/survey-invitations/{otherToken}",
            toEmployee.TextBody,
            StringComparison.Ordinal);

        // The revoked invitation's own token appears in nothing that was sent.
        var revokedToken = await _harness.WithDbAsync(db => db.SurveyInvitations
            .AsNoTracking().Where(i => i.Id == revokedInvitationId).Select(i => i.InvitationToken).FirstAsync());
        Assert.DoesNotContain(revokedToken, toEmployee.TextBody, StringComparison.Ordinal);
        Assert.DoesNotContain(revokedToken, toColleague.TextBody, StringComparison.Ordinal);

        var statuses = await _harness.WithDbAsync(db => db.Notifications
            .AsNoTracking()
            .Where(n => n.UserId == employeeId || n.UserId == colleagueId)
            .Select(n => new { n.UserId, n.Data, n.Status })
            .ToListAsync());
        Assert.Equal(3, statuses.Count);

        // Exactly one row was cancelled, it belongs to the person whose invitation was revoked,
        // and its payload names that invitation. Matched as text rather than through
        // `SurveyNotificationData.InvitationIdOrNull` -- the function `UnsentMailForAsync` uses to
        // decide -- so a break in that reader cannot move the expectation and the outcome
        // together and leave this green.
        var cancelled = Assert.Single(statuses, row => row.Status == NotificationStatuses.Cancelled);
        Assert.Equal(employeeId, cancelled.UserId);
        Assert.Contains(
            revokedInvitationId.ToString(), cancelled.Data ?? string.Empty, StringComparison.OrdinalIgnoreCase);
        Assert.Equal(2, statuses.Count(row => row.Status == NotificationStatuses.Sent));
    }

    /// <summary>
    /// <b>#383, the retry budget decides which <c>failed</c> rows are cancelled.</b>
    ///
    /// <para>
    /// A <c>failed</c> notification with retries left is still going to be mailed -- the sweep
    /// selects on <c>NotificationStatuses.Retryable</c>, which includes it -- so a revoke has to
    /// cancel it exactly as it cancels a <c>pending</c> one. A <c>failed</c> row that has burned
    /// its budget is a dead letter no sweep will touch again; rewriting it to <c>cancelled</c>
    /// stops nothing and drops it out of <c>GET /notifications?status=failed</c>, erasing the
    /// record that the product tried to reach this person and could not.
    /// </para>
    /// <para>
    /// The two rows differ only in <c>RetryCount</c>. Both were queued by the real endpoint, so
    /// their <c>data</c> payload is the producer's; only the delivery outcome -- which is what
    /// this test is about and not what it trusts -- is set here, because the capturing transport
    /// in this class always succeeds.
    /// </para>
    /// </summary>
    [Fact]
    public async Task A_revoke_cancels_a_failed_notification_with_retries_left_and_spares_a_dead_letter()
    {
        var client = await AdminAsync();
        var survey = await CreateActiveSurveyAsync(client);
        var (retryableId, retryableEmail) = await SeedEmployeeAsync();
        var (deadLetterId, deadLetterEmail) = await SeedEmployeeAsync();

        (await client.PostAsJsonAsync(
            $"/surveys/{survey.Id}/invitations",
            new CreateSurveyInvitationsRequest(UserIds: [retryableId, deadLetterId]))).EnsureSuccessStatusCode();

        const string ProviderReason = "The provider returned a temporary error.";
        var failedAt = DateTimeOffset.UtcNow.AddHours(-1);
        await _harness.WithDbAsync(async db =>
        {
            foreach (var notification in await db.Notifications
                         .Where(n => n.UserId == retryableId || n.UserId == deadLetterId)
                         .ToListAsync())
            {
                notification.Status = NotificationStatuses.Failed;
                notification.FailedAt = failedAt;
                notification.FailureReason = ProviderReason;
                notification.RetryCount = notification.UserId == deadLetterId ? notification.MaxRetries : 1;
            }

            await db.SaveChangesAsync();
        });

        var invitationIds = await _harness.WithDbAsync(db => db.SurveyInvitations
            .AsNoTracking()
            .Where(i => i.SurveyId == survey.Id)
            .Select(i => new { i.Id, i.UserId })
            .ToListAsync());

        var revokedAt = DateTimeOffset.UtcNow;
        foreach (var invitation in invitationIds)
        {
            (await client.PostAsync(
                $"/surveys/{survey.Id}/invitations/{invitation.Id}/revoke", null)).EnsureSuccessStatusCode();
        }

        var rows = await _harness.WithDbAsync(db => db.Notifications
            .AsNoTracking()
            .Where(n => n.UserId == retryableId || n.UserId == deadLetterId)
            .ToDictionaryAsync(n => n.UserId));

        // Retries left, so the sweep would have come back for it: cancelled.
        Assert.Equal(NotificationStatuses.Cancelled, rows[retryableId].Status);

        // ...and it keeps the timestamp of the failure it really had. A cancellation is a
        // decision, not a failure, so the revoke neither rewrites that timestamp nor invents one.
        Assert.NotNull(rows[retryableId].FailedAt);
        Assert.True(
            rows[retryableId].FailedAt < revokedAt,
            $"failed_at was rewritten by the revoke: {rows[retryableId].FailedAt:O}");

        // Out of budget, so it was never going anywhere: left as the failure it was, reason and
        // all.
        Assert.Equal(NotificationStatuses.Failed, rows[deadLetterId].Status);
        Assert.Equal(ProviderReason, rows[deadLetterId].FailureReason);

        // And neither is mailed by a subsequent sweep -- the dead letter because it is out of
        // retries, the other because it is cancelled.
        var sweep = await SweepAsync(client);
        Assert.Equal(0, sweep.Sent);
        Assert.Empty(_mail.Mailbox.To(retryableEmail));
        Assert.Empty(_mail.Mailbox.To(deadLetterEmail));
    }

    /// <summary>
    /// <b>#383, the other type named in the issue's own sentence.</b> "Cancel the still-<c>pending</c>
    /// <c>survey_invitation</c> / <c>survey_reminder</c> notifications" -- and the reminder is the
    /// row most likely to be outstanding when somebody revokes, because it is raised days after
    /// the invitation went out, by a worker, at a moment no administrator chose.
    ///
    /// <para>
    /// Narrowing the candidate filter to <c>survey_invitation</c> alone leaves every other test in
    /// this class green: they all queue their rows through <c>POST /surveys/{id}/invitations</c>,
    /// which only ever produces that one type. This is the test that fails instead.
    /// </para>
    /// <para>
    /// The reminder is raised by <c>InvitationReminderJob.RunAsync</c> -- the producer
    /// <c>Jobs.cs</c> ticks in the Workers host -- and never hand-written: the type filter is what
    /// is under test, and a row this test typed out itself would prove only that the filter
    /// matches a string this test chose.
    /// </para>
    /// </summary>
    [Fact]
    public async Task A_revoke_cancels_the_reminder_a_worker_queued_and_not_just_the_invitation()
    {
        var client = await AdminAsync();
        var survey = await CreateActiveSurveyAsync(client);
        var (employeeId, employeeEmail) = await SeedEmployeeAsync();

        var invited = await client.PostAsJsonAsync(
            $"/surveys/{survey.Id}/invitations", new CreateSurveyInvitationsRequest(UserIds: [employeeId]));
        invited.EnsureSuccessStatusCode();
        var invitationId = (await invited.Content.ReadFromJsonAsync<SurveyInvitationBatchResult>())!.InvitationIds[0];

        // The invitation itself goes out first, exactly as it would have. This test is about the
        // message queued AFTERWARDS, so from here on the mailbox count is the whole assertion.
        Assert.Equal(1, (await SweepAsync(client)).Sent);
        Assert.Single(_mail.Mailbox.To(employeeEmail));

        // Age the contact past the reminder cadence so the worker finds this invitation due.
        await _harness.WithDbAsync(async db =>
        {
            var invitation = await db.SurveyInvitations.FirstAsync(i => i.Id == invitationId);
            invitation.SentAt = DateTimeOffset.UtcNow.AddDays(-30);
            invitation.Status = SurveyInvitationStatuses.Sent;
            await db.SaveChangesAsync();
        });

        using (var scope = _factory.Services.CreateScope())
        {
            var raised = await InvitationReminderJob.RunAsync(
                scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>(),
                scope.ServiceProvider.GetRequiredService<ILoggerFactory>(),
                DateTimeOffset.UtcNow,
                InvitationReminderJob.DefaultBatchSize,
                CancellationToken.None);
            Assert.True(raised.Raised >= 1, "the reminder job raised nothing, so this test would be vacuous");
        }

        var queued = await _harness.WithDbAsync(db => db.Notifications
            .AsNoTracking()
            .FirstAsync(n => n.UserId == employeeId && n.Type == NotificationTypes.SurveyReminder));
        Assert.Equal(NotificationStatuses.Pending, queued.Status);

        // The producer's own payload names this invitation. Asserted as text rather than through
        // the reader the endpoint uses, so this precondition cannot agree with the code under test
        // by sharing its bug.
        Assert.Contains(invitationId.ToString(), queued.Data ?? string.Empty, StringComparison.OrdinalIgnoreCase);

        (await client.PostAsync(
            $"/surveys/{survey.Id}/invitations/{invitationId}/revoke", null)).EnsureSuccessStatusCode();

        var afterRevoke = await SweepAsync(client);
        Assert.Equal(0, afterRevoke.Sent);

        // Still exactly one message: the invitation that went before the revoke. The reminder
        // never reached a transport.
        Assert.Single(_mail.Mailbox.To(employeeEmail));

        var reminder = await _harness.WithDbAsync(db => db.Notifications
            .AsNoTracking()
            .FirstAsync(n => n.UserId == employeeId && n.Type == NotificationTypes.SurveyReminder));
        Assert.Equal(NotificationStatuses.Cancelled, reminder.Status);
        Assert.Null(reminder.SentAt);
    }

    /// <summary>
    /// <b>#383, the rows this change arrives too late for.</b> Every invitation revoked before
    /// this behaviour existed still sits beside a live <c>pending</c> notification, and there is
    /// no data migration here: revoking again is the entire remedy. So the cancellation has to
    /// run on an invitation that is <i>already</i> revoked -- the branch where the status flip is
    /// a no-op and the cancellation is the only thing left to do, and the one branch every other
    /// test in this class skips because it always revokes something live.
    ///
    /// <para>
    /// The same remedy is the only one available for the race named on
    /// <c>RevokeInvitationAsync</c>, where the reminder worker reads an invitation moments before
    /// it is revoked and inserts the reminder moments after. That window cannot be driven
    /// deterministically from a test; the state it leaves behind is exactly the state below.
    /// </para>
    /// <para>
    /// Produced the way production produced it. The notification is the real endpoint's; the
    /// revoke that left it behind is replayed as the old code performed it -- status, expiry and
    /// stamp, and not a word said to the notifications table.
    /// </para>
    /// </summary>
    [Fact]
    public async Task Revoking_an_already_revoked_invitation_cancels_mail_the_first_revoke_left_behind()
    {
        var client = await AdminAsync();
        var survey = await CreateActiveSurveyAsync(client);
        var (employeeId, employeeEmail) = await SeedEmployeeAsync();

        var invited = await client.PostAsJsonAsync(
            $"/surveys/{survey.Id}/invitations", new CreateSurveyInvitationsRequest(UserIds: [employeeId]));
        invited.EnsureSuccessStatusCode();
        var invitationId = (await invited.Content.ReadFromJsonAsync<SurveyInvitationBatchResult>())!.InvitationIds[0];

        // The revoke as it behaved before this fix: the invitation is closed and the queued mail
        // is not mentioned.
        var revokedAt = DateTimeOffset.UtcNow;
        await _harness.WithDbAsync(async db =>
        {
            var invitation = await db.SurveyInvitations.FirstAsync(i => i.Id == invitationId);
            invitation.Status = SurveyInvitationStatuses.Revoked;
            invitation.ExpiresAt = revokedAt;
            invitation.UpdatedAt = revokedAt;
            await db.SaveChangesAsync();
        });

        // The state an upgrade inherits, stated rather than assumed: revoked, and still going to
        // be mailed.
        Assert.Equal(
            NotificationStatuses.Pending,
            await _harness.WithDbAsync(db => db.Notifications
                .AsNoTracking().Where(n => n.UserId == employeeId).Select(n => n.Status).FirstAsync()));

        // The only move an administrator has: revoke it again.
        var again = await client.PostAsync($"/surveys/{survey.Id}/invitations/{invitationId}/revoke", null);
        again.EnsureSuccessStatusCode();

        // It is still revoked -- and now its mail is cancelled too.
        var detail = (await again.Content.ReadFromJsonAsync<SurveyInvitationDetail>())!;
        Assert.Equal(SurveyInvitationStatuses.Revoked, detail.Status);

        var repaired = await _harness.WithDbAsync(db => db.Notifications
            .AsNoTracking().FirstAsync(n => n.UserId == employeeId));
        Assert.Equal(NotificationStatuses.Cancelled, repaired.Status);

        // The assertion that matters: the sweep that would have mailed it does not.
        Assert.Equal(0, (await SweepAsync(client)).Sent);
        Assert.Empty(_mail.Mailbox.To(employeeEmail));
    }

    /// <summary>
    /// <b>#383, the limit of what a revoke may cancel.</b> A <c>survey_invitation</c> notification
    /// whose <c>data</c> names no invitation is a message this product still sends -- it degrades
    /// to the link-less mail, which <see cref="SurveyNotificationData"/> documents and
    /// <c>A_notification_that_is_not_about_a_survey_gets_no_link</c> pins. Nothing about it is
    /// about the invitation being revoked, so a revoke must leave it exactly where it is.
    ///
    /// <para>
    /// Widening the payload match to "or names nothing" is a one-token change that no other test
    /// in this class can see, and it would silently suppress an unrelated message every time an
    /// administrator revoked anything for the same person.
    /// </para>
    /// <para>
    /// The row is written by <c>POST /notifications</c>, which is the product's real path for a
    /// hand-addressed message and is named on <see cref="SurveyNotificationData"/> as the reason
    /// payload-less survey mail exists at all. Dated forward so it is still queued when the revoke
    /// lands, then delivered by the real sweep at the moment it comes due.
    /// </para>
    /// </summary>
    [Fact]
    public async Task A_revoke_leaves_survey_mail_that_names_no_invitation_alone()
    {
        var client = await AdminAsync();
        var survey = await CreateActiveSurveyAsync(client);
        var (employeeId, employeeEmail) = await SeedEmployeeAsync();

        var invited = await client.PostAsJsonAsync(
            $"/surveys/{survey.Id}/invitations", new CreateSurveyInvitationsRequest(UserIds: [employeeId]));
        invited.EnsureSuccessStatusCode();
        var invitationId = (await invited.Content.ReadFromJsonAsync<SurveyInvitationBatchResult>())!.InvitationIds[0];

        var dueAt = DateTimeOffset.UtcNow.AddDays(2);
        var posted = await client.PostAsJsonAsync("/notifications", new CreateNotificationRequest(
            UserId: employeeId,
            CompanyId: _companyId,
            Type: NotificationTypes.SurveyInvitation,
            Channel: NotificationChannels.Email,
            Priority: NotificationPriorities.Default,
            Title: "A word about the survey programme",
            Message: "No link, and nothing to do with any one invitation.",
            Data: null,
            ScheduledFor: dueAt));
        posted.EnsureSuccessStatusCode();
        var hand = (await posted.Content.ReadFromJsonAsync<NotificationDetail>())!;
        Assert.Equal(NotificationStatuses.Pending, hand.Status);
        Assert.Null(hand.Data);

        (await client.PostAsync(
            $"/surveys/{survey.Id}/invitations/{invitationId}/revoke", null)).EnsureSuccessStatusCode();

        // The invitation's own mail is cancelled; the message that named no invitation is not.
        var rows = await _harness.WithDbAsync(db => db.Notifications
            .AsNoTracking().Where(n => n.UserId == employeeId).ToDictionaryAsync(n => n.Id));
        Assert.Equal(2, rows.Count);
        Assert.Equal(NotificationStatuses.Pending, rows[hand.Id].Status);
        Assert.Single(rows.Values, n => n.Status == NotificationStatuses.Cancelled);

        // ...and it is still delivered when it comes due, which is the part a status alone does
        // not prove.
        using (var scope = _factory.Services.CreateScope())
        {
            var swept = await NotificationDelivery.ProcessDueAsync(
                scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>(),
                scope.ServiceProvider.GetRequiredService<INotificationSender>(),
                scope.ServiceProvider.GetRequiredService<ILoggerFactory>(),
                _companyId,
                dueAt.AddMinutes(1),
                NotificationDelivery.DefaultBatchSize,
                CancellationToken.None);

            Assert.Equal(1, swept.Attempted);
            Assert.Equal(1, swept.Sent);
        }

        var message = Assert.Single(_mail.Mailbox.To(employeeEmail));
        Assert.Contains("No link, and nothing to do with any one invitation.", message.TextBody, StringComparison.Ordinal);
        Assert.DoesNotContain(SurveyAccessTokens.InvitationLinkPrefix, message.TextBody, StringComparison.Ordinal);
    }

    /// <summary>
    /// <b>#383, across a tenant boundary.</b> The candidate query is scoped to the invitation's
    /// company as well as its recipient, and only a re-homed employee can tell the two apart: an
    /// invitation minted by a former employer keeps that employer's <c>company_id</c>, while the
    /// same person now receives mail under their new one.
    ///
    /// <para>
    /// Delete the tenancy clause and every other test in this class stays green, because every
    /// other test lives in one company. What changes is this: the former employer's revoke reaches
    /// into the new employer's queue and cancels a message that company composed, about a survey
    /// the revoking administrator cannot see. One tenant's click, another tenant's row.
    /// </para>
    /// <para>
    /// The re-homing itself is a direct write for the reason
    /// <c>A_re_homed_employees_previous_tenant_token_is_not_mailed_by_their_new_tenant</c> gives:
    /// nothing in <c>src/</c> moves a user between companies yet. Both notifications are written
    /// by real endpoints, and the mail that is allowed through carries no token -- so letting it
    /// go is not a disclosure, it is this tenant's message being left to this tenant.
    /// </para>
    /// </summary>
    [Fact]
    public async Task A_revoke_does_not_cancel_the_same_persons_queued_mail_in_another_tenant()
    {
        var formerCompanyId = await _harness.SeedCompanyAsync("Mail Link Prior Co");
        var formerAdmin = await _harness.ClientAsync(Roles.CompanyAdmin, formerCompanyId);

        var employeeId = await _harness.WithDbAsync(async db =>
        {
            var user = new User
            {
                Id = Guid.NewGuid(),
                CompanyId = formerCompanyId,
                Email = $"{Guid.NewGuid():N}@rehomed-revoke.test",
                Name = "Rehomed",
                Role = Roles.Employee,
                IsActive = true,
                CreatedAt = DateTimeOffset.UtcNow,
                UpdatedAt = DateTimeOffset.UtcNow,
            };
            db.Users.Add(user);
            await db.SaveChangesAsync();
            return user.Id;
        });

        var formerSurvey = await SurveyTestHarness.CreateSurveyAsync(
            formerAdmin, SurveyTestHarness.MinimalRequest(formerCompanyId));
        (await SurveyTestHarness.SetStatusAsync(formerAdmin, formerSurvey.Id, SurveyStatuses.Active))
            .EnsureSuccessStatusCode();

        var invited = await formerAdmin.PostAsJsonAsync(
            $"/surveys/{formerSurvey.Id}/invitations", new CreateSurveyInvitationsRequest(UserIds: [employeeId]));
        invited.EnsureSuccessStatusCode();
        var oldInvitationId = (await invited.Content.ReadFromJsonAsync<SurveyInvitationBatchResult>())!.InvitationIds[0];

        // The employee moves here. The old invitation row is untouched: its user_id still names
        // them, its company_id still names their former employer.
        var employeeEmail = await _harness.WithDbAsync(async db =>
        {
            var user = await db.Users.FirstAsync(u => u.Id == employeeId);
            user.CompanyId = _companyId;
            user.UpdatedAt = DateTimeOffset.UtcNow;
            await db.SaveChangesAsync();
            return user.Email;
        });

        // Their new employer queues survey mail for them that names the old invitation -- the one
        // shape of row that passes every predicate except tenancy.
        var dueAt = DateTimeOffset.UtcNow.AddDays(2);
        var posted = await (await AdminAsync()).PostAsJsonAsync("/notifications", new CreateNotificationRequest(
            UserId: employeeId,
            CompanyId: _companyId,
            Type: NotificationTypes.SurveyInvitation,
            Channel: NotificationChannels.Email,
            Priority: NotificationPriorities.Default,
            Title: "Your survey",
            Message: "Please respond.",
            Data: SurveyNotificationData.Serialize(formerSurvey.Id, oldInvitationId),
            ScheduledFor: dueAt));
        posted.EnsureSuccessStatusCode();
        var newTenantRowId = (await posted.Content.ReadFromJsonAsync<NotificationDetail>())!.Id;

        // The FORMER employer revokes their own invitation.
        (await formerAdmin.PostAsync(
            $"/surveys/{formerSurvey.Id}/invitations/{oldInvitationId}/revoke", null)).EnsureSuccessStatusCode();

        var rows = await _harness.WithDbAsync(db => db.Notifications
            .AsNoTracking().Where(n => n.UserId == employeeId).ToDictionaryAsync(n => n.Id));
        Assert.Equal(2, rows.Count);

        // Their former tenant's queued mail: cancelled, which is the whole point of the fix.
        Assert.Equal(
            NotificationStatuses.Cancelled,
            Assert.Single(rows.Values, n => n.CompanyId == formerCompanyId).Status);

        // The other tenant's: untouched, and still delivered when it comes due.
        Assert.Equal(NotificationStatuses.Pending, rows[newTenantRowId].Status);

        using (var scope = _factory.Services.CreateScope())
        {
            var swept = await NotificationDelivery.ProcessDueAsync(
                scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>(),
                scope.ServiceProvider.GetRequiredService<INotificationSender>(),
                scope.ServiceProvider.GetRequiredService<ILoggerFactory>(),
                _companyId,
                dueAt.AddMinutes(1),
                NotificationDelivery.DefaultBatchSize,
                CancellationToken.None);

            Assert.Equal(1, swept.Sent);
        }

        // Delivered, and carrying nothing: the revoked invitation has no live token to resolve,
        // which is what makes leaving this row alone safe rather than merely correct.
        var message = Assert.Single(_mail.Mailbox.To(employeeEmail));
        Assert.DoesNotContain(SurveyAccessTokens.InvitationLinkPrefix, message.TextBody, StringComparison.Ordinal);
        Assert.DoesNotContain(SurveyAccessTokens.InvitationLinkPrefix, message.HtmlBody, StringComparison.Ordinal);
    }

    /// <summary>
    /// <b>#383, what the cancelled row says about itself.</b> <c>cancelled</c> means a decision was
    /// taken, not that anything went wrong, and <c>GET /notifications</c> is where a human reads
    /// the difference. So the row acquires a reason and a fresh stamp, and it does <b>not</b>
    /// acquire a <c>failedAt</c>: a message that never failed must not appear in an operator's
    /// console as one that did.
    ///
    /// <para>
    /// Both halves are one-token changes to <c>CancelUnsentMail</c> that nothing else here can
    /// see -- no other test in this class reads either timestamp on a cancelled row -- and the
    /// <c>failedAt</c> half is visible to every administrator through the list endpoint, which is
    /// why that half is asserted on the rendered response rather than on the row.
    /// </para>
    /// </summary>
    [Fact]
    public async Task A_cancelled_message_is_stamped_as_a_decision_and_not_as_a_failure()
    {
        var client = await AdminAsync();
        var survey = await CreateActiveSurveyAsync(client);
        var (employeeId, _) = await SeedEmployeeAsync();

        var invited = await client.PostAsJsonAsync(
            $"/surveys/{survey.Id}/invitations", new CreateSurveyInvitationsRequest(UserIds: [employeeId]));
        invited.EnsureSuccessStatusCode();
        var invitationId = (await invited.Content.ReadFromJsonAsync<SurveyInvitationBatchResult>())!.InvitationIds[0];

        var queued = await _harness.WithDbAsync(db => db.Notifications
            .AsNoTracking().FirstAsync(n => n.UserId == employeeId));
        Assert.Null(queued.FailedAt);

        (await client.PostAsync(
            $"/surveys/{survey.Id}/invitations/{invitationId}/revoke", null)).EnsureSuccessStatusCode();

        var cancelled = await _harness.WithDbAsync(db => db.Notifications
            .AsNoTracking().FirstAsync(n => n.UserId == employeeId));
        Assert.Equal(NotificationStatuses.Cancelled, cancelled.Status);

        // The revoke moved the row, and the row records when.
        Assert.True(
            cancelled.UpdatedAt > queued.UpdatedAt,
            $"updated_at did not move: still {cancelled.UpdatedAt:O}");

        // What the administrator sees. Not a failure, and it says why.
        var listed = await client.GetFromJsonAsync<NotificationListResponse>(
            $"/notifications?companyId={_companyId}");
        var detail = Assert.Single(listed!.Notifications, n => n.Id == cancelled.Id);
        Assert.Equal(NotificationStatuses.Cancelled, detail.Status);
        Assert.Null(detail.FailedAt);
        Assert.False(string.IsNullOrWhiteSpace(detail.FailureReason));
    }

    /// <summary>
    /// <b>#383, decision 2.</b> Revoking the <i>distribution link</i> is a different operation
    /// on a different row, and it cancels nothing.
    ///
    /// <para>
    /// The share link lives on <c>survey_distributions.public_url</c> and this product never
    /// mails it: the only URL any notification carries is <c>/survey-invitations/{token}</c>,
    /// resolved from the <c>survey_invitations</c> row that <c>notifications.data</c> names. So
    /// there is no queued message that becomes wrong when the link dies -- and cancelling a
    /// whole survey's invitation mail because its public link was withdrawn would un-invite
    /// everybody over an unrelated decision.
    /// </para>
    /// <para>
    /// Pinned rather than reasoned about, because "revoke" appearing in both route names is
    /// exactly the resemblance that invites somebody to make the two behave alike.
    /// </para>
    /// </summary>
    [Fact]
    public async Task Revoking_the_public_distribution_link_does_not_cancel_anybodys_invitation_mail()
    {
        var client = await AdminAsync();
        var survey = await CreateActiveSurveyAsync(client);
        var (employeeId, employeeEmail) = await SeedEmployeeAsync();

        var distribution = await client.PutAsJsonAsync(
            $"/surveys/{survey.Id}/distribution",
            new UpsertSurveyDistributionRequest(AccessType: SurveyAccessTypes.Public));
        distribution.EnsureSuccessStatusCode();
        Assert.NotNull((await distribution.Content.ReadFromJsonAsync<SurveyDistributionDetail>())!.PublicLink);

        (await client.PostAsJsonAsync(
            $"/surveys/{survey.Id}/invitations",
            new CreateSurveyInvitationsRequest(UserIds: [employeeId]))).EnsureSuccessStatusCode();

        var killed = await client.PostAsync($"/surveys/{survey.Id}/distribution/link/revoke", null);
        killed.EnsureSuccessStatusCode();
        Assert.Null((await killed.Content.ReadFromJsonAsync<SurveyDistributionDetail>())!.PublicLink);

        // The invitation still goes out, and it still carries this invitee's own token -- which
        // is not the link that was revoked and never was.
        Assert.Equal(1, (await SweepAsync(client)).Sent);

        var token = await _harness.WithDbAsync(db => db.SurveyInvitations
            .AsNoTracking()
            .Where(i => i.SurveyId == survey.Id && i.UserId == employeeId)
            .Select(i => i.InvitationToken)
            .FirstAsync());
        var message = Assert.Single(_mail.Mailbox.To(employeeEmail));
        Assert.Contains(
            $"{CapturingMailHostFixture.AppBaseUrl}/survey-invitations/{token}",
            message.TextBody,
            StringComparison.Ordinal);

        Assert.Equal(
            NotificationStatuses.Sent,
            await _harness.WithDbAsync(db => db.Notifications
                .AsNoTracking().Where(n => n.UserId == employeeId).Select(n => n.Status).FirstAsync()));
    }

    /// <summary>
    /// <b>G4.</b> A notification that is not about a survey is unchanged: no link, and the
    /// composer's other output identical to what it always produced.
    /// </summary>
    [Fact]
    public async Task A_notification_that_is_not_about_a_survey_gets_no_link()
    {
        var client = await AdminAsync();
        var (employeeId, employeeEmail) = await SeedEmployeeAsync();

        // POST /notifications delivers a due notification inline (DeliverIfDueAsync), so this
        // needs no sweep -- and it exercises the OTHER of the two paths that reach the sender,
        // which is worth having: the invitation tests above all go through /notifications/process.
        var created = await client.PostAsJsonAsync("/notifications", new CreateNotificationRequest(
            UserId: employeeId,
            CompanyId: _companyId,
            Type: NotificationTypes.SystemNotification,
            Channel: NotificationChannels.Email,
            Priority: NotificationPriorities.Default,
            Title: "Scheduled maintenance",
            Message: "The platform will be briefly unavailable on Sunday."));
        created.EnsureSuccessStatusCode();

        var detail = await created.Content.ReadFromJsonAsync<NotificationDetail>();
        Assert.Equal(NotificationStatuses.Sent, detail!.Status);

        var message = Assert.Single(_mail.Mailbox.To(employeeEmail));
        Assert.DoesNotContain(SurveyAccessTokens.InvitationLinkPrefix, message.TextBody, StringComparison.Ordinal);
        Assert.DoesNotContain(SurveyAccessTokens.InvitationLinkPrefix, message.HtmlBody, StringComparison.Ordinal);
        Assert.Contains("The platform will be briefly unavailable", message.TextBody, StringComparison.Ordinal);
    }

    // ------------------------------------------------------------------
    // The exfiltration primitive, and the scope that closes it
    // ------------------------------------------------------------------

    /// <summary>
    /// <b>The exploit, same tenant.</b> `POST /notifications` writes `data` verbatim, so a
    /// CompanyAdmin may choose which invitation id the sender looks up. Named on its own that
    /// is an exfiltration primitive: point a `survey_invitation` at a colleague's invitation,
    /// address it to yourself, and the sender resolves THEIR token and mails it to YOU -- after
    /// which you open their survey as them.
    ///
    /// <para>
    /// This is the capability the producer-side design removed when it kept tokens out of
    /// `data`. Re-admitting it through the lookup key would have undone the whole point, and
    /// the class docs' claim that no payload can change the URL's host or shape is true and
    /// beside the point: the attacker was never changing the shape, only whose token was in it.
    /// </para>
    /// </summary>
    [Fact]
    public async Task An_admin_cannot_have_another_employees_token_mailed_to_themselves()
    {
        var client = await AdminAsync();
        var survey = await CreateActiveSurveyAsync(client);
        var (victimId, _) = await SeedEmployeeAsync();
        var (attackerId, attackerEmail) = await SeedEmployeeAsync();

        var invited = await client.PostAsJsonAsync(
            $"/surveys/{survey.Id}/invitations", new CreateSurveyInvitationsRequest(UserIds: [victimId]));
        invited.EnsureSuccessStatusCode();
        var victimInvitationId = (await invited.Content.ReadFromJsonAsync<SurveyInvitationBatchResult>())!.InvitationIds[0];

        var victimToken = await _harness.WithDbAsync(db => db.SurveyInvitations
            .AsNoTracking().Where(i => i.Id == victimInvitationId).Select(i => i.InvitationToken).FirstAsync());

        // The attack: the attacker's own user, the attacker's own company -- both of which
        // CanAccessCompany happily authorises -- and the VICTIM's invitation id in `data`.
        var posted = await client.PostAsJsonAsync("/notifications", new CreateNotificationRequest(
            UserId: attackerId,
            CompanyId: _companyId,
            Type: NotificationTypes.SurveyInvitation,
            Channel: NotificationChannels.Email,
            Priority: NotificationPriorities.Default,
            Title: "Your survey",
            Message: "Please respond.",
            Data: SurveyNotificationData.Serialize(survey.Id, victimInvitationId)));
        posted.EnsureSuccessStatusCode();

        // The mail is delivered -- the attack does not fail loudly, which is exactly why this
        // needs asserting on the body rather than on a status.
        var message = Assert.Single(_mail.Mailbox.To(attackerEmail));
        Assert.Equal(NotificationStatuses.Sent, (await posted.Content.ReadFromJsonAsync<NotificationDetail>())!.Status);

        // ...and it carries nothing the attacker can use.
        Assert.DoesNotContain(victimToken, message.TextBody, StringComparison.Ordinal);
        Assert.DoesNotContain(victimToken, message.HtmlBody, StringComparison.Ordinal);
        Assert.DoesNotContain(SurveyAccessTokens.InvitationLinkPrefix, message.TextBody, StringComparison.Ordinal);
        Assert.DoesNotContain(SurveyAccessTokens.InvitationLinkPrefix, message.HtmlBody, StringComparison.Ordinal);

        // The victim's invitation is untouched and still theirs -- the attempt neither
        // consumed nor revoked it.
        Assert.Equal(victimToken, await _harness.WithDbAsync(db => db.SurveyInvitations
            .AsNoTracking().Where(i => i.Id == victimInvitationId).Select(i => i.InvitationToken).FirstAsync()));
    }

    /// <summary>
    /// <b>The exploit, across tenants.</b> The same attack aimed at another company's
    /// invitation.
    ///
    /// <para>
    /// <b>Which predicate stops this one, stated honestly.</b> The recipient predicate does --
    /// the victim is a different user, so the row fails to match before tenancy is even
    /// consulted. Removing the company predicate leaves this test green, which was measured
    /// rather than assumed. It is kept anyway because it is the attack somebody will actually
    /// try, and a defence that holds for the reason next to it is worth pinning; the case where
    /// tenancy is the ONLY thing standing in the way is the re-homing test below.
    /// </para>
    /// </summary>
    [Fact]
    public async Task An_admin_cannot_have_another_TENANTS_token_mailed_to_themselves()
    {
        // A second tenant, with its own admin, its own survey and its own invitee.
        var otherCompanyId = await _harness.SeedCompanyAsync("Mail Link Victim Co");
        var otherAdmin = await _harness.ClientAsync(Roles.CompanyAdmin, otherCompanyId);

        var victimId = await _harness.WithDbAsync(async db =>
        {
            var user = new User
            {
                Id = Guid.NewGuid(),
                CompanyId = otherCompanyId,
                Email = $"{Guid.NewGuid():N}@victim.test",
                Name = "Victim",
                Role = Roles.Employee,
                IsActive = true,
                CreatedAt = DateTimeOffset.UtcNow,
                UpdatedAt = DateTimeOffset.UtcNow,
            };
            db.Users.Add(user);
            await db.SaveChangesAsync();
            return user.Id;
        });

        var otherSurvey = await SurveyTestHarness.CreateSurveyAsync(
            otherAdmin, SurveyTestHarness.MinimalRequest(otherCompanyId));
        (await SurveyTestHarness.SetStatusAsync(otherAdmin, otherSurvey.Id, SurveyStatuses.Active))
            .EnsureSuccessStatusCode();

        var invited = await otherAdmin.PostAsJsonAsync(
            $"/surveys/{otherSurvey.Id}/invitations", new CreateSurveyInvitationsRequest(UserIds: [victimId]));
        invited.EnsureSuccessStatusCode();
        var victimInvitationId = (await invited.Content.ReadFromJsonAsync<SurveyInvitationBatchResult>())!.InvitationIds[0];
        var victimToken = await _harness.WithDbAsync(db => db.SurveyInvitations
            .AsNoTracking().Where(i => i.Id == victimInvitationId).Select(i => i.InvitationToken).FirstAsync());

        // Tenant A's admin, addressing tenant A's own employee, naming tenant B's invitation.
        var client = await AdminAsync();
        var (attackerId, attackerEmail) = await SeedEmployeeAsync();

        var posted = await client.PostAsJsonAsync("/notifications", new CreateNotificationRequest(
            UserId: attackerId,
            CompanyId: _companyId,
            Type: NotificationTypes.SurveyInvitation,
            Channel: NotificationChannels.Email,
            Priority: NotificationPriorities.Default,
            Title: "Your survey",
            Message: "Please respond.",
            Data: SurveyNotificationData.Serialize(otherSurvey.Id, victimInvitationId)));
        posted.EnsureSuccessStatusCode();

        var message = Assert.Single(_mail.Mailbox.To(attackerEmail));
        Assert.DoesNotContain(victimToken, message.TextBody, StringComparison.Ordinal);
        Assert.DoesNotContain(victimToken, message.HtmlBody, StringComparison.Ordinal);
        Assert.DoesNotContain(SurveyAccessTokens.InvitationLinkPrefix, message.TextBody, StringComparison.Ordinal);
    }

    /// <summary>
    /// <b>The case the tenancy predicate is actually for: an employee who moved companies.</b>
    ///
    /// <para>
    /// `survey_invitations.company_id` is the SURVEY's tenant, frozen when the row was minted,
    /// and `users.company_id` is where that person is now. They agree at mint time and diverge
    /// the moment somebody is re-homed -- which leaves a live invitation whose `user_id` points
    /// at an employee of a DIFFERENT tenant. Scoped only by recipient, the new tenant's admin
    /// could then have the old tenant's token mailed out, because the row genuinely does belong
    /// to that user. Only `company_id` separates the two.
    /// </para>
    /// <para>
    /// <b>Unreachable through the product today, and kept anyway.</b> Nothing in <c>src/</c>
    /// writes <c>User.CompanyId</c> after creation -- <c>UpdateUserRequest</c> has no such
    /// field -- so this test manufactures the state with a direct write, and the mail it blocks
    /// would land in the employee's OWN mailbox carrying their OWN token, which is not a
    /// disclosure to the admin who sent it. So this is defence-in-depth, not a live hole: the
    /// predicate is here so that adding a re-homing feature later cannot silently open one, and
    /// this test is what makes the predicate fail a build if it is ever deleted. Claiming more
    /// than that would be overselling it.
    /// </para>
    /// </summary>
    [Fact]
    public async Task A_re_homed_employees_previous_tenant_token_is_not_mailed_by_their_new_tenant()
    {
        // The former tenant: its own survey, and an invitation minted for the employee while
        // they still worked there.
        var formerCompanyId = await _harness.SeedCompanyAsync("Mail Link Former Co");
        var formerAdmin = await _harness.ClientAsync(Roles.CompanyAdmin, formerCompanyId);

        var employeeId = await _harness.WithDbAsync(async db =>
        {
            var user = new User
            {
                Id = Guid.NewGuid(),
                CompanyId = formerCompanyId,
                Email = $"{Guid.NewGuid():N}@rehomed.test",
                Name = "Rehomed",
                Role = Roles.Employee,
                IsActive = true,
                CreatedAt = DateTimeOffset.UtcNow,
                UpdatedAt = DateTimeOffset.UtcNow,
            };
            db.Users.Add(user);
            await db.SaveChangesAsync();
            return user.Id;
        });

        var formerSurvey = await SurveyTestHarness.CreateSurveyAsync(
            formerAdmin, SurveyTestHarness.MinimalRequest(formerCompanyId));
        (await SurveyTestHarness.SetStatusAsync(formerAdmin, formerSurvey.Id, SurveyStatuses.Active))
            .EnsureSuccessStatusCode();

        var invited = await formerAdmin.PostAsJsonAsync(
            $"/surveys/{formerSurvey.Id}/invitations", new CreateSurveyInvitationsRequest(UserIds: [employeeId]));
        invited.EnsureSuccessStatusCode();
        var oldInvitationId = (await invited.Content.ReadFromJsonAsync<SurveyInvitationBatchResult>())!.InvitationIds[0];

        var oldToken = await _harness.WithDbAsync(db => db.SurveyInvitations
            .AsNoTracking().Where(i => i.Id == oldInvitationId).Select(i => i.InvitationToken).FirstAsync());

        // The employee moves to this test class's company. The old invitation row is untouched:
        // its user_id still names them, its company_id still names their former employer.
        var employeeEmail = await _harness.WithDbAsync(async db =>
        {
            var user = await db.Users.FirstAsync(u => u.Id == employeeId);
            user.CompanyId = _companyId;
            user.UpdatedAt = DateTimeOffset.UtcNow;
            await db.SaveChangesAsync();
            return user.Email;
        });

        // Their NEW employer's admin names the OLD invitation. Recipient matches -- the row
        // really is this person's -- so only tenancy can refuse it.
        var client = await AdminAsync();
        var posted = await client.PostAsJsonAsync("/notifications", new CreateNotificationRequest(
            UserId: employeeId,
            CompanyId: _companyId,
            Type: NotificationTypes.SurveyInvitation,
            Channel: NotificationChannels.Email,
            Priority: NotificationPriorities.Default,
            Title: "Your survey",
            Message: "Please respond.",
            Data: SurveyNotificationData.Serialize(formerSurvey.Id, oldInvitationId)));
        posted.EnsureSuccessStatusCode();

        var message = Assert.Single(_mail.Mailbox.To(employeeEmail));
        Assert.DoesNotContain(oldToken, message.TextBody, StringComparison.Ordinal);
        Assert.DoesNotContain(oldToken, message.HtmlBody, StringComparison.Ordinal);
        Assert.DoesNotContain(SurveyAccessTokens.InvitationLinkPrefix, message.TextBody, StringComparison.Ordinal);
        Assert.DoesNotContain(SurveyAccessTokens.InvitationLinkPrefix, message.HtmlBody, StringComparison.Ordinal);
    }

    /// <summary>
    /// <b>The token mailed is the one the notification NAMED.</b>
    ///
    /// <para>
    /// The predicate the whole design was originally keyed on, and the only one that had no
    /// test: every other case here gives its recipient exactly one invitation, so "the row you
    /// asked for" and "this user's first live row in this tenant" are indistinguishable.
    /// Deleting <c>i.Id == invitationId</c> left both suites fully green.
    /// </para>
    /// <para>
    /// The consequence is not a security one -- the scope predicates still confine it to this
    /// person, in this tenant -- it is plain wrongness: an employee invited to two open surveys
    /// receives survey A's link under a subject and body about survey B, and answers the wrong
    /// survey or none. Asserted in BOTH directions from one recipient holding two live
    /// invitations, because with the id predicate gone an unordered <c>FirstOrDefault</c> may
    /// coincidentally return the right row for one of them; it cannot for both.
    /// </para>
    /// </summary>
    [Fact]
    public async Task The_link_names_the_invitation_the_notification_asked_for_not_just_one_of_the_recipients()
    {
        var client = await AdminAsync();
        var (employeeId, employeeEmail) = await SeedEmployeeAsync();

        var first = await CreateActiveSurveyAsync(client);
        var second = await CreateActiveSurveyAsync(client);

        async Task<(Guid InvitationId, string Token)> InviteAsync(Guid surveyId)
        {
            var response = await client.PostAsJsonAsync(
                $"/surveys/{surveyId}/invitations", new CreateSurveyInvitationsRequest(UserIds: [employeeId]));
            response.EnsureSuccessStatusCode();
            var invitationId = (await response.Content.ReadFromJsonAsync<SurveyInvitationBatchResult>())!.InvitationIds[0];
            var token = await _harness.WithDbAsync(db => db.SurveyInvitations
                .AsNoTracking().Where(i => i.Id == invitationId).Select(i => i.InvitationToken).FirstAsync());
            return (invitationId, token);
        }

        var a = await InviteAsync(first.Id);
        var b = await InviteAsync(second.Id);
        Assert.NotEqual(a.Token, b.Token);

        // Both invitations are live, both belong to this employee, both sit in this tenant.
        // Only the id distinguishes them.
        var mailed = new List<string>();
        foreach (var (surveyId, invitation) in new[] { (first.Id, a), (second.Id, b) })
        {
            _mail.Mailbox.Clear();
            (await client.PostAsJsonAsync("/notifications", new CreateNotificationRequest(
                UserId: employeeId,
                CompanyId: _companyId,
                Type: NotificationTypes.SurveyInvitation,
                Channel: NotificationChannels.Email,
                Priority: NotificationPriorities.Default,
                Title: "Your survey",
                Message: "Please respond.",
                Data: SurveyNotificationData.Serialize(surveyId, invitation.InvitationId)))).EnsureSuccessStatusCode();

            var body = Assert.Single(_mail.Mailbox.To(employeeEmail)).TextBody;
            Assert.Contains(
                $"{CapturingMailHostFixture.AppBaseUrl}/survey-invitations/{invitation.Token}",
                body,
                StringComparison.Ordinal);
            mailed.Add(invitation.Token);
        }

        // ...and the two mails did not carry the same link, which is what a lookup that
        // ignored the id would produce.
        Assert.Equal(2, mailed.Distinct(StringComparer.Ordinal).Count());
    }

    /// <summary>
    /// <b>A blank token column is treated as no token, not as a link to nowhere.</b>
    /// <c>FirstOrDefaultAsync</c> gives null for "no row", and the lookup collapses a blank
    /// column into the same answer. Untested, that collapse could be deleted -- `return token;`
    /// passes everything -- and the mail would carry a live-looking button pointing at
    /// <c>/survey-invitations/</c> with nothing after it.
    /// </summary>
    [Fact]
    public async Task A_blank_token_column_produces_no_link_rather_than_a_link_to_nowhere()
    {
        var client = await AdminAsync();
        var survey = await CreateActiveSurveyAsync(client);
        var (employeeId, employeeEmail) = await SeedEmployeeAsync();

        var invited = await client.PostAsJsonAsync(
            $"/surveys/{survey.Id}/invitations", new CreateSurveyInvitationsRequest(UserIds: [employeeId]));
        invited.EnsureSuccessStatusCode();
        var invitationId = (await invited.Content.ReadFromJsonAsync<SurveyInvitationBatchResult>())!.InvitationIds[0];

        await _harness.WithDbAsync(async db =>
        {
            var invitation = await db.SurveyInvitations.FirstAsync(i => i.Id == invitationId);
            invitation.InvitationToken = string.Empty;
            await db.SaveChangesAsync();
        });

        await SweepAsync(client);

        var message = Assert.Single(_mail.Mailbox.To(employeeEmail));
        Assert.DoesNotContain(SurveyAccessTokens.InvitationLinkPrefix, message.TextBody, StringComparison.Ordinal);
        Assert.DoesNotContain(SurveyAccessTokens.InvitationLinkPrefix, message.HtmlBody, StringComparison.Ordinal);
        Assert.DoesNotContain("href=\"\"", message.HtmlBody, StringComparison.Ordinal);
    }

    /// <summary>
    /// <b>A completed invitation still gets its link, and that is the decision rather than an
    /// oversight.</b>
    ///
    /// <para>
    /// The reminder job excludes completed invitations when it plans, but a reminder queued
    /// before the invitee answered and swept afterwards still goes out. Only revocation
    /// suppresses the link; completion does not, because the token resolves and
    /// <c>GET /survey-invitations/{token}</c> answers 409 <c>already_completed</c> -- "you have
    /// already answered this" tells the recipient more than a link-less mail does. Pinned so
    /// the behaviour is a choice somebody made, not an artefact of the filter being short.
    /// </para>
    /// </summary>
    [Fact]
    public async Task A_completed_invitation_still_carries_its_link_and_the_link_says_already_answered()
    {
        var client = await AdminAsync();
        var survey = await CreateActiveSurveyAsync(client);
        var (employeeId, employeeEmail) = await SeedEmployeeAsync();

        var invited = await client.PostAsJsonAsync(
            $"/surveys/{survey.Id}/invitations", new CreateSurveyInvitationsRequest(UserIds: [employeeId]));
        invited.EnsureSuccessStatusCode();
        var invitationId = (await invited.Content.ReadFromJsonAsync<SurveyInvitationBatchResult>())!.InvitationIds[0];

        var token = await _harness.WithDbAsync(async db =>
        {
            var invitation = await db.SurveyInvitations.FirstAsync(i => i.Id == invitationId);
            invitation.Status = SurveyInvitationStatuses.Completed;
            invitation.CompletedAt = DateTimeOffset.UtcNow;
            await db.SaveChangesAsync();
            return invitation.InvitationToken;
        });

        await SweepAsync(client);

        var message = Assert.Single(_mail.Mailbox.To(employeeEmail));
        Assert.Contains(
            $"{CapturingMailHostFixture.AppBaseUrl}/survey-invitations/{token}",
            message.TextBody,
            StringComparison.Ordinal);

        // ...and following it is informative rather than broken.
        using var anonymous = _factory.CreateClient();
        var opened = await anonymous.GetAsync($"/survey-invitations/{token}");
        Assert.Equal(HttpStatusCode.Conflict, opened.StatusCode);
    }

    // ------------------------------------------------------------------
    // The scheduled reminder path, and what a sweep costs
    // ------------------------------------------------------------------

    /// <summary>
    /// <b>The reminder job is the path that runs in production.</b> `Jobs.cs` ticks
    /// `InvitationReminderJob` in the Workers host on a cadence; the manual
    /// `POST /surveys/{id}/invitations/reminders` endpoint is not what nudges a real invitee.
    /// The job raised `survey_reminder` rows with no `Data` at all, so every scheduled reminder
    /// mailed a message telling somebody to follow a link it did not contain -- the original
    /// defect, surviving in the half nobody looked at.
    ///
    /// <para>
    /// Driven through the real job rather than by hand-writing a row, because hand-writing the
    /// payload is exactly the mistake that made this invisible: a test that sets `Data` itself
    /// proves the sender's type guard and says nothing about whether any producer writes it.
    /// </para>
    /// </summary>
    [Fact]
    public async Task A_scheduled_reminder_carries_a_link_just_as_the_invitation_did()
    {
        var client = await AdminAsync();
        var survey = await CreateActiveSurveyAsync(client);
        var (employeeId, employeeEmail) = await SeedEmployeeAsync();

        var invited = await client.PostAsJsonAsync(
            $"/surveys/{survey.Id}/invitations", new CreateSurveyInvitationsRequest(UserIds: [employeeId]));
        invited.EnsureSuccessStatusCode();

        // Age the invitation past the reminder cadence so the job finds it due.
        await _harness.WithDbAsync(async db =>
        {
            var invitation = await db.SurveyInvitations.FirstAsync(i => i.UserId == employeeId && i.SurveyId == survey.Id);
            invitation.SentAt = DateTimeOffset.UtcNow.AddDays(-30);
            invitation.Status = SurveyInvitationStatuses.Sent;
            await db.SaveChangesAsync();
        });

        // The real job, in a scope of the real host.
        using (var scope = _factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>();
            // RunAsync is the entry point Jobs.cs ticks in the Workers host -- the real
            // producer, saved by the job itself.
            var swept = await InvitationReminderJob.RunAsync(
                db,
                scope.ServiceProvider.GetRequiredService<ILoggerFactory>(),
                DateTimeOffset.UtcNow,
                InvitationReminderJob.DefaultBatchSize,
                CancellationToken.None);
            Assert.True(swept.Raised >= 1, "the reminder job raised nothing, so this assertion would be vacuous");
        }

        await SweepAsync(client);

        var token = await _harness.WithDbAsync(db => db.SurveyInvitations
            .AsNoTracking().Where(i => i.SurveyId == survey.Id && i.UserId == employeeId)
            .Select(i => i.InvitationToken).FirstAsync());
        var expected = $"{CapturingMailHostFixture.AppBaseUrl}/survey-invitations/{token}";

        // Both mails -- the invitation and the scheduled reminder -- and both parts of each.
        var messages = _mail.Mailbox.To(employeeEmail);
        Assert.Equal(2, messages.Count);
        Assert.All(messages, m => Assert.Contains(expected, m.TextBody, StringComparison.Ordinal));
        Assert.All(messages, m => Assert.Contains($"href=\"{expected}\"", m.HtmlBody, StringComparison.Ordinal));
    }

    /// <summary>
    /// <b>What the link costs, pinned.</b> `NotificationDelivery` issues no per-notification
    /// query, but the SENDER now issues exactly one per survey mail. That is a real change to
    /// the sweep's cost and the comment there states it; this is what stops the statement from
    /// drifting. The existing budget test cannot see it -- it dispatches
    /// `system_notification` over `in_app`, which never reaches the lookup.
    /// </summary>
    [Fact]
    public async Task A_sweep_costs_exactly_one_extra_query_per_invitation_mailed()
    {
        var client = await AdminAsync();
        var survey = await CreateActiveSurveyAsync(client);

        async Task<int> CostOfSweepingAsync(int invitees)
        {
            var ids = new List<Guid>();
            for (var i = 0; i < invitees; i++)
            {
                ids.Add((await SeedEmployeeAsync()).Id);
            }

            (await client.PostAsJsonAsync(
                $"/surveys/{survey.Id}/invitations",
                new CreateSurveyInvitationsRequest(UserIds: ids))).EnsureSuccessStatusCode();

            _factory.CommandCounter.Reset();
            var swept = await SweepAsync(client);
            Assert.Equal(invitees, swept.Sent);
            return _factory.CommandCounter.Count;
        }

        var forOne = await CostOfSweepingAsync(1);
        var forFive = await CostOfSweepingAsync(5);

        Assert.True(forOne > 0, "the interceptor observed no database commands, so this assertion would be vacuous");

        // Four more invitations, four more lookups, and nothing else that scales. Stated as a
        // bound rather than an equality for the reason the bulk-dispatch budget gives: how EF
        // packs the batch's writes into commands is a provider heuristic. A second per-mail
        // query -- or loading the whole SurveyInvitation entity -- costs four more than this.
        Assert.True(
            forFive <= forOne + 4 + 1,
            $"sweeping 1 invitation cost {forOne} command(s) and sweeping 5 cost {forFive}; "
            + "the per-mail cost has grown beyond the single token lookup that is documented on NotificationDelivery");
    }

    /// <summary>
    /// <b>G5, the API half.</b> The container hands out the real sender, and the lookup it
    /// needs resolves in the same scope. Asserted here as well as in
    /// <c>EmailDeliveryRegistrationTests</c> because this host is the one whose sender is
    /// actually driven, and a sender that cannot be constructed fails inside a dispatch tick
    /// rather than at a registration.
    /// </summary>
    [Fact]
    public void The_api_host_resolves_the_real_sender_and_the_lookup_it_depends_on()
    {
        using var scope = _factory.Services.CreateScope();

        Assert.IsType<EmailNotificationSender>(scope.ServiceProvider.GetRequiredService<INotificationSender>());
        Assert.NotNull(scope.ServiceProvider.GetRequiredService<ISurveyInvitationTokens>());
    }
}
