using System.Text.Json;
using System.Text.Json.Serialization;
using ClimateProject.Domain.Entities;

namespace ClimateProject.Application.Surveys;

// ---------------------------------------------------------------------------
// SNAPSHOT SHAPES
//
// These are PERSISTENCE shapes, not read DTOs, and they are deliberately
// En/Es-paired. The #195 rule ("no read DTO may expose En/Es-shaped fields")
// governs what leaves the API; it cannot govern what a snapshot stores, because a
// snapshot that kept only the locale someone happened to be reading in would
// desynchronise from the survey it claims to be a copy of the moment the survey is
// translated -- which is exactly what SurveyVersion's own entity comment warns
// about for its title/description columns.
//
// Nothing below is ever returned raw. SurveyHistoryEndpoints resolves every one of
// these pairs through SurveyContent.Resolve and hands back the same
// SurveyQuestionDto / SurveySettingsDto the live survey uses, so a client renders a
// historical version with the code it already has.
// ---------------------------------------------------------------------------

/// <summary>
/// One option as it stood at publish time. <see cref="Value"/> is the stable,
/// locale-independent key that <c>question_responses.response_value</c> holds -- it is
/// the join key between a stored answer and the wording that produced it, so it is the
/// single most important field in the snapshot.
/// </summary>
public sealed record SurveyVersionOptionSnapshot(int Order, string Value, string? LabelEn, string? LabelEs);

/// <param name="Id">
/// The live <c>questions.id</c> at the time of the snapshot. Kept because
/// <c>question_responses.question_id</c> points at it: without it a stored answer can be
/// matched to a version's wording only by ordinal, and ordinals move.
/// </param>
public sealed record SurveyVersionQuestionSnapshot(
    Guid Id,
    int Order,
    string Type,
    string? TextEn,
    string? TextEs,
    int? ScaleMin,
    int? ScaleMax,
    string? ScaleLabelMinEn,
    string? ScaleLabelMinEs,
    string? ScaleLabelMaxEn,
    string? ScaleLabelMaxEs,
    bool Required,
    bool CommentRequired,
    string? CommentPromptEn,
    string? CommentPromptEs,
    string? Category,
    IReadOnlyList<SurveyVersionOptionSnapshot> Options);

/// <summary>
/// Everything about how the survey was configured to run, flattened into the one
/// <c>settings_snapshot</c> jsonb column.
///
/// Written out member by member rather than by serialising <see cref="SurveySettings"/>
/// directly: the entity is free to be renamed or restructured by a later lane, and a
/// snapshot table whose stored JSON silently stops deserialising is a version history
/// that reads as empty rather than as broken.
///
/// <paramref name="DepartmentIds"/> lives here, and <c>demographics_snapshot</c> is left
/// null -- see <see cref="SurveyVersioning"/>.
/// </summary>
public sealed record SurveyVersionSettingsSnapshot(
    string Type,
    string Language,
    DateTimeOffset StartDate,
    DateTimeOffset EndDate,
    IReadOnlyList<Guid> DepartmentIds,
    int? TargetAudienceCount,
    bool Anonymous,
    bool AllowPartialResponses,
    bool RandomizeQuestions,
    bool ShowProgress,
    bool AutoSave,
    int? TimeLimitMinutes,
    int? ResponseLimit,
    bool NotificationSendInvitations,
    bool NotificationSendReminders,
    int NotificationReminderFrequencyDays,
    string? InvitationCustomMessageEn,
    string? InvitationCustomMessageEs,
    string? InvitationCustomSubjectEn,
    string? InvitationCustomSubjectEs,
    bool InvitationIncludeCredentials,
    bool InvitationSendImmediately,
    bool InvitationBrandingEnabled);

