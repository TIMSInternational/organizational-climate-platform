using System.Security.Cryptography;
using ClimateProject.Domain.Entities;

namespace ClimateProject.Application.Auth;

/// <summary>
/// Mints a temporary password that satisfies a <see cref="PasswordPolicy"/>.
///
/// <c>POST /auth/admin/reset-credentials</c> used to hand out
/// <c>Guid.NewGuid().ToString("N")[..12]</c> — twelve lowercase hex characters. Under the
/// default policy (uppercase, lowercase and a number all required) that password would be
/// refused the moment its holder tried to change it, and under a stricter tenant policy it
/// never satisfied the rules the administrator had switched on. A reset must produce a
/// password the product itself would accept.
///
/// Composition: one character from each class the policy demands (and always one lowercase
/// letter and one digit, so the result is never a single-class string), padded with
/// characters from every allowed class up to <c>max(MinLength, 16)</c> — never above
/// <see cref="PasswordPolicyValidation.MaxLength"/> — then shuffled. Every draw comes from
/// <see cref="RandomNumberGenerator"/>.
/// </summary>
public static class TemporaryPasswords
{
    private const string Upper = "ABCDEFGHJKLMNPQRSTUVWXYZ";      // no I or O: they read as 1 and 0 on a printout
    private const string Lower = "abcdefghijkmnopqrstuvwxyz";     // no l
    private const string Digits = "23456789";                     // no 0 or 1
    private const string Special = "!@#$%^&*-_=+?";               // a subset of PasswordPolicyValidation's set
    private const int MinimumGenerated = 16;

    public static string Generate(PasswordPolicy policy)
    {
        ArgumentNullException.ThrowIfNull(policy);
        var length = Math.Clamp(Math.Max(policy.MinLength, MinimumGenerated), MinimumGenerated, PasswordPolicyValidation.MaxLength);

        var pool = Lower + Digits + (policy.RequireUppercase ? Upper : string.Empty) + (policy.RequireSpecialChars ? Special : string.Empty);
        var chars = new List<char>(length) { Pick(Lower), Pick(Digits) };
        if (policy.RequireUppercase) chars.Add(Pick(Upper));
        if (policy.RequireSpecialChars) chars.Add(Pick(Special));
        while (chars.Count < length) chars.Add(Pick(pool));

        // Fisher–Yates with a cryptographic source, so the mandatory characters are not
        // always at the front.
        for (var i = chars.Count - 1; i > 0; i--)
        {
            var j = RandomNumberGenerator.GetInt32(i + 1);
            (chars[i], chars[j]) = (chars[j], chars[i]);
        }
        return new string(chars.ToArray());
    }

    private static char Pick(string alphabet) => alphabet[RandomNumberGenerator.GetInt32(alphabet.Length)];
}
