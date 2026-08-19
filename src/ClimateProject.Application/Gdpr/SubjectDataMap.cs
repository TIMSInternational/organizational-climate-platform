namespace ClimateProject.Application.Gdpr;

/// <summary>
/// How a table relates to a data subject.
/// </summary>
public enum SubjectLink
{
    /// <summary>The table holds nothing about a natural person.</summary>
    None,

    /// <summary>
    /// The row is <b>about</b> the subject: it exists because that person exists. Their
    /// account, their answers, their invitations, the mail addressed to them.
    /// </summary>
    Subject,

    /// <summary>
    /// The subject appears on a business record as its author, approver or owner. The row is
    /// about a survey or an action plan; the personal data is the attribution itself.
    /// </summary>
    Actor,

    /// <summary>
    /// The row carries no identifier of its own and is reached only through a parent that is
    /// itself <see cref="Subject"/> — the detail lines of the subject's own rows.
    /// </summary>
    ThroughParent,
}

/// <summary>What a subject access request returns for a table.</summary>
public enum ExportTreatment
{
    /// <summary>Nothing. The table holds no data about the subject.</summary>
    None,

    /// <summary>Every mapped column of every matching row, minus <see cref="SubjectDataMap.RedactedColumns"/>.</summary>
    FullRecord,

    /// <summary>
    /// Identifier and label only. Used for <see cref="SubjectLink.Actor"/> rows: the subject's
    /// personal data is "you created this", and the record's own contents routinely include
    /// other people's data (a survey's responses, an action plan's participants), which an
    /// access request by one person must not hand over.
    /// </summary>
    Reference,
}

/// <summary>What an erasure request does to a table. See <c>docs/compliance/gdpr-subject-rights.md</c>.</summary>
public enum ErasureTreatment
{
    /// <summary>The table holds nothing about the subject, so erasure does not reach it.</summary>
    NotApplicable,

    /// <summary>
    /// The rows survive with the link to the person severed or replaced by a pseudonym that
    /// cannot be reversed from the data.
    /// </summary>
    Anonymised,

    /// <summary>Named columns are overwritten; the rest of the row is left intact.</summary>
    Redacted,

    /// <summary>The rows are deleted outright.</summary>
    Deleted,

    /// <summary>
    /// The rows are left exactly as they are, under a documented ground in
    /// <c>docs/compliance/gdpr-subject-rights.md</c>.
    /// </summary>
    Retained,
}

/// <summary>
/// One table's entry in the subject-data map.
/// </summary>
/// <param name="Entity">The EF entity CLR type name. Matches <c>IEntityType.ClrType.Name</c>.</param>
/// <param name="Table">The table name. Matched against <c>IEntityType.GetTableName()</c> by the guard tests.</param>
/// <param name="LinkProperties">
/// The properties that connect a row to a person. For <see cref="SubjectLink.ThroughParent"/>
/// this is the foreign key to the parent, not a person reference.
/// </param>
/// <param name="LawfulBasis">The Article 6 ground the data is held under, in plain words.</param>
/// <param name="Retention">How long the data is kept, and what ends that.</param>
/// <param name="Rationale">Why the treatments above are what they are.</param>
public sealed record SubjectDataEntry(
    string Entity,
    string Table,
    SubjectLink Link,
    IReadOnlyList<string> LinkProperties,
    ExportTreatment Export,
    ErasureTreatment Erasure,
    string LawfulBasis,
    string Retention,
    string Rationale);