/// <summary>
/// A whole survey's content at one instant: the two column pairs SurveyVersion carries
/// natively plus the two jsonb blobs. The unit both <see cref="SurveyVersioning.Capture"/>
/// and <see cref="SurveyVersioning.Diff"/> work in.
/// </summary>
public sealed record SurveyVersionContent(
    string? TitleEn,
    string? TitleEs,
    string? DescriptionEn,
    string? DescriptionEs,
    IReadOnlyList<SurveyVersionQuestionSnapshot> Questions,
    SurveyVersionSettingsSnapshot Settings);

/// <summary>
/// Why a snapshot was taken. Machine tokens, not display copy: the frontend maps them to
/// i18n keys, so a version history reads in the viewer's language rather than in
/// whatever language the server happened to be written in.
/// </summary>
public static class SurveyVersionReasons
{
    /// <summary>First time this survey's content became visible to respondents.</summary>
    public const string Publish = "publish";

    /// <summary>
    /// A later publish. Only reachable via <c>scheduled -&gt; draft -&gt; scheduled|active</c>,
    /// which the lifecycle permits precisely because a scheduled survey has no responses
    /// yet.
    /// </summary>
    public const string Republish = "republish";

    public static readonly string[] All = [Publish, Republish];
}

/// <summary>
/// Snapshotting and diffing a survey's content, as pure functions over plain data.
///
/// Kept in Application, out of the endpoint, for the same reason
/// <see cref="SurveyStatuses"/> and <c>DemographicSnapshotDiff</c> are: this is the part
/// that is easy to get subtly wrong and expensive to notice. A wrong diff does not throw;
/// it just makes the change log quietly misleading, and it is unit-testable here without
/// Docker.
///
/// <b>What a version is.</b> One row per publish. A survey's content is editable only in
/// <c>draft</c> (<see cref="SurveyStatuses.AllowsContentEdit"/>) and only while it has no
/// responses, and no status that accepts responses has a path back to <c>draft</c>. So
/// the snapshot taken at the publish that led to collection is, and remains, a byte-for-byte
/// copy of the content every response was collected against -- which is what makes an
/// answer resolvable to the exact wording that produced it.
///
/// <b>demographics_snapshot stays null.</b> Legacy's survey model carried a per-survey
/// demographic-field configuration; this schema has none (demographics are normalised into
/// <c>user_demographics</c> / <c>response_demographics</c>, see #193). Repurposing the
/// column for department targeting would make it mean something different from its name,
/// so targeting goes in <see cref="SurveyVersionSettingsSnapshot.DepartmentIds"/> and the
/// column is left for the configuration it is named after, if that ever lands.
/// </summary>
public static class SurveyVersioning
{
    /// <summary>
    /// Web defaults: camelCase out, case-insensitive in. Matching the API's own JSON
    /// conventions matters because these blobs are read by hand in psql at least as often
    /// as by this code.
    /// </summary>
    private static readonly JsonSerializerOptions SnapshotJson = new(JsonSerializerDefaults.Web)
    {
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
    };

