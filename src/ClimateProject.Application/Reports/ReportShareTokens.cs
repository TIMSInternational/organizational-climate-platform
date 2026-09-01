using System.Security.Cryptography;

namespace ClimateProject.Application.Reports;

/// <summary>
/// Minting and hashing for report share tokens (#139).
///
/// One place, so that the value written to <c>report_shares.token_hash</c> at mint time and the
/// value looked up at resolve time cannot drift into two different derivations -- a drift whose
/// symptom is every link in the product silently answering "not available".
/// </summary>
public static class ReportShareTokens
{
    /// <summary>
    /// 32 bytes -- 256 bits -- of cryptographically random material per token.
    /// </summary>
    /// <remarks>
    /// This is the entire credential for a page that serves a company's climate data to whoever
    /// holds the URL, so it is sized as a credential and not as an identifier. A <c>Guid</c>
    /// would have been the convenient choice and carries about 122 usable bits from a generator
    /// that makes no randomness promise at all; this makes no assumption to revisit.
    /// </remarks>
    public const int TokenBytes = 32;

    /// <summary>Days a link lives when the mint request does not say.</summary>
    /// <remarks>
    /// Thirty, and non-negotiably finite. The default matters more than the number: a link with
    /// no expiry is a permanent unauthenticated hole in the tenant boundary that nobody will
    /// remember to close, and defaults are what actually gets shipped.
    /// </remarks>
    public const int DefaultLifetimeDays = 30;

    /// <summary>The shortest lifetime a caller can ask for.</summary>
    public const int MinLifetimeDays = 1;

    /// <summary>
    /// The longest lifetime a caller can ask for. A year, after which the administrator has to
    /// make the decision again rather than having made it once in 2026.
    /// </summary>
    public const int MaxLifetimeDays = 365;

    /// <summary>Length of the hex hash. SHA-256 is 32 bytes, so 64 characters.</summary>
    public const int TokenHashLength = 64;

    /// <summary>Mints a fresh token. URL-safe, unpadded, 43 characters.</summary>
    /// <remarks>
    /// Base64Url rather than plain Base64 because this lands in a path segment: <c>+</c> and
    /// <c>/</c> would need escaping, and a token that survives being pasted into a chat window,
    /// a PDF and an email client without being mangled is worth more than four saved characters.
    /// </remarks>
    public static string NewToken()
        => Base64UrlEncode(RandomNumberGenerator.GetBytes(TokenBytes));

    /// <summary>
    /// SHA-256 of the token's UTF-8 bytes, lower-case hex.
    /// </summary>
    /// <remarks>
    /// Deterministic and unsalted on purpose: the resolve path has to find a row <em>by</em> this
    /// value, so it must be reproducible from the token alone. That is safe here for the reason
    /// spelled out on <c>ReportShare.TokenHash</c> -- the input is 256 bits of generator output,
    /// so there is no dictionary to precompute and no birthday collision to worry about.
    /// </remarks>
    public static string Hash(string token)
        => Convert.ToHexStringLower(SHA256.HashData(System.Text.Encoding.UTF8.GetBytes(token)));

    /// <summary>Clamps a requested lifetime into the permitted range.</summary>
    /// <remarks>
    /// Clamped, not rejected. The caller is an authenticated administrator choosing a duration in
    /// a form, and answering 400 to "90000 days" teaches them nothing a silently sane 365 does
    /// not. It also removes a branch from the mint path: there is no lifetime input that can fail.
    /// </remarks>
    public static int ClampLifetimeDays(int? requested)
        => requested is null
            ? DefaultLifetimeDays
            : Math.Clamp(requested.Value, MinLifetimeDays, MaxLifetimeDays);

    private static string Base64UrlEncode(byte[] bytes)
        => Convert.ToBase64String(bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_');
}
