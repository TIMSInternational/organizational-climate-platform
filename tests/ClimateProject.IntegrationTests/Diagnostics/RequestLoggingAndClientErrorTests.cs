using System.Net;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using ClimateProject.Api.Endpoints;
using ClimateProject.Api.Infrastructure;
using ClimateProject.IntegrationTests.Support;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;

namespace ClimateProject.IntegrationTests.Diagnostics;

/// <summary>
/// The request line and request id (<see cref="RequestLogging"/>) and the web's crash reports
/// (<see cref="ClientErrorEndpoints"/>), #158.
///
/// <para>
/// Every assertion reads the formatted message the way an operator reads CloudWatch, through
/// <see cref="CapturingLoggerProvider"/>, under the log level the service ships with
/// (<c>Microsoft.AspNetCore</c> at Warning) -- the Development default of Information would
/// add the framework's own "Request starting" line, which carries the raw path and would make
/// the "never the raw path" assertions below meaningless.
/// </para>
/// <para>
/// No database: every route exercised here answers before one is needed (a 401 from
/// authorization, a static probe, the crash route, which touches none). The host points at an
/// unused connection string the same way <c>RateLimitingTests</c> does.
/// </para>
/// </summary>
[Collection("AppHost")]
public partial class RequestLoggingAndClientErrorTests : IClassFixture<WebApplicationFactory<Program>>
{
    private readonly WebApplicationFactory<Program> _root;

    public RequestLoggingAndClientErrorTests(WebApplicationFactory<Program> factory) => _root = factory;

    private WebApplicationFactory<Program> HostWith(CapturingLoggerProvider logs, params (string Key, string Value)[] overrides)
        => _root.WithWebHostBuilder(builder =>
        {
            builder.ConfigureAppConfiguration((_, config) =>
            {
                var settings = new Dictionary<string, string?>
                {
                    ["TrackingJwtSecret"] = AuthWebApplicationFactory.TestJwtSecret,
                    ["ConnectionStrings:ClimateProject"] = "Host=localhost;Database=unused;Username=unused;Password=unused;Timeout=2",
                    ["InternalApiKey"] = AuthWebApplicationFactory.TestInternalApiKey,
                    ["Scheduling:Enabled"] = "false",
                    ["Logging:LogLevel:Microsoft.AspNetCore"] = "Warning",
                };

                foreach (var (key, value) in overrides)
                {
                    settings[key] = value;
                }

                config.AddInMemoryCollection(settings);
            });

            builder.ConfigureLogging(logging => logging.AddProvider(logs));
        });

    private static CapturedLogRecord[] RequestLines(CapturingLoggerProvider logs)
        => [.. logs.Records.Where(record => record.Category == RequestLogging.LogCategory)];

    private static CapturedLogRecord[] CrashLines(CapturingLoggerProvider logs)
        => [.. logs.Records.Where(record => record.Category == ClientErrorEndpoints.LogCategory)];

    private static string LoggedId(CapturedLogRecord line)
    {
        var match = LoggedIdPattern().Match(line.Message);
        Assert.True(match.Success, $"no id= in: {line.Message}");
        return match.Groups[1].Value;
    }

    private static string HeaderId(HttpResponseMessage response)
    {
        Assert.True(
            response.Headers.TryGetValues(RequestLogging.HeaderName, out var values),
            $"{RequestLogging.HeaderName} missing on {(int)response.StatusCode}");
        var id = Assert.Single(values);
        Assert.False(string.IsNullOrWhiteSpace(id));
        return id;
    }

    private static StringContent Report(string json) => new(json, Encoding.UTF8, "text/plain");

    // ------------------------------------------------------------------
    // The request line.
    // ------------------------------------------------------------------