    public static SurveyVersionContent Capture(
        Survey survey,
        IReadOnlyList<Question> questions,
        IReadOnlyDictionary<Guid, List<QuestionOption>> optionsByQuestion,
        IReadOnlyCollection<Guid> departmentIds)
    {
        ArgumentNullException.ThrowIfNull(survey);
        ArgumentNullException.ThrowIfNull(questions);
        ArgumentNullException.ThrowIfNull(optionsByQuestion);
        ArgumentNullException.ThrowIfNull(departmentIds);

        var questionSnapshots = questions
            .OrderBy(q => q.Order)
            .ThenBy(q => q.Id)
            .Select(q => new SurveyVersionQuestionSnapshot(
                q.Id,
                q.Order,
                q.Type,
                q.TextEn,
                q.TextEs,
                q.ScaleMin,
                q.ScaleMax,
                q.ScaleLabelMinEn,
                q.ScaleLabelMinEs,
                q.ScaleLabelMaxEn,
                q.ScaleLabelMaxEs,
                q.Required,
                q.CommentRequired,
                q.CommentPromptEn,
                q.CommentPromptEs,
                q.Category,
                (optionsByQuestion.TryGetValue(q.Id, out var options) ? options : [])
                    .OrderBy(o => o.Order)
                    .Select(o => new SurveyVersionOptionSnapshot(o.Order, o.Value, o.LabelEn, o.LabelEs))
                    .ToList()))
            .ToList();

        var settings = new SurveyVersionSettingsSnapshot(
            survey.Type,
            survey.Language,
            survey.StartDate,
            survey.EndDate,
            departmentIds.Distinct().OrderBy(id => id).ToList(),
            survey.TargetAudienceCount,
            survey.Settings.Anonymous,
            survey.Settings.AllowPartialResponses,
            survey.Settings.RandomizeQuestions,
            survey.Settings.ShowProgress,
            survey.Settings.AutoSave,
            survey.Settings.TimeLimitMinutes,
            survey.Settings.ResponseLimit,
            survey.Settings.NotificationSendInvitations,
            survey.Settings.NotificationSendReminders,
            survey.Settings.NotificationReminderFrequencyDays,
            survey.Settings.InvitationCustomMessageEn,
            survey.Settings.InvitationCustomMessageEs,
            survey.Settings.InvitationCustomSubjectEn,
            survey.Settings.InvitationCustomSubjectEs,
            survey.Settings.InvitationIncludeCredentials,
            survey.Settings.InvitationSendImmediately,
            survey.Settings.InvitationBrandingEnabled);

        return new SurveyVersionContent(
            survey.TitleEn, survey.TitleEs, survey.DescriptionEn, survey.DescriptionEs,
            questionSnapshots, settings);
    }

    public static string SerializeQuestions(IReadOnlyList<SurveyVersionQuestionSnapshot> questions)
        => JsonSerializer.Serialize(questions, SnapshotJson);

    public static string SerializeSettings(SurveyVersionSettingsSnapshot settings)
        => JsonSerializer.Serialize(settings, SnapshotJson);

    /// <summary>
    /// Reads a stored row back into <see cref="SurveyVersionContent"/>.
    ///
    /// A blob that is null, empty or unparseable degrades to "no questions" / default
    /// settings rather than throwing: version history is a read-only audit surface, and a
    /// 500 on the whole list because one old row predates a shape change would hide the
    /// other rows too. The row's own columns still tell the truth about title, actor and
    /// time.
    /// </summary>
    public static SurveyVersionContent ReadContent(SurveyVersion version)
    {
        ArgumentNullException.ThrowIfNull(version);

        return new SurveyVersionContent(
            version.TitleEn,
            version.TitleEs,
            version.DescriptionEn,
            version.DescriptionEs,
            Deserialize<List<SurveyVersionQuestionSnapshot>>(version.QuestionsSnapshot) ?? [],
            Deserialize<SurveyVersionSettingsSnapshot>(version.SettingsSnapshot) ?? EmptySettings);
    }

    private static readonly SurveyVersionSettingsSnapshot EmptySettings = new(
        Type: string.Empty,
        Language: Localization.ContentLanguages.FallbackLocale,
        StartDate: default,
        EndDate: default,
        DepartmentIds: [],
        TargetAudienceCount: null,
        Anonymous: false,
        AllowPartialResponses: true,
        RandomizeQuestions: false,
        ShowProgress: true,
        AutoSave: true,
        TimeLimitMinutes: null,
        ResponseLimit: null,
        NotificationSendInvitations: true,
        NotificationSendReminders: true,
        NotificationReminderFrequencyDays: 3,
        InvitationCustomMessageEn: null,
        InvitationCustomMessageEs: null,
        InvitationCustomSubjectEn: null,
        InvitationCustomSubjectEs: null,
        InvitationIncludeCredentials: false,
        InvitationSendImmediately: false,
        InvitationBrandingEnabled: false);

