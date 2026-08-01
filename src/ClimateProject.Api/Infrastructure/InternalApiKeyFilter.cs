using System.Security.Cryptography;
using System.Text;

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
        if (!authHeader.StartsWith(prefix, StringComparison.Ordinal) ||
            !ConstantTimeEquals(authHeader[prefix.Length..], expectedKey))
        {
            return Results.Json(new { message = "Invalid or missing internal API key." }, statusCode: 401);
        }

        return await next(context);
    }

    private static bool ConstantTimeEquals(string actual, string expected)
    {
        var actualBytes = Encoding.UTF8.GetBytes(actual);
        var expectedBytes = Encoding.UTF8.GetBytes(expected);

        // FixedTimeEquals requires equal-length spans; comparing against the hash of the
        // expected key when lengths differ avoids leaking length information via a short-circuit.
        if (actualBytes.Length != expectedBytes.Length)
        {
            var actualHash = SHA256.HashData(actualBytes);
            var expectedHash = SHA256.HashData(expectedBytes);
            CryptographicOperations.FixedTimeEquals(actualHash, expectedHash);
            return false;
        }

        return CryptographicOperations.FixedTimeEquals(actualBytes, expectedBytes);
    }
}
