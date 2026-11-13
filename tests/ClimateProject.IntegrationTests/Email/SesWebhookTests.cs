using System.Net;
using System.Security.Cryptography;
using System.Text;
using ClimateProject.Application.Auth;
using ClimateProject.Domain.Entities;
using ClimateProject.Infrastructure.Persistence;
using ClimateProject.IntegrationTests.Support;
using ClimateProject.Application.Email;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Http.HttpResults;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging.Abstractions;

namespace ClimateProject.IntegrationTests.Email;

/// <summary>
/// <c>POST /webhooks/ses</c>: an anonymous route, so every way it can be talked into writing is
/// pinned — and the one way it should write is proven against a real database.
/// </summary>
[Collection("Postgres")]
public class SesWebhookTests : IAsyncLifetime
{
    private readonly AuthWebApplicationFactory _factory;
    private readonly string _domain = $"seswebhook-{Guid.NewGuid():N}.test";
    private string _email = "";
    private Guid _userId;

    public SesWebhookTests(PostgresContainerFixture postgres) => _factory = postgres.App;

    public async Task InitializeAsync()
    {
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>();
        var now = DateTimeOffset.UtcNow;
        var company = new Company { Id = Guid.NewGuid(), Name = "Webhook Co", EmailDomain = _domain, CreatedAt = now };
        db.Companies.Add(company);
        _email = $"carlos-{Guid.NewGuid():N}@{_domain}";
        var user = new User
        {
            Id = Guid.NewGuid(), Name = "Carlos Rivera", Email = _email, PasswordHash = "x", Role = Roles.Employee,
            CompanyId = company.Id, IsActive = true, CreatedAt = now, UpdatedAt = now,
        };
        db.Users.Add(user);
        _userId = user.Id;
        await db.SaveChangesAsync();
    }

    public Task DisposeAsync() => Task.CompletedTask;

    private Task<HttpResponseMessage> PostAsync(string body, HttpClient? client = null)
        => (client ?? _factory.CreateClient()).PostAsync("/webhooks/ses", new StringContent(body, Encoding.UTF8, "text/plain"));

    private async Task<List<EmailDeliveryEvent>> EventsAsync()
    {
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>();
        return await db.EmailDeliveryEvents.AsNoTracking().Where(e => e.UserId == _userId).ToListAsync();
    }

    [Fact]
    public async Task A_signed_bounce_of_this_products_mail_to_a_person_here_is_stored()
    {
        // Upper-cased on the way in, as a receiving server may report it.
        var response = await PostAsync(TestSns.Notification(TestSns.BounceEvent(_email.ToUpperInvariant())));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var stored = Assert.Single(await EventsAsync());
        Assert.Equal(_email, stored.Email);
        Assert.Equal("bounce", stored.EventType);
        Assert.Equal("Permanent", stored.BounceType);
        Assert.Equal("smtp; 550 5.1.1 user unknown", stored.Diagnostic);
    }

    /// <summary>SNS delivers at least once. A redelivery must not make one bounce two.</summary>
    [Fact]
    public async Task The_same_delivery_twice_is_stored_once()
    {
        var body = TestSns.Notification(TestSns.BounceEvent(_email), messageId: "sns-" + Guid.NewGuid().ToString("N"));

        Assert.Equal(HttpStatusCode.OK, (await PostAsync(body)).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await PostAsync(body)).StatusCode);

        Assert.Single(await EventsAsync());
    }

    [Fact]
    public async Task A_bounce_for_an_address_nobody_here_holds_is_dropped()
    {
        var stranger = $"stranger-{Guid.NewGuid():N}@elsewhere.test";

        Assert.Equal(HttpStatusCode.OK, (await PostAsync(TestSns.Notification(TestSns.BounceEvent(stranger)))).StatusCode);

        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>();
        Assert.False(await db.EmailDeliveryEvents.AnyAsync(e => e.Email == stranger));
    }

    /// <summary>The set is shared with five other products: mail we did not tag is theirs.</summary>
    [Fact]
    public async Task Mail_this_product_did_not_tag_is_dropped()
    {
        Assert.Equal(HttpStatusCode.OK, (await PostAsync(TestSns.Notification(TestSns.BounceEvent(_email, tagged: false)))).StatusCode);

        Assert.Empty(await EventsAsync());
    }

    [Fact]
    public async Task A_message_signed_by_any_other_key_is_refused()
    {
        using var forger = RSA.Create(2048);

        var response = await PostAsync(TestSns.Notification(TestSns.BounceEvent(_email), signer: forger));

        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
        Assert.Empty(await EventsAsync());
    }

    [Fact]
    public async Task A_genuinely_signed_message_from_another_topic_is_refused()
    {
        var response = await PostAsync(TestSns.Notification(
            TestSns.BounceEvent(_email), topic: "arn:aws:sns:us-east-1:000000000000:someone-elses-topic"));

        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
        Assert.Empty(await EventsAsync());
    }

    [Fact]
    public async Task A_certificate_that_is_not_on_an_sns_host_is_refused()
    {
        var response = await PostAsync(TestSns.Notification(
            TestSns.BounceEvent(_email), certificateUrl: "https://attacker.test/SimpleNotificationService-tests.pem"));

        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
        Assert.Empty(await EventsAsync());
    }

    [Fact]
    public async Task A_body_that_is_not_an_sns_message_is_a_bad_request()
        => Assert.Equal(HttpStatusCode.BadRequest, (await PostAsync("{\"hello\":\"world\"}")).StatusCode);

    [Fact]
    public async Task A_signed_subscription_confirmation_is_confirmed()
    {
        var subscribe = "https://sns.us-east-1.amazonaws.com/?Action=ConfirmSubscription&Token=" + Guid.NewGuid().ToString("N");

        var response = await PostAsync(TestSns.Confirmation(subscribe));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Contains(subscribe, TestSns.Confirmed);
    }

    /// <summary>
    /// A deployment that was never given a topic exposes nothing, even to a validly signed
    /// message. The handler is called directly with blank options: a second host built inside
    /// this collection does not start (measured -- it times out at five minutes).
    /// </summary>
    [Fact]
    public async Task With_no_topic_configured_the_route_is_not_there()
    {
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>();
        var context = new DefaultHttpContext();
        context.Request.Body = new MemoryStream(Encoding.UTF8.GetBytes(TestSns.Notification(TestSns.BounceEvent(_email))));

        foreach (var topic in new string?[] { null, "", "   " })
        {
            context.Request.Body.Position = 0;
            var result = await ClimateProject.Api.Endpoints.SesWebhookEndpoints.ReceiveAsync(
                context.Request, new EmailOptions { SesEventsTopicArn = topic }, new TestSnsCertificateSource(),
                new RecordingSnsConfirmer(), db, NullLoggerFactory.Instance, CancellationToken.None);

            Assert.IsType<NotFound>(result);
        }

        Assert.Empty(await EventsAsync());
    }
}