    [Fact]
    public async Task A_request_line_names_the_route_template_and_never_the_raw_id_or_query()
    {
        var logs = new CapturingLoggerProvider();
        using var client = HostWith(logs).CreateClient();
        var surveyId = Guid.NewGuid();

        using var response = await client.GetAsync($"/surveys/{surveyId}/results?companyId=SECRETQUERYVALUE#frag");

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
        var line = Assert.Single(RequestLines(logs));
        Assert.Equal(LogLevel.Information, line.Level);
        Assert.StartsWith(RequestLogging.LinePrefix + " GET /surveys/{id:guid}/results 401 ", line.Message, StringComparison.Ordinal);

        // Over every record the host wrote: an id or a query value that reached any sink
        // reached CloudWatch.
        Assert.DoesNotContain(logs.Records, record => record.Message.Contains(surveyId.ToString(), StringComparison.OrdinalIgnoreCase));
        Assert.DoesNotContain(logs.Records, record => record.Message.Contains("SECRETQUERYVALUE", StringComparison.Ordinal));
        Assert.DoesNotContain(logs.Records, record => record.Message.Contains("companyId=", StringComparison.Ordinal));
    }

    [Fact]
    public async Task The_request_id_header_is_the_id_in_the_request_line()
    {
        var logs = new CapturingLoggerProvider();
        using var client = HostWith(logs).CreateClient();

        using var response = await client.GetAsync($"/surveys/{Guid.NewGuid()}/results");

        Assert.Equal(LoggedId(Assert.Single(RequestLines(logs))), HeaderId(response));
    }

    [Fact]
    public async Task An_unmatched_path_is_logged_as_unmatched_and_not_as_its_path()
    {
        var logs = new CapturingLoggerProvider();
        using var client = HostWith(logs).CreateClient();

        using var response = await client.GetAsync("/no-such-route/SECRETPATHVALUE%0AFORGED");

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
        var line = Assert.Single(RequestLines(logs));
        Assert.Contains(" GET (unmatched) 404 ", line.Message, StringComparison.Ordinal);
        Assert.DoesNotContain(logs.Records, record => record.Message.Contains("SECRETPATHVALUE", StringComparison.Ordinal));
        Assert.DoesNotContain(logs.Records, record => record.Message.Contains('\n', StringComparison.Ordinal));
    }

    [Fact]
    public async Task The_probes_produce_no_request_line_but_still_carry_the_id()
    {
        var logs = new CapturingLoggerProvider();
        using var client = HostWith(logs).CreateClient();

        foreach (var path in new[] { "/health", "/version", "/HEALTH" })
        {
            using var response = await client.GetAsync(path);
            Assert.Equal(HttpStatusCode.OK, response.StatusCode);
            HeaderId(response);
        }

        Assert.Empty(RequestLines(logs));
    }

    [Fact]
    public async Task The_cors_policy_exposes_the_request_id_to_the_web()
    {
        var logs = new CapturingLoggerProvider();
        const string origin = "https://climate.example.test";
        using var client = HostWith(logs, ("Cors:AllowedOrigins:0", origin)).CreateClient();
        using var request = new HttpRequestMessage(HttpMethod.Get, "/version");
        request.Headers.Add("Origin", origin);

        using var response = await client.SendAsync(request);

        Assert.True(response.Headers.TryGetValues("Access-Control-Expose-Headers", out var exposed), "no Access-Control-Expose-Headers");
        Assert.Contains(RequestLogging.HeaderName, string.Join(',', exposed), StringComparison.OrdinalIgnoreCase);
    }

    // ------------------------------------------------------------------
    // Error bodies carry the id.
    // ------------------------------------------------------------------

    [Fact]
    public async Task An_oversized_body_is_refused_413_and_the_body_carries_the_request_id()
    {
        var logs = new CapturingLoggerProvider();
        using var client = HostWith(logs).CreateClient();
        var stack = new string('x', (int)ClientErrorEndpoints.MaxBodyBytes);

        using var response = await client.PostAsync(
            ClientErrorEndpoints.Route,
            Report(JsonSerializer.Serialize(new { message = "boom", stack })));

        Assert.Equal(HttpStatusCode.RequestEntityTooLarge, response.StatusCode);
        using var body = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        Assert.Equal(HeaderId(response), body.RootElement.GetProperty("requestId").GetString());
        Assert.Empty(CrashLines(logs));
        Assert.Contains(" POST /client-errors 413 ", Assert.Single(RequestLines(logs)).Message, StringComparison.Ordinal);
    }