/// <summary>
/// Every table in this database, classified by what it holds about a data subject, what a
/// subject access request returns for it, and what an erasure request does to it (#144).
///
/// <para><b>Why a hand-written map and not "just query everything".</b> The obligation is
/// completeness — an access response that misses a table is a failed obligation, not a small
/// bug — and completeness cannot be asserted by the code that does the exporting, because a
/// table nobody remembered is exactly the table the exporter does not mention. So the map is
/// declarative and separate, and <c>SubjectDataMapTests</c> checks it against the live EF
/// model: every non-owned entity type must appear here, every foreign key to <c>User</c> in
/// the model must be declared as a link property, and every link property declared here must
/// exist on that entity. Add an entity and the unit tests go red until somebody has decided
/// what it holds; add a <c>user_id</c> column to an existing table and they go red for that
/// too. That is the mechanism that keeps this honest — not this comment.</para>
///
/// <para><b>The enumeration is from the model, not from memory.</b> The 27 non-owned entity
/// types with a foreign key to <c>User</c> (<c>User</c> itself among them, via
/// <c>manager_id</c>) were taken from <c>IEntityType.GetReferencingForeignKeys()</c> on
/// <c>User</c>, and <c>SubjectDataMapTests</c> re-derives that set on every run. Three more
/// hold subject data with no foreign key to <c>users</c> at all and are declared by hand:
/// <c>question_responses</c> and <c>response_demographics</c> (detail rows of a
/// <c>responses</c> row) and <c>user_invitation_demographics</c> (detail rows of an
/// invitation). A fourth case is subtler: <c>user_invitations</c> does have a key to
/// <c>users</c>, but it points at the <i>inviter</i> — the invitee is identified by
/// <c>email</c> alone, because no user row exists until they accept. An FK-only sweep would
/// have exported an invitation to whoever sent it and never to the person it names, which is
/// what the <c>Email</c> guard test exists to keep visible.</para>
///
/// <para><b>Owned types are not listed.</b> <c>UserPreferences</c>, <c>UserConsent</c>,
/// <c>NotificationPreferences</c>, <c>NotificationMetadata</c> and the rest are columns of
/// their owner's table (<c>users</c>, <c>notifications</c>, ...), and are exported and erased
/// with the owner. <c>SubjectDataMapTests.Owned_entity_types_are_not_listed_separately</c>
/// holds that line, so an owned type can never be quietly counted as a table of its own.</para>
///
/// <para><b>Scope: this database only.</b> <c>services/tracking-api</c> keeps its own Postgres
/// and this map does not describe it. See <see cref="SubjectDataSources"/>.</para>
/// </summary>
public static class SubjectDataMap
{
    private const string BasisNone = "Not personal data.";
    private const string BasisContract =
        "Art. 6(1)(b) — necessary to provide the service the employer has engaged on the employee's behalf.";
    private const string BasisLegitimateInterest =
        "Art. 6(1)(f) — legitimate interest of the controller in operating, securing and evidencing the platform.";
    private const string RetentionNone = "n/a";

    private static readonly string[] NoProperties = [];

    /// <summary>
    /// Columns that are never returned verbatim by a subject access export, and the reason.
    ///
    /// <para>Every one of these is a live credential rather than a fact about the person.
    /// A bcrypt hash is offline-crackable and an invitation token is a bearer credential:
    /// anyone holding the exported file could accept the invitation. A subject is entitled to
    /// the data held about them, not to a copy of the secrets that authenticate them, so the
    /// value is replaced with <see cref="RedactedMarker"/> and the column's presence is still
    /// disclosed.</para>
    ///
    /// <para>Keyed <c>Entity.Property</c>, matching the names the exporter reads from the EF
    /// model.</para>
    /// </summary>
    public static readonly IReadOnlySet<string> RedactedColumns = new HashSet<string>(StringComparer.Ordinal)
    {
        "User.PasswordHash",
        "UserInvitation.InvitationToken",
        "SurveyInvitation.InvitationToken",
        "MicroclimateInvitation.InvitationToken",
    };

    /// <summary>What a redacted column's value is replaced with in an export.</summary>
    public const string RedactedMarker = "[redacted: credential]";

