using System.Security.Cryptography;
using System.Text;

namespace ClimateProject.Api.Infrastructure;

public sealed class InternalApiKeyFilter(IConfiguration configuration) : IEndpointFilter
{
    public async ValueTask<object?> InvokeAsync(EndpointFilterInvocationContext context, EndpointFilterDelegate next)
    {
        // As of #189 an empty InternalApiKey fails the host at startup (see the
        // AddOptions<InternalApiOptions>().ValidateOnStart() registration in Program.cs), so in
        // a running service this branch should be unreachable. Kept deliberately as defence in
        // depth -- it must fail *closed*, and a filter on an internet-reachable auth boundary
        // should not depend on a startup guard elsewhere in the file staying in place. Do not
        // delete it as dead code.
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
