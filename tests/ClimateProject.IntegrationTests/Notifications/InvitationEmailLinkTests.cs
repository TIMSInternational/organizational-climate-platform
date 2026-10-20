using System.Net;
using System.Net.Http.Json;
using ClimateProject.Api.Endpoints;
using ClimateProject.Application.Auth;
using ClimateProject.Application.Email;
using ClimateProject.Application.Localization;
using ClimateProject.Application.Microclimates;
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
    private static readonly Lock Gate = new();
    private static CapturingMailFactory? _factory;
    private static readonly CapturedMailbox SharedMailbox = new();

    /// <summary>
    /// Everything the product handed to a transport, for every class that uses this fixture.
    ///
    /// <para>
    /// The host and the mailbox are <b>static</b>, so a second test class asking for a
    /// capturing host does not build a second one: xUnit constructs a class fixture per class,
    /// and each host is billed against <see cref="AuthWebApplicationFactory.HostBudget"/>,
    /// which the assembly is close to. Every class using this filters by its own recipient
    /// address and every class using it sits in the <c>Postgres</c> collection, which xUnit
    /// runs one class at a time -- so sharing the record is safe in the only way that matters,
    /// that no two classes write it concurrently.
    /// </para>
    /// </summary>
    public CapturedMailbox Mailbox => SharedMailbox;

    public AuthWebApplicationFactory HostFor(string connectionString)
    {
        lock (Gate)
        {
            return _factory ??= new CapturingMailFactory(connectionString, SharedMailbox);
        }
    }

    /// <summary>
    /// Deliberately empty. The host outlives any one class that uses it -- disposing it when
    /// the first such class finishes would tear it out from under the next one -- so it lives
    /// for the test process, exactly as <see cref="PostgresContainerFixture.App"/> does.
    /// </summary>
    public void Dispose()
    {
    }

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

    /// <summary>
    /// Every survey in this class asks for the invitation mail and for reminders, because the
    /// MAIL is what the class is about.
    ///
    /// The product's own default for both is OFF since 2026-10-19: the invitation mail's
    /// button answers a survey without signing in, and the ruling is one email per person --
    /// their credentials. These 27 tests were written against the old default and relied on
    /// it silently, which is why all of them went red at once. Asking explicitly is also the
    /// honest shape: a test about what the mail contains should say that it wants mail.
    /// </summary>
    private static CreateSurveyRequest Mailing(CreateSurveyRequest request)
        => request with
        {
            Settings = (request.Settings ?? new SurveySettingsInput()) with
            {
                NotificationSendInvitations = true,
                NotificationSendReminders = true,
            },
        };

    private async Task<SurveyDetail> CreateActiveSurveyAsync(HttpClient client)
    {
        var created = await SurveyTestHarness.CreateSurveyAsync(client, Mailing(SurveyTestHarness.MinimalRequest(_companyId)));
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
    /// An action plan's due-date nudge links to the plan, under a label that says so. The job
    /// raised these with no link at all, and the composer labelled every link "Abrir la
    /// encuesta" -- so the first link a plan mail carried would have said it opened a survey.
    /// </summary>
    [Fact]
    public async Task An_action_plan_nudge_links_to_its_plan_under_a_label_that_says_plan()
    {
        var client = await AdminAsync();
        var (employeeId, employeeEmail) = await SeedEmployeeAsync(ContentLanguages.Spanish);
        var planId = Guid.NewGuid();

        // Raised the way ActionPlanDueJob raises it: a pending row carrying only the plan id.
        await _harness.WithDbAsync(async db =>
        {
            db.Notifications.Add(new Notification
            {
                Id = Guid.NewGuid(),
                UserId = employeeId,
                CompanyId = _companyId,
                Type = NotificationTypes.ActionPlanAlert,
                Channel = NotificationChannels.Email,
                Priority = NotificationPriorities.Medium,
                Status = NotificationStatuses.Pending,
                Title = "Un plan de acción a tu cargo vence pronto",
                Message = "\"Reducir la carga\" vence el 2026-10-20.",
                Data = ActionPlanNotificationData.Serialize(planId),
                ScheduledFor = DateTimeOffset.UtcNow.AddMinutes(-1),
                MaxRetries = 3,
                CreatedAt = DateTimeOffset.UtcNow,
                UpdatedAt = DateTimeOffset.UtcNow,
            });
            await db.SaveChangesAsync();
            return 0;
        });
        await SweepAsync(client);

        var expected = $"{CapturingMailHostFixture.AppBaseUrl}/action-plans/{planId}";
        var message = Assert.Single(_mail.Mailbox.To(employeeEmail));
        Assert.Contains($"Abrir el plan: {expected}", message.TextBody, StringComparison.Ordinal);
        Assert.Contains($"href=\"{expected}\"", message.HtmlBody, StringComparison.Ordinal);
        Assert.DoesNotContain("Abrir la encuesta", message.TextBody, StringComparison.Ordinal);
        Assert.DoesNotContain("Abrir la encuesta", message.HtmlBody, StringComparison.Ordinal);
    }

    // ------------------------------------------------------------------
    // The exfiltration primitive, and the scope that closes it
    // ------------------------------------------------------------------

    // ------------------------------------------------------------------
    // The scheduled reminder path, and what a sweep costs
    // ------------------------------------------------------------------

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

        // #130's half of the same seam, and registered separately because it reads a
        // different table. A sender constructed without it fails inside a dispatch tick.
        Assert.NotNull(scope.ServiceProvider.GetRequiredService<IMicroclimateInvitationTokens>());
    }

    // ------------------------------------------------------------------
    // #130: the microclimate half of every guarantee above
    // ------------------------------------------------------------------

    /// <summary>An ACTIVE microclimate, so it can be distributed.</summary>
    private Task<Guid> CreateActiveMicroclimateAsync(bool anonymous = true)
        => _harness.WithDbAsync(async db =>
        {
            var now = DateTimeOffset.UtcNow;
            var author = new User
            {
                Id = Guid.NewGuid(),
                CompanyId = _companyId,
                Email = $"{Guid.NewGuid():N}@author.{RecipientDomain}",
                Name = "Author",
                Role = Roles.CompanyAdmin,
                IsActive = true,
                CreatedAt = now,
                UpdatedAt = now,
            };
            db.Users.Add(author);

            var microclimate = new Microclimate
            {
                Id = Guid.NewGuid(),
                TitleEn = "Weekly pulse",
                TitleEs = "Pulso semanal",
                Language = "both",
                CompanyId = _companyId,

                // A real row: microclimates.created_by is a foreign key and Guid.Empty is refused.
                CreatedBy = author.Id,
                Status = MicroclimateStatuses.Active,
                TargetParticipantCount = 10,
                CreatedAt = now,
                UpdatedAt = now,
            };
            microclimate.Scheduling.StartTime = now.AddMinutes(-5);
            microclimate.Scheduling.EndTime = now.AddHours(4);
            microclimate.RealtimeSettings.AnonymousResponses = anonymous;
            db.Microclimates.Add(microclimate);

            await db.SaveChangesAsync();
            return microclimate.Id;
        });

    /// <summary>
    /// <b>The guarantee this whole slice turns on.</b> A microclimate invitee's mail carries an
    /// absolute <c>/microclimate-invitations/{token}</c> URL built from the token on THEIR row,
    /// and that URL is one the API actually honours.
    ///
    /// <para>
    /// End to end through the real seam: the endpoint queues a <c>notifications</c> row with
    /// <c>MicroclimateNotificationData</c> in its <c>data</c> column, the sweep picks it up,
    /// <c>EmailNotificationSender</c> branches on the type, <c>MicroclimateInvitationTokens</c>
    /// resolves the token out of <c>microclimate_invitations</c>, and the composer renders it.
    /// Five components, four of them new, and the failure mode if any one of them names the
    /// survey side instead is <b>silent</b>: a null token, a link-less mail, a green build, and
    /// every invitee holding an email they cannot act on. Which is why the last block here
    /// resolves the mailed link against the live route rather than comparing strings.
    /// </para>
    /// </summary>
    [Fact]
    public async Task A_microclimate_invitation_email_carries_a_link_the_microclimate_route_honours()
    {
        var client = await AdminAsync();
        var microclimateId = await CreateActiveMicroclimateAsync();
        var (employeeId, employeeEmail) = await SeedEmployeeAsync();

        var invited = await client.PostAsJsonAsync(
            $"/microclimates/{microclimateId}/invitations",
            new CreateMicroclimateInvitationsRequest(UserIds: [employeeId]));
        Assert.Equal(HttpStatusCode.Created, invited.StatusCode);

        var sweep = await SweepAsync(client);
        Assert.Equal(1, sweep.Sent);

        // Read AFTER the send, from the row itself: predicting the token would prove only that
        // this test can do base64.
        var token = await _harness.WithDbAsync(db => db.MicroclimateInvitations
            .AsNoTracking().Where(i => i.MicroclimateId == microclimateId && i.UserId == employeeId)
            .Select(i => i.InvitationToken).FirstAsync());

        var expected = $"{CapturingMailHostFixture.AppBaseUrl}/microclimate-invitations/{token}";
        var message = Assert.Single(_mail.Mailbox.To(employeeEmail));

        // Both parts. A call to action present only in the HTML is a dead end for every
        // plain-text reader.
        Assert.Contains(expected, message.TextBody, StringComparison.Ordinal);
        Assert.Contains($"href=\"{expected}\"", message.HtmlBody, StringComparison.Ordinal);

        // And NOT the survey route. This is the wrong-table mix-up, asserted at the one place
        // it would actually be seen: in the envelope.
        Assert.DoesNotContain(SurveyAccessTokens.InvitationLinkPrefix, message.TextBody, StringComparison.Ordinal);
        Assert.DoesNotContain("/respond", message.TextBody, StringComparison.Ordinal);
        Assert.DoesNotContain(microclimateId.ToString(), message.TextBody, StringComparison.Ordinal);

        // The link the mail carries is the link the API honours. No string comparison can fake
        // this: the unauthenticated token route resolves it to this microclimate.
        using var anonymous = _factory.CreateClient();
        var opened = await anonymous.GetAsync($"/microclimate-invitations/{token}");
        opened.EnsureSuccessStatusCode();
        var detail = await opened.Content.ReadFromJsonAsync<MicroclimateInvitationTokenDetail>();
        Assert.Equal(microclimateId, detail!.MicroclimateId);
    }

    /// <summary>
    /// Revocation between queueing and the sweep is real, not eventual. The row is queued with
    /// the invitation's id and not its token precisely so this can be true -- the sender makes
    /// the trip to the database at SEND time, and finds nothing.
    ///
    /// <para>The mail still goes out. A recipient whose invitation an administrator withdrew
    /// gets the message minus its button, never a row marked <c>failed</c> burning three
    /// retries on a condition no retry can change.</para>
    /// </summary>
    [Fact]
    public async Task An_invitation_revoked_before_the_sweep_is_mailed_without_a_link()
    {
        var client = await AdminAsync();
        var microclimateId = await CreateActiveMicroclimateAsync();
        var (employeeId, employeeEmail) = await SeedEmployeeAsync();

        var invited = await client.PostAsJsonAsync(
            $"/microclimates/{microclimateId}/invitations",
            new CreateMicroclimateInvitationsRequest(UserIds: [employeeId]));
        var invitationId = Assert.Single(
            (await invited.Content.ReadFromJsonAsync<MicroclimateInvitationBatchResult>())!.InvitationIds);

        // The window this design exists to close: queued, then withdrawn, then swept.
        (await client.PostAsync(
            $"/microclimates/{microclimateId}/invitations/{invitationId}/revoke", null))
            .EnsureSuccessStatusCode();

        var sweep = await SweepAsync(client);
        Assert.Equal(1, sweep.Sent);

        var message = Assert.Single(_mail.Mailbox.To(employeeEmail));
        Assert.DoesNotContain("/microclimate-invitations/", message.TextBody, StringComparison.Ordinal);
        Assert.DoesNotContain("/microclimate-invitations/", message.HtmlBody, StringComparison.Ordinal);

        // And nothing that looks like a button with nothing behind it.
        Assert.DoesNotContain("href=\"\"", message.HtmlBody, StringComparison.Ordinal);
    }
}