    /// <summary>
    /// String columns whose name contains "Email" but which hold no data subject's address,
    /// with the reason. Checked by <c>SubjectDataMapTests.Every_email_column_is_accounted_for</c>,
    /// which otherwise requires the owning table to be classified as holding subject data.
    /// </summary>
    public static readonly IReadOnlyDictionary<string, string> EmailColumnExemptions =
        new Dictionary<string, string>(StringComparer.Ordinal)
        {
            ["Company.EmailDomain"] =
                "The tenant's own mail domain, used to route signups to a company. A domain, not a person.",
            ["SystemEmailSettings.FromEmail"] =
                "The platform's outbound sender address, configured by an operator. Not a data subject's address.",
        };

    /// <summary>
    /// Every non-owned entity type in <c>ClimateProjectDbContext</c>, in alphabetical order so
    /// that a diff against the model dump is a straight comparison.
    /// </summary>
    public static readonly IReadOnlyList<SubjectDataEntry> Entries =
    [
        Actor("ActionPlan", "action_plans", "CreatedBy",
            "The plan is a business record owned by the company. Attribution to its author is retained so that a "
            + "plan's provenance survives an erasure; the plan's own contents are not returned to the author as "
            + "personal data because they describe the department, not them."),
        NotPersonal("ActionPlanKpi", "action_plan_kpis", "Measurement targets on a plan. No person referenced."),
        NotPersonal("ActionPlanKpiUpdate", "action_plan_kpi_updates",
            "A KPI reading. The person who recorded it is on action_plan_progress_updates, not here."),
        NotPersonal("ActionPlanObjective", "action_plan_objectives", "Objectives on a plan. No person referenced."),
        NotPersonal("ActionPlanObjectiveUpdate", "action_plan_objective_updates",
            "An objective reading. The person who recorded it is on action_plan_progress_updates, not here."),
        Actor("ActionPlanProgressUpdate", "action_plan_progress_updates", "UpdatedBy",
            "Who reported progress and when. Retained for the same reason as the plan itself: a progress history "
            + "with the reporter stripped out cannot be audited."),
        Actor("ActionPlanTemplate", "action_plan_templates", "CreatedBy",
            "Authorship of a reusable template. Company-scoped or global; either way a business asset."),
        NotPersonal("ActionPlanTemplateKpi", "action_plan_template_kpis", "Template content. No person referenced."),
        NotPersonal("ActionPlanTemplateObjective", "action_plan_template_objectives",
            "Template content. No person referenced."),
        Actor("AIInsight", "ai_insights", "AcknowledgedBy",
            "Who acknowledged a generated insight. The insight itself is an aggregate over a department and is not "
            + "the acknowledger's personal data."),
        NotPersonal("AnalyticsInsight", "analytics_insights",
            "Aggregate metrics over a survey or department. No row is about an individual."),
        NotPersonal("AnalyticsMetricData", "analytics_metric_data", "Aggregate metric values. No person referenced."),
        NotPersonal("AnalyticsTimeSeries", "analytics_time_series", "Aggregate series points. No person referenced."),

        new("AuditLog", "audit_logs", SubjectLink.Subject, ["UserId"],
            ExportTreatment.FullRecord, ErasureTreatment.Retained,
            BasisLegitimateInterest,
            "Retained for the life of the tenant; no automatic expiry, and retention cleanup does not touch it.",
            "Security and accountability records. Art. 17(3)(b) and (e): erasing them is the one action that "
            + "makes the platform unable to show what was done to whose data, which is the opposite of what the "
            + "right exists to achieve. Exported in full — the subject is entitled to see what was recorded about "
            + "them — but never deleted or redacted by an erasure request. The subject's identity in these rows is "
            + "the user_id foreign key, which after erasure points at a pseudonymised users row."),

        Actor("Benchmark", "benchmarks", "CreatedBy",
            "Authorship of a benchmark definition. Benchmark values are aggregates and reference nobody."),
        NotPersonal("BenchmarkMetric", "benchmark_metrics", "Aggregate values on a benchmark. No person referenced."),
        NotPersonal("Company", "companies",
            "The employer, a legal person. Its email domain is a routing rule, not an individual's address."),
        NotPersonal("DemographicField", "demographic_fields",
            "A tenant's demographic field definitions — the questions, not anybody's answers."),
        NotPersonal("DemographicFieldOption", "demographic_field_options",
            "The permitted values of a demographic field. Definitions, not answers."),
        Actor("DemographicSnapshot", "demographic_snapshots", "CreatedBy",
            "Who took a point-in-time snapshot of the company's demographics."),
        Actor("DemographicSnapshotChange", "demographic_snapshot_changes", "ChangedBy",
            "Who applied a demographic change. The change's before/after values belong to the subject of the "
            + "entry it points at, not to the person who made it."),

        new("DemographicSnapshotEntry", "demographic_snapshot_entries", SubjectLink.Subject, ["UserId"],
            ExportTreatment.FullRecord, ErasureTreatment.Retained,
            BasisLegitimateInterest,
            "Retained for as long as the snapshot it belongs to; snapshots are historical records and do not expire.",
            "One row per employee per snapshot: the demographic values they held on the date the snapshot was "
            + "taken. Deleting the subject's rows would silently change the totals of a snapshot that has already "
            + "been reported on, so they are retained and de-identified instead — after erasure the user_id points "
            + "at a pseudonymised users row and the entry can no longer be resolved to a person."),

        new("Department", "departments", SubjectLink.Actor, ["ManagerId"],
            ExportTreatment.Reference, ErasureTreatment.Retained,
            BasisContract,
            "For as long as the department exists.",
            "\"This person manages this department\" is a fact about them, and it is exported as a reference. It "
            + "is retained on erasure because the org structure is the employer's record, and because erasure "
            + "pseudonymises the users row rather than deleting it, so no dangling manager_id is created."),

        Actor("Microclimate", "microclimates", "CreatedBy", "Authorship of a microclimate. Its results are aggregates."),
        NotPersonal("MicroclimateAiInsight", "microclimate_ai_insights",
            "Generated commentary on aggregate microclimate results. No person referenced."),
        NotPersonal("MicroclimateDepartmentTarget", "microclimate_department_targets",
            "Which departments a microclimate targets. Departments, not people."),

        new("MicroclimateInvitation", "microclimate_invitations", SubjectLink.Subject, ["UserId", "Email"],
            ExportTreatment.FullRecord, ErasureTreatment.Redacted,
            BasisContract,
            "Redacted on erasure; otherwise kept while the microclimate's participation record is meaningful.",
            "An invitation addressed to the subject, carrying their email and a bearer token. On erasure the "
            + "email, token and metadata are overwritten and the row is kept, because deleting it would change "
            + "the microclimate's participation denominator — a reported figure."),

        NotPersonal("MicroclimateQuestion", "microclimate_questions", "Question text. No person referenced."),
        NotPersonal("MicroclimateQuestionOption", "microclimate_question_options",
            "Answer options. No person referenced."),
        Actor("MicroclimateTemplate", "microclimate_templates", "CreatedBy", "Authorship of a reusable template."),
        NotPersonal("MicroclimateTemplateQuestion", "microclimate_template_questions",
            "Template question text. No person referenced."),
        NotPersonal("MicroclimateTemplateQuestionOption", "microclimate_template_question_options",
            "Template answer options. No person referenced."),

        new("Notification", "notifications", SubjectLink.Subject, ["UserId"],
            ExportTreatment.FullRecord, ErasureTreatment.Deleted,
            BasisContract,
            "Deleted once terminal and older than the configured notification window (retention cleanup), or on erasure.",
            "Mail and in-app messages addressed to the subject, including the rendered body and the delivery "
            + "metadata (IP, user agent, mail client) captured when it was opened. Nothing aggregates over them "
            + "and nothing audits from them, so they are deleted outright."),

        NotPersonal("NotificationPersonalizationRule", "notification_personalization_rules",
            "Rules that pick template variants. Conditions over roles and attributes, not identities."),
        Actor("NotificationTemplate", "notification_templates", "CreatedBy", "Authorship of a message template."),
        NotPersonal("NotificationTemplateVariable", "notification_template_variables",
            "Placeholder declarations on a template. No person referenced."),
        NotPersonal("Question", "questions", "Survey question text. No person referenced."),
        NotPersonal("QuestionConditionalLogic", "question_conditional_logic",
            "Branching rules between questions. No person referenced."),
        NotPersonal("QuestionEmojiOption", "question_emoji_options", "Answer options. No person referenced."),
        NotPersonal("QuestionOption", "question_options", "Answer options. No person referenced."),

        // The two question repositories (#58). Authored CONTENT, not subject data: a repository item
        // is a question somebody may one day ask, and holds nobody's answer. The only personal datum
        // on any of these seven tables is authorship, which is retained through erasure for the same
        // reason survey_templates' is -- attribution to a pseudonymised users row.
        Actor("QuestionBankItem", "question_bank_items", "CreatedBy",
            "Authorship of a curated question. Its metrics (usage, response rate, insight score) are "
            + "corpus-level aggregates and reference nobody."),
        NotPersonal("QuestionBankItemOption", "question_bank_item_options",
            "Answer options on a bank question. Definitions, not answers."),
        NotPersonal("QuestionBankItemTag", "question_bank_item_tags",
            "Free-text tags used to filter the bank. No person referenced."),
        Actor("QuestionCategory", "question_categories", "CreatedBy",
            "Authorship of a node in the library's category tree. The tree files questions, not people."),
        // Two actor columns rather than one: an item records who wrote it AND who last edited it, and
        // an access export that named only the author would under-report a subject's footprint.
        new("QuestionLibraryItem", "question_library_items", SubjectLink.Actor, ["CreatedBy", "LastModifiedBy"],
            ExportTreatment.Reference, ErasureTreatment.Retained,
            BasisLegitimateInterest,
            "For as long as the record exists; attribution survives erasure.",
            "Authorship and last editorship of a reusable question. The question text is content the "
            + "employer authored, not anything the subject disclosed."),
        NotPersonal("QuestionLibraryItemOption", "question_library_item_options",
            "Answer options on a library question. Definitions, not answers."),
        NotPersonal("QuestionLibraryItemTag", "question_library_item_tags",
            "Free-text tags used to filter the library. No person referenced."),

        new("QuestionResponse", "question_responses", SubjectLink.ThroughParent, ["ResponseId"],
            ExportTreatment.FullRecord, ErasureTreatment.Retained,
            BasisContract,
            "Retained indefinitely as part of the survey record.",
            "The subject's actual answers, reached through their responses rows. Exported in full. Retained on "
            + "erasure because the parent response is anonymised rather than deleted — see Response. Free-text "
            + "answers may contain self-identifying content that no automated rule can find; that limitation is "
            + "stated in docs/compliance/gdpr-subject-rights.md rather than papered over."),

        new("Report", "reports", SubjectLink.Actor, ["CreatedBy", "SharedWith"],
            ExportTreatment.Reference, ErasureTreatment.Retained,
            BasisLegitimateInterest,
            "For as long as the report exists; attribution survives erasure.",
            "Authorship of a generated report, plus the recipient list in shared_with — the one subject "
            + "reference in this database that is neither a foreign key nor an email column. See "
            + "SubjectDataMap.SharedWithColumn for why it is searched even though nothing populates it yet. A "
            + "report's contents are aggregates over a department or survey and are not returned as one "
            + "person's data."),

        new("Response", "responses", SubjectLink.Subject, ["UserId"],
            ExportTreatment.FullRecord, ErasureTreatment.Anonymised,
            BasisContract,
            "Retained indefinitely; anonymised on erasure.",
            "One survey sitting. Anonymised rather than deleted: every published climate score, benchmark and "
            + "trend in the product is an aggregate over these rows, and removing one silently restates figures "
            + "the employer has already acted on. Anonymising severs user_id and clears the identifying "
            + "envelope — IP address, user agent, session id — leaving an answer that belongs to a survey and a "
            + "department and to no one. This is the position the issue asks to be stated rather than assumed: "
            + "an anonymised response is no longer personal data and Art. 17 does not reach it, but that is only "
            + "true once the envelope is gone, which is why erasure clears it rather than leaving it."),

        new("ResponseDemographic", "response_demographics", SubjectLink.ThroughParent, ["ResponseId"],
            ExportTreatment.FullRecord, ErasureTreatment.Retained,
            BasisContract,
            "Retained indefinitely as part of the survey record.",
            "The demographic slice a response was filed under, copied onto the response so that aggregates "
            + "survive later changes to the person's profile. Exported. Retained for the same reason as "
            + "question_responses: it is a property of an anonymised answer, not of a person."),

        Actor("Survey", "surveys", "CreatedBy",
            "Authorship of a survey. Its responses belong to other people and are never returned by one "
            + "subject's access request."),

        new("SurveyAuditLog", "survey_audit_logs", SubjectLink.Subject, ["UserId", "UserEmail"],
            ExportTreatment.FullRecord, ErasureTreatment.Redacted,
            BasisLegitimateInterest,
            "Retained for the life of the survey; no automatic expiry, and retention cleanup does not touch it.",
            "The survey change trail. It denormalises the actor's name, email and role onto every row so the "
            + "trail reads without a join. On erasure those three copies are overwritten and everything else — "
            + "user_id, action, entity, changes, timestamp, IP, user agent — is kept: the duplicated identity is "
            + "the only part erasure can take without breaking the trail, because user_id still resolves to the "
            + "pseudonymised users row and the record stays attributable. Note that the changes column is free "
            + "JSON and may embed personal data no rule can locate; see the limitations section of "
            + "docs/compliance/gdpr-subject-rights.md."),

        NotPersonal("SurveyDepartmentTarget", "survey_department_targets",
            "Which departments a survey targets. Departments, not people."),
        Actor("SurveyDistribution", "survey_distributions", "LastRegeneratedBy",
            "Who last regenerated a distribution link or QR code."),

        new("SurveyDraft", "survey_drafts", SubjectLink.Subject, ["UserId"],
            ExportTreatment.FullRecord, ErasureTreatment.Deleted,
            BasisContract,
            "Deleted 30 days after last save (SurveyDraftRetention), or on erasure.",
            "The subject's unsubmitted authoring sessions, including the autosaved wizard payload. Private to "
            + "their author, referenced by nothing, and already on a 30-day clock — deleted outright."),

        new("SurveyInvitation", "survey_invitations", SubjectLink.Subject, ["UserId", "Email"],
            ExportTreatment.FullRecord, ErasureTreatment.Redacted,
            BasisContract,
            "Redacted on erasure; otherwise kept while the survey's participation record is meaningful.",
            "An invitation addressed to the subject, carrying their email and a bearer token. Redacted rather "
            + "than deleted for the same reason as microclimate_invitations: the row is the denominator of a "
            + "reported response rate."),

        Actor("SurveyTemplate", "survey_templates", "CreatedBy", "Authorship of a reusable survey template."),
        Actor("SurveyVersion", "survey_versions", "CreatedBy",
            "Who published a version of a survey. Part of the survey's own change history."),
        NotPersonal("SystemSettings", "system_settings",
            "Platform configuration, including the outbound sender address. Operator settings, not subject data."),
        NotPersonal("TemplateQuestion", "template_questions", "Template question text. No person referenced."),
        NotPersonal("TemplateQuestionOption", "template_question_options",
            "Template answer options. No person referenced."),

        new("User", "users", SubjectLink.Subject, ["Id", "Email", "ManagerId"],
            ExportTreatment.FullRecord, ErasureTreatment.Anonymised,
            BasisContract,
            "For as long as the account exists; pseudonymised on erasure and never afterwards restored.",
            "The account itself, together with its owned columns — preferences, notification opt-outs and the "
            + "consent flags. Pseudonymised rather than deleted, and the reason is structural as well as legal: "
            + "nineteen foreign keys into users are ON DELETE RESTRICT (surveys.created_by, reports.created_by, "
            + "survey_audit_logs.user_id and the rest), so a DELETE would either fail or, if those restrictions "
            + "were relaxed, take the audit trail and the company's business records with it. Erasure overwrites "
            + "the identifiers — email, name, credential, legacy persona id, last login — and deactivates the "
            + "account. ManagerId is listed as a second link because the subject also appears here as somebody "
            + "else's manager; that direction is exported as a reference and never expanded, since the reports "
            + "are other data subjects."),

        new("UserDemographic", "user_demographics", SubjectLink.Subject, ["UserId"],
            ExportTreatment.FullRecord, ErasureTreatment.Deleted,
            BasisContract,
            "For as long as the account exists; deleted on erasure.",
            "The subject's current answers to their employer's demographic fields — the most directly "
            + "identifying non-account data held. Deleted outright: the historical values the aggregates need "
            + "live in demographic_snapshot_entries, so nothing that has already been reported depends on these "
            + "rows."),

        new("UserInvitation", "user_invitations", SubjectLink.Subject, ["Email", "InvitedBy"],
            ExportTreatment.FullRecord, ErasureTreatment.Redacted,
            BasisContract,
            "Redacted on erasure; expired unaccepted invitations are deleted by retention cleanup.",
            "Two different people can be on this row. The invitee is identified by email alone — there is no "
            + "user row until they accept — which is why an FK-only sweep of the model would miss them and why "
            + "the export matches on email as well as on invited_by. Erasure overwrites the invitee's email, the "
            + "bearer token and the free-form invitation payload; the invited_by attribution is retained, since "
            + "that is an act by an administrator on the company's behalf."),

        new("UserInvitationDemographic", "user_invitation_demographics", SubjectLink.ThroughParent, ["InvitationId"],
            ExportTreatment.FullRecord, ErasureTreatment.Deleted,
            BasisContract,
            "Deleted with its invitation, or on erasure.",
            "Demographic values pre-assigned to an invitee before they have an account. Deleted on erasure for "
            + "the same reason as user_demographics — nothing aggregates over them."),
    ];

