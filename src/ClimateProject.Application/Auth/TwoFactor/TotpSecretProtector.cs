using System.Security.Cryptography;
using System.Text;

namespace ClimateProject.Application.Auth.TwoFactor;

/// <summary>
/// AES-256-GCM for TOTP secrets at rest. Stored layout: <c>nonce(12) | ciphertext | tag(16)</c>.
/// </summary>
/// <remarks>
/// Deliberately NOT ASP.NET Data Protection: its key ring lives on the instance's disk, and App
/// Runner's disk is gone on every redeploy -- every enrolled person would be locked out by the
/// next deploy. The key here is a configured secret (<c>Auth:TotpEncryptionKey</c>) that
/// survives deploys. The user id is bound in as associated data, so a ciphertext copied onto
/// another person's row does not decrypt there.
/// </remarks>
public sealed class TotpSecretProtector
{
    public const int KeyBytes = 32;
    public const int NonceBytes = 12;
    public const int TagBytes = 16;

    private readonly byte[] _key;

    public TotpSecretProtector(byte[] key)
    {
        ArgumentNullException.ThrowIfNull(key);
        if (key.Length != KeyBytes)
        {
            throw new ArgumentException($"The TOTP encryption key must be {KeyBytes} bytes.", nameof(key));
        }

        _key = (byte[])key.Clone();
    }

    public byte[] Protect(byte[] secret, Guid userId)
    {
        ArgumentNullException.ThrowIfNull(secret);
        var output = new byte[NonceBytes + secret.Length + TagBytes];
        var nonce = output.AsSpan(0, NonceBytes);
        RandomNumberGenerator.Fill(nonce);

        using var aes = new AesGcm(_key, TagBytes);
        aes.Encrypt(
            nonce,
            secret,
            output.AsSpan(NonceBytes, secret.Length),
            output.AsSpan(NonceBytes + secret.Length, TagBytes),
            AssociatedData(userId));
        return output;
    }

    /// <summary>The secret, or null when the bytes were altered, belong to another user or another key.</summary>
    public byte[]? Unprotect(byte[]? stored, Guid userId)
    {
        if (stored is null || stored.Length < NonceBytes + TagBytes + 1)
        {
            return null;
        }

        var length = stored.Length - NonceBytes - TagBytes;
        var plaintext = new byte[length];
        try
        {
            using var aes = new AesGcm(_key, TagBytes);
            aes.Decrypt(
                stored.AsSpan(0, NonceBytes),
                stored.AsSpan(NonceBytes, length),
                stored.AsSpan(NonceBytes + length, TagBytes),
                plaintext,
                AssociatedData(userId));
            return plaintext;
        }
        catch (CryptographicException)
        {
            return null;
        }
    }

    private static byte[] AssociatedData(Guid userId) => Encoding.ASCII.GetBytes("occ-totp:" + userId.ToString("D"));
}

/// <summary>
/// Whether two-factor sign-in is on, and the keys it runs on. Built once at startup from
/// <c>Auth:TotpEncryptionKey</c>.
/// </summary>
/// <remarks>
/// Fail safe in both directions that matter. A missing key turns the whole feature OFF -- sign-in
/// is exactly what it was, nothing is enforced, the profile says it is unavailable -- so a deploy
/// that ships before the secret exists neither fails nor locks anyone out. A malformed key (not
/// base64, or not 32 bytes) is treated the same way rather than crashing the host: refusing to
/// boot over an optional feature would take sign-in down for everybody.
/// </remarks>
public sealed class TwoFactorSettings
{
    public const string ConfigurationKey = "Auth:TotpEncryptionKey";

    /// <summary>The issuer an authenticator app shows next to the code.</summary>
    public const string Issuer = "OCC";

    private static readonly byte[] ChallengeKeyInfo = Encoding.ASCII.GetBytes("occ two-factor challenge token v1");

    private TwoFactorSettings(TotpSecretProtector? protector, byte[]? challengeSigningKey)
    {
        Protector = protector;
        ChallengeSigningKey = challengeSigningKey;
    }

    public static TwoFactorSettings Disabled { get; } = new(null, null);

    public bool IsEnabled => Protector is not null && ChallengeSigningKey is not null;

    public TotpSecretProtector? Protector { get; }

    /// <summary>
    /// The key challenge tokens are signed with: HKDF-SHA256 of the encryption key, NOT the
    /// session signing secret. A challenge token therefore fails signature validation under the
    /// session bearer scheme here and in climate-tracking (which shares TrackingJwtSecret).
    /// </summary>
    public byte[]? ChallengeSigningKey { get; }

    /// <summary>The settings for a configured value, and the one-line problem when it leaves the feature off.</summary>
    public static TwoFactorSettings FromConfiguredKey(string? configured, out string? problem)
    {
        if (string.IsNullOrWhiteSpace(configured))
        {
            problem = $"{ConfigurationKey} is not configured: two-factor sign-in is OFF (no enrollment offered, "
                + "nothing enforced, sign-in unchanged).";
            return Disabled;
        }

        byte[] key;
        try
        {
            key = Convert.FromBase64String(configured.Trim());
        }
        catch (FormatException)
        {
            problem = $"{ConfigurationKey} is not valid base64: two-factor sign-in is OFF.";
            return Disabled;
        }

        if (key.Length != TotpSecretProtector.KeyBytes)
        {
            problem = $"{ConfigurationKey} decodes to {key.Length} bytes, not {TotpSecretProtector.KeyBytes}: "
                + "two-factor sign-in is OFF.";
            return Disabled;
        }

        problem = null;
        var challengeKey = HKDF.DeriveKey(HashAlgorithmName.SHA256, key, 32, salt: null, info: ChallengeKeyInfo);
        return new TwoFactorSettings(new TotpSecretProtector(key), challengeKey);
    }
}
