using System.Net;
using System.Text;
using System.Text.Json;
using Anthropic;
using Anthropic.Exceptions;
using ClimateProject.Infrastructure.OrgStructure;

namespace ClimateProject.UnitTests.OrgStructure.Intake;

/// <summary>
/// Which provider errors tell the admin "the AI is unavailable" rather than "the AI could not
/// interpret this file". Measured 2026-09-30: a Bedrock account whose Opus agreement had failed
/// answered every intake with 403, and the screen blamed the admin's spreadsheet.
/// </summary>
public class ClaudeIntakeMappingModelTests
{
    private static HttpRequestException Http(HttpStatusCode status) => new("provider", null, status);

    [Fact]
    public void A_rejected_key_a_forbidden_model_and_an_unknown_model_are_the_deployment()
    {
        Assert.True(ClaudeIntakeMappingModel.IsNoAccess(
            new AnthropicUnauthorizedException(Http(HttpStatusCode.Unauthorized)) { StatusCode = HttpStatusCode.Unauthorized, ResponseBody = "{}" }));
        Assert.True(ClaudeIntakeMappingModel.IsNoAccess(
            new AnthropicForbiddenException(Http(HttpStatusCode.Forbidden)) { StatusCode = HttpStatusCode.Forbidden, ResponseBody = "{}" }));
        Assert.True(ClaudeIntakeMappingModel.IsNoAccess(
            new AnthropicNotFoundException(Http(HttpStatusCode.NotFound)) { StatusCode = HttpStatusCode.NotFound, ResponseBody = "{}" }));
    }

    [Fact]
    public void A_bad_request_a_rate_limit_and_a_server_error_are_still_failures()
    {
        Assert.False(ClaudeIntakeMappingModel.IsNoAccess(
            new AnthropicBadRequestException(Http(HttpStatusCode.BadRequest)) { StatusCode = HttpStatusCode.BadRequest, ResponseBody = "{}" }));
        Assert.False(ClaudeIntakeMappingModel.IsNoAccess(
            new AnthropicRateLimitException(Http(HttpStatusCode.TooManyRequests)) { StatusCode = HttpStatusCode.TooManyRequests, ResponseBody = "{}" }));
        Assert.False(ClaudeIntakeMappingModel.IsNoAccess(
            new AnthropicApiException("server", Http(HttpStatusCode.InternalServerError)) { StatusCode = HttpStatusCode.InternalServerError, ResponseBody = "{}" }));
    }

    /// <summary>Records the one request the SDK sends and answers it with a 400.</summary>
    private sealed class CapturingHandler : HttpMessageHandler
    {
        public string? Body { get; private set; }
        public string Betas { get; private set; } = "";

        protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            Body = request.Content is null ? null : await request.Content.ReadAsStringAsync(cancellationToken);
            Betas = request.Headers.TryGetValues("anthropic-beta", out var values) ? string.Join(",", values) : "";
            return new HttpResponseMessage(HttpStatusCode.BadRequest)
            {
                Content = new StringContent(
                    """{"type":"error","error":{"type":"invalid_request_error","message":"captured"}}""",
                    Encoding.UTF8,
                    "application/json"),
            };
        }
    }

    private static async Task<CapturingHandler> Send(bool bedrock)
    {
        var handler = new CapturingHandler();
        var client = new AnthropicClient { ApiKey = "test-key", HttpClient = new HttpClient(handler), MaxRetries = 0 };
        var request = ClaudeIntakeMappingModel.BuildRequest("claude-test", "high", bedrock, """{"language":"es"}""");
        await Assert.ThrowsAsync<AnthropicBadRequestException>(() => client.Beta.Messages.Create(request));
        Assert.NotNull(handler.Body);
        return handler;
    }

    // SDK 13 made a message a union whose type is its role. This reads the wire body the real
    // serializer produces, because a wrong shape compiles and only fails at the provider.
    [Fact]
    public async Task The_profile_goes_out_as_the_single_user_turn_with_the_schema_and_the_effort()
    {
        var handler = await Send(bedrock: false);
        using var body = JsonDocument.Parse(handler.Body!);
        var root = body.RootElement;

        var message = Assert.Single(root.GetProperty("messages").EnumerateArray().ToList());
        Assert.Equal("user", message.GetProperty("role").GetString());
        Assert.Equal("""{"language":"es"}""", message.GetProperty("content").GetString());
        Assert.Equal("claude-test", root.GetProperty("model").GetString());
        Assert.Equal("high", root.GetProperty("output_config").GetProperty("effort").GetString());
        Assert.Equal("json_schema", root.GetProperty("output_config").GetProperty("format").GetProperty("type").GetString());
        Assert.Contains("server-side-fallback-2026-07-01", handler.Betas);
        Assert.True(root.TryGetProperty("fallbacks", out _));
    }

    [Fact]
    public async Task Bedrock_requests_carry_no_server_side_fallback()
    {
        var handler = await Send(bedrock: true);
        using var body = JsonDocument.Parse(handler.Body!);

        Assert.Equal("user", body.RootElement.GetProperty("messages")[0].GetProperty("role").GetString());
        Assert.DoesNotContain("server-side-fallback", handler.Betas);
        Assert.False(body.RootElement.TryGetProperty("fallbacks", out _));
    }
}