    [Fact]
    public async Task A_report_that_is_not_json_is_refused_400_with_the_id_and_nothing_echoed()
    {
        var logs = new CapturingLoggerProvider();
        using var client = HostWith(logs).CreateClient();

        using var response = await client.PostAsync(ClientErrorEndpoints.Route, Report("{not json ECHOME"));

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        var text = await response.Content.ReadAsStringAsync();
        Assert.DoesNotContain("ECHOME", text, StringComparison.Ordinal);
        using var body = JsonDocument.Parse(text);
        Assert.Equal(HeaderId(response), body.RootElement.GetProperty("requestId").GetString());
        Assert.Empty(CrashLines(logs));
    }

    // ------------------------------------------------------------------
    // The crash report.
    // ------------------------------------------------------------------

    [Fact]
    public async Task A_crash_report_answers_204_and_writes_one_warning_line_with_no_query_string()
    {
        var logs = new CapturingLoggerProvider();
        using var client = HostWith(logs).CreateClient();

        // A build stamp is 40 hex characters; built at run time so the secret scanner does not
        // read a literal one as a credential.
        var build = string.Concat(Enumerable.Repeat("c0ffee", 7))[..40];
        var report = JsonSerializer.Serialize(new
        {
            message = "Failed to fetch https://api.example.test/x?token=SECRETQUERY#access_token=SECRETFRAG for ana@example.com",
            stack = "TypeError: boom\n    at render (https://climate.example.test/assets/SurveyResultsNextPage-CkA1b2c3.js?v=SECRETVERSION:1:200)\n    at x (y.js#SECRETHASH:2:3)",
            route = "/s/:token",
            build,
        });
        using var request = new HttpRequestMessage(HttpMethod.Post, ClientErrorEndpoints.Route) { Content = Report(report) };
        request.Headers.UserAgent.ParseAdd("Mozilla/5.0 (TestAgent)");

        using var response = await client.SendAsync(request);

        Assert.Equal(HttpStatusCode.NoContent, response.StatusCode);
        Assert.Empty(await response.Content.ReadAsByteArrayAsync());

        var line = Assert.Single(CrashLines(logs));
        Assert.Equal(LogLevel.Warning, line.Level);
        Assert.StartsWith(ClientErrorEndpoints.LogLiteral + $" route=/s/:token build={build} ", line.Message, StringComparison.Ordinal);
        Assert.Contains("SurveyResultsNextPage-CkA1b2c3.js", line.Message, StringComparison.Ordinal);
        Assert.Contains("Mozilla/5.0 (TestAgent)", line.Message, StringComparison.Ordinal);
        Assert.Equal(HeaderId(response), LoggedId(line));

        foreach (var forbidden in new[] { "SECRETQUERY", "SECRETFRAG", "SECRETVERSION", "SECRETHASH", "ana@example.com", "?", "#" })
        {
            Assert.DoesNotContain(forbidden, line.Message, StringComparison.Ordinal);
        }

        Assert.DoesNotContain('\n', line.Message);

        // The request line for the report itself must not read as a second crash to the
        // metric filter that counts the literal.
        Assert.DoesNotContain(ClientErrorEndpoints.LogLiteral, Assert.Single(RequestLines(logs)).Message, StringComparison.Ordinal);
    }

    [Fact]
    public async Task Crash_reports_are_rate_limited_per_caller()
    {
        var logs = new CapturingLoggerProvider();
        using var client = HostWith(logs, ("RateLimiting:TrustedProxyHopCount", "1")).CreateClient();

        async Task<HttpStatusCode> SendFrom(string caller)
        {
            using var request = new HttpRequestMessage(HttpMethod.Post, ClientErrorEndpoints.Route)
            {
                Content = Report("""{"message":"boom","route":"/dashboard"}"""),
            };
            request.Headers.Add(ClientIpResolver.ForwardedForHeaderName, caller);
            using var response = await client.SendAsync(request);
            return response.StatusCode;
        }

        for (var i = 0; i < RateLimitPolicies.ClientErrorPermitsPerWindow; i++)
        {
            Assert.Equal(HttpStatusCode.NoContent, await SendFrom("203.0.113.10"));
        }

        Assert.Equal(HttpStatusCode.TooManyRequests, await SendFrom("203.0.113.10"));
        Assert.Equal(HttpStatusCode.NoContent, await SendFrom("203.0.113.11"));
        Assert.Equal(RateLimitPolicies.ClientErrorPermitsPerWindow + 1, CrashLines(logs).Length);
    }

