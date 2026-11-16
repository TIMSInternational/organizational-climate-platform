using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using ClimateProject.Api.Infrastructure;

namespace ClimateProject.Api.Endpoints;

/// <summary>
/// <c>POST /client-errors</c>: the web reports a crash, and the API writes it to its own log as
/// one Warning line (#158).
///
/// <para>
/// <b>Why.</b> Measured 2026-11-15: a screen that threw rendered <c>RouteErrorBoundary</c>'s card
/// and told nobody. There was no <c>window.onerror</c> and no <c>unhandledrejection</c> handler
/// anywhere in <c>web/</c>, so a broken build in front of eight hundred respondents was invisible
/// until one of them wrote to the client. This puts the crash in the API's application log group,
/// where a metric filter counts <see cref="LogLiteral"/> and an alarm in
/// <c>infra/aws/climate-project-observability.yml</c> pages on it.
/// </para>
/// <para>
/// <b>Anonymous, and bounded three ways for that reason.</b> A respondent's page crashes too and a
/// respondent has no account, so the route cannot require one. What stops it being a free way to
/// write to the log group: the <see cref="RateLimitPolicies.ClientError"/> policy (per caller
/// address), a body ceiling of <see cref="MaxBodyBytes"/> enforced by the size-limit middleware
/// before anything is read (413), and per-field truncation below.
/// </para>
/// <para>
/// <b>What the line may carry.</b> Nothing that identifies a person or opens a survey. The web
/// sends the matched ROUTE PATTERN (<c>/s/:token</c>), never <c>location.pathname</c>, because a
/// respondent's path IS their access token; and it scrubs before it sends. This side does not
/// trust that: <see cref="ClientErrorReportSanitizer"/> strips query strings and fragments, emails,
/// long token-shaped runs and control characters from every field, and replaces any route segment
/// that looks like an id or a token. Nothing is echoed: the answer is always an empty 204.
/// </para>
/// </summary>
public static class ClientErrorEndpoints
{
    public const string Route = "/client-errors";

    /// <summary>The logger category of the crash line.</summary>
    public const string LogCategory = "ClimateProject.Api.ClientErrors";

    /// <summary>
    /// The literal the crash line starts with and the metric filter counts. Deliberately NOT a
    /// substring of <see cref="Route"/>: the request line for this very route
    /// (<c>api-request POST /client-errors 204 ...</c>) would otherwise be counted as a second
    /// crash for every report.
    /// </summary>
    public const string LogLiteral = "web-crash-report";

    /// <summary>
    /// Body ceiling. An honest report is under 3 KB -- 500 characters of message, 2 KB of stack,
    /// a route, a build stamp -- so 8 KB carries any of them with room, and refuses anything else
    /// before it is read.
    /// </summary>
    public const long MaxBodyBytes = 8 * 1024;

    public static void MapClientErrorEndpoints(this WebApplication app)
    {
        app.MapPost(Route, Receive)
            .AllowAnonymous()
            .RequireRateLimiting(RateLimitPolicies.ClientError)
            .WithMetadata(new MaxRequestBodyBytesMetadata(MaxBodyBytes));
    }

    /// <summary>
    /// Reads the body itself rather than binding a parameter, so the web can send it as
    /// <c>text/plain</c>. That is a CORS-safelisted type, so a cross-origin report needs no
    /// preflight -- which matters because the report is sent with <c>keepalive</c> as the page
    /// may be unloading, and a preflighted keepalive request is exactly the kind browsers have
    /// refused or dropped. The JSON inside is the same either way; any content type is read.
    /// </summary>
    internal static async Task<IResult> Receive(HttpContext context, ILoggerFactory loggerFactory)
    {
        ClientErrorReport? report;
        try
        {
            using var reader = new StreamReader(context.Request.Body, Encoding.UTF8);
            var body = await reader.ReadToEndAsync(context.RequestAborted);
            report = string.IsNullOrWhiteSpace(body)
                ? null
                : JsonSerializer.Deserialize<ClientErrorReport>(body, JsonSerializerOptions.Web);
        }
        catch (JsonException)
        {
            // Never echoed, not even the parser's position: the body is the caller's text.
            return Results.Json(
                new { message = "The crash report is not valid JSON.", requestId = context.TraceIdentifier },
                statusCode: StatusCodes.Status400BadRequest);
        }

        var clean = ClientErrorReportSanitizer.Sanitize(report, context.Request.Headers.UserAgent.ToString());

        loggerFactory.CreateLogger(LogCategory).LogWarning(
            LogLiteral + " route={Route} build={Build} message={Message} stack={Stack} ua={UserAgent} id={RequestId}",
            clean.Route,
            clean.Build,
            clean.Message,
            clean.Stack,
            clean.UserAgent,
            context.TraceIdentifier);

        return Results.NoContent();
    }
}

