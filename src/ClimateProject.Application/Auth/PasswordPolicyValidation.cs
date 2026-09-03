using ClimateProject.Domain.Entities;

namespace ClimateProject.Application.Auth;

/// <summary>
/// Checks a candidate password against the administrator-configured
/// <see cref="PasswordPolicy"/> (<c>GET/PUT /admin/system/settings</c>).
///
/// The policy has five knobs and, until #136, exactly one of them was enforced anywhere:
/// <c>AuthEndpoints.SignupAsync</c> reads <c>MinLength</c> and nothing reads the four
/// complexity flags at all. An admin could therefore turn on "require numbers", see it
/// persisted, and have it silently ignored -- a setting the product does not honour is
/// worse than an absent one, the same argument that keeps push notifications off #103's
/// API surface.
///
/// #136 closed that gap for the self-service change-password route only and left signup
/// alone, saying the tightening belonged in a change that named it. That change is the one
/// that wired this validator into <c>AuthEndpoints.SignupAsync</c> and
/// <c>InvitationAcceptEndpoints</c> (which had a hardcoded 8 that read no setting at all),
/// and made <c>reset-credentials</c> mint a password that passes it
/// (<see cref="TemporaryPasswords"/>). Existing accounts are untouched: nothing here runs
/// at login.
///
/// Pure and dependency-free so it is unit-testable without a database or a host.
/// </summary>
public static class PasswordPolicyValidation
{
    /// <summary>
    /// Upper bound on a submitted password. Not a policy knob -- bcrypt silently truncates
    /// its input past 72 bytes, so a longer password is not the password the user thinks
    /// they chose, and two different long passwords can hash identically. Rejecting is the
    /// only honest answer; the alternative is an account whose password has a silent
    /// suffix that does nothing.
    /// </summary>
    public const int MaxLength = 72;

    /// <summary>
    /// The characters counted as "special". Deliberately an explicit set rather than
    /// <c>!char.IsLetterOrDigit</c>: the latter counts a space, an accented letter's
    /// combining mark, or an emoji, which makes the rule impossible to state in the UI.
    /// </summary>
    private const string SpecialCharacters = "!@#$%^&*()-_=+[]{};:,.<>?/\\|`~'\"";

    /// <summary>
    /// Null when <paramref name="password"/> satisfies <paramref name="policy"/>, otherwise
    /// a single message naming every unmet requirement.
    ///
    /// Every rule is evaluated before returning, rather than short-circuiting on the first
    /// failure: a form that reveals one requirement at a time turns one rejected submission
    /// into five.
    /// </summary>
    public static string? Validate(string? password, PasswordPolicy policy)
    {
        ArgumentNullException.ThrowIfNull(policy);

        if (string.IsNullOrEmpty(password))
        {
            return "Password is required";
        }

        var failures = new List<string>();

        if (password.Length < policy.MinLength)
        {
            failures.Add($"be at least {policy.MinLength} characters long");
        }

        // Checked even though it is not a configurable rule -- see MaxLength.
        if (password.Length > MaxLength)
        {
            failures.Add($"be at most {MaxLength} characters long");
        }

        if (policy.RequireUppercase && !password.Any(char.IsUpper))
        {
            failures.Add("contain an uppercase letter");
        }

        if (policy.RequireLowercase && !password.Any(char.IsLower))
        {
            failures.Add("contain a lowercase letter");
        }

        if (policy.RequireNumbers && !password.Any(char.IsDigit))
        {
            failures.Add("contain a number");
        }

        if (policy.RequireSpecialChars && !password.Any(SpecialCharacters.Contains))
        {
            failures.Add("contain a special character");
        }

        return failures.Count == 0 ? null : $"Password must {string.Join(", ", failures)}";
    }
}