    // ------------------------------------------------------------------
    // The sanitizer, directly: what a raw path or a token turns into.
    // ------------------------------------------------------------------

    [Theory]
    [InlineData("/s/:token", "/s/:token")]
    [InlineData("/surveys/:id/results", "/surveys/:id/results")]
    [InlineData("/admin/companies/:companyId/demographic-fields", "/admin/companies/:companyId/demographic-fields")]
    [InlineData("/s/Zx81kq0PdLm2Nw9Rt5Yb", "/s/:redacted")]
    [InlineData("/surveys/3f2a9c1e-5b7d-4e8f-9a0b-1c2d3e4f5a6b/results", "/surveys/:redacted/results")]
    [InlineData("/survey-invitations/abcdefghijklmnopqrstuvwx", "/survey-invitations/:redacted")]
    [InlineData("/dashboard?token=abc#x", "/dashboard")]
    [InlineData("/a b\n/c", "/ab/c")]
    [InlineData("", "(none)")]
    public void A_route_that_is_not_a_pattern_is_reduced_to_one(string raw, string expected)
        => Assert.Equal(expected, ClientErrorReportSanitizer.CleanRoute(raw));

    [Fact]
    public void A_message_is_truncated_after_it_is_cleaned()
    {
        var clean = ClientErrorReportSanitizer.Clean(new string('a', 2000), ClientErrorReportSanitizer.MaxMessageLength);

        Assert.Equal(ClientErrorReportSanitizer.MaxMessageLength + 1, clean.Length);
        Assert.EndsWith("…", clean, StringComparison.Ordinal);
    }

    [Fact]
    public void A_token_shaped_run_is_redacted_but_a_long_identifier_is_kept()
    {
        var clean = ClientErrorReportSanitizer.Clean(
            "jwt eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9 in useSurveyResultsQueryWithFilters",
            ClientErrorReportSanitizer.MaxMessageLength);

        Assert.DoesNotContain("eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9", clean, StringComparison.Ordinal);
        Assert.Contains("[redacted]", clean, StringComparison.Ordinal);
        Assert.Contains("useSurveyResultsQueryWithFilters", clean, StringComparison.Ordinal);
    }

    // ------------------------------------------------------------------
    // The alarm reads what the endpoint writes.
    // ------------------------------------------------------------------

    [Fact]
    public void The_alarm_counts_the_literal_the_endpoint_writes()
    {
        var dir = new DirectoryInfo(AppContext.BaseDirectory);
        while (dir is not null && !File.Exists(Path.Combine(dir.FullName, "ClimateProject.slnx")))
        {
            dir = dir.Parent;
        }

        Assert.NotNull(dir);
        var template = File.ReadAllText(Path.Combine(dir.FullName, "infra", "aws", "climate-project-observability.yml"));

        // The filter is a quoted substring (see the template's header for why), so the only
        // way for it to stop matching is for the literal or the pattern to change alone.
        Assert.Contains($"FilterPattern: '\"{ClientErrorEndpoints.LogLiteral}\"'", template, StringComparison.Ordinal);
        Assert.Contains("MetricName: WebCrashReported", template, StringComparison.Ordinal);
        Assert.DoesNotContain(ClientErrorEndpoints.LogLiteral, ClientErrorEndpoints.Route, StringComparison.Ordinal);
        Assert.DoesNotContain(ClientErrorEndpoints.LogLiteral, RequestLogging.LinePrefix, StringComparison.Ordinal);
    }

    [GeneratedRegex(@"id=(\S+)$")]
    private static partial Regex LoggedIdPattern();
}
