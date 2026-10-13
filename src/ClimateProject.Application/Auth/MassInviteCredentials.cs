using System.Globalization;
using System.Security.Cryptography;
using System.Text;

namespace ClimateProject.Application.Auth;

/// <summary>
/// The username and password a mass invite generates for each person on the roster (ruled
/// 2026-10-13): <c>esph-k7m2q9xa</c> and a 10-character alphanumeric password, emailed together,
/// with no forced change at first sign-in.
///
/// <para>
/// Both are read off an email and typed on a phone, so neither alphabet holds a character that
/// reads as another: no 0/o, no 1/l/i, no I or O. Every draw comes from
/// <see cref="RandomNumberGenerator"/>. Ten characters over 55 symbols is about 57 bits, behind
/// <c>/auth/login</c>'s authentication rate limit.
/// </para>
/// <para>
/// Deliberately not <see cref="TemporaryPasswords"/>: that one pads to sixteen characters and
/// adds symbols when a policy asks for them, which is right for an administrator's reset and
/// wrong for a person copying a password from an email. Login does not re-validate the tenant's
/// policy, so a generated password always signs in; the policy applies when its holder chooses
/// their own.
/// </para>
/// </summary>
public static class MassInviteCredentials
{
    /// <summary>The suffix alphabet: lower-case letters and digits, minus 0, 1, i, l and o.</summary>
    public const string UsernameAlphabet = "23456789abcdefghjkmnpqrstuvwxyz";

    private const string Upper = "ABCDEFGHJKLMNPQRSTUVWXYZ";
    private const string Lower = "abcdefghjkmnpqrstuvwxyz";
    private const string Digits = "23456789";

    public const int UsernameSuffixLength = 8;
    public const int PasswordLength = 10;
    public const int MaxPrefixLength = 8;

    /// <summary>
    /// The company part of a username: the company's name folded to plain lower-case letters and
    /// digits ("Empresa de Servicios Públicos de Heredia" is long, so it is cut, never rejected).
    /// An empty fold (a name of nothing but symbols) falls back to <c>occ</c>.
    /// </summary>
    public static string PrefixFor(string companyName)
    {
        ArgumentNullException.ThrowIfNull(companyName);
        var builder = new StringBuilder();
        foreach (var c in companyName.Normalize(NormalizationForm.FormD))
        {
            if (CharUnicodeInfo.GetUnicodeCategory(c) == UnicodeCategory.NonSpacingMark)
            {
                continue;
            }

            var lower = char.ToLowerInvariant(c);
            if (lower is (>= 'a' and <= 'z') or (>= '0' and <= '9'))
            {
                builder.Append(lower);
                if (builder.Length == MaxPrefixLength)
                {
                    break;
                }
            }
        }

        return builder.Length == 0 ? "occ" : builder.ToString();
    }

    public static string Username(string prefix)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(prefix);
        var suffix = new char[UsernameSuffixLength];
        for (var i = 0; i < suffix.Length; i++)
        {
            suffix[i] = Pick(UsernameAlphabet);
        }

        return $"{prefix}-{new string(suffix)}";
    }

    /// <summary>Ten characters with at least one upper-case letter, one lower-case letter and one digit.</summary>
    public static string Password()
    {
        var chars = new List<char>(PasswordLength) { Pick(Upper), Pick(Lower), Pick(Digits) };
        var pool = Upper + Lower + Digits;
        while (chars.Count < PasswordLength)
        {
            chars.Add(Pick(pool));
        }

        for (var i = chars.Count - 1; i > 0; i--)
        {
            var j = RandomNumberGenerator.GetInt32(i + 1);
            (chars[i], chars[j]) = (chars[j], chars[i]);
        }

        return new string(chars.ToArray());
    }

    private static char Pick(string alphabet) => alphabet[RandomNumberGenerator.GetInt32(alphabet.Length)];
}
