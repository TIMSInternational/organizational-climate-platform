using System.Text.Json;

namespace ClimateProject.DataMigration.Reporting;

public enum ReportEntryKind
{
    /// <summary>A whole document that was not written, with the reason. These are the
    /// entries reconciliation counts: source = written + skips, exactly.</summary>
    Skip,

    /// <summary>A single field loaded as NULL because its reference could not resolve.
    /// The row itself was written - degradations never enter the skip count.</summary>
    Degraded,

    /// <summary>A monolingual content field routed to _en or _es by Company.language (#195).</summary>
    Attribution,

    /// <summary>A named normalisation rule fired (never an inline silent fix).</summary>
    Normalisation,

    /// <summary>A field the typed stub did not declare arrived in a document's Extra.</summary>
    UnmappedExtra,

    /// <summary>A recomputed-vs-legacy disagreement (e.g. Department level/path).</summary>
    IntegrityFinding,
}

/// <summary>One reportable fact about one document (or one field of one document).</summary>
public sealed record ReportEntry(
    string Rule,
    ReportEntryKind Kind,
    string Collection,
    string? LegacyId,
    string? Field,
    string Reason);

/// <summary>
/// The data-quality report: the reviewable deliverable of a run (sub-issue E). Every
/// document not migrated cleanly, every language attribution and every normalisation
/// that fired lands here by NAME, so the report enumerates rules rather than prose.
/// Skips are load-bearing: reconciliation asserts source count == written + skips per
/// collection, and a skip that bypasses this report breaks that equation loudly.
/// </summary>
public sealed class DataQualityReport
{
    private readonly List<ReportEntry> _entries = [];

    public IReadOnlyList<ReportEntry> Entries => _entries;

    public void Add(ReportEntry entry) => _entries.Add(entry);

    public void Skip(string rule, string collection, string legacyId, string reason, string? field = null)
        => _entries.Add(new ReportEntry(rule, ReportEntryKind.Skip, collection, legacyId, field, reason));

    public void Attribution(string collection, string legacyId, string field, string language)
        => _entries.Add(new ReportEntry(
            MigrationRules.LanguageAttribution, ReportEntryKind.Attribution, collection, legacyId, field,
            $"monolingual content attributed to '{language}'"));

    public void Normalisation(string rule, string collection, string legacyId, string field, string reason)
        => _entries.Add(new ReportEntry(rule, ReportEntryKind.Normalisation, collection, legacyId, field, reason));

    public void UnmappedExtra(string collection, string legacyId, string field)
        => _entries.Add(new ReportEntry(
            MigrationRules.UnmappedField, ReportEntryKind.UnmappedExtra, collection, legacyId, field,
            "field present in the document but undeclared by the typed stub"));

    public void Integrity(string rule, string collection, string legacyId, string field, string reason)
        => _entries.Add(new ReportEntry(rule, ReportEntryKind.IntegrityFinding, collection, legacyId, field, reason));

    /// <summary>Skips for one collection - the number reconciliation holds against the source count.</summary>
    public int SkipCount(string collection)
        => _entries.Count(e => e.Kind == ReportEntryKind.Skip && e.Collection == collection);

    public void Degraded(string rule, string collection, string legacyId, string field, string reason)
        => _entries.Add(new ReportEntry(rule, ReportEntryKind.Degraded, collection, legacyId, field, reason));

    public IReadOnlyDictionary<string, int> CountsByRule()
        => _entries.GroupBy(e => e.Rule).ToDictionary(g => g.Key, g => g.Count());

    /// <summary>One file per run. JSON, counts first, then every entry.</summary>
    public async Task WriteAsync(string path, CancellationToken cancellationToken)
    {
        var payload = new
        {
            counts = CountsByRule().OrderBy(p => p.Key).ToDictionary(p => p.Key, p => p.Value),
            entries = _entries,
        };
        var directory = Path.GetDirectoryName(Path.GetFullPath(path));
        if (!string.IsNullOrEmpty(directory))
        {
            Directory.CreateDirectory(directory);
        }

        await using var stream = File.Create(path);
        await JsonSerializer.SerializeAsync(stream, payload, new JsonSerializerOptions { WriteIndented = true }, cancellationToken);
    }
}

