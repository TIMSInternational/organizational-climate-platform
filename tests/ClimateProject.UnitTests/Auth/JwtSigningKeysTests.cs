using System.Text;
using ClimateProject.Infrastructure.Auth;
using Microsoft.IdentityModel.Tokens;

namespace ClimateProject.UnitTests.Auth;

/// <summary>
/// The rule deciding which keys may verify an inbound token during a <c>TrackingJwtSecret</c>
/// rotation (#70). Every case here is about what is admitted and what is not — this is the
/// widest the authentication surface ever gets, so it is worth stating precisely.
/// </summary>
public class JwtSigningKeysTests
{
    private const string Current = "the-current-tracking-jwt-secret-32-bytes-min-000000";
    private const string Previous = "the-previous-tracking-jwt-secret-32-bytes-min-00000";

    private static IEnumerable<string> BytesOf(IEnumerable<SecurityKey> keys)
        => keys.Cast<SymmetricSecurityKey>().Select(k => Encoding.UTF8.GetString(k.Key));

    [Fact]
    public void Outside_a_rotation_only_the_current_secret_verifies()
    {
        var keys = JwtSigningKeys.ForValidation(Current, previous: null);

        Assert.Equal([Current], BytesOf(keys));
    }

    [Fact]
    public void During_a_rotation_both_secrets_verify()
    {
        var keys = JwtSigningKeys.ForValidation(Current, Previous);

        // Order matters only for which is tried first; membership is the guarantee.
        Assert.Equal([Current, Previous], BytesOf(keys));
    }

    /// <summary>
    /// An unset environment variable and an unpopulated appsettings entry both arrive as blank.
    /// Admitting one as a key would mean every token signed with the empty string validated —
    /// a far worse outcome than the missing-config error it might look like.
    /// </summary>
    [Theory]
    [InlineData("")]
    [InlineData("   ")]
    [InlineData("\t\n")]
    public void A_blank_previous_secret_is_absent_rather_than_a_key(string blank)
    {
        var keys = JwtSigningKeys.ForValidation(Current, blank);

        Assert.Equal([Current], BytesOf(keys));
    }

    /// <summary>
    /// Handing the handler the same key twice makes one signature failure report two identical
    /// failed attempts, which reads as a configuration bug that is not there.
    /// </summary>
    [Fact]
    public void A_previous_secret_identical_to_the_current_one_is_not_added_twice()
    {
        var keys = JwtSigningKeys.ForValidation(Current, Current);

        Assert.Equal([Current], BytesOf(keys));
    }

    /// <summary>
    /// Ordinal, not case-insensitive or culture-aware: two secrets differing only in case are
    /// genuinely different signing keys, and collapsing them would silently drop the real one.
    /// </summary>
    [Fact]
    public void A_previous_secret_differing_only_in_case_is_a_different_key()
    {
        var keys = JwtSigningKeys.ForValidation(Current, Current.ToUpperInvariant());

        Assert.Equal([Current, Current.ToUpperInvariant()], BytesOf(keys));
    }

    /// <summary>
    /// The current secret is required. Fail loudly at startup rather than serve with no key —
    /// mirrors the existing <c>Missing TrackingJwtSecret configuration</c> guard.
    /// </summary>
    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    public void A_missing_current_secret_throws(string? missing)
    {
        // ThrowsAny, not Throws: null raises ArgumentNullException and blank raises
        // ArgumentException, and xUnit's Throws<T> demands the exact type. What this asserts is
        // that startup fails rather than serving with no signing key -- which exception carries
        // that message is not the guarantee.
        Assert.ThrowsAny<ArgumentException>(() => JwtSigningKeys.ForValidation(missing!, Previous));
    }
}
