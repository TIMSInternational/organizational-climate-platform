using ClimateProject.Application.Reports;

namespace ClimateProject.UnitTests.Reports;

/// <summary>
/// #139: the token primitive behind report share links.
/// </summary>
public class ReportShareTokensTests
{
    /// <summary>
    /// The token is the entire credential for an unauthenticated page, so it is sized as one:
    /// 256 bits of generator output, which is 43 Base64Url characters.
    /// </summary>
    /// <remarks>
    /// Asserts the decoded byte count, not the string length alone -- a generator that emitted
    /// 43 characters of one repeated letter would satisfy a length assertion perfectly.
    /// </remarks>
    [Fact]
    public void A_token_carries_the_full_256_bits_of_randomness()
    {
        var token = ReportShareTokens.NewToken();

        Assert.Equal(43, token.Length);
        Assert.Equal(ReportShareTokens.TokenBytes, DecodeBase64Url(token).Length);
    }

    /// <summary>
    /// The token survives a URL path segment untouched: no <c>+</c>, no <c>/</c>, no <c>=</c>.
    /// </summary>
    /// <remarks>
    /// This is the difference between a link that works when pasted into a chat window and one
    /// that resolves to a different token -- or to nothing -- after an intermediary re-encodes
    /// it. Asserted over many tokens because plain Base64 produces <c>+</c> and <c>/</c> only
    /// some of the time, and one sample passes by luck.
    /// </remarks>
    [Fact]
    public void Tokens_are_url_safe_every_time()
    {
        for (var i = 0; i < 500; i++)
        {
            var token = ReportShareTokens.NewToken();
            Assert.True(
                token.All(c => char.IsAsciiLetterOrDigit(c) || c == '-' || c == '_'),
                $"token is not URL-safe: {token}");
        }
    }

    /// <summary>Two tokens are never the same. 256 bits is the reason; this is the check.</summary>
    [Fact]
    public void Tokens_do_not_repeat()
    {
        var tokens = Enumerable.Range(0, 1000).Select(_ => ReportShareTokens.NewToken()).ToList();

        Assert.Equal(tokens.Count, tokens.Distinct(StringComparer.Ordinal).Count());
    }

    /// <summary>
    /// The hash is reproducible from the token -- which is what makes the resolve path a single
    /// index probe -- and reveals nothing of it.
    /// </summary>
    [Fact]
    public void Hashing_is_deterministic_and_hides_the_token()
    {
        var token = ReportShareTokens.NewToken();
        var hash = ReportShareTokens.Hash(token);

        Assert.Equal(hash, ReportShareTokens.Hash(token));
        Assert.Equal(ReportShareTokens.TokenHashLength, hash.Length);
        Assert.True(hash.All(c => char.IsAsciiDigit(c) || (c >= 'a' && c <= 'f')), $"not lower-case hex: {hash}");
        Assert.NotEqual(token, hash);
        Assert.DoesNotContain(token, hash, StringComparison.OrdinalIgnoreCase);
        Assert.NotEqual(hash, ReportShareTokens.Hash(ReportShareTokens.NewToken()));
    }

    /// <summary>
    /// A known-answer test, so that the derivation cannot be quietly changed to something else
    /// that is also "deterministic". Changing it invalidates every link in the database, and
    /// this is the test that says so out loud.
    /// </summary>
    /// <remarks>
    /// The expected digests come from outside this codebase -- <c>printf '%s' x | shasum -a
    /// 256</c> -- rather than from <c>SHA256.HashData</c>, which is the implementation and
    /// would agree with any mistake it also made. The accented input is here because the
    /// product is Spanish-language and the encoding step is the part that would silently
    /// differ: <c>Encoding.UTF8</c> and <c>Encoding.ASCII</c> hash "climate" identically and
    /// "climático" differently.
    /// </remarks>
    [Theory]
    [InlineData("climate", "10db699812d02cc570ad3bdef91138092088ff2718c1ef1d4ee308a89defe62a")]
    [InlineData("climático", "f573ddcf0d5ee6c9b3ad85371686dcce8e5cfd4b5e5ae1ef7411bcec1f0d8598")]
    public void The_hash_is_sha256_of_the_tokens_utf8_bytes_in_lower_case_hex(string token, string expected)
        => Assert.Equal(expected, ReportShareTokens.Hash(token));

    /// <summary>
    /// A lifetime is always finite. The default is what actually ships, so it is the value that
    /// matters most, and it is a bounded number of days rather than "never".
    /// </summary>
    [Theory]
    [InlineData(null, ReportShareTokens.DefaultLifetimeDays)]
    [InlineData(7, 7)]
    [InlineData(0, ReportShareTokens.MinLifetimeDays)]
    [InlineData(-30, ReportShareTokens.MinLifetimeDays)]
    [InlineData(int.MinValue, ReportShareTokens.MinLifetimeDays)]
    [InlineData(100_000, ReportShareTokens.MaxLifetimeDays)]
    [InlineData(int.MaxValue, ReportShareTokens.MaxLifetimeDays)]
    public void A_requested_lifetime_is_clamped_never_rejected_and_never_unbounded(int? requested, int expected)
        => Assert.Equal(expected, ReportShareTokens.ClampLifetimeDays(requested));

    private static byte[] DecodeBase64Url(string value)
    {
        var padded = value.Replace('-', '+').Replace('_', '/');
        padded += new string('=', (4 - (padded.Length % 4)) % 4);
        return Convert.FromBase64String(padded);
    }
}
