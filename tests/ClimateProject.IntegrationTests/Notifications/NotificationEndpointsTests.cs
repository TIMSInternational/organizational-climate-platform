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
    private readonly string _companyDomain = $"notif-{Guid.NewGuid():N}.test";
    private readonly string _otherCompanyDomain = $"notif-other-{Guid.NewGuid():N}.test";
    private AuthWebApplicationFactory? _defaultFactory;
    private Guid _companyId;
    private Guid _otherCompanyId;

    public NotificationEndpointsTests(PostgresContainerFixture postgres) => _postgres = postgres;

    /// <summary>
    /// **Exactly one application host per test, never more.**
    ///
    /// Two tests here need a customised host (a failing sender; a command-counting
    /// interceptor). The obvious shape -- a shared default factory plus a second one inside
    /// those tests -- boots two or three hosts per test, and concurrent
    /// <c>WebApplicationFactory&lt;Program&gt;</c> boots are the identified cause of the
    /// spurious <c>ObjectDisposedException</c> in <c>StartupValidationTests</c> (see
    /// <c>AppHostCollection</c>, which serialises the AppHost classes against each other but
    /// *not* against this Postgres collection). Tripling this class's host boots reproduced
    /// exactly that failure on CI.
    ///
    /// So the default factory is lazy and the two customised tests never touch it, while
    /// migrations and seeding go through a bare DbContext -- the way the Persistence tests
    /// already do -- rather than through a host of their own.
    /// </summary>
    private AuthWebApplicationFactory Factory => _defaultFactory ??= new AuthWebApplicationFactory(_postgres.ConnectionString);

    private ClimateProjectDbContext CreateContext() => new(
        new DbContextOptionsBuilder<ClimateProjectDbContext>().UseNpgsql(_postgres.ConnectionString).Options);

    public async Task InitializeAsync()
    {
        await using var db = CreateContext();
        await db.Database.MigrateAsync();

        var company = new Company { Id = Guid.NewGuid(), Name = "Notif Co", EmailDomain = _companyDomain, CreatedAt = DateTimeOffset.UtcNow };
        var otherCompany = new Company { Id = Guid.NewGuid(), Name = "Other Co", EmailDomain = _otherCompanyDomain, CreatedAt = DateTimeOffset.UtcNow };
        db.Companies.AddRange(company, otherCompany);
        _companyId = company.Id;
        _otherCompanyId = otherCompany.Id;
        await db.SaveChangesAsync();
    }

    public Task DisposeAsync()
    {
        _defaultFactory?.Dispose();
        return Task.CompletedTask;
    }

    private async Task<(string Token, Guid UserId)> SignUpAndGetTokenAsync(HttpClient client, string role, string? domain = null)
    {
        var email = $"{Guid.NewGuid():N}@{domain ?? _companyDomain}";
        var signup = await client.PostAsJsonAsync("/auth/signup", new SignupRequest("Test User", email, "a-good-password"));
        Assert.Equal(HttpStatusCode.Created, signup.StatusCode);

        Guid userId;
        await using (var db = CreateContext())
        {
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
        var client = Factory.CreateClient();
        var (token, _) = await SignUpAndGetTokenAsync(client, role, domain);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);
        return client;
    }

    private async Task WithDbAsync(Func<ClimateProjectDbContext, Task> action)
    {
        await using var db = CreateContext();
        await action(db);
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
        var (_, recipientId) = await SignUpAndGetTokenAsync(Factory.CreateClient(), Roles.Employee);

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
        var (_, recipientId) = await SignUpAndGetTokenAsync(Factory.CreateClient(), Roles.Employee);

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

        var userAClient = Factory.CreateClient();
        var (userAToken, userAId) = await SignUpAndGetTokenAsync(userAClient, Roles.Employee);
        userAClient.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", userAToken);

        var userBClient = Factory.CreateClient();
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
        var (_, recipientId) = await SignUpAndGetTokenAsync(Factory.CreateClient(), Roles.Employee);

        var response = await foreignAdmin.PostAsJsonAsync("/notifications", Request(recipientId, _companyId));

        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
    }

    [Fact]
    public async Task An_email_opt_out_suppresses_delivery_and_is_recorded_as_cancelled_not_failed()
    {
        var adminClient = await AuthenticatedClientAsync(Roles.CompanyAdmin);
        var (_, recipientId) = await SignUpAndGetTokenAsync(Factory.CreateClient(), Roles.Employee);

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
        var (_, recipientId) = await SignUpAndGetTokenAsync(Factory.CreateClient(), Roles.Employee);

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
        var (_, firstId) = await SignUpAndGetTokenAsync(Factory.CreateClient(), Roles.Employee);
        var (_, secondId) = await SignUpAndGetTokenAsync(Factory.CreateClient(), Roles.Employee);
        var (_, foreignId) = await SignUpAndGetTokenAsync(Factory.CreateClient(), Roles.Employee, _otherCompanyDomain);
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
        // The counting factory is the ONLY host this test boots -- the shared `Factory` is
        // deliberately never touched here. See the comment on that property.
        var counter = new CommandCountingInterceptor();
        using var countingFactory = new CountingWebApplicationFactory(_postgres.ConnectionString, counter);

        var (adminToken, _) = await SignUpAndGetTokenAsync(countingFactory.CreateClient(), Roles.CompanyAdmin);

        var oneRecipient = new List<Guid>();
        var fiveRecipients = new List<Guid>();
        for (var i = 0; i < 5; i++)
        {
            var (_, id) = await SignUpAndGetTokenAsync(countingFactory.CreateClient(), Roles.Employee);
            fiveRecipients.Add(id);
            if (i == 0) oneRecipient.Add(id);
        }

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
    public async Task A_transient_failure_backs_off_before_process_retries_it()
    {
        // Likewise the only host this test boots.
        using var failingFactory = new StubSenderWebApplicationFactory(
            _postgres.ConnectionString,
            new ScriptedNotificationSender(
                NotificationDeliveryResult.Failure(ScriptedNotificationSender.TransientReason)));

        var (adminToken, _) = await SignUpAndGetTokenAsync(failingFactory.CreateClient(), Roles.CompanyAdmin);
        var (_, recipientId) = await SignUpAndGetTokenAsync(failingFactory.CreateClient(), Roles.Employee);

        var client = failingFactory.CreateClient();
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", adminToken);

        var response = await client.PostAsJsonAsync("/notifications", Request(recipientId, _companyId));
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        var failed = (await response.Content.ReadFromJsonAsync<NotificationDetail>())!;

        Assert.Equal(NotificationStatuses.Failed, failed.Status);
        Assert.NotNull(failed.FailedAt);
        Assert.Null(failed.SentAt);
        Assert.Equal(1, failed.RetryCount);
        Assert.Equal(ScriptedNotificationSender.TransientReason, failed.FailureReason);

        // #100: a row that has just failed is NOT retried on the next sweep. Before the
        // backoff, /process would immediately re-attempt it -- which against a real provider
        // means hammering a host that has just said "not now" with the exact traffic it
        // refused. The row is still `failed` and still retryable; it is simply not yet due.
        var tooSoon = await client.PostAsync($"/notifications/process?companyId={_companyId}", null);
        var tooSoonResult = (await tooSoon.Content.ReadFromJsonAsync<NotificationProcessResult>())!;
        Assert.Equal(0, tooSoonResult.Attempted);

        await WithDbAsync(async db =>
        {
            var unchanged = await db.Notifications.AsNoTracking().FirstAsync(n => n.Id == failed.Id);
            Assert.Equal(1, unchanged.RetryCount);
        });

        // Backdating FailedAt past the first-retry delay is how the passage of time is
        // simulated -- the backoff is derived from FailedAt and RetryCount rather than stored
        // in a next_attempt_at column, so moving FailedAt is exactly equivalent to waiting.
        await WithDbAsync(async db =>
        {
            var row = await db.Notifications.FirstAsync(n => n.Id == failed.Id);
            row.FailedAt = DateTimeOffset.UtcNow - NotificationRetryPolicy.FirstRetryDelay - TimeSpan.FromSeconds(30);
            await db.SaveChangesAsync();
        });

        var processed = await client.PostAsync($"/notifications/process?companyId={_companyId}", null);
        var result = (await processed.Content.ReadFromJsonAsync<NotificationProcessResult>())!;
        Assert.Equal(1, result.Attempted);
        Assert.Equal(1, result.Failed);

        await WithDbAsync(async db =>
        {
            var reloaded = await db.Notifications.AsNoTracking().FirstAsync(n => n.Id == failed.Id);
            Assert.Equal(2, reloaded.RetryCount);
            Assert.Equal(NotificationStatuses.Failed, reloaded.Status);
        });
    }

    [Fact]
    public async Task A_permanent_failure_is_dead_lettered_and_never_retried_and_the_sender_gets_the_recipients_address()
    {
        var sender = new ScriptedNotificationSender(
            NotificationDeliveryResult.PermanentFailure(ScriptedNotificationSender.PermanentReason));

        // The only host this test boots.
        using var bouncingFactory = new StubSenderWebApplicationFactory(_postgres.ConnectionString, sender);

        var (adminToken, _) = await SignUpAndGetTokenAsync(bouncingFactory.CreateClient(), Roles.CompanyAdmin);
        var (_, recipientId) = await SignUpAndGetTokenAsync(bouncingFactory.CreateClient(), Roles.Employee);

        string recipientEmail = string.Empty;
        await WithDbAsync(async db =>
        {
            var user = await db.Users.FirstAsync(u => u.Id == recipientId);
            user.Preferences.Language = "es";
            await db.SaveChangesAsync();
            recipientEmail = user.Email;
        });

        var client = bouncingFactory.CreateClient();
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", adminToken);

        var response = await client.PostAsJsonAsync("/notifications", Request(recipientId, _companyId));
        var bounced = (await response.Content.ReadFromJsonAsync<NotificationDetail>())!;

        Assert.Equal(NotificationStatuses.Failed, bounced.Status);
        Assert.Equal(ScriptedNotificationSender.PermanentReason, bounced.FailureReason);

        // Dead-lettered by exhausting the retry budget in one step rather than by inventing a
        // status: the row stays `failed` and stays visible in GET /notifications?status=failed,
        // but /process can never pick it up again however long anyone waits. Retrying a hard
        // bounce is how a sending domain's reputation gets burned.
        await WithDbAsync(async db =>
        {
            var row = await db.Notifications.AsNoTracking().FirstAsync(n => n.Id == bounced.Id);
            Assert.Equal(row.MaxRetries, row.RetryCount);

            // Backdate well past every backoff step: the reason it is not retried must be the
            // exhausted budget, not the delay.
            var tracked = await db.Notifications.FirstAsync(n => n.Id == bounced.Id);
            tracked.FailedAt = DateTimeOffset.UtcNow - TimeSpan.FromDays(1);
            await db.SaveChangesAsync();
        });

        var swept = await client.PostAsync($"/notifications/process?companyId={_companyId}", null);
        Assert.Equal(0, (await swept.Content.ReadFromJsonAsync<NotificationProcessResult>())!.Attempted);

        // Still listed, so a failed send is visible rather than lost.
        var failedList = await client.GetFromJsonAsync<NotificationListResponse>(
            $"/notifications?companyId={_companyId}&status={NotificationStatuses.Failed}");
        Assert.Contains(failedList!.Notifications, n => n.Id == bounced.Id);

        // The seam carried the address and the recipient's own language, which is the whole
        // reason NotificationRecipient exists -- a notification row has neither.
        var seen = Assert.Single(sender.Recipients);
        Assert.Equal(recipientId, seen.UserId);
        Assert.Equal(recipientEmail, seen.EmailAddress);
        Assert.Equal("es", seen.Language);
    }

    [Theory]
    [InlineData(NotificationChannels.Push)]
    [InlineData("carrier_pigeon")]
    public async Task An_undeliverable_channel_is_rejected_rather_than_reported_as_sent(string channel)
    {
        var adminClient = await AuthenticatedClientAsync(Roles.CompanyAdmin);
        var (_, recipientId) = await SignUpAndGetTokenAsync(Factory.CreateClient(), Roles.Employee);

        var response = await adminClient.PostAsJsonAsync("/notifications", Request(
            recipientId, _companyId, NotificationTypes.SystemNotification, channel));

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task An_unknown_type_or_malformed_data_is_rejected_with_a_message_not_a_500()
    {
        var adminClient = await AuthenticatedClientAsync(Roles.CompanyAdmin);
        var (_, recipientId) = await SignUpAndGetTokenAsync(Factory.CreateClient(), Roles.Employee);

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
        var client = Factory.CreateClient();
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
        var client = Factory.CreateClient();
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
        var (_, recipientId) = await SignUpAndGetTokenAsync(Factory.CreateClient(), Roles.Employee);

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
        var (_, recipientId) = await SignUpAndGetTokenAsync(Factory.CreateClient(), Roles.Employee);

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

    /// <summary>
    /// Returns a scripted outcome and records who it was asked to deliver to, so the failure
    /// branches of the dispatch path are reachable in a test and the recipient handed across
    /// the seam can be asserted on.
    ///
    /// Recording the recipient is not incidental: before #100 the seam took only a
    /// <c>Notification</c>, which carries a user id and no address, so a sender physically
    /// could not deliver anything. What this pins is that the dispatch path resolves the
    /// recipient itself -- address and language included -- rather than leaving the sender to
    /// query for it.
    /// </summary>
    private sealed class ScriptedNotificationSender(NotificationDeliveryResult result) : INotificationSender
    {
        public const string TransientReason = "Stub provider refused the recipient.";
        public const string PermanentReason = "Stub provider hard-bounced the recipient.";

        private readonly List<NotificationRecipient> _recipients = [];

        public IReadOnlyList<NotificationRecipient> Recipients
        {
            get { lock (_recipients) { return [.. _recipients]; } }
        }

        public Task<NotificationDeliveryResult> SendAsync(
            Notification notification,
            NotificationRecipient recipient,
            CancellationToken cancellationToken)
        {
            lock (_recipients) { _recipients.Add(recipient); }
            return Task.FromResult(result);
        }
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
