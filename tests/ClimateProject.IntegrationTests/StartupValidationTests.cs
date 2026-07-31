using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.Configuration;

namespace ClimateProject.IntegrationTests;

/// <summary>
/// appsettings.json ships secrets/connection-string placeholders as empty
/// strings ("TrackingJwtSecret": "", "ConnectionStrings:ClimateProject": "",
/// "GoogleClientId": ""). An empty string is not null, so a naive
/// "?? throw" null-coalescing guard silently lets it through: the app used to
/// start successfully with a zero-length JWT signing key and then 500 on
/// every request (including /health). These tests prove the app instead
/// fails fast at startup -- before accepting any traffic -- when
/// TrackingJwtSecret is empty.
/// </summary>
public class StartupValidationTests
{
    [Fact]
    public async Task Empty_TrackingJwtSecret_fails_startup_instead_of_accepting_traffic()
    {
        using var factory = new WebApplicationFactory<Program>().WithWebHostBuilder(builder =>
        {
            builder.ConfigureAppConfiguration((_, config) =>
            {
                config.AddInMemoryCollection(new Dictionary<string, string?>
                {
                    // Not exercised by /health (no DbContext is injected there),
                    // but must be non-empty so it doesn't mask the assertion
                    // this test is actually making.
                    ["ConnectionStrings:ClimateProject"] = "Host=localhost;Database=unused;Username=unused;Password=unused",
                    ["TrackingJwtSecret"] = string.Empty,
                    ["GoogleClientId"] = "test-google-client-id",
                });
            });
        });

        var exception = await Record.ExceptionAsync(async () =>
        {
            var client = factory.CreateClient();
            await client.GetAsync("/health");
        });

        Assert.NotNull(exception);
        Assert.True(
            ExceptionChainMentions(exception, "TrackingJwtSecret"),
            $"Expected the exception chain to mention TrackingJwtSecret (fail-fast startup guard). Actual: {exception}");
    }

    [Fact]
    public async Task Missing_TrackingJwtSecret_fails_startup_instead_of_accepting_traffic()
    {
        using var factory = new WebApplicationFactory<Program>().WithWebHostBuilder(builder =>
        {
            builder.ConfigureAppConfiguration((_, config) =>
            {
                config.AddInMemoryCollection(new Dictionary<string, string?>
                {
                    ["ConnectionStrings:ClimateProject"] = "Host=localhost;Database=unused;Username=unused;Password=unused",
                    ["GoogleClientId"] = "test-google-client-id",
                    // TrackingJwtSecret intentionally omitted entirely.
                });
            });
        });

        var exception = await Record.ExceptionAsync(async () =>
        {
            var client = factory.CreateClient();
            await client.GetAsync("/health");
        });

        Assert.NotNull(exception);
        Assert.True(
            ExceptionChainMentions(exception, "TrackingJwtSecret"),
            $"Expected the exception chain to mention TrackingJwtSecret (fail-fast startup guard). Actual: {exception}");
    }

    private static bool ExceptionChainMentions(Exception? exception, string text)
    {
        for (var current = exception; current is not null; current = current.InnerException)
        {
            if (current.Message.Contains(text, StringComparison.Ordinal))
            {
                return true;
            }

            if (current is AggregateException aggregate)
            {
                foreach (var inner in aggregate.InnerExceptions)
                {
                    if (ExceptionChainMentions(inner, text))
                    {
                        return true;
                    }
                }
            }
        }

        return false;
    }
}