/// <summary>The body the web sends. Every field optional: a report with nothing in it is still a crash.</summary>
public sealed record ClientErrorReport(string? Message, string? Stack, string? Route, string? Build);

/// <summary>A report after <see cref="ClientErrorReportSanitizer.Sanitize"/>: safe to write to a log line.</summary>
public sealed record SanitizedClientError(string Message, string Stack, string Route, string Build, string UserAgent);

/// <summary>
/// Makes a crash report safe to write to a log line. Server-side on purpose, even though the web
/// scrubs first: the route is anonymous, so anything can arrive here, and a log line is forever.
/// </summary>
internal static partial class ClientErrorReportSanitizer
{
    public const int MaxMessageLength = 500;
    public const int MaxStackLength = 2048;
    public const int MaxRouteLength = 200;
    public const int MaxBuildLength = 64;
    public const int MaxUserAgentLength = 300;

    internal const string None = "(none)";

    public static SanitizedClientError Sanitize(ClientErrorReport? report, string? userAgent)
        => new(
            Message: Clean(report?.Message, MaxMessageLength),
            Stack: Clean(report?.Stack, MaxStackLength),
            Route: CleanRoute(report?.Route),
            Build: CleanBuild(report?.Build),
            UserAgent: Clean(userAgent, MaxUserAgentLength));

    /// <summary>
    /// Strips what must never reach a log, then bounds the length. In this order, so truncation
    /// cannot cut a query string in half and leave its first half behind.
    /// </summary>
    internal static string Clean(string? value, int maxLength)
    {
        if (string.IsNullOrWhiteSpace(value))
        {
            return None;
        }

        // Bound the work before any regex runs: the body ceiling already caps this, but a
        // field is never longer than four times what it may keep for any reason worth honouring.
        var text = value.Length > maxLength * 4 ? value[..(maxLength * 4)] : value;

        // A query string or fragment, wherever it appears -- a URL in a stack frame, a URL in a
        // fetch error's message. Both are where a token travels (?token=, #access_token=).
        text = QueryOrFragment().Replace(text, string.Empty);
        text = Email().Replace(text, "[email]");
        text = TokenShaped().Replace(text, static match => IsBundleChunkName(match.Value) ? match.Value : "[redacted]");

        // One event per report. The console formatter writes one line per line, and App Runner
        // ships each line as its own CloudWatch event: a raw stack would arrive as twenty events,
        // and a newline in a message could forge a line of anything.
        text = FlattenControlCharacters(text).Trim();

        if (text.Length > maxLength)
        {
            text = text[..maxLength] + "…";
        }

        return text.Length == 0 ? None : text;
    }

    /// <summary>
    /// The route the web says it was on. Expected to be a pattern (<c>/surveys/:id/results</c>);
    /// anything that does not look like one is reduced until it does: a query string or fragment
    /// is dropped, a segment that is not a parameter but looks like an id or a token becomes
    /// <c>:redacted</c>, and characters a pattern never contains are removed.
    /// </summary>
    internal static string CleanRoute(string? value)
    {
        if (string.IsNullOrWhiteSpace(value))
        {
            return None;
        }

        var text = value.Length > MaxRouteLength * 4 ? value[..(MaxRouteLength * 4)] : value;
        var cut = text.IndexOfAny(['?', '#']);
        if (cut >= 0)
        {
            text = text[..cut];
        }

        var segments = text.Split('/');
        for (var i = 0; i < segments.Length; i++)
        {
            var segment = RouteCharacters().Replace(segments[i], string.Empty);
            segments[i] = !segment.StartsWith(':') && LooksLikeAnIdentifier(segment)
                ? ":redacted"
                : segment;
        }

        var route = string.Join('/', segments);
        if (route.Length > MaxRouteLength)
        {
            route = route[..MaxRouteLength];
        }

        return route.Length == 0 ? None : route;
    }

