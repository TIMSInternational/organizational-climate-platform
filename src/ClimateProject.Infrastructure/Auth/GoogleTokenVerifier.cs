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

            return new GoogleUserInfo(payload.Email, payload.Name);
        }
        catch (InvalidJwtException)
        {
            return null;
        }
    }
}
