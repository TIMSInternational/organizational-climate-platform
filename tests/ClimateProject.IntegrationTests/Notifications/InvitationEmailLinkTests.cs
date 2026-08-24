using System.Net.Http.Json;
using ClimateProject.Api.Endpoints;
using ClimateProject.Application.Auth;
using ClimateProject.Application.Email;
using ClimateProject.Application.Localization;
using ClimateProject.Application.Notifications;
using ClimateProject.Application.Surveys;
using ClimateProject.Domain.Entities;
using ClimateProject.Infrastructure.Notifications;
using ClimateProject.IntegrationTests.Support;
using ClimateProject.IntegrationTests.Surveys;
using Microsoft.AspNetCore.Hosting;
using Microsoft.Extensions.Configuration;
using Microsoft.AspNetCore.TestHost;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
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