    /// <summary>
    /// A static segment of a web route is a lower-case word or two (<c>demographic-fields</c>).
    /// A segment with a digit in it that is eight characters or longer is an id, a token or a
    /// GUID, and so is anything sixteen characters or longer that is not hyphenated lower-case
    /// words of fifteen letters or fewer each.
    /// </summary>
    internal static bool LooksLikeAnIdentifier(string segment)
        => (segment.Length >= 8 && segment.Any(char.IsAsciiDigit))
            || (segment.Length >= 16 && !HyphenatedWords().IsMatch(segment));

    private static string CleanBuild(string? value)
    {
        if (string.IsNullOrWhiteSpace(value))
        {
            return None;
        }

        // A build stamp is a 40-hex sha or "unknown" (web/docs/build-stamp.md). Keep only what a
        // stamp can contain.
        var text = BuildCharacters().Replace(value, string.Empty);
        if (text.Length > MaxBuildLength)
        {
            text = text[..MaxBuildLength];
        }

        return text.Length == 0 ? None : text;
    }

    private static string FlattenControlCharacters(string text)
    {
        var builder = new StringBuilder(text.Length);
        var lastWasBreak = false;
        foreach (var character in text)
        {
            if (character is '\r' or '\n')
            {
                if (!lastWasBreak)
                {
                    builder.Append(" | ");
                }

                lastWasBreak = true;
                continue;
            }

            lastWasBreak = false;
            builder.Append(char.IsControl(character) ? ' ' : character);
        }

        return builder.ToString();
    }

    // Up to the next delimiter -- or up to a stack frame's ":line:column" suffix, which is
    // kept, because "file.js?v=abc:12:345" is a frame whose position is the useful part.
    [GeneratedRegex(@"[?#][^\s()""'<>]*?(?=:\d+:\d+(?![\d])|[\s()""'<>]|$)", RegexOptions.CultureInvariant)]
    private static partial Regex QueryOrFragment();

    [GeneratedRegex(@"[^\s@()""'<>,;:/]+@[^\s@()""'<>,;:/]+\.[A-Za-z]{2,}", RegexOptions.CultureInvariant)]
    private static partial Regex Email();

    /// <summary>
    /// Vite names a lazy chunk <c>PageName-hash8</c> (<c>SurveyResultsNextPage-CkA1b2c3.js</c>),
    /// which is token-shaped by length and is the most useful thing in a stack frame. Kept.
    /// </summary>
    private static bool IsBundleChunkName(string value) => BundleChunkName().IsMatch(value);

    // 24+ characters of the base64url alphabet, at least one a digit: a JWT segment, an
    // invitation or share-link token, a session id. A long identifier in a stack frame
    // (useSurveyResultsQueryWithFilters) has no digit and is kept.
    [GeneratedRegex(@"(?=[A-Za-z_\-]*[0-9])[A-Za-z0-9_\-]{24,}", RegexOptions.CultureInvariant)]
    private static partial Regex TokenShaped();

    [GeneratedRegex(@"^[A-Za-z]+-[A-Za-z0-9_\-]{8}$", RegexOptions.CultureInvariant)]
    private static partial Regex BundleChunkName();

    [GeneratedRegex(@"[^A-Za-z0-9:_\-\*\.]", RegexOptions.CultureInvariant)]
    private static partial Regex RouteCharacters();

    [GeneratedRegex(@"^[a-z]{1,15}(-[a-z]{1,15})*$", RegexOptions.CultureInvariant)]
    private static partial Regex HyphenatedWords();

    [GeneratedRegex(@"[^A-Za-z0-9\-]", RegexOptions.CultureInvariant)]
    private static partial Regex BuildCharacters();
}
