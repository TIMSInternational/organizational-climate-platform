using ClimateProject.Infrastructure.Auth;
using Google.Apis.Auth;

namespace ClimateProject.UnitTests.Auth;

/// <summary>
/// The /auth/google trust decision (#280).
///
/// <para>These exist because the check had NO coverage at any level. Every integration test
/// swaps in <c>FakeGoogleTokenVerifier</c> via <c>AuthWebApplicationFactory</c>, so nothing in
/// the suite ever reaches <see cref="GoogleTokenVerifier"/> — deleting the guard kept CI 100%
/// green. On a fix whose whole argument is that a comment is what let this rot the first time,
/// the one new security check being enforced only by prose was the wrong place to stop.</para>
///
/// <para>What the check is for: <c>ValidateAsync</c> proves the token came from Google for
/// this client, not that the address in it belongs to the caller. Since #280 that address
/// decides which tenant you join, so an unverified <c>acme.com</c> address would be a way into
/// ACME's tenant.</para>
/// </summary>
public class GoogleTokenVerifierMapPayloadTests
{
    private static GoogleJsonWebSignature.Payload Payload(string? email, bool verified, string? name = "Ada")
        => new() { Email = email, EmailVerified = verified, Name = name };

    [Fact]
    public void A_verified_address_is_accepted_and_carries_the_name_through()
    {
        var result = GoogleTokenVerifier.MapPayload(Payload("ada@acme.test", verified: true));

        Assert.NotNull(result);
        Assert.Equal("ada@acme.test", result!.Email);
        Assert.Equal("Ada", result.Name);
    }

    [Fact]
    public void An_UNVERIFIED_address_is_refused_even_though_the_token_itself_is_valid()
    {
        // The whole point. The token is genuine; the address in it is not proven. Null maps to
        // the same generic 401 an invalid token gets, so the caller cannot distinguish them.
        Assert.Null(GoogleTokenVerifier.MapPayload(Payload("attacker@acme.test", verified: false)));
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    public void A_missing_address_is_refused_even_when_marked_verified(string? email)
    {
        // 'verified' with no address is not a contradiction Google promises never to send, and
        // an empty domain would match nothing in companies.email_domain anyway.
        Assert.Null(GoogleTokenVerifier.MapPayload(Payload(email, verified: true)));
    }

    [Fact]
    public void A_null_payload_throws_rather_than_resolving_to_a_user()
    {
        Assert.Throws<ArgumentNullException>(() => GoogleTokenVerifier.MapPayload(null!));
    }
}