/// <summary>
/// Every rule the pipeline can fire, by name. The report enumerates these; the tests
/// exercise them one by one. A rule that is not named here does not exist.
/// </summary>
public static class MigrationRules
{
    public const string LanguageAttribution = "content.language-attribution";
    public const string UnmappedField = "document.unmapped-field";

    public const string MissingRequiredField = "document.missing-required-field";
    public const string DanglingReference = "reference.dangling";
    public const string MalformedReference = "reference.malformed";

    public const string DemographicKeyUnresolved = "user.demographic-key-unresolved";
    public const string DemographicValueOverlong = "user.demographic-value-overlong";
    public const string DemographicValueNotScalar = "user.demographic-value-not-scalar";
    public const string RoleUnknown = "user.role-unknown";
    public const string DuplicateEmail = "user.duplicate-email";

    public const string DepartmentHierarchyMismatch = "department.hierarchy-mismatch";
    public const string DuplicateLegacyExternalId = "department.duplicate-legacy-external-id";

    public const string RoleDepartmentAdminRemapped = "user.role-department-admin-remapped";
    public const string CompanyInactiveDropped = "company.inactive-flag-dropped";
    public const string TimestampFromObjectId = "timestamp.from-object-id";
    public const string ContentOverlongTruncated = "content.overlong-truncated";

    // Survey (#154 slice 2). Status remaps because the target vocabulary is
    // draft/scheduled/active/closed/archived (SurveyStatuses) while legacy was
    // draft/active/paused/completed/archived; both retired statuses land on 'closed'
    // because it is the one state that, like them, refuses new responses.
    public const string SurveyStatusCompletedRemapped = "survey.status-completed-remapped";
    public const string SurveyStatusPausedRemapped = "survey.status-paused-remapped";
    public const string SurveyStatusUnknown = "survey.status-unknown";
    public const string SurveyTemplateLinkDropped = "survey.template-link-dropped";
    public const string SurveyDemographicsConfigDropped = "survey.demographics-config-dropped";
    public const string SurveyQuestionMissingId = "survey.question-missing-id";
    public const string SurveyQuestionDuplicateId = "survey.question-duplicate-id";

    // Question fan-out. Type remaps: yes_no_comment folds into yes_no (the comment
    // shape lives in the comment columns now), emoji_scale is a pure rename to
    // emoji_rating. Comment-prompt/binary-config scrubs mirror #332's migration: a
    // value equal to the legacy DDL default is the default, not authored content.
    public const string QuestionTypeUnknown = "question.type-unknown";
    public const string QuestionTypeYesNoCommentRemapped = "question.type-yes-no-comment-remapped";
    public const string QuestionTypeEmojiScaleRemapped = "question.type-emoji-scale-remapped";
    public const string CommentPromptDefaultScrubbed = "question.comment-prompt-default-scrubbed";
    public const string BinaryCommentConfigDefaultScrubbed = "question.binary-comment-config-default-scrubbed";
    public const string QuestionOptionDuplicateValue = "question.option-duplicate-value";
    public const string QuestionEmojiOptionInvalid = "question.emoji-option-invalid";
    public const string QuestionConditionValueNotScalar = "question.condition-value-not-scalar";

    // Response (#154 slice 3) - the volume driver. Answer rows are child fan-out, so
    // their misfits are normalisations (the whole-response skip count stays exact).
    public const string ResponseSessionIdFabricated = "response.session-id-fabricated";
    public const string ResponseAnswerQuestionUnresolved = "response.answer-question-unresolved";
    public const string ResponseAnswerDuplicateQuestion = "response.answer-duplicate-question";
    public const string ResponseAnswerValueInvalid = "response.answer-value-invalid";
    public const string ResponseAnswerBooleanCoded = "response.answer-boolean-coded";
    public const string ResponseDemographicInvalid = "response.demographic-invalid";
    public const string ResponseDemographicDuplicateField = "response.demographic-duplicate-field";

