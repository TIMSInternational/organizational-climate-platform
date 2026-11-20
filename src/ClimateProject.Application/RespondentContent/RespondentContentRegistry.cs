using ClimateProject.Application.Surveys;

namespace ClimateProject.Application.RespondentContent;

/// <summary>What an entry is: a respondent screen's words, an email's, or a presentation choice.</summary>
public static class RespondentContentKinds
{
    /// <summary>Words on a respondent screen. Product default: the web catalogue.</summary>
    public const string Screen = "screen";

    /// <summary>A survey email's subject or paragraph. Product default: the composer's C# copy.</summary>
    public const string Email = "email";

    /// <summary>A locale-independent presentation choice with a closed set of values.</summary>
    public const string Display = "display";

    public static readonly IReadOnlyList<string> All = [Screen, Email, Display];

    /// <summary>
    /// What a respondent payload carries (<c>SurveyRespondView.Content</c>, the invitation token
    /// detail): the screens' words and the display choices. The emails' words never ride on a
    /// payload served to an anonymous visitor -- nothing on a screen reads them.
    /// </summary>
    public static readonly IReadOnlyList<string> RespondentPayload = [Screen, Display];
}

/// <summary>The locales an override is stored under.</summary>
public static class RespondentContentLocales
{
    public const string Spanish = "es";
    public const string English = "en";

    /// <summary>A <see cref="RespondentContentKinds.Display"/> key's only locale.</summary>
    public const string Any = "*";

    /// <summary>Every locale a PUT may name.</summary>
    public static readonly IReadOnlyList<string> All = [Spanish, English, Any];

    /// <summary>The locales a text (screen or email) is written in.</summary>
    public static readonly IReadOnlyList<string> Text = [Spanish, English];

    public static bool IsText(string? locale) => locale is Spanish or English;
}

/// <summary>
/// The survey columns that already held a text before the registry existed. They stay that
/// text's SURVEY-level storage (the ruling: "not duplicated in the table"); the names are the
/// <see cref="Domain.Entities.SurveySettings"/> property prefixes, <c>En</c>/<c>Es</c> appended.
/// </summary>
public static class RespondentContentLegacyColumns
{
    /// <summary><c>SurveySettings.RespondentIntroEn/Es</c>: the anonymity box's paragraph.</summary>
    public const string RespondentIntro = "RespondentIntro";

    /// <summary><c>SurveySettings.ClosingMessageEn/Es</c>: the thank-you.</summary>
    public const string ClosingMessage = "ClosingMessage";

    /// <summary><c>SurveySettings.InvitationCustomSubjectEn/Es</c>: the personal-link email's subject.</summary>
    public const string InvitationCustomSubject = "InvitationCustomSubject";

    /// <summary><c>SurveySettings.InvitationCustomMessageEn/Es</c>: the personal-link email's message.</summary>
    public const string InvitationCustomMessage = "InvitationCustomMessage";

    public static readonly IReadOnlyList<string> All = [RespondentIntro, ClosingMessage, InvitationCustomSubject, InvitationCustomMessage];
}

