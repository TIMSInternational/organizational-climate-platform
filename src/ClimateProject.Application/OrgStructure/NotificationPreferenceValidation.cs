namespace ClimateProject.Application.OrgStructure;

/// <summary>
/// The vocabulary behind <c>NotificationPreferences.DigestFrequency</c> (#192).
///
/// A validated string rather than a C# enum, matching how Role, the various Status
/// columns and <c>Department.MicroclimateFrequency</c> are already handled here: the
/// values are legacy Mongo string literals, and an enum would need a converter on every
/// boundary while still round-tripping as these exact strings.
///
/// The four values are legacy <c>User.ts NotificationSettingsSchema</c>'s enum exactly.
/// Defining the set now, before #97 builds the self-service preferences endpoint, is the
/// point -- an independently written literal list is precisely how the question-type
/// vocabularies drifted apart (see <c>QuestionTypes</c>, #196).
/// </summary>
public static class NotificationPreferenceValidation
{
    public const string DigestDaily = "daily";
    public const string DigestWeekly = "weekly";
    public const string DigestMonthly = "monthly";

    /// <summary>Opt out of digest mail entirely, without opting out of individual mails.</summary>
    public const string DigestNever = "never";

    public static readonly string[] ValidDigestFrequencies =
    [
        DigestDaily,
        DigestWeekly,
        DigestMonthly,
        DigestNever,
    ];

    /// <summary>
    /// The default a user who has never touched their settings holds. Must stay equal to
    /// the DB-level default in <c>UserConfiguration</c> and to the CLR initializer on
    /// <c>NotificationPreferences.DigestFrequency</c>; a unit test asserts all three agree.
    /// </summary>
    public const string DefaultDigestFrequency = DigestWeekly;

    public static bool IsValidDigestFrequency(string? value) =>
        value is not null && Array.IndexOf(ValidDigestFrequencies, value) >= 0;
}
