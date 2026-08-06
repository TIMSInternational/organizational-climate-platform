using System.Data.Common;
using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using ClimateProject.Api.Endpoints;
using ClimateProject.Application.Auth;
using ClimateProject.Application.Notifications;
using ClimateProject.Application.OrgStructure;
using ClimateProject.Domain.Entities;
using ClimateProject.Infrastructure.Persistence;
using ClimateProject.IntegrationTests.Support;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.TestHost;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;

namespace ClimateProject.IntegrationTests.Notifications;

[Collection("Postgres")]
public class NotificationEndpointsTests : IAsyncLifetime
{
    private readonly PostgresContainerFixture _postgres;
    private readonly AuthWebApplicationFactory _factory;
    private readonly string _companyDomain = $"notif-{Guid.NewGuid():N}.test";
    private readonly string _otherCompanyDomain = $"notif-other-{Guid.NewGuid():N}.test";
    private Guid _companyId;
    private Guid _otherCompanyId;

    public NotificationEndpointsTests(PostgresContainerFixture postgres)
    {
        _postgres = postgres;
        _factory = new AuthWebApplicationFactory(postgres.ConnectionString);
    }

    public async Task InitializeAsync()
    {
        await _factory.ApplyMigrationsAsync();
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>();

        var company = new Company { Id = Guid.NewGuid(), Name = "Notif Co", EmailDomain = _companyDomain, CreatedAt = DateTimeOffset.UtcNow };
        var otherCompany = new Company { Id = Guid.NewGuid(), Name = "Other Co", EmailDomain = _otherCompanyDomain, CreatedAt = DateTimeOffset.UtcNow };
        db.Companies.AddRange(company, otherCompany);
        _companyId = company.Id;
        _otherCompanyId = otherCompany.Id;
        await db.SaveChangesAsync();
    }

    public Task DisposeAsync()
    {
        _factory.Dispose();
        return Task.CompletedTask;
    }

    private async Task<(string Token, Guid UserId)> SignUpAndGetTokenAsync(HttpClient client, string role, string? domain = null)
    {
        var email = $"{Guid.NewGuid():N}@{domain ?? _companyDomain}";
        var signup = await client.PostAsJsonAsync("/auth/signup", new SignupRequest("Test User", email, "a-good-password"));
        Assert.Equal(HttpStatusCode.Created, signup.StatusCode);

        Guid userId;
        using (var scope = _factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>();
            var user = await db.Users.FirstAsync(u => u.Email == email);
            user.Role = role;
            await db.SaveChangesAsync();
            userId = user.Id;
        }

        var login = await client.PostAsJsonAsync("/auth/login", new LoginRequest(email, "a-good-password"));
        var token = (await login.Content.ReadFromJsonAsync<TokenResponse>())!.Token;
        return (token, userId);
    }