/// <summary>
/// One overridable text or choice.
/// </summary>
/// <param name="Key">
/// The key. A <see cref="RespondentContentKinds.Screen"/> key is its catalogue path as the web
/// reads it inside <c>useTranslation('surveyRespond')</c> -- see <see cref="RespondentContentRegistry"/>.
/// </param>
/// <param name="Kind">One of <see cref="RespondentContentKinds"/>.</param>
/// <param name="Group">
/// The screen (or email) the text is read on, for an editor that lists the entries screen by
/// screen: <c>start</c>, <c>invitation</c>, <c>anonymity</c>, <c>demographics</c>,
/// <c>identity</c>, <c>footer</c>, <c>thanks</c>, <c>cards</c>, <c>email.personalLink</c>,
/// <c>email.credentials</c>, <c>email.reminder</c>, <c>display</c>.
/// </param>
/// <param name="MaxLength">The longest value accepted, in UTF-16 code units, after trimming.</param>
/// <param name="Placeholders">
/// The <c>{name}</c> placeholders an override may contain, without braces: exactly those the
/// product default uses. An override may leave one out; it may not introduce another.
/// </param>
/// <param name="LegacyColumn">One of <see cref="RespondentContentLegacyColumns"/>, or null.</param>
/// <param name="Values">A display entry's closed set of values; empty for a text.</param>
/// <param name="DefaultValue">A display entry's product default; null for a text (its default lives in the catalogue or the composer).</param>
public sealed record RespondentContentEntry(
    string Key,
    string Kind,
    string Group,
    int MaxLength,
    IReadOnlyList<string> Placeholders,
    string? LegacyColumn = null,
    IReadOnlyList<string>? Values = null,
    string? DefaultValue = null)
{
    /// <summary>The closed set of values a display entry admits; empty for a text.</summary>
    public IReadOnlyList<string> AllowedValues { get; } = Values ?? [];

    public bool IsDisplay => Kind == RespondentContentKinds.Display;

    /// <summary>
    /// At the SURVEY level, once this text is set in one of the survey's languages it must be set
    /// in every one of them before the survey leaves draft: the four legacy keys are publish-gate
    /// fields (<c>SurveyContent.GateFields</c>, «faltan traducciones»), as they were before the
    /// registry. Every other text, and every company-level value, is per locale with the product
    /// default where a locale has none. An editor marks these.
    /// </summary>
    public bool RequiresEveryLocale => LegacyColumn is not null;

    /// <summary>Whether a value for this entry may be stored under <paramref name="locale"/>.</summary>
    public bool TakesLocale(string? locale)
        => IsDisplay ? locale == RespondentContentLocales.Any : RespondentContentLocales.IsText(locale);
}

/// <summary>
/// The FIXED list of what a client's wording may replace, at the company level and per survey
/// (ruled 2026-11-19, <c>docs/decisions/editable-respondent-content.md</c>): «survey → company →
/// product default». Nothing outside this list is overridable, and adding an entry is a code
/// change on purpose -- an override that no screen reads would be an editor that lies.
/// </summary>
/// <remarks>
/// <para><b>The key convention.</b> A <see cref="RespondentContentKinds.Screen"/> key is the
/// text's path in <c>web/src/i18n/{es,en}.json</c> UNDER the <c>surveyRespond</c> namespace and
/// WITHOUT that prefix -- exactly the string a respondent component passes to <c>t()</c> after
/// <c>useTranslation('surveyRespond')</c>: <c>anonymousBody</c>, <c>demographics.intro</c>,
/// <c>next.entryPace</c>. So a screen renders <c>content[key] ?? t(key)</c> with one key, and
/// <c>RespondentContentRegistryTests</c> reads both catalogues and fails when a screen key is
/// missing from either or uses a placeholder the registry does not allow. Email keys are
/// <c>email.&lt;mail&gt;.&lt;part&gt;</c> and display keys <c>display.&lt;name&gt;</c>; the
/// same test asserts neither prefix exists under <c>surveyRespond</c>, so the three families
/// can never collide.</para>
///
/// <para><b>What is deliberately NOT here.</b> Every text that states what is RECORDED about the
/// person, except the two the ruling made editable (<c>anonymousBody</c>, the anonymity paragraph,
/// and <c>participationBody</c>, the participation clause). In particular the identified
/// variants -- <c>identifiedChip</c>, <c>identifiedTitle</c>, <c>identifiedBody</c> -- and
/// <c>answeredOnThisDeviceBody</c>/<c>answeredOnThisDeviceBodyRecorded</c>: an author's prose
/// must not be able to hide that names are kept (<c>SurveySettings.RespondentIntroEn</c>). Nor
/// the two «Qué pasa ahora» claims about how the answers are kept, <c>happensPooledTitle</c>
/// («se agrupan de inmediato») and <c>happensAttributedTitle</c> («las procesa un equipo
/// externo»): an override of either could tell an identified survey's respondents their answers
/// are pooled. Also
/// out: errors, autosave and validation messages, accessible-only labels, and the
/// privacy-floor and storage guarantees, which change by ruling, not by preference.</para>
///
/// <para><b>Placeholders</b> are <c>{name}</c> with <c>name</c> in <c>[A-Za-z0-9_]</c>, the
/// pattern <c>web/src/i18n/translate.ts</c> interpolates. A screen entry allows exactly the
/// placeholders its catalogue default uses; an email entry allows <c>{survey}</c> and
/// <c>{company}</c>, the two names the composers put in their own subjects and paragraphs.</para>
/// </remarks>
public static class RespondentContentRegistry
{
    /// <summary>Eyebrows, readings, chips and buttons.</summary>
    public const int LabelMaxLength = 80;

