using ClimateProject.Application.Auth;

namespace ClimateProject.IntegrationTests.Support;

/// Encodes its response directly in the input for deterministic tests without
/// hitting Google's real API: "valid:{email}:{name}" succeeds, anything else fails.
public class FakeGoogleTokenVerifier : IGoogleTokenVerifier
{
    public Task<GoogleUserInfo?> VerifyAsync(string idToken, CancellationToken cancellationToken)
    {
        if (!idToken.StartsWith("valid:", StringComparison.Ordinal))
        {
            return Task.FromResult<GoogleUserInfo?>(null);
        }

        var parts = idToken.Split(':', 3);
        if (parts.Length != 3)
        {
            return Task.FromResult<GoogleUserInfo?>(null);
        }

        return Task.FromResult<GoogleUserInfo?>(new GoogleUserInfo(parts[1], parts[2]));
    }
}