    private static T? Deserialize<T>(string? json)
    {
        if (string.IsNullOrWhiteSpace(json))
        {
            return default;
        }

        try
        {
            return JsonSerializer.Deserialize<T>(json, SnapshotJson);
        }
        catch (JsonException)
        {
            return default;
        }
    }

    // ------------------------------------------------------------------
    // Diff
    // ------------------------------------------------------------------

    /// <summary>
    /// Every settings member, as (field path, accessor). A table rather than twenty-odd
    /// if-statements so that adding a member to the snapshot and forgetting to diff it is
    /// one visible omission in one place instead of an invisible one spread over a method.
    /// <c>DepartmentIds</c> is absent deliberately -- it is a set and needs set equality.
    /// </summary>
    private static readonly (string Field, Func<SurveyVersionSettingsSnapshot, object?> Get)[] SettingsFields =
    [
        ("type", s => s.Type),
        ("language", s => s.Language),
        ("startDate", s => s.StartDate),
        ("endDate", s => s.EndDate),
        ("targetAudienceCount", s => s.TargetAudienceCount),
        ("settings.anonymous", s => s.Anonymous),
        ("settings.allowPartialResponses", s => s.AllowPartialResponses),
        ("settings.randomizeQuestions", s => s.RandomizeQuestions),
        ("settings.showProgress", s => s.ShowProgress),
        ("settings.autoSave", s => s.AutoSave),
        ("settings.timeLimitMinutes", s => s.TimeLimitMinutes),
        ("settings.responseLimit", s => s.ResponseLimit),
        ("settings.notificationSendInvitations", s => s.NotificationSendInvitations),
        ("settings.notificationSendReminders", s => s.NotificationSendReminders),
        ("settings.notificationReminderFrequencyDays", s => s.NotificationReminderFrequencyDays),
        ("settings.invitationCustomMessage", s => Pair(s.InvitationCustomMessageEn, s.InvitationCustomMessageEs)),
        ("settings.invitationCustomSubject", s => Pair(s.InvitationCustomSubjectEn, s.InvitationCustomSubjectEs)),
        ("settings.invitationIncludeCredentials", s => s.InvitationIncludeCredentials),
        ("settings.invitationSendImmediately", s => s.InvitationSendImmediately),
        ("settings.invitationBrandingEnabled", s => s.InvitationBrandingEnabled),
    ];

    /// <summary>
    /// The field paths that changed between two versions of a survey's content, ordered and
    /// stable. Lands in <c>survey_versions.changes</c> and in the <c>changes</c> jsonb of a
    /// survey audit entry.
    ///
    /// <b>Both locales of a pair are one field.</b> Translating a question is a change to
    /// <c>questions[0].text</c>, not to some <c>questions[0].textEs</c> the API has no
    /// concept of -- emitting locale-suffixed paths here would leak the #195 column shape
    /// into a client-facing string.
    ///
    /// <b>Questions are matched by order, not by id.</b> A content edit replaces every
    /// question row wholesale with freshly generated ids (see
    /// <c>SurveyEndpoints.UpdateAsync</c>), so id-matching would report every version as a
    /// total rewrite. Order is what a reader recognises the question by.
    /// </summary>
    public static IReadOnlyList<string> Diff(SurveyVersionContent? previous, SurveyVersionContent next)
    {
        ArgumentNullException.ThrowIfNull(next);

        // No predecessor: the first version is not a change to anything.
        if (previous is null)
        {
            return [];
        }

        var changes = new List<string>();

        if (!Equals(Pair(previous.TitleEn, previous.TitleEs), Pair(next.TitleEn, next.TitleEs)))
        {
            changes.Add("title");
        }

        if (!Equals(Pair(previous.DescriptionEn, previous.DescriptionEs), Pair(next.DescriptionEn, next.DescriptionEs)))
        {
            changes.Add("description");
        }

        foreach (var (field, get) in SettingsFields)
        {
            if (!Equals(get(previous.Settings), get(next.Settings)))
            {
                changes.Add(field);
            }
        }

        if (!previous.Settings.DepartmentIds.ToHashSet().SetEquals(next.Settings.DepartmentIds))
        {
            changes.Add("departmentIds");
        }

        changes.AddRange(DiffQuestions(previous.Questions, next.Questions));

        return changes;
    }