    /// <summary>Titles and headings.</summary>
    public const int TitleMaxLength = 200;

    /// <summary>One sentence: the pace line, the footer, a thank-you claim.</summary>
    public const int SentenceMaxLength = 300;

    /// <summary>A paragraph: an intro, a card's body.</summary>
    public const int ParagraphMaxLength = 1000;

    /// <summary>An email subject: the width of <c>settings_invitation_custom_subject_*</c>.</summary>
    public const int EmailSubjectMaxLength = 200;

    /// <summary>An email paragraph: the width of <c>settings_invitation_custom_message_*</c>.</summary>
    public const int EmailMessageMaxLength = 1000;

    /// <summary>The width of <c>respondent_content_overrides.value</c>; every entry fits under it.</summary>
    public const int StorageMaxLength = 4000;

    // ---- keys code refers to by name ------------------------------------------------------

    public const string AnonymousBody = "anonymousBody";
    public const string ParticipationBody = "participationBody";
    public const string ThankYouTitle = "thankYouTitle";
    public const string DemographicsIntro = "demographics.intro";
    public const string IdentityIntro = "identity.intro";
    public const string EmailPersonalLinkSubject = "email.personalLink.subject";
    public const string EmailPersonalLinkMessage = "email.personalLink.message";
    public const string EmailCredentialsSubject = "email.credentials.subject";
    public const string EmailCredentialsMessage = "email.credentials.message";
    public const string EmailReminderSubject = "email.reminder.subject";
    public const string EmailReminderMessage = "email.reminder.message";
    public const string DisplayTextAlign = "display.textAlign";

    /// <summary><see cref="DisplayTextAlign"/>'s values: justified with hyphenation (PROCOMER, 2026-11-19) or ragged.</summary>
    public const string TextAlignJustify = "justify";

    public const string TextAlignStart = "start";

    private static readonly string[] None = [];
    private static readonly string[] EmailPlaceholders = ["survey", "company"];