    /// <summary>
    /// The one subject reference in this database that is neither a foreign key nor an email
    /// column: <c>reports.shared_with</c>, a <c>text[]</c> of recipients.
    ///
    /// <para>Nothing in <c>src/</c> writes or reads it today — <c>ReportConfiguration</c> is
    /// its only mention, and it defaults to an empty array — so in the current product it is
    /// always empty. It is searched by the access export anyway, matching both the subject's
    /// id and their email, because the column exists, an import or a future share feature can
    /// fill it, and an export that skips a populated column is the exact failure this issue
    /// is about. It is not touched by erasure: an empty array has nothing to erase, and
    /// guessing at the element format of a column no code writes would be inventing a
    /// contract.</para>
    /// </summary>
    public const string SharedWithColumn = "Report.SharedWith";

    private static SubjectDataEntry NotPersonal(string entity, string table, string rationale)
        => new(entity, table, SubjectLink.None, NoProperties,
            ExportTreatment.None, ErasureTreatment.NotApplicable, BasisNone, RetentionNone, rationale);

    private static SubjectDataEntry Actor(string entity, string table, string linkProperty, string rationale)
        => new(entity, table, SubjectLink.Actor, [linkProperty],
            ExportTreatment.Reference, ErasureTreatment.Retained,
            BasisLegitimateInterest,
            "For as long as the record exists; attribution survives erasure.",
            rationale);

    /// <summary>The map entry for an entity, or null when it is not classified.</summary>
    public static SubjectDataEntry? Find(string entity)
        => Entries.FirstOrDefault(e => string.Equals(e.Entity, entity, StringComparison.Ordinal));
}
