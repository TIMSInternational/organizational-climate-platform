using System.Globalization;

namespace ClimateProject.Application.Surveys;

/// <summary>A respondent's name and email, as they submit it on the public link.</summary>
public sealed record SurveyParticipantInput(string? Name = null, string? Email = null);

/// <summary>A participant identity that passed validation.</summary>
/// <param name="Name">Trimmed, internal whitespace collapsed.</param>
/// <param name="Email">Trimmed and lower-cased, or null when none was given.</param>
public sealed record ValidatedParticipant(string Name, string? Email);

/// <summary>
/// Validates who says they answered. Pure, so the unit suite can pin every rule.
/// </summary>
/// <remarks>
/// <para>
/// Name required, email optional: "many respondents are operarios with no email". An email
/// that IS given must look like one, because it is what the pending list is matched on --
/// a typo there silently leaves a person listed as not having answered.
/// </para>
/// <para>
/// Nothing here, nor its caller, ever puts the name or email beside a response id: not in a
/// row, not in an error message, not in a log line. The error strings below name the rule
/// broken, never the value.
/// </para>
/// </remarks>
public static class ParticipantIdentity
{
    public const int NameMaxLength = 200;
    public const int EmailMaxLength = 320;

    public static (ValidatedParticipant? Participant, string? Error) Validate(SurveyParticipantInput? input)
    {
        var name = Collapse(input?.Name);
        if (name.Length == 0)
        {
            return (null, "participant.name is required");
        }

        if (name.Length > NameMaxLength)
        {
            return (null, $"participant.name must be at most {NameMaxLength} characters");
        }

        var email = input?.Email?.Trim();
        if (string.IsNullOrEmpty(email))
        {
            return (new ValidatedParticipant(name, null), null);
        }

        if (email.Length > EmailMaxLength)
        {
            return (null, $"participant.email must be at most {EmailMaxLength} characters");
        }

        if (!LooksLikeEmail(email))
        {
            return (null, "participant.email is not a valid email address");
        }

        return (new ValidatedParticipant(name, email.ToLower(CultureInfo.InvariantCulture)), null);
    }

    /// <summary>
    /// One local part, one '@', a domain with a dot and no whitespace anywhere. Deliberately
    /// not RFC 5322: the question is whether this can be matched against a user's address,
    /// and that is all the pending list needs.
    /// </summary>
    private static bool LooksLikeEmail(string email)
    {
        if (email.Any(char.IsWhiteSpace))
        {
            return false;
        }

        var at = email.IndexOf('@', StringComparison.Ordinal);
        if (at <= 0 || at != email.LastIndexOf('@'))
        {
            return false;
        }

        var domain = email[(at + 1)..];
        var dot = domain.LastIndexOf('.');
        return dot > 0 && dot < domain.Length - 1;
    }

    private static string Collapse(string? value)
        => string.Join(' ', (value ?? string.Empty).Split((char[]?)null, StringSplitOptions.RemoveEmptyEntries));
}