    private static IEnumerable<string> DiffQuestions(
        IReadOnlyList<SurveyVersionQuestionSnapshot> previous,
        IReadOnlyList<SurveyVersionQuestionSnapshot> next)
    {
        var before = ByOrder(previous);
        var after = ByOrder(next);

        foreach (var order in before.Keys.Union(after.Keys).OrderBy(o => o))
        {
            var hadIt = before.TryGetValue(order, out var was);
            var hasIt = after.TryGetValue(order, out var now);
            var path = $"questions[{order}]";

            if (!hadIt)
            {
                yield return $"{path}.added";
                continue;
            }

            if (!hasIt)
            {
                yield return $"{path}.removed";
                continue;
            }

            if (!string.Equals(was!.Type, now!.Type, StringComparison.Ordinal)) yield return $"{path}.type";
            if (!Equals(Pair(was.TextEn, was.TextEs), Pair(now.TextEn, now.TextEs))) yield return $"{path}.text";
            if (was.ScaleMin != now.ScaleMin) yield return $"{path}.scaleMin";
            if (was.ScaleMax != now.ScaleMax) yield return $"{path}.scaleMax";
            if (!Equals(Pair(was.ScaleLabelMinEn, was.ScaleLabelMinEs), Pair(now.ScaleLabelMinEn, now.ScaleLabelMinEs))) yield return $"{path}.scaleLabelMin";
            if (!Equals(Pair(was.ScaleLabelMaxEn, was.ScaleLabelMaxEs), Pair(now.ScaleLabelMaxEn, now.ScaleLabelMaxEs))) yield return $"{path}.scaleLabelMax";
            if (was.Required != now.Required) yield return $"{path}.required";
            if (was.CommentRequired != now.CommentRequired) yield return $"{path}.commentRequired";
            if (!Equals(Pair(was.CommentPromptEn, was.CommentPromptEs), Pair(now.CommentPromptEn, now.CommentPromptEs))) yield return $"{path}.commentPrompt";
            if (!string.Equals(was.Category, now.Category, StringComparison.Ordinal)) yield return $"{path}.category";

            // Options compare as an ordered whole -- value, order and both labels. A
            // changed VALUE is the serious one: it is the join key every stored answer
            // carries, so a version whose options[2].value moved is a version whose
            // answers no longer aggregate with its predecessor's.
            if (!was.Options.SequenceEqual(now.Options)) yield return $"{path}.options";
        }
    }

    /// <summary>
    /// Last write wins on a duplicated order rather than throwing. Nothing in the schema
    /// forbids two questions sharing an order -- the endpoint rejects it at authoring time,
    /// but a snapshot is history and history is not re-validated.
    /// </summary>
    private static Dictionary<int, SurveyVersionQuestionSnapshot> ByOrder(
        IReadOnlyList<SurveyVersionQuestionSnapshot> questions)
    {
        var byOrder = new Dictionary<int, SurveyVersionQuestionSnapshot>();
        foreach (var question in questions)
        {
            byOrder[question.Order] = question;
        }

        return byOrder;
    }

    /// <summary>
    /// Collapses an en/es column pair into one comparable value. Null and "" are the same
    /// absence here -- an admin clearing a field to empty and an admin who never filled it
    /// in have produced the same survey, and reporting that as a change would make every
    /// diff noisy in exactly the places it matters least.
    /// </summary>
    private static object Pair(string? en, string? es)
        => (Normalise(en), Normalise(es));

    private static string? Normalise(string? value)
        => string.IsNullOrWhiteSpace(value) ? null : value.Trim();
}
