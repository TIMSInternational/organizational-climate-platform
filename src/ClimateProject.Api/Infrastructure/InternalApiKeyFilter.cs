namespace ClimateProject.Api.Infrastructure;

public sealed class InternalApiKeyFilter(IConfiguration configuration) : IEndpointFilter
{
    public async ValueTask<object?> InvokeAsync(EndpointFilterInvocationContext context, EndpointFilterDelegate next)
    {
        var expectedKey = configuration["InternalApiKey"];
        if (string.IsNullOrWhiteSpace(expectedKey))
        {
            return Results.Json(new { message = "Internal API is not configured." }, statusCode: 500);
        }

        const string prefix = "Bearer ";
        var authHeader = context.HttpContext.Request.Headers.Authorization.ToString();
        if (!authHeader.StartsWith(prefix, StringComparison.Ordinal) || authHeader[prefix.Length..] != expectedKey)
        {
            return Results.Json(new { message = "Invalid or missing internal API key." }, statusCode: 401);
        }

        return await next(context);
    }
}
