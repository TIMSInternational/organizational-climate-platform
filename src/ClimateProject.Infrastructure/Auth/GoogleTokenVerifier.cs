using ClimateProject.Application.Auth;
using Google.Apis.Auth;
using Microsoft.Extensions.Configuration;

namespace ClimateProject.Infrastructure.Auth;

public class GoogleTokenVerifier : IGoogleTokenVerifier
{
    private readonly string _clientId;

    public GoogleTokenVerifier(IConfiguration configuration)
    {
        var clientId = configuration["GoogleClientId"];
        if (string.IsNullOrWhiteSpace(clientId))
        {
            throw new InvalidOperationException("Missing GoogleClientId configuration.");
        }

        _clientId = clientId;
    }

    public async Task<GoogleUserInfo?> VerifyAsync(string idToken, CancellationToken cancellationToken)
    {
        try
        {
            var payload = await GoogleJsonWebSignature.ValidateAsync(idToken, new GoogleJsonWebSignature.ValidationSettings
            {
                Audience = [_clientId],
            });

            // ValidateAsync proves the token came from Google for this client; it does NOT
            // prove the address in it belongs to the person signing in. Google will mint an
            // ID token carrying an unverified `email` (an account created with an address
            // whose ownership was never confirmed), and #280 made that address load-bearing:
            // /auth/google decides which tenant you join by matching its domain against
            // companies.email_domain. An unverified acme.com address would be a way into
            // ACME's tenant. Treat an unverified email as no email at all -- the caller maps
            // null to the same generic 401 an invalid token gets.
            if (payload.EmailVerified != true || string.IsNullOrWhiteSpace(payload.Email))
            {
                return null;
            }

            return new GoogleUserInfo(payload.Email, payload.Name);
        }
        catch (InvalidJwtException)
        {
            return null;
        }
    }
}
