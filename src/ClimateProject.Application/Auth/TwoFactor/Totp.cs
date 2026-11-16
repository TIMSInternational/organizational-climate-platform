using System.Security.Cryptography;
using System.Text;

namespace ClimateProject.Application.Auth.TwoFactor;

/// <summary>
/// RFC 6238 TOTP over HMAC-SHA1 (RFC 4226 dynamic truncation), with nothing but
/// <c>System.Security.Cryptography</c> -- no package (CLAUDE.md: a dependency needs a reason
/// that survives procurement, and forty lines do not give one).
/// </summary>
public static class Totp
{
    /// <summary>Seconds per step (RFC 6238 X). What every authenticator app assumes.</summary>
    public const int StepSeconds = 30;

    /// <summary>Digits shown to the person.</summary>
    public const int Digits = 6;

    /// <summary>
    /// Steps either side of now that are accepted: one, i.e. a clock up to ~30 s off still
    /// works, and a code stays usable for the step after it was shown.
    /// </summary>
    public const int AcceptedWindowSteps = 1;

    /// <summary>The secret length the issuer generates: 160 bits, RFC 4226's recommendation.</summary>
    public const int SecretBytes = 20;

    public static byte[] NewSecret() => RandomNumberGenerator.GetBytes(SecretBytes);

    public static long StepAt(DateTimeOffset instant) => instant.ToUnixTimeSeconds() / StepSeconds;

    /// <summary>The code for one step, left-padded to <paramref name="digits"/>.</summary>
    public static string Compute(byte[] secret, long step, int digits = Digits)
    {
        ArgumentNullException.ThrowIfNull(secret);
        Span<byte> counter = stackalloc byte[8];
        System.Buffers.Binary.BinaryPrimitives.WriteInt64BigEndian(counter, step);

        Span<byte> hash = stackalloc byte[20];
        HMACSHA1.HashData(secret, counter, hash);

        var offset = hash[^1] & 0x0F;
        var binary = ((hash[offset] & 0x7F) << 24)
            | (hash[offset + 1] << 16)
            | (hash[offset + 2] << 8)
            | hash[offset + 3];

        var modulus = (int)Math.Pow(10, digits);
        return (binary % modulus).ToString(System.Globalization.CultureInfo.InvariantCulture).PadLeft(digits, '0');
    }

    /// <summary>
    /// The step <paramref name="code"/> was valid for, within ±<see cref="AcceptedWindowSteps"/>
    /// of <paramref name="now"/>, or null. A step at or below <paramref name="lastUsedStep"/> is
    /// never matched: that is the replay refusal, and the caller persists the step returned.
    /// </summary>
    public static long? Match(byte[] secret, string? code, DateTimeOffset now, long? lastUsedStep)
    {
        if (!IsWellFormedCode(code))
        {
            return null;
        }

        var presented = Encoding.ASCII.GetBytes(code!);
        var current = StepAt(now);
        long? matched = null;

        // Every candidate is computed and compared, matched or not, so the time taken does not
        // say which step (if any) the code belonged to.
        for (var step = current - AcceptedWindowSteps; step <= current + AcceptedWindowSteps; step++)
        {
            var expected = Encoding.ASCII.GetBytes(Compute(secret, step));
            var equal = CryptographicOperations.FixedTimeEquals(expected, presented);
            if (equal && matched is null && (lastUsedStep is not { } floor || step > floor))
            {
                matched = step;
            }
        }

        return matched;
    }

    /// <summary>Exactly <see cref="Digits"/> ASCII digits.</summary>
    public static bool IsWellFormedCode(string? code)
        => code is { Length: Digits } && code.All(char.IsAsciiDigit);

    /// <summary>
    /// The <c>otpauth://</c> URI an authenticator app reads from a QR code. Label
    /// <c>issuer:account</c>, both percent-encoded, as Google Authenticator's key-uri format asks.
    /// </summary>
    public static string OtpAuthUri(string issuer, string accountName, string base32Secret)
    {
        var label = Uri.EscapeDataString(issuer) + ":" + Uri.EscapeDataString(accountName);
        return $"otpauth://totp/{label}?secret={base32Secret}&issuer={Uri.EscapeDataString(issuer)}"
            + $"&algorithm=SHA1&digits={Digits}&period={StepSeconds}";
    }
}

/// <summary>RFC 4648 base32, upper-case, no padding -- the form otpauth URIs carry.</summary>
public static class Base32
{
    private const string Alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

    public static string Encode(ReadOnlySpan<byte> data)
    {
        var output = new StringBuilder((data.Length * 8 + 4) / 5);
        int buffer = 0, bits = 0;
        foreach (var b in data)
        {
            buffer = (buffer << 8) | b;
            bits += 8;
            while (bits >= 5)
            {
                output.Append(Alphabet[(buffer >> (bits - 5)) & 31]);
                bits -= 5;
            }
        }

        if (bits > 0)
        {
            output.Append(Alphabet[(buffer << (5 - bits)) & 31]);
        }

        return output.ToString();
    }
}
