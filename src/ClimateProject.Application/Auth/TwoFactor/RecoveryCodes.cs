using System.Security.Cryptography;
using System.Text;
using ClimateProject.Domain.Entities;

namespace ClimateProject.Application.Auth.TwoFactor;

/// <summary>
/// The ten single-use codes shown once at enrollment, for the day the phone is lost.
/// </summary>
/// <remarks>
/// Ten characters from a 32-letter alphabet with no 0/O/1/I (50 bits each), shown as
/// <c>XXXXX-XXXXX</c>. Input is case-insensitive and ignores spaces and hyphens. Stored hashed
/// through <see cref="IPasswordHasher"/>, one row per code.
/// </remarks>
public static class RecoveryCodes
{
    public const int Count = 10;
    public const int Length = 10;
    public const string Alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

    /// <summary>Fresh codes, in their normalised (unhyphenated) form.</summary>
    public static IReadOnlyList<string> Generate()
    {
        var codes = new List<string>(Count);
        while (codes.Count < Count)
        {
            var chars = new char[Length];
            for (var i = 0; i < Length; i++)
            {
                chars[i] = Alphabet[RandomNumberGenerator.GetInt32(Alphabet.Length)];
            }

            var code = new string(chars);
            if (!codes.Contains(code, StringComparer.Ordinal))
            {
                codes.Add(code);
            }
        }

        return codes;
    }

    /// <summary>How a code is shown: <c>ABCDE-FGHIJ</c>.</summary>
    public static string Display(string normalised) => normalised[..5] + "-" + normalised[5..];

    /// <summary>The canonical form of what was typed, or null when it cannot be a recovery code.</summary>
    public static string? Normalise(string? input)
    {
        if (string.IsNullOrWhiteSpace(input))
        {
            return null;
        }

        var builder = new StringBuilder(Length);
        foreach (var c in input)
        {
            if (c is ' ' or '-' or '\t')
            {
                continue;
            }

            var upper = char.ToUpperInvariant(c);
            if (!Alphabet.Contains(upper, StringComparison.Ordinal))
            {
                return null;
            }

            builder.Append(upper);
        }

        return builder.Length == Length ? builder.ToString() : null;
    }

    /// <summary>
    /// Spends the code that matches <paramref name="input"/>, if an unspent one does.
    /// </summary>
    /// <returns>True and stamps <c>UsedAt</c> on the matching row; false otherwise.</returns>
    /// <remarks>
    /// Only ever called with input that <see cref="Normalise"/> accepts, so a six-digit TOTP code
    /// never costs ten bcrypt comparisons. Rows with <c>UsedAt</c> set are skipped: a code opens
    /// exactly once.
    /// </remarks>
    public static bool TryConsume(
        IEnumerable<UserRecoveryCode> codes, string? input, IPasswordHasher hasher, DateTimeOffset now)
    {
        ArgumentNullException.ThrowIfNull(codes);
        ArgumentNullException.ThrowIfNull(hasher);
        if (Normalise(input) is not { } normalised)
        {
            return false;
        }

        foreach (var code in codes)
        {
            if (code.UsedAt is null && hasher.Verify(normalised, code.CodeHash))
            {
                code.UsedAt = now;
                return true;
            }
        }

        return false;
    }
}
