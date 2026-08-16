using ClimateProject.Api.Scheduling;
using ClimateProject.Application.Notifications;
using ClimateProject.Application.OrgStructure;
using ClimateProject.Application.Scheduling;
using ClimateProject.Infrastructure.Email;
using ClimateProject.Infrastructure.Notifications;
using ClimateProject.Infrastructure.OrgStructure;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;

namespace ClimateProject.IntegrationTests;

/// <summary>
/// One host, configured with a mail provider, shared by every test in
/// <see cref="EmailDeliveryRegistrationTests"/>.
///
/// A class fixture rather than a field, for the reason <c>UnreachableDatabaseHostFixture</c>
/// gives: xUnit instantiates a test class once per test method, so a factory built in the
/// constructor would boot one host per test. Host boots are the structural hazard
/// <c>AppHostCollection</c> documents, and all three tests want identical configuration.
///
/// Nothing here is ever dialled. Resolving a sender opens no connection, and no test in this
/// class sends anything.
/// </summary>
public sealed class ConfiguredEmailHostFixture : IDisposable
{
    public WebApplicationFactory<Program> Factory { get; } = new WebApplicationFactory<Program>()
        .WithWebHostBuilder(builder => builder.ConfigureAppConfiguration((_, config) =>
            config.AddInMemoryCollection(new Dictionary<string, string?>
            {
                // A complete configuration: several settings are validated at startup, so
                // overriding only the email ones would fail the host for an unrelated reason.
                ["ConnectionStrings:ClimateProject"] = "Host=localhost;Database=unused;Username=unused;Password=unused",
                ["TrackingJwtSecret"] = "integration-test-tracking-jwt-secret-32-bytes-min",
                ["InternalApiKey"] = "integration-test-internal-api-key",
                ["GoogleClientId"] = "test-google-client-id",

                ["Email:Provider"] = "smtp",
                ["Email:SmtpHost"] = "smtp.example.invalid",
                ["Email:FromAddress"] = "no-reply@example.com",
                ["Email:AppBaseUrl"] = "https://app.example.com",

                // The API co-hosts the scheduled jobs (#275); this host starts and stays up
                // for the whole class, so they must run idle rather than tick against the
                // unused connection string above.
                ["Scheduling:Enabled"] = "false",
            })));

    public void Dispose() => Factory.Dispose();
}

/// <summary>
/// Does #100 actually take effect?
///
/// Everything else about this change can be right while the one thing that matters is wrong:
/// the two delivery seams are resolved from configuration by a factory in <c>Program.cs</c>,
/// and if that factory picked the stub regardless, every other test in the suite would still
/// pass -- the stub reports success, so notifications would go on being marked <c>sent</c>
/// exactly as they were before. This asserts the concrete types the container hands out when
/// a provider is configured.
///
/// The unconfigured direction needs no host of its own: <c>NotificationEndpointsTests</c>
/// already runs its whole surface against the default registration.
/// </summary>
[Collection("AppHost")]
public class EmailDeliveryRegistrationTests(ConfiguredEmailHostFixture fixture)
    : IClassFixture<ConfiguredEmailHostFixture>
{
    [Fact]
    public void A_configured_provider_replaces_the_notification_stub_with_the_real_sender()
    {
        using var scope = fixture.Factory.Services.CreateScope();

        Assert.IsType<EmailNotificationSender>(scope.ServiceProvider.GetRequiredService<INotificationSender>());
    }

    [Fact]
    public void A_configured_provider_replaces_the_invitation_stub_too()
    {
        // The invitation stub is the reason #100 blocks UAT in #161: an invite flow that never
        // sends an invite cannot be walked through by a human.
        using var scope = fixture.Factory.Services.CreateScope();

        Assert.IsType<EmailInvitationEmailSender>(scope.ServiceProvider.GetRequiredService<IInvitationEmailSender>());
    }

    /// <summary>
    /// The #91 selection rule's configured arm: with a provider present, scheduled reports
    /// must be generated and delivered by the real runner, not logged away by the stub. The
    /// unconfigured arm -- stub stays, nothing claims delivery -- is asserted in
    /// <c>ApiSchedulingCoHostTests</c> against its unconfigured host.
    /// </summary>
    [Fact]
    public void A_configured_provider_selects_the_real_scheduled_report_runner()
    {
        using var scope = fixture.Factory.Services.CreateScope();

        Assert.IsType<DeliveringScheduledReportRunner>(
            scope.ServiceProvider.GetRequiredService<IScheduledReportRunner>());
    }

    [Fact]
    public void The_rate_limiter_is_shared_across_scopes_so_it_paces_the_whole_process()
    {
        // A per-scope limiter would reset on every request and pace nothing, which is the
        // difference between staying inside the provider's per-second cap and discovering it.
        using var first = fixture.Factory.Services.CreateScope();
        using var second = fixture.Factory.Services.CreateScope();

        Assert.Same(
            first.ServiceProvider.GetRequiredService<EmailSendRateLimiter>(),
            second.ServiceProvider.GetRequiredService<EmailSendRateLimiter>());
    }
}