    /// <summary>Every entry, in the order an editor lists them: screen by screen, then the emails, then display.</summary>
    public static readonly IReadOnlyList<RespondentContentEntry> Entries =
    [
        // /s/:token -- the start page (PublicRespondEntryView). `closesReading` is the same
        // reading on the personal-link landing.
        Screen("eyebrow", "start", LabelMaxLength),
        Screen("next.entryPace", "start", SentenceMaxLength, "count", "minutes"),
        Screen("next.entryPaceBrief", "start", SentenceMaxLength, "count"),
        Screen("next.entryPaceOne", "start", SentenceMaxLength),
        Screen("next.entryPaceOneQuestion", "start", SentenceMaxLength, "minutes"),
        Screen("closesReading", "start", LabelMaxLength),
        Screen("questionsReading", "start", LabelMaxLength),
        Screen("next.entryStart", "start", LabelMaxLength),

        // /survey-invitations/:token -- the personal-link landing (SurveyInvitationPage).
        Screen("invitationEyebrow", "invitation", LabelMaxLength),
        Screen("invitationExpiresReading", "invitation", LabelMaxLength),
        Screen("beginSurvey", "invitation", LabelMaxLength),

        // The anonymity notice (AnonymityNotice), on an anonymous response only.
        Screen("anonymousChip", "anonymity", LabelMaxLength),
        new(AnonymousBody, RespondentContentKinds.Screen, "anonymity", SurveyRespondentText.IntroMaxLength, None,
            LegacyColumn: RespondentContentLegacyColumns.RespondentIntro),
        Screen(ParticipationBody, "anonymity", ParagraphMaxLength),

        // «Sobre usted»: the self-declared demographics screen.
        Screen("demographics.eyebrow", "demographics", LabelMaxLength),
        Screen(DemographicsIntro, "demographics", ParagraphMaxLength),
        Screen("demographics.start", "demographics", LabelMaxLength),

        // «Quién responde»: name and email, before the questions.
        Screen("identity.eyebrow", "identity", LabelMaxLength),
        Screen(IdentityIntro, "identity", ParagraphMaxLength),
        Screen("identity.question", "identity", TitleMaxLength),
        Screen("identity.name", "identity", LabelMaxLength),
        Screen("identity.email", "identity", LabelMaxLength),
        Screen("identity.emailHelp", "identity", SentenceMaxLength),

        // The question footer.
        Screen("next.closesOn", "footer", SentenceMaxLength, "date"),
        Screen("next.aboutMinutes", "footer", SentenceMaxLength, "minutes"),
        Screen("next.underAMinute", "footer", SentenceMaxLength),

        // The thank-you. The closing message replaces its title, as it always has.
        new(ThankYouTitle, RespondentContentKinds.Screen, "thanks", SurveyRespondentText.ClosingMaxLength, None,
            LegacyColumn: RespondentContentLegacyColumns.ClosingMessage),
        Screen("receiptReading", "thanks", LabelMaxLength),
        Screen("whatHappensNowTitle", "thanks", TitleMaxLength),
        Screen("happensClosesTitle", "thanks", SentenceMaxLength, "date"),
        Screen("happensResultsTitle", "thanks", SentenceMaxLength),

        // The closed and already-answered cards. Where no view is loaded they are drawn from a
        // refusal that carries the same map (`RespondentCardRefusal`): the respond GET's 400 on a
        // closed survey, the personal-link landing's 409 `already_completed`. The UNAVAILABLE
        // card (`unavailableTitle`, `next.entryLinkUnavailableBody`) is deliberately not here: it
        // is drawn only from the respond GET's fail-closed 401, which tells a holder of a dead
        // link nothing -- not even whose survey it was -- so no client's words can reach it.
        Screen("closedTitle", "cards", TitleMaxLength),
        Screen("closedBody", "cards", ParagraphMaxLength),
        Screen("alreadyCompletedTitle", "cards", TitleMaxLength),
        Screen("alreadyCompletedBody", "cards", ParagraphMaxLength),
        Screen("answeredOnThisDeviceTitle", "cards", TitleMaxLength),

        // The three survey emails. The personal-link pair already had survey columns.
        new(EmailPersonalLinkSubject, RespondentContentKinds.Email, "email.personalLink", EmailSubjectMaxLength, EmailPlaceholders,
            LegacyColumn: RespondentContentLegacyColumns.InvitationCustomSubject),
        new(EmailPersonalLinkMessage, RespondentContentKinds.Email, "email.personalLink", EmailMessageMaxLength, EmailPlaceholders,
            LegacyColumn: RespondentContentLegacyColumns.InvitationCustomMessage),
        new(EmailCredentialsSubject, RespondentContentKinds.Email, "email.credentials", EmailSubjectMaxLength, EmailPlaceholders),
        new(EmailCredentialsMessage, RespondentContentKinds.Email, "email.credentials", EmailMessageMaxLength, EmailPlaceholders),
        new(EmailReminderSubject, RespondentContentKinds.Email, "email.reminder", EmailSubjectMaxLength, EmailPlaceholders),
        new(EmailReminderMessage, RespondentContentKinds.Email, "email.reminder", EmailMessageMaxLength, EmailPlaceholders),

        // Presentation. Locale '*'.
        new(DisplayTextAlign, RespondentContentKinds.Display, "display", TextAlignJustify.Length, None,
            Values: [TextAlignJustify, TextAlignStart], DefaultValue: TextAlignJustify),
    ];

    private static readonly Dictionary<string, RespondentContentEntry> ByKey =
        Entries.ToDictionary(e => e.Key, StringComparer.Ordinal);

    /// <summary>The entry named <paramref name="key"/> (case-sensitive), if the registry has one.</summary>
    public static bool TryGet(string? key, out RespondentContentEntry entry)
    {
        if (key is not null && ByKey.TryGetValue(key, out var found))
        {
            entry = found;
            return true;
        }

        entry = null!;
        return false;
    }

    /// <summary>The entry stored in <paramref name="legacyColumn"/>, if any.</summary>
    public static RespondentContentEntry? ForLegacyColumn(string legacyColumn)
        => Entries.FirstOrDefault(e => string.Equals(e.LegacyColumn, legacyColumn, StringComparison.Ordinal));

    private static RespondentContentEntry Screen(string key, string group, int maxLength, params string[] placeholders)
        => new(key, RespondentContentKinds.Screen, group, maxLength, placeholders);
}