    // SurveyTemplate (#154 slice 4). The tenant-leak rule is the sharp one: a template
    // whose company reference cannot resolve is SKIPPED, never NULLed, because
    // CompanyId NULL means globally visible (#191's convention) and the degrade would
    // publish a private template to every tenant. Emoji questions are unrepresentable
    // (no template emoji table, and SurveyTemplateQuestions refuses the type), so the
    // question drops by name rather than loading a row that can never render.
    public const string SurveyTemplateDefaultSettingsDropped = "surveytemplate.default-settings-dropped";
    public const string SurveyTemplateDemographicsConfigDropped = "surveytemplate.demographics-config-dropped";
    public const string SurveyTemplateQuestionIdFromPosition = "surveytemplate.question-id-from-position";
    public const string SurveyTemplateQuestionEmojiUnrepresentable = "surveytemplate.question-emoji-unrepresentable";
    public const string SurveyTemplateQuestionConditionalLogicDropped = "surveytemplate.question-conditional-logic-dropped";

    // SurveyVersion + SurveyAuditLog (#154 slice 5), the survey-history pair.
    public const string SurveyVersionDuplicateNumber = "surveyversion.duplicate-version-number";

    // The audit vocabularies are the sharp part: legacy has 14 actions and 9 entity
    // types, the target 5 and 3 (SurveyAuditActions / SurveyAuditEntityTypes). Every
    // remap is named, and a row whose action has no target meaning is a reported skip
    // rather than a string the history endpoint cannot render. The original values and
    // the raw legacy changes ride along in metadata, so nothing is destroyed.
    public const string AuditActionRemapped = "surveyauditlog.action-remapped";
    public const string AuditActionUnrepresentable = "surveyauditlog.action-unrepresentable";
    public const string AuditEntityTypeRemapped = "surveyauditlog.entity-type-remapped";
    public const string AuditActorFieldFabricated = "surveyauditlog.actor-field-fabricated";
    public const string AuditReferenceNotAnIdentifier = "surveyauditlog.reference-not-an-identifier";

    // SurveyDraft / SurveyDistribution / SurveyInvitation (#154 slice 6).
    public const string DraftExpiryDerived = "surveydraft.expiry-derived";

    // A legacy share link carries a legacy token the target refuses by shape, so
    // keeping it would render a dead link as a live one.
    public const string DistributionPublicLinkDropped = "surveydistribution.public-link-dropped";
    public const string DistributionAccessTypeUnknown = "surveydistribution.access-type-unknown";
    public const string DistributionErrorCorrectionDropped = "surveydistribution.error-correction-dropped";
    public const string DistributionQrPayloadDropped = "surveydistribution.qr-payload-dropped";

    // The legacy invitation token is preserved as a record but cannot authenticate
    // (uuidv4 shape vs the target's 43-char base64url); those people need re-inviting.
    public const string InvitationTokenInert = "surveyinvitation.token-inert";
    public const string InvitationStatusReconstructed = "surveyinvitation.status-reconstructed";
    public const string InvitationExpiryDerived = "surveyinvitation.expiry-derived";
    public const string InvitationDuplicateToken = "surveyinvitation.duplicate-token";
    public const string DistributionDuplicateSurvey = "surveydistribution.duplicate-survey";

    // Microclimate domain (#154 slice 7).
    public const string MicroclimateStatusRemapped = "microclimate.status-remapped";
    public const string MicroclimateDurationDefaulted = "microclimate.duration-defaulted";
    public const string MicroclimateAutoCloseDropped = "microclimate.auto-close-dropped";
    public const string MicroclimateEngagementUnknown = "microclimate.engagement-level-unknown";
    public const string MicroclimateQuestionIdFromPosition = "microclimate.question-id-from-position";
    public const string MicroclimateQuestionEmojiUnrepresentable = "microclimate.question-emoji-unrepresentable";
    public const string MicroclimateInsightIncomplete = "microclimate.insight-incomplete";
}
