namespace ClimateProject.Application.RespondentContent;

/// <summary>
/// A survey email's two editable parts -- its subject and its paragraph -- in each language, as
/// the chain resolves them (ruled 2026-11-19, <c>docs/decisions/editable-respondent-content.md</c>):
/// per language, the survey's own row, else the company's, else blank. Blank means the
/// composer's own default copy for that language; another language's words are never borrowed.
/// </summary>
/// <remarks>
/// <para>It holds ONLY the words a client may write. What a mail must carry whatever the client
/// wrote -- the username and password, the sign-in button and its link, the line naming the
/// survey, what to do with the message -- is the composer's, and has no field here to be
/// replaced through.</para>
/// <para>Placeholders (<c>{survey}</c>, <c>{company}</c>) are still in the text: the composer
/// fills them with <see cref="RespondentContentPlaceholders.Fill"/> and THEN hands the result to
/// <c>EmailBranding</c>, which escapes it.</para>
/// </remarks>
public sealed record SurveyEmailText(string? SubjectEs, string? SubjectEn, string? MessageEs, string? MessageEn)
{
    public static readonly SurveyEmailText None = new(null, null, null, null);

    /// <summary>The credentials mail's words (<c>email.credentials.*</c>) from the chain.</summary>
    public static SurveyEmailText Credentials(RespondentContentSources sources)
        => From(sources, RespondentContentRegistry.EmailCredentialsSubject, RespondentContentRegistry.EmailCredentialsMessage);

    /// <summary>The no-password reminder's words (<c>email.reminder.*</c>) from the chain.</summary>
    public static SurveyEmailText Reminder(RespondentContentSources sources)
        => From(sources, RespondentContentRegistry.EmailReminderSubject, RespondentContentRegistry.EmailReminderMessage);

    /// <summary>One read, resolved once per language -- the two-language rule the personal-link mail follows.</summary>
    public static SurveyEmailText From(RespondentContentSources sources, string subjectKey, string messageKey)
    {
        ArgumentNullException.ThrowIfNull(sources);
        string[] email = [RespondentContentKinds.Email];
        var es = RespondentContentResolver.Resolve(sources, RespondentContentLocales.Spanish, email);
        var en = RespondentContentResolver.Resolve(sources, RespondentContentLocales.English, email);
        return new SurveyEmailText(
            es.GetValueOrDefault(subjectKey),
            en.GetValueOrDefault(subjectKey),
            es.GetValueOrDefault(messageKey),
            en.GetValueOrDefault(messageKey));
    }

    /// <summary>
    /// This language's subject with its placeholders filled, or null when nothing was written --
    /// the composer's default then.
    /// </summary>
    public string? SubjectFor(bool spanish, IReadOnlyDictionary<string, string> placeholders)
        => Clean(RespondentContentPlaceholders.Fill(spanish ? SubjectEs : SubjectEn, placeholders));

    /// <summary>This language's paragraph with its placeholders filled, or null when nothing was written.</summary>
    public string? MessageFor(bool spanish, IReadOnlyDictionary<string, string> placeholders)
        => Clean(RespondentContentPlaceholders.Fill(spanish ? MessageEs : MessageEn, placeholders));

    /// <summary>
    /// The author's message split on blank lines, so each paragraph they wrote is its own
    /// paragraph in the mail -- as the personal-link mail splits its message.
    /// </summary>
    public static IEnumerable<string> ParagraphsOf(string message)
    {
        ArgumentNullException.ThrowIfNull(message);
        return message.Replace("\r\n", "\n", StringComparison.Ordinal)
            .Split("\n\n", StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
            .Where(p => p.Length > 0);
    }

    /// <summary>The two names an email override may contain, filled.</summary>
    public static IReadOnlyDictionary<string, string> Placeholders(string? survey, string? company)
        => new Dictionary<string, string>(StringComparer.Ordinal)
        {
            ["survey"] = survey?.Trim() ?? string.Empty,
            ["company"] = company?.Trim() ?? string.Empty,
        };

    private static string? Clean(string? value) => string.IsNullOrWhiteSpace(value) ? null : value.Trim();
}