    private async Task<HttpClient> AuthenticatedClientAsync(string role, string? domain = null)
    {
        var client = _factory.CreateClient();
        var (token, _) = await SignUpAndGetTokenAsync(client, role, domain);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);
        return client;
    }

    private async Task WithDbAsync(Func<ClimateProjectDbContext, Task> action)
    {
        using var scope = _factory.Services.CreateScope();
        await action(scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>());
    }

    private static CreateNotificationRequest Request(
        Guid userId,
        Guid companyId,
        string type = NotificationTypes.SystemNotification,
        string channel = NotificationChannels.InApp,
        Guid? templateId = null,
        DateTimeOffset? scheduledFor = null)
        => new(userId, companyId, type, channel, NotificationPriorities.Medium, "Title", "Message", null, templateId, scheduledFor);

    [Fact]
    public async Task CompanyAdmin_can_dispatch_without_a_template_and_it_is_sent_immediately()
    {
        var adminClient = await AuthenticatedClientAsync(Roles.CompanyAdmin);
        var (_, recipientId) = await SignUpAndGetTokenAsync(_factory.CreateClient(), Roles.Employee);

        var response = await adminClient.PostAsJsonAsync("/notifications", Request(recipientId, _companyId));

        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        var created = await response.Content.ReadFromJsonAsync<NotificationDetail>();
        Assert.Null(created!.TemplateId);
        Assert.Equal(NotificationStatuses.Sent, created.Status);
        Assert.NotNull(created.SentAt);
        Assert.Null(created.FailedAt);
        Assert.Equal(0, created.RetryCount);
    }

    [Fact]
    public async Task Dispatch_also_works_with_a_template_and_rejects_another_tenants_template()
    {
        var adminClient = await AuthenticatedClientAsync(Roles.CompanyAdmin);
        var (_, recipientId) = await SignUpAndGetTokenAsync(_factory.CreateClient(), Roles.Employee);

        var ownTemplateId = Guid.NewGuid();
        var foreignTemplateId = Guid.NewGuid();
        await WithDbAsync(async db =>
        {
            var author = await db.Users.FirstAsync(u => u.Id == recipientId);
            var now = DateTimeOffset.UtcNow;
            db.NotificationTemplates.AddRange(
                new NotificationTemplate
                {
                    Id = ownTemplateId, Name = "Own", Type = NotificationTypes.SystemNotification,
                    Channel = NotificationChannels.InApp, CompanyId = _companyId, CreatedBy = author.Id,
                    CreatedAt = now, UpdatedAt = now,
                },
                new NotificationTemplate
                {
                    Id = foreignTemplateId, Name = "Foreign", Type = NotificationTypes.SystemNotification,
                    Channel = NotificationChannels.InApp, CompanyId = _otherCompanyId, CreatedBy = author.Id,
                    CreatedAt = now, UpdatedAt = now,
                });
            await db.SaveChangesAsync();
        });

        var withTemplate = await adminClient.PostAsJsonAsync("/notifications", Request(recipientId, _companyId, templateId: ownTemplateId));
        Assert.Equal(HttpStatusCode.Created, withTemplate.StatusCode);
        var created = await withTemplate.Content.ReadFromJsonAsync<NotificationDetail>();
        Assert.Equal(ownTemplateId, created!.TemplateId);
        Assert.Equal(NotificationStatuses.Sent, created.Status);

        // The FK alone would happily accept another tenant's template id.
        var withForeignTemplate = await adminClient.PostAsJsonAsync("/notifications", Request(recipientId, _companyId, templateId: foreignTemplateId));
        Assert.Equal(HttpStatusCode.BadRequest, withForeignTemplate.StatusCode);
    }

    [Fact]
    public async Task A_user_cannot_read_or_mark_read_another_users_notifications()
    {
        // The acceptance criterion for #97. Note the third assertion: the CompanyAdmin who
        // *created* the notification, and who administers the tenant it belongs to, still
        // cannot mark it read -- the self-service rule is per-user, not per-company.
        var adminClient = await AuthenticatedClientAsync(Roles.CompanyAdmin);

        var userAClient = _factory.CreateClient();
        var (userAToken, userAId) = await SignUpAndGetTokenAsync(userAClient, Roles.Employee);
        userAClient.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", userAToken);

        var userBClient = _factory.CreateClient();
        var (userBToken, _) = await SignUpAndGetTokenAsync(userBClient, Roles.Employee);
        userBClient.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", userBToken);

        var createForA = await adminClient.PostAsJsonAsync("/notifications", Request(userAId, _companyId));
        var forA = (await createForA.Content.ReadFromJsonAsync<NotificationDetail>())!;

        var bInbox = await (await userBClient.GetAsync("/notifications/mine")).Content.ReadFromJsonAsync<NotificationListResponse>();
        Assert.DoesNotContain(bInbox!.Notifications, n => n.Id == forA.Id);

        Assert.Equal(HttpStatusCode.Forbidden, (await userBClient.PostAsync($"/notifications/{forA.Id}/read", null)).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await adminClient.PostAsync($"/notifications/{forA.Id}/read", null)).StatusCode);

        var aInbox = await (await userAClient.GetAsync("/notifications/mine")).Content.ReadFromJsonAsync<NotificationListResponse>();
        Assert.Contains(aInbox!.Notifications, n => n.Id == forA.Id);

        var markRead = await userAClient.PostAsync($"/notifications/{forA.Id}/read", null);
        Assert.Equal(HttpStatusCode.OK, markRead.StatusCode);
        var marked = (await markRead.Content.ReadFromJsonAsync<NotificationDetail>())!;
        Assert.NotNull(marked.OpenedAt);
        Assert.Equal(NotificationStatuses.Opened, marked.Status);

        // Idempotent: a second read does not move "first opened at".
        var markedAgain = await (await userAClient.PostAsync($"/notifications/{forA.Id}/read", null))
            .Content.ReadFromJsonAsync<NotificationDetail>();
        Assert.Equal(marked.OpenedAt, markedAgain!.OpenedAt);
    }

    [Fact]
    public async Task An_admin_of_another_company_cannot_dispatch_into_this_one()
    {
        var foreignAdmin = await AuthenticatedClientAsync(Roles.CompanyAdmin, _otherCompanyDomain);
        var (_, recipientId) = await SignUpAndGetTokenAsync(_factory.CreateClient(), Roles.Employee);

        var response = await foreignAdmin.PostAsJsonAsync("/notifications", Request(recipientId, _companyId));

        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
    }

    [Fact]
    public async Task An_email_opt_out_suppresses_delivery_and_is_recorded_as_cancelled_not_failed()
    {
        var adminClient = await AuthenticatedClientAsync(Roles.CompanyAdmin);
        var (_, recipientId) = await SignUpAndGetTokenAsync(_factory.CreateClient(), Roles.Employee);

        await WithDbAsync(async db =>
        {
            var recipient = await db.Users.FirstAsync(u => u.Id == recipientId);
            recipient.Notifications.EmailSurveys = false;
            await db.SaveChangesAsync();
        });

        var suppressed = await adminClient.PostAsJsonAsync("/notifications", Request(
            recipientId, _companyId, NotificationTypes.SurveyInvitation, NotificationChannels.Email));
        var suppressedDetail = (await suppressed.Content.ReadFromJsonAsync<NotificationDetail>())!;

        Assert.Equal(NotificationStatuses.Cancelled, suppressedDetail.Status);
        Assert.Null(suppressedDetail.SentAt);
        Assert.NotNull(suppressedDetail.FailureReason);
        // Not "failed": nothing broke, and a failed row would be picked back up by /process
        // and mailed to someone who opted out.
        Assert.Equal(0, suppressedDetail.RetryCount);
        Assert.Null(suppressedDetail.FailedAt);

        // The opt-out is scoped to what it governs: a microclimate email still goes out, and
        // so does the in-app copy of the very type that was turned off.
        var otherType = await adminClient.PostAsJsonAsync("/notifications", Request(
            recipientId, _companyId, NotificationTypes.MicroclimateInvitation, NotificationChannels.Email));
        Assert.Equal(NotificationStatuses.Sent, (await otherType.Content.ReadFromJsonAsync<NotificationDetail>())!.Status);

        var inApp = await adminClient.PostAsJsonAsync("/notifications", Request(
            recipientId, _companyId, NotificationTypes.SurveyInvitation, NotificationChannels.InApp));
        Assert.Equal(NotificationStatuses.Sent, (await inApp.Content.ReadFromJsonAsync<NotificationDetail>())!.Status);
    }

    [Fact]
    public async Task A_scheduled_notification_stays_pending_until_process_runs_and_honours_an_opt_out_taken_meanwhile()
    {
        var adminClient = await AuthenticatedClientAsync(Roles.CompanyAdmin);
        var (_, recipientId) = await SignUpAndGetTokenAsync(_factory.CreateClient(), Roles.Employee);

        var scheduled = await adminClient.PostAsJsonAsync("/notifications", Request(
            recipientId, _companyId, NotificationTypes.DeadlineReminder, NotificationChannels.Email,
            scheduledFor: DateTimeOffset.UtcNow.AddHours(1)));
        var pending = (await scheduled.Content.ReadFromJsonAsync<NotificationDetail>())!;
        Assert.Equal(NotificationStatuses.Pending, pending.Status);
        Assert.Null(pending.SentAt);

        // A sweep now must not pick it up -- it is not due.
        await adminClient.PostAsync($"/notifications/process?companyId={_companyId}", null);
        await WithDbAsync(async db =>
            Assert.Equal(NotificationStatuses.Pending, (await db.Notifications.AsNoTracking().FirstAsync(n => n.Id == pending.Id)).Status));

        // The recipient opts out between scheduling and sending. Because the consent decision
        // is made at delivery time, that opt-out is honoured -- which it would not be if the
        // decision had been frozen when the admin queued the notification.
        await WithDbAsync(async db =>
        {
            var recipient = await db.Users.FirstAsync(u => u.Id == recipientId);
            recipient.Notifications.EmailReminders = false;
            var notification = await db.Notifications.FirstAsync(n => n.Id == pending.Id);
            notification.ScheduledFor = DateTimeOffset.UtcNow.AddMinutes(-1);
            await db.SaveChangesAsync();
        });

        var processed = await adminClient.PostAsync($"/notifications/process?companyId={_companyId}", null);
        Assert.Equal(HttpStatusCode.OK, processed.StatusCode);
        var result = (await processed.Content.ReadFromJsonAsync<NotificationProcessResult>())!;
        Assert.Equal(1, result.Attempted);
        Assert.Equal(1, result.Suppressed);
        Assert.Equal(0, result.Sent);

        await WithDbAsync(async db =>
            Assert.Equal(NotificationStatuses.Cancelled, (await db.Notifications.AsNoTracking().FirstAsync(n => n.Id == pending.Id)).Status));
    }

    [Fact]
    public async Task Bulk_dispatch_reports_unknown_and_cross_tenant_recipients_without_failing_the_batch()
    {
        var adminClient = await AuthenticatedClientAsync(Roles.CompanyAdmin);
        var (_, firstId) = await SignUpAndGetTokenAsync(_factory.CreateClient(), Roles.Employee);
        var (_, secondId) = await SignUpAndGetTokenAsync(_factory.CreateClient(), Roles.Employee);
        var (_, foreignId) = await SignUpAndGetTokenAsync(_factory.CreateClient(), Roles.Employee, _otherCompanyDomain);
        var strangerId = Guid.NewGuid();

        var response = await adminClient.PostAsJsonAsync("/notifications/bulk", new CreateBulkNotificationRequest(
            [firstId, secondId, foreignId, strangerId, firstId],
            _companyId,
            NotificationTypes.SystemNotification,
            NotificationChannels.InApp,
            NotificationPriorities.High,
            "Bulk title",
            "Bulk message"));

        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        var result = (await response.Content.ReadFromJsonAsync<BulkNotificationResult>())!;

        Assert.Equal(4, result.Requested);      // the duplicate id is collapsed
        Assert.Equal(2, result.Created);
        Assert.Equal(2, result.Sent);
        Assert.Equal(0, result.Failed);
        Assert.Equal(0, result.Suppressed);
        Assert.Equal(2, result.UnknownUserIds.Count);
        // A user who exists but belongs to another tenant is "unknown" here, not merely
        // skipped: the recipient lookup is company-scoped, so cross-tenant dispatch is
        // impossible even when the caller knows a valid user id.
        Assert.Contains(foreignId, result.UnknownUserIds);
        Assert.Contains(strangerId, result.UnknownUserIds);
        Assert.All(result.Notifications, n => Assert.Equal(NotificationPriorities.High, n.Priority));
    }

    [Fact]
    public async Task Bulk_dispatch_issues_the_same_number_of_database_commands_regardless_of_recipient_count()
    {
        // The N+1 acceptance criterion, asserted as a property rather than an absolute count:
        // whatever the handler costs for one recipient, it must cost exactly the same for
        // five. A per-recipient SELECT or SaveChanges would break this immediately.
        var setupClient = _factory.CreateClient();
        var (adminToken, _) = await SignUpAndGetTokenAsync(setupClient, Roles.CompanyAdmin);

        var oneRecipient = new List<Guid>();
        var fiveRecipients = new List<Guid>();
        for (var i = 0; i < 5; i++)
        {
            var (_, id) = await SignUpAndGetTokenAsync(_factory.CreateClient(), Roles.Employee);
            fiveRecipients.Add(id);
            if (i == 0) oneRecipient.Add(id);
        }

        var counter = new CommandCountingInterceptor();
        using var countingFactory = new CountingWebApplicationFactory(_postgres.ConnectionString, counter);
        var client = countingFactory.CreateClient();
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", adminToken);

        async Task<int> CountForAsync(IReadOnlyList<Guid> recipients)
        {
            counter.Reset();
            var response = await client.PostAsJsonAsync("/notifications/bulk", new CreateBulkNotificationRequest(
                recipients, _companyId, NotificationTypes.SystemNotification, NotificationChannels.InApp,
                NotificationPriorities.Medium, "Bulk", "Bulk"));
            Assert.Equal(HttpStatusCode.Created, response.StatusCode);
            return counter.Count;
        }

        var forOne = await CountForAsync(oneRecipient);
        var forFive = await CountForAsync(fiveRecipients);

        Assert.True(forOne > 0, "the interceptor observed no database commands at all, so this assertion would be vacuous");

        // Deliberately "at most one more", not "exactly equal": how EF packs five INSERTs
        // into command batches is a provider heuristic, and pinning it would make this test
        // fail on an EF upgrade that changed nothing about this endpoint. A genuine N+1
        // costs four extra commands here, which this still catches.
        Assert.True(
            forFive <= forOne + 1,
            $"bulk dispatch issued {forOne} database command(s) for 1 recipient but {forFive} for 5 -- it is scaling with the recipient count");
    }

    [Fact]
    public async Task A_failing_sender_records_the_failure_and_process_retries_it()
    {
        var setupClient = _factory.CreateClient();
        var (adminToken, _) = await SignUpAndGetTokenAsync(setupClient, Roles.CompanyAdmin);
        var (_, recipientId) = await SignUpAndGetTokenAsync(_factory.CreateClient(), Roles.Employee);

        using var failingFactory = new StubSenderWebApplicationFactory(
            _postgres.ConnectionString,
            new FailingNotificationSender());
        var client = failingFactory.CreateClient();
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", adminToken);

        var response = await client.PostAsJsonAsync("/notifications", Request(recipientId, _companyId));
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        var failed = (await response.Content.ReadFromJsonAsync<NotificationDetail>())!;

        Assert.Equal(NotificationStatuses.Failed, failed.Status);
        Assert.NotNull(failed.FailedAt);
        Assert.Null(failed.SentAt);
        Assert.Equal(1, failed.RetryCount);
        Assert.Equal(FailingNotificationSender.Reason, failed.FailureReason);

        // A failed row is retryable while it has retries left, so the sweep picks it up again.
        var processed = await client.PostAsync($"/notifications/process?companyId={_companyId}", null);
        var result = (await processed.Content.ReadFromJsonAsync<NotificationProcessResult>())!;
        Assert.Equal(1, result.Failed);

        await WithDbAsync(async db =>
        {
            var reloaded = await db.Notifications.AsNoTracking().FirstAsync(n => n.Id == failed.Id);
            Assert.Equal(2, reloaded.RetryCount);
            Assert.Equal(NotificationStatuses.Failed, reloaded.Status);
        });
    }

    [Theory]
    [InlineData(NotificationChannels.Push)]
    [InlineData("carrier_pigeon")]
    public async Task An_undeliverable_channel_is_rejected_rather_than_reported_as_sent(string channel)
    {
        var adminClient = await AuthenticatedClientAsync(Roles.CompanyAdmin);
        var (_, recipientId) = await SignUpAndGetTokenAsync(_factory.CreateClient(), Roles.Employee);

        var response = await adminClient.PostAsJsonAsync("/notifications", Request(
            recipientId, _companyId, NotificationTypes.SystemNotification, channel));

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task An_unknown_type_or_malformed_data_is_rejected_with_a_message_not_a_500()
    {
        var adminClient = await AuthenticatedClientAsync(Roles.CompanyAdmin);
        var (_, recipientId) = await SignUpAndGetTokenAsync(_factory.CreateClient(), Roles.Employee);

        var badType = await adminClient.PostAsJsonAsync("/notifications", new CreateNotificationRequest(
            recipientId, _companyId, "not_a_type", NotificationChannels.InApp, null, "T", "M"));
        Assert.Equal(HttpStatusCode.BadRequest, badType.StatusCode);

        var badJson = await adminClient.PostAsJsonAsync("/notifications", new CreateNotificationRequest(
            recipientId, _companyId, NotificationTypes.SystemNotification, NotificationChannels.InApp, null, "T", "M",
            Data: "{not json"));
        Assert.Equal(HttpStatusCode.BadRequest, badJson.StatusCode);
    }

    [Fact]
    public async Task Self_service_preferences_expose_five_and_a_partial_update_leaves_the_rest_alone()
    {
        var client = _factory.CreateClient();
        var (token, userId) = await SignUpAndGetTokenAsync(client, Roles.Employee);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);

        // Start from a state where every stored value differs from the CLR defaults, so an
        // accidental "reset to defaults" is visible rather than a coincidence.
        await WithDbAsync(async db =>
        {
            var user = await db.Users.FirstAsync(u => u.Id == userId);
            user.Notifications.EmailSurveys = false;
            user.Notifications.EmailMicroclimates = false;
            user.Notifications.EmailActionPlans = false;
            user.Notifications.EmailReminders = false;
            user.Notifications.PushNotifications = true;
            user.Notifications.DigestFrequency = NotificationPreferenceValidation.DigestNever;
            await db.SaveChangesAsync();
        });

        var read = await (await client.GetAsync("/notifications/preferences"))
            .Content.ReadFromJsonAsync<NotificationPreferencesResponse>();
        Assert.False(read!.EmailSurveys);
        Assert.Equal(NotificationPreferenceValidation.DigestNever, read.DigestFrequency);

        // The wire payload names five preferences and never push.
        var raw = await (await client.GetAsync("/notifications/preferences")).Content.ReadAsStringAsync();
        Assert.DoesNotContain("push", raw, StringComparison.OrdinalIgnoreCase);

        var updated = await client.PutAsJsonAsync("/notifications/preferences",
            new UpdateNotificationPreferencesRequest(EmailSurveys: true));
        Assert.Equal(HttpStatusCode.OK, updated.StatusCode);
        var body = (await updated.Content.ReadFromJsonAsync<NotificationPreferencesResponse>())!;

        Assert.True(body.EmailSurveys);
        Assert.False(body.EmailMicroclimates);
        Assert.False(body.EmailActionPlans);
        Assert.False(body.EmailReminders);
        Assert.Equal(NotificationPreferenceValidation.DigestNever, body.DigestFrequency);

        await WithDbAsync(async db =>
        {
            var user = await db.Users.AsNoTracking().FirstAsync(u => u.Id == userId);
            Assert.True(user.Notifications.EmailSurveys);
            Assert.False(user.Notifications.EmailReminders);
            // The sixth, unexposed preference survives a self-service write untouched.
            Assert.True(user.Notifications.PushNotifications);
            Assert.NotNull(user.ConsentUpdatedAt);
        });
    }

    [Fact]
    public async Task An_invalid_digest_frequency_is_rejected_and_changes_nothing()
    {
        var client = _factory.CreateClient();
        var (token, userId) = await SignUpAndGetTokenAsync(client, Roles.Employee);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);

        var response = await client.PutAsJsonAsync("/notifications/preferences",
            new UpdateNotificationPreferencesRequest(EmailSurveys: false, DigestFrequency: "yearly"));

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        await WithDbAsync(async db =>
        {
            var user = await db.Users.AsNoTracking().FirstAsync(u => u.Id == userId);
            Assert.True(user.Notifications.EmailSurveys);
            Assert.Equal(NotificationPreferenceValidation.DefaultDigestFrequency, user.Notifications.DigestFrequency);
        });
    }

    [Fact]
    public async Task An_employee_cannot_reach_the_admin_dispatch_or_list_surface()
    {
        var employeeClient = await AuthenticatedClientAsync(Roles.Employee);
        var (_, recipientId) = await SignUpAndGetTokenAsync(_factory.CreateClient(), Roles.Employee);

        Assert.Equal(HttpStatusCode.Forbidden,
            (await employeeClient.GetAsync($"/notifications?companyId={_companyId}")).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden,
            (await employeeClient.PostAsJsonAsync("/notifications", Request(recipientId, _companyId))).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden,
            (await employeeClient.PostAsync("/notifications/process", null)).StatusCode);
    }

    [Fact]
    public async Task The_admin_list_is_scoped_to_the_company_and_filterable_by_status()
    {
        var adminClient = await AuthenticatedClientAsync(Roles.CompanyAdmin);
        var (_, recipientId) = await SignUpAndGetTokenAsync(_factory.CreateClient(), Roles.Employee);

        var created = await (await adminClient.PostAsJsonAsync("/notifications", Request(recipientId, _companyId)))
            .Content.ReadFromJsonAsync<NotificationDetail>();

        var sent = await (await adminClient.GetAsync($"/notifications?companyId={_companyId}&status={NotificationStatuses.Sent}"))
            .Content.ReadFromJsonAsync<NotificationListResponse>();
        Assert.Contains(sent!.Notifications, n => n.Id == created!.Id);

        var cancelled = await (await adminClient.GetAsync($"/notifications?companyId={_companyId}&status={NotificationStatuses.Cancelled}"))
            .Content.ReadFromJsonAsync<NotificationListResponse>();
        Assert.DoesNotContain(cancelled!.Notifications, n => n.Id == created!.Id);

        Assert.Equal(HttpStatusCode.BadRequest,
            (await adminClient.GetAsync($"/notifications?companyId={_companyId}&status=nonsense")).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden,
            (await adminClient.GetAsync($"/notifications?companyId={_otherCompanyId}")).StatusCode);
    }

    /// <summary>Always fails, so the failure branch of the dispatch path is reachable in a test.</summary>
    private sealed class FailingNotificationSender : INotificationSender
    {
        public const string Reason = "Stub provider refused the recipient.";

        public Task<NotificationDeliveryResult> SendAsync(Notification notification, CancellationToken cancellationToken)
            => Task.FromResult(NotificationDeliveryResult.Failure(Reason));
    }

    private sealed class StubSenderWebApplicationFactory(string connectionString, INotificationSender sender)
        : AuthWebApplicationFactory(connectionString)
    {
        protected override void ConfigureWebHost(IWebHostBuilder builder)
        {
            base.ConfigureWebHost(builder);
            builder.ConfigureTestServices(services =>
            {
                services.RemoveAll<INotificationSender>();
                services.AddScoped(_ => sender);
            });
        }
    }

    /// <summary>
    /// Re-registers the DbContext with an interceptor attached. The interceptor is wired
    /// through <c>AddInterceptors</c> rather than left to be discovered from the service
    /// provider, so the wiring is explicit and does not depend on EF's DI conventions.
    /// </summary>
    private sealed class CountingWebApplicationFactory : AuthWebApplicationFactory
    {
        private readonly string _databaseConnectionString;
        private readonly CommandCountingInterceptor _interceptor;

        public CountingWebApplicationFactory(string connectionString, CommandCountingInterceptor interceptor)
            : base(connectionString)
        {
            _databaseConnectionString = connectionString;
            _interceptor = interceptor;
        }

        protected override void ConfigureWebHost(IWebHostBuilder builder)
        {
            base.ConfigureWebHost(builder);
            builder.ConfigureTestServices(services =>
            {
                services.RemoveAll<DbContextOptions<ClimateProjectDbContext>>();
                services.RemoveAll<DbContextOptions>();
                services.AddDbContext<ClimateProjectDbContext>(options =>
                    options.UseNpgsql(_databaseConnectionString).AddInterceptors(_interceptor));
            });
        }
    }

    private sealed class CommandCountingInterceptor : DbCommandInterceptor
    {
        private int _count;

        public int Count => Volatile.Read(ref _count);

        public void Reset() => Volatile.Write(ref _count, 0);

        public override InterceptionResult<DbDataReader> ReaderExecuting(
            DbCommand command, CommandEventData eventData, InterceptionResult<DbDataReader> result)
        {
            Interlocked.Increment(ref _count);
            return base.ReaderExecuting(command, eventData, result);
        }

        public override ValueTask<InterceptionResult<DbDataReader>> ReaderExecutingAsync(
            DbCommand command, CommandEventData eventData, InterceptionResult<DbDataReader> result,
            CancellationToken cancellationToken = default)
        {
            Interlocked.Increment(ref _count);
            return base.ReaderExecutingAsync(command, eventData, result, cancellationToken);
        }

        public override InterceptionResult<int> NonQueryExecuting(
            DbCommand command, CommandEventData eventData, InterceptionResult<int> result)
        {
            Interlocked.Increment(ref _count);
            return base.NonQueryExecuting(command, eventData, result);
        }

        public override ValueTask<InterceptionResult<int>> NonQueryExecutingAsync(
            DbCommand command, CommandEventData eventData, InterceptionResult<int> result,
            CancellationToken cancellationToken = default)
        {
            Interlocked.Increment(ref _count);
            return base.NonQueryExecutingAsync(command, eventData, result, cancellationToken);
        }

        public override InterceptionResult<object> ScalarExecuting(
            DbCommand command, CommandEventData eventData, InterceptionResult<object> result)
        {
            Interlocked.Increment(ref _count);
            return base.ScalarExecuting(command, eventData, result);
        }

        public override ValueTask<InterceptionResult<object>> ScalarExecutingAsync(
            DbCommand command, CommandEventData eventData, InterceptionResult<object> result,
            CancellationToken cancellationToken = default)
        {
            Interlocked.Increment(ref _count);
            return base.ScalarExecutingAsync(command, eventData, result, cancellationToken);
        }
    }
}
