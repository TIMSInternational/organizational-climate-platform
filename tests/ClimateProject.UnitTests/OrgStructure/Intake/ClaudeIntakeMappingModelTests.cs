using System.Net;
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
}
