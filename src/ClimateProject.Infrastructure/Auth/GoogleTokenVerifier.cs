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

            return MapPayload(payload);
        }
        catch (InvalidJwtException)
        {
            return null;
        }
    }

    /// <summary>
    /// The trust decision, separated from the network call so it can be tested.
    ///
    /// <para><c>ValidateAsync</c> proves the token came from Google for this client; it does
    /// NOT prove the address inside it belongs to the person signing in. Google will mint an
    /// ID token carrying an unverified <c>email</c> -- an account created with an address
    /// whose ownership was never confirmed -- and #280 made that address load-bearing:
    /// <c>/auth/google</c> decides which tenant you join by matching its domain against
    /// <c>companies.email_domain</c>. An unverified <c>acme.com</c> address would be a way
    /// into ACME's tenant. So an unverified email is treated as no email at all, and the
    /// caller maps null to the same generic 401 an invalid token gets.</para>
    ///
    /// <para><b>Why this is a separate internal method rather than inline.</b> Every
    /// integration test swaps in <c>FakeGoogleTokenVerifier</c>
    /// (<c>AuthWebApplicationFactory</c>), so nothing in the suite ever reaches this class --
    /// deleting the check inline kept CI 100% green, which is precisely the "enforced only by
    /// prose" failure #280 exists to correct. <c>GoogleJsonWebSignature.Payload</c> has a
    /// public parameterless constructor with settable members, so hoisting the predicate here
    /// makes it directly unit-testable.</para>
    /// </summary>
    internal static GoogleUserInfo? MapPayload(GoogleJsonWebSignature.Payload payload)
    {
        ArgumentNullException.ThrowIfNull(payload);

        // `!= true` rather than `!`: EmailVerified is a bool on this version of the library,
        // but the spelling survives a nullable-returning upgrade without silently inverting.
        if (payload.EmailVerified != true || string.IsNullOrWhiteSpace(payload.Email))
        {
            return null;
        }

        return new GoogleUserInfo(payload.Email, payload.Name);
    }
}
