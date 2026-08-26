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
    /// <summary>
    /// The domain every seeded recipient in this class sits in.
    ///
    /// It used to be <c>.test</c>, which is now exactly what this suite must not use here:
    /// <c>EmailNotificationSender</c> refuses RFC 2606/6761 reserved domains before the
    /// transport is called, so a <c>.test</c> recipient would never reach the capturing
    /// transport and every assertion below about what a recipient READS would be asserting
    /// nothing. A subdomain of a domain TIMS owns, and no mail is sent by any test here.
    /// </summary>
    private const string RecipientDomain = "fixtures.timsint.com";

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
                Email = $"{Guid.NewGuid():N}@invitee.{RecipientDomain}",
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
    /// <b>G3.</b> Revoked between queueing and sending: the mail still goes out, and it goes
    /// out <i>without</i> a link rather than with one that greets the recipient with a 410.
    /// The row must be recorded <c>sent</c>, not <c>failed</c> -- a failure here would burn
    /// three retries on a condition no retry can change.
    /// </summary>
    [Fact]
    public async Task A_revoked_invitation_still_sends_its_mail_and_sends_it_without_a_link()
    {
        var client = await AdminAsync();
        var survey = await CreateActiveSurveyAsync(client);
        var (employeeId, employeeEmail) = await SeedEmployeeAsync();

        var invited = await client.PostAsJsonAsync(
            $"/surveys/{survey.Id}/invitations", new CreateSurveyInvitationsRequest(UserIds: [employeeId]));
        invited.EnsureSuccessStatusCode();
        var batch = (await invited.Content.ReadFromJsonAsync<SurveyInvitationBatchResult>())!;

        // The administrator changes their mind, through the real route, before the sweep runs.
        (await client.PostAsync(
            $"/surveys/{survey.Id}/invitations/{batch.InvitationIds[0]}/revoke", null)).EnsureSuccessStatusCode();

        var sweep = await SweepAsync(client);
        Assert.Equal(1, sweep.Sent);
        Assert.Equal(0, sweep.Failed);

        var message = Assert.Single(_mail.Mailbox.To(employeeEmail));
        Assert.DoesNotContain(SurveyAccessTokens.InvitationLinkPrefix, message.TextBody, StringComparison.Ordinal);
        Assert.DoesNotContain(SurveyAccessTokens.InvitationLinkPrefix, message.HtmlBody, StringComparison.Ordinal);
        Assert.DoesNotContain("Open the survey", message.TextBody, StringComparison.Ordinal);

        // Not a broken button, either: no anchor with an empty or dangling href.
        Assert.DoesNotContain("href=\"\"", message.HtmlBody, StringComparison.Ordinal);

        // The message itself still arrived intact -- this is a mail minus its link, not a
        // truncated one.
        Assert.False(string.IsNullOrWhiteSpace(message.TextBody));
        Assert.False(string.IsNullOrWhiteSpace(message.Subject));
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
                Email = $"{Guid.NewGuid():N}@victim.{RecipientDomain}",
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
                Email = $"{Guid.NewGuid():N}@rehomed.{RecipientDomain}",
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
