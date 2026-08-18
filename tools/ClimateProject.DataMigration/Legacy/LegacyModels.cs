using MongoDB.Bson;
using MongoDB.Bson.Serialization.Attributes;

namespace ClimateProject.DataMigration.Legacy;

// One stub per registered Mongoose model in climate-project/src/models/. The five
// foundational collections (Company, Department, User, SystemSettings, DemographicField)
// plus the survey domain (Survey, SurveyTemplate, SurveyVersion, SurveyAuditLog, SurveyDraft,
// SurveyDistribution, SurveyInvitation) and Response are typed field-by-field from the legacy
// Mongoose schemas per sub-issue B
// (docs/migration/sub-issues.md); the rest stay deliberately field-less until their
// slice lands - a stub that guesses fields is worse than one that declares none, and
// everything undeclared lands in Extra, visibly.
//
// Typing rules for the typed stubs: every property is nullable, because at this layer
// "absent in the document" and "present with the default" are different facts and the
// mapper decides what each means; nested subdocuments carry their own [BsonExtraElements]
// so an unmapped field two levels down is as reportable as one at the top.
//
// Ordering and numbering follow the design doc's collection table
// (docs/superpowers/specs/2026-08-03-mongo-to-postgres-etl-design.md). 33-35 are the three
// models that table missed: QuestionPool.ts registers them alongside QuestionPool itself
// (see the doc's 2026-08-15 addendum).

/// <summary>1. Mongoose model 'Company' (Company.ts). Typed 2026-08-17 from the legacy schema.</summary>
public sealed class LegacyCompany : LegacyDocument
{
    [BsonElement("name")] public string? Name { get; set; }
    [BsonElement("domain")] public string? Domain { get; set; }
    [BsonElement("industry")] public string? Industry { get; set; }
    [BsonElement("size")] public string? Size { get; set; }
    [BsonElement("country")] public string? Country { get; set; }
    [BsonElement("branding")] public LegacyCompanyBranding? Branding { get; set; }
    [BsonElement("settings")] public LegacyCompanySettings? Settings { get; set; }
    [BsonElement("is_active")] public bool? IsActive { get; set; }
    [BsonElement("subscription_tier")] public string? SubscriptionTier { get; set; }
    [BsonElement("created_at")] public DateTime? CreatedAt { get; set; }
    [BsonElement("updated_at")] public DateTime? UpdatedAt { get; set; }
    [BsonElement("__v")] public int? Version { get; set; }
}

public sealed class LegacyCompanyBranding
{
    [BsonElement("logo_url")] public string? LogoUrl { get; set; }
    [BsonElement("primary_color")] public string? PrimaryColor { get; set; }
    [BsonElement("secondary_color")] public string? SecondaryColor { get; set; }
    [BsonElement("font_family")] public string? FontFamily { get; set; }
    [BsonElement("custom_css")] public string? CustomCss { get; set; }
    [BsonExtraElements] public BsonDocument? Extra { get; set; }
}

public sealed class LegacyCompanySettings
{
    [BsonElement("survey_frequency")] public string? SurveyFrequency { get; set; }
    [BsonElement("microclimate_enabled")] public bool? MicroclimateEnabled { get; set; }
    [BsonElement("ai_insights_enabled")] public bool? AiInsightsEnabled { get; set; }
    [BsonElement("anonymous_surveys")] public bool? AnonymousSurveys { get; set; }
    [BsonElement("data_retention_days")] public int? DataRetentionDays { get; set; }
    [BsonElement("timezone")] public string? Timezone { get; set; }
    [BsonElement("language")] public string? Language { get; set; }
    [BsonExtraElements] public BsonDocument? Extra { get; set; }
}

/// <summary>2. Mongoose model 'Department' (Department.ts). Typed 2026-08-17 from the legacy schema.</summary>
public sealed class LegacyDepartment : LegacyDocument
{
    [BsonElement("name")] public string? Name { get; set; }
    [BsonElement("description")] public string? Description { get; set; }
    [BsonElement("company_id")] public string? CompanyId { get; set; }
    [BsonElement("hierarchy")] public LegacyDepartmentHierarchy? Hierarchy { get; set; }
    [BsonElement("manager_id")] public string? ManagerId { get; set; }
    [BsonElement("settings")] public LegacyDepartmentSettings? Settings { get; set; }
    [BsonElement("employee_count")] public int? EmployeeCount { get; set; }
    [BsonElement("is_active")] public bool? IsActive { get; set; }
    [BsonElement("created_at")] public DateTime? CreatedAt { get; set; }
    [BsonElement("updated_at")] public DateTime? UpdatedAt { get; set; }
    [BsonElement("__v")] public int? Version { get; set; }
}

/// <summary>
/// level and path are DERIVED values in the legacy product (recomputed by a pre-save
/// hook from the parent chain). They have no target column: the ETL recomputes both
/// from ParentDepartmentId after the second pass and asserts against these as an
/// integrity check, per the design doc.
/// </summary>
public sealed class LegacyDepartmentHierarchy
{
    [BsonElement("parent_department_id")] public string? ParentDepartmentId { get; set; }
    [BsonElement("level")] public int? Level { get; set; }
    [BsonElement("path")] public string? Path { get; set; }
    [BsonExtraElements] public BsonDocument? Extra { get; set; }
}

public sealed class LegacyDepartmentSettings
{
    [BsonElement("survey_participation_required")] public bool? SurveyParticipationRequired { get; set; }
    [BsonElement("microclimate_frequency")] public string? MicroclimateFrequency { get; set; }
    [BsonElement("auto_action_plans")] public bool? AutoActionPlans { get; set; }
    [BsonElement("notification_preferences")] public LegacyDepartmentNotificationPreferences? NotificationPreferences { get; set; }
    [BsonExtraElements] public BsonDocument? Extra { get; set; }
}

public sealed class LegacyDepartmentNotificationPreferences
{
    [BsonElement("email_enabled")] public bool? EmailEnabled { get; set; }
    [BsonElement("slack_enabled")] public bool? SlackEnabled { get; set; }
    [BsonElement("teams_enabled")] public bool? TeamsEnabled { get; set; }
    [BsonExtraElements] public BsonDocument? Extra { get; set; }
}

/// <summary>3. Mongoose model 'User' (User.ts). Typed 2026-08-17 from the legacy schema.</summary>
public sealed class LegacyUser : LegacyDocument
{
    [BsonElement("name")] public string? Name { get; set; }
    [BsonElement("email")] public string? Email { get; set; }

    // select:false in Mongoose hid this from application queries; the raw BSON reader
    // sees it. The census (sub-issue A) asserts a sane non-null rate anyway.
    [BsonElement("password_hash")] public string? PasswordHash { get; set; }
    [BsonElement("role")] public string? Role { get; set; }
    [BsonElement("company_id")] public string? CompanyId { get; set; }
    [BsonElement("department_id")] public string? DepartmentId { get; set; }
    [BsonElement("manager_id")] public string? ManagerId { get; set; }
    [BsonElement("preferences")] public LegacyUserPreferences? Preferences { get; set; }

    // Schemaless by design (strict:false): company-specific keys resolved against
    // DemographicField at mapping time; unresolved keys/values go to the report (#193).
    [BsonElement("demographics")] public BsonDocument? Demographics { get; set; }
    [BsonElement("consent_preferences")] public LegacyUserConsent? ConsentPreferences { get; set; }
    [BsonElement("consent_updated_at")] public DateTime? ConsentUpdatedAt { get; set; }
    [BsonElement("is_active")] public bool? IsActive { get; set; }
    [BsonElement("last_login")] public DateTime? LastLogin { get; set; }
    [BsonElement("created_at")] public DateTime? CreatedAt { get; set; }
    [BsonElement("updated_at")] public DateTime? UpdatedAt { get; set; }
    [BsonElement("__v")] public int? Version { get; set; }
}

public sealed class LegacyUserPreferences
{
    [BsonElement("language")] public string? Language { get; set; }
    [BsonElement("timezone")] public string? Timezone { get; set; }
    [BsonElement("notification_settings")] public LegacyUserNotificationSettings? NotificationSettings { get; set; }
    [BsonElement("dashboard_layout")] public string? DashboardLayout { get; set; }
    [BsonElement("theme")] public string? Theme { get; set; }
    [BsonExtraElements] public BsonDocument? Extra { get; set; }
}

/// <summary>
/// The six preferences #192 carries over verbatim. Null means "the document never held
/// this field": the mapper leaves the target at its DDL default rather than writing a
/// value the legacy doc did not contain - the email_* fields are opt-outs real users
/// set, and fabricating one re-subscribes them.
/// </summary>
public sealed class LegacyUserNotificationSettings
{
    [BsonElement("email_surveys")] public bool? EmailSurveys { get; set; }
    [BsonElement("email_microclimates")] public bool? EmailMicroclimates { get; set; }
    [BsonElement("email_action_plans")] public bool? EmailActionPlans { get; set; }
    [BsonElement("email_reminders")] public bool? EmailReminders { get; set; }
    [BsonElement("push_notifications")] public bool? PushNotifications { get; set; }
    [BsonElement("digest_frequency")] public string? DigestFrequency { get; set; }
    [BsonExtraElements] public BsonDocument? Extra { get; set; }
}

public sealed class LegacyUserConsent
{
    [BsonElement("essential")] public bool? Essential { get; set; }
    [BsonElement("analytics")] public bool? Analytics { get; set; }
    [BsonElement("marketing")] public bool? Marketing { get; set; }
    [BsonElement("personalization")] public bool? Personalization { get; set; }
    [BsonElement("thirdParty")] public bool? ThirdParty { get; set; }
    [BsonElement("demographics")] public bool? Demographics { get; set; }
    [BsonExtraElements] public BsonDocument? Extra { get; set; }
}

/// <summary>4. Mongoose model 'SystemSettings' (SystemSettings.ts). Typed 2026-08-17 from the legacy schema.</summary>
public sealed class LegacySystemSettings : LegacyDocument
{
    [BsonElement("login_enabled")] public bool? LoginEnabled { get; set; }
    [BsonElement("maintenance_mode")] public bool? MaintenanceMode { get; set; }
    [BsonElement("maintenance_message")] public string? MaintenanceMessage { get; set; }
    [BsonElement("max_login_attempts")] public int? MaxLoginAttempts { get; set; }
    [BsonElement("session_timeout")] public int? SessionTimeoutMinutes { get; set; }
    [BsonElement("password_policy")] public LegacyPasswordPolicy? PasswordPolicy { get; set; }
    [BsonElement("email_settings")] public LegacySystemEmailSettings? EmailSettings { get; set; }
    [BsonElement("created_at")] public DateTime? CreatedAt { get; set; }
    [BsonElement("updated_at")] public DateTime? UpdatedAt { get; set; }
    [BsonElement("__v")] public int? Version { get; set; }
}

public sealed class LegacyPasswordPolicy
{
    [BsonElement("min_length")] public int? MinLength { get; set; }
    [BsonElement("require_uppercase")] public bool? RequireUppercase { get; set; }
    [BsonElement("require_lowercase")] public bool? RequireLowercase { get; set; }
    [BsonElement("require_numbers")] public bool? RequireNumbers { get; set; }
    [BsonElement("require_special_chars")] public bool? RequireSpecialChars { get; set; }
    [BsonExtraElements] public BsonDocument? Extra { get; set; }
}

public sealed class LegacySystemEmailSettings
{
    [BsonElement("smtp_enabled")] public bool? SmtpEnabled { get; set; }
    [BsonElement("from_email")] public string? FromEmail { get; set; }
    [BsonElement("smtp_host")] public string? SmtpHost { get; set; }
    [BsonElement("smtp_port")] public int? SmtpPort { get; set; }
    [BsonExtraElements] public BsonDocument? Extra { get; set; }
}

/// <summary>5. Mongoose model 'DemographicField' (DemographicField.ts). Typed 2026-08-17 from the legacy schema.</summary>
public sealed class LegacyDemographicField : LegacyDocument
{
    [BsonElement("company_id")] public string? CompanyId { get; set; }
    [BsonElement("field")] public string? Field { get; set; }

    // One monolingual label: attributed to label_en or label_es by Company.language,
    // like every other #195 content field. options fan out to DemographicFieldOption
    // rows whose stable Value is the option text verbatim.
    [BsonElement("label")] public string? Label { get; set; }
    [BsonElement("type")] public string? Type { get; set; }
    [BsonElement("options")] public List<string>? Options { get; set; }
    [BsonElement("required")] public bool? Required { get; set; }
    [BsonElement("order")] public int? Order { get; set; }
    [BsonElement("is_active")] public bool? IsActive { get; set; }
    [BsonElement("created_at")] public DateTime? CreatedAt { get; set; }
    [BsonElement("updated_at")] public DateTime? UpdatedAt { get; set; }
    [BsonElement("__v")] public int? Version { get; set; }
}

/// <summary>6. Mongoose model 'DemographicSnapshot' (DemographicSnapshot.ts).</summary>
public sealed class LegacyDemographicSnapshot : LegacyDocument;

/// <summary>7. Mongoose model 'Survey' (Survey.ts). Typed 2026-08-17 from the legacy schema.</summary>
public sealed class LegacySurvey : LegacyDocument
{
    [BsonElement("title")] public string? Title { get; set; }
    [BsonElement("description")] public string? Description { get; set; }
    [BsonElement("type")] public string? Type { get; set; }
    [BsonElement("company_id")] public string? CompanyId { get; set; }
    [BsonElement("created_by")] public string? CreatedBy { get; set; }
    [BsonElement("department_ids")] public List<string>? DepartmentIds { get; set; }
    [BsonElement("questions")] public List<LegacySurveyQuestion>? Questions { get; set; }

    // Per-survey demographics died in the redesign (#193 moved demographics onto the
    // user); both fields are read raw so their presence can be REPORTED as a named
    // drop rather than surfacing as an anonymous unmapped-field line.
    [BsonElement("demographic_field_ids")] public List<string>? DemographicFieldIds { get; set; }
    [BsonElement("demographics")] public List<BsonDocument>? Demographics { get; set; }

    [BsonElement("settings")] public LegacySurveySettings? Settings { get; set; }
    [BsonElement("start_date")] public DateTime? StartDate { get; set; }
    [BsonElement("end_date")] public DateTime? EndDate { get; set; }
    [BsonElement("status")] public string? Status { get; set; }
    [BsonElement("response_count")] public int? ResponseCount { get; set; }
    [BsonElement("target_audience_count")] public int? TargetAudienceCount { get; set; }
    [BsonElement("template_id")] public string? TemplateId { get; set; }
    [BsonElement("version")] public int? Version { get; set; }
    [BsonElement("created_at")] public DateTime? CreatedAt { get; set; }
    [BsonElement("updated_at")] public DateTime? UpdatedAt { get; set; }

    // Survey is the one collection with BOTH a domain 'version' field and Mongoose's
    // internal '__v' key, so the latter gets Mongoose's own name for it here.
    [BsonElement("__v")] public int? VersionKey { get; set; }
}

/// <summary>
/// A survey's embedded question subdocument (QuestionSchema, <c>_id: false</c>). Its
/// <c>id</c> is an application-minted STRING, not a Mongo <c>_id</c> - answers in the
/// Response collection reference it, which is why identity derives from
/// (survey <c>_id</c>, this string) via <see cref="MigrationIds.ForChild"/>.
/// The interface's <c>config</c> field is deliberately not typed: QuestionSchema never
/// declared it, so Mongoose strict mode stripped it at write time; if a document
/// carries one anyway it lands in Extra and is reported.
/// </summary>
public sealed class LegacySurveyQuestion
{
    [BsonElement("id")] public string? Id { get; set; }
    [BsonElement("text")] public string? Text { get; set; }
    [BsonElement("type")] public string? Type { get; set; }
    [BsonElement("options")] public List<string>? Options { get; set; }
    [BsonElement("scale_min")] public int? ScaleMin { get; set; }
    [BsonElement("scale_max")] public int? ScaleMax { get; set; }
    [BsonElement("scale_labels")] public LegacyScaleLabels? ScaleLabels { get; set; }
    [BsonElement("emoji_options")] public List<LegacyEmojiOption>? EmojiOptions { get; set; }
    [BsonElement("comment_required")] public bool? CommentRequired { get; set; }
    [BsonElement("comment_prompt")] public string? CommentPrompt { get; set; }
    [BsonElement("binary_comment_config")] public LegacyBinaryCommentConfig? BinaryCommentConfig { get; set; }
    [BsonElement("required")] public bool? Required { get; set; }
    [BsonElement("conditional_logic")] public LegacyConditionalLogic? ConditionalLogic { get; set; }
    [BsonElement("order")] public int? Order { get; set; }
    [BsonElement("category")] public string? Category { get; set; }
    [BsonExtraElements] public BsonDocument? Extra { get; set; }
}

public sealed class LegacyScaleLabels
{
    [BsonElement("min")] public string? Min { get; set; }
    [BsonElement("max")] public string? Max { get; set; }
    [BsonExtraElements] public BsonDocument? Extra { get; set; }
}

public sealed class LegacyEmojiOption
{
    [BsonElement("emoji")] public string? Emoji { get; set; }
    [BsonElement("label")] public string? Label { get; set; }
    [BsonElement("value")] public int? Value { get; set; }
    [BsonExtraElements] public BsonDocument? Extra { get; set; }
}

public sealed class LegacyBinaryCommentConfig
{
    [BsonElement("enabled")] public bool? Enabled { get; set; }
    [BsonElement("label")] public string? Label { get; set; }
    [BsonElement("placeholder")] public string? Placeholder { get; set; }
    [BsonElement("max_length")] public int? MaxLength { get; set; }
    [BsonElement("required")] public bool? Required { get; set; }
    [BsonElement("min_length")] public int? MinLength { get; set; }
    [BsonExtraElements] public BsonDocument? Extra { get; set; }
}

/// <summary>condition_value is Mixed (string | number) in the legacy schema.</summary>
public sealed class LegacyConditionalLogic
{
    [BsonElement("condition_question_id")] public string? ConditionQuestionId { get; set; }
    [BsonElement("condition_operator")] public string? ConditionOperator { get; set; }
    [BsonElement("condition_value")] public BsonValue? ConditionValue { get; set; }
    [BsonElement("action")] public string? Action { get; set; }
    [BsonElement("target_question_id")] public string? TargetQuestionId { get; set; }
    [BsonExtraElements] public BsonDocument? Extra { get; set; }
}

public sealed class LegacySurveySettings
{
    [BsonElement("anonymous")] public bool? Anonymous { get; set; }
    [BsonElement("allow_partial_responses")] public bool? AllowPartialResponses { get; set; }
    [BsonElement("randomize_questions")] public bool? RandomizeQuestions { get; set; }
    [BsonElement("show_progress")] public bool? ShowProgress { get; set; }
    [BsonElement("auto_save")] public bool? AutoSave { get; set; }
    [BsonElement("time_limit_minutes")] public int? TimeLimitMinutes { get; set; }
    [BsonElement("response_limit")] public int? ResponseLimit { get; set; }
    [BsonElement("notification_settings")] public LegacySurveyNotificationSettings? NotificationSettings { get; set; }
    [BsonElement("invitation_settings")] public LegacySurveyInvitationSettings? InvitationSettings { get; set; }
    [BsonExtraElements] public BsonDocument? Extra { get; set; }
}

public sealed class LegacySurveyNotificationSettings
{
    [BsonElement("send_invitations")] public bool? SendInvitations { get; set; }
    [BsonElement("send_reminders")] public bool? SendReminders { get; set; }
    [BsonElement("reminder_frequency_days")] public int? ReminderFrequencyDays { get; set; }
    [BsonExtraElements] public BsonDocument? Extra { get; set; }
}

public sealed class LegacySurveyInvitationSettings
{
    [BsonElement("custom_message")] public string? CustomMessage { get; set; }
    [BsonElement("include_credentials")] public bool? IncludeCredentials { get; set; }
    [BsonElement("send_immediately")] public bool? SendImmediately { get; set; }
    [BsonElement("custom_subject")] public string? CustomSubject { get; set; }
    [BsonElement("branding_enabled")] public bool? BrandingEnabled { get; set; }
    [BsonExtraElements] public BsonDocument? Extra { get; set; }
}

/// <summary>
/// 8. Mongoose model 'SurveyVersion' (SurveyVersion.ts). Typed 2026-08-18 from the legacy
/// schema. The three snapshots are <c>Schema.Types.Mixed</c> - whole-document captures of
/// the survey as it stood - and land in the target's jsonb snapshot columns as-is.
/// </summary>
public sealed class LegacySurveyVersion : LegacyDocument
{
    [BsonElement("survey_id")] public string? SurveyId { get; set; }
    [BsonElement("version_number")] public int? VersionNumber { get; set; }
    [BsonElement("title")] public string? Title { get; set; }
    [BsonElement("description")] public string? Description { get; set; }
    [BsonElement("questions")] public BsonValue? Questions { get; set; }
    [BsonElement("demographics")] public BsonValue? Demographics { get; set; }
    [BsonElement("settings")] public BsonValue? Settings { get; set; }
    [BsonElement("changes")] public List<string>? Changes { get; set; }
    [BsonElement("reason")] public string? Reason { get; set; }
    [BsonElement("created_by")] public string? CreatedBy { get; set; }
    [BsonElement("created_at")] public DateTime? CreatedAt { get; set; }
    [BsonElement("__v")] public int? Version { get; set; }
}

/// <summary>
/// 9. Mongoose model 'SurveyDraft' (SurveyDraft.ts). Typed 2026-08-18. Like
/// SurveyAuditLog and SurveyDistribution, its references are real ObjectIds.
///
/// The four step_data subdocuments are the wizard's in-progress state and land whole in
/// the target's single draft_data jsonb column. Deliberately NOT re-mapped field by
/// field: a draft is unfinished input, not content the product reads through the
/// question rules, and step2_data's questions are ALREADY bilingual
/// (<c>text: {en, es}</c>) - the one place legacy stored both languages - so #195
/// attribution must not touch them.
/// </summary>
public sealed class LegacySurveyDraft : LegacyDocument
{
    [BsonElement("user_id")] public BsonValue? UserId { get; set; }
    [BsonElement("company_id")] public BsonValue? CompanyId { get; set; }
    [BsonElement("session_id")] public string? SessionId { get; set; }
    [BsonElement("step1_data")] public BsonValue? Step1Data { get; set; }
    [BsonElement("step2_data")] public BsonValue? Step2Data { get; set; }
    [BsonElement("step3_data")] public BsonValue? Step3Data { get; set; }
    [BsonElement("step4_data")] public BsonValue? Step4Data { get; set; }
    [BsonElement("current_step")] public int? CurrentStep { get; set; }
    [BsonElement("last_edited_field")] public string? LastEditedField { get; set; }
    [BsonElement("auto_save_count")] public int? AutoSaveCount { get; set; }
    [BsonElement("version")] public int? Version { get; set; }
    [BsonElement("last_autosave_at")] public DateTime? LastAutosaveAt { get; set; }
    [BsonElement("expires_at")] public DateTime? ExpiresAt { get; set; }
    [BsonElement("is_recovered")] public bool? IsRecovered { get; set; }
    [BsonElement("created_at")] public DateTime? CreatedAt { get; set; }
    [BsonElement("updated_at")] public DateTime? UpdatedAt { get; set; }
    [BsonElement("__v")] public int? VersionKey { get; set; }
}

/// <summary>
/// 10. Mongoose model 'SurveyTemplate' (SurveyTemplate.ts). Typed 2026-08-18 from the
/// legacy schema. Its questions array is declared <c>[Schema.Types.Mixed]</c> with the
/// comment "Reuse Question schema from Survey" - the wire shape IS the survey question
/// subdocument, so the same <see cref="LegacySurveyQuestion"/> stub deserializes it
/// (and Mixed means Mongoose validated NOTHING here, so expect more drift than in
/// surveys). demographics and default_settings are read raw: both are named drops.
/// </summary>
public sealed class LegacySurveyTemplate : LegacyDocument
{
    [BsonElement("name")] public string? Name { get; set; }
    [BsonElement("description")] public string? Description { get; set; }
    [BsonElement("category")] public string? Category { get; set; }
    [BsonElement("industry")] public string? Industry { get; set; }
    [BsonElement("company_size")] public string? CompanySize { get; set; }
    [BsonElement("questions")] public List<LegacySurveyQuestion>? Questions { get; set; }
    [BsonElement("demographics")] public List<BsonDocument>? Demographics { get; set; }
    [BsonElement("default_settings")] public BsonDocument? DefaultSettings { get; set; }
    [BsonElement("is_public")] public bool? IsPublic { get; set; }
    [BsonElement("created_by")] public string? CreatedBy { get; set; }
    [BsonElement("company_id")] public string? CompanyId { get; set; }
    [BsonElement("usage_count")] public int? UsageCount { get; set; }
    [BsonElement("rating")] public double? Rating { get; set; }
    [BsonElement("tags")] public List<string>? Tags { get; set; }
    [BsonElement("source_survey_id")] public string? SourceSurveyId { get; set; }
    [BsonElement("last_used")] public DateTime? LastUsed { get; set; }
    [BsonElement("created_at")] public DateTime? CreatedAt { get; set; }
    [BsonElement("updated_at")] public DateTime? UpdatedAt { get; set; }
    [BsonElement("__v")] public int? Version { get; set; }
}

/// <summary>
/// 11. Mongoose model 'SurveyDistribution' (SurveyDistribution.ts). Typed 2026-08-18.
/// survey_id is an ObjectId AND uniquely indexed - one distribution per survey, both
/// sides.
/// </summary>
public sealed class LegacySurveyDistribution : LegacyDocument
{
    [BsonElement("survey_id")] public BsonValue? SurveyId { get; set; }
    [BsonElement("access_type")] public string? AccessType { get; set; }
    [BsonElement("public_url")] public string? PublicUrl { get; set; }
    [BsonElement("tokenized_links_generated")] public int? TokenizedLinksGenerated { get; set; }

    // These four may hold a URL, raw SVG markup, or a data: URI - the schema says only
    // "String". The target's columns are varchar(500) URLs, so the mapper keeps what
    // fits a URL column and drops the rest by name rather than truncating markup into
    // a link that looks real and resolves nowhere.
    [BsonElement("qr_code_url")] public string? QrCodeUrl { get; set; }
    [BsonElement("qr_code_svg")] public string? QrCodeSvg { get; set; }
    [BsonElement("qr_code_png")] public string? QrCodePng { get; set; }
    [BsonElement("qr_code_pdf_url")] public string? QrCodePdfUrl { get; set; }

    [BsonElement("access_rules")] public LegacyAccessRules? AccessRules { get; set; }
    [BsonElement("qr_customization")] public LegacyQrCustomization? QrCustomization { get; set; }
    [BsonElement("created_at")] public DateTime? CreatedAt { get; set; }
    [BsonElement("updated_at")] public DateTime? UpdatedAt { get; set; }
    [BsonElement("__v")] public int? Version { get; set; }
}

public sealed class LegacyAccessRules
{
    [BsonElement("require_login")] public bool? RequireLogin { get; set; }
    [BsonElement("allow_anonymous")] public bool? AllowAnonymous { get; set; }
    [BsonElement("single_response")] public bool? SingleResponse { get; set; }
    [BsonElement("active_outside_schedule")] public bool? ActiveOutsideSchedule { get; set; }
    [BsonElement("allowed_domains")] public List<string>? AllowedDomains { get; set; }
    [BsonElement("blocked_ips")] public List<string>? BlockedIps { get; set; }
    [BsonElement("max_responses")] public int? MaxResponses { get; set; }
    [BsonExtraElements] public BsonDocument? Extra { get; set; }
}

public sealed class LegacyQrCustomization
{
    [BsonElement("size")] public int? Size { get; set; }

    // 'color' is the target's foreground_color: a rename, not a drop.
    [BsonElement("color")] public string? Color { get; set; }
    [BsonElement("background_color")] public string? BackgroundColor { get; set; }
    [BsonElement("logo_url")] public string? LogoUrl { get; set; }

    // L/M/Q/H. No target column: QR images are regenerated by the new system, which
    // picks its own error correction, so this is a named drop.
    [BsonElement("error_correction")] public string? ErrorCorrection { get; set; }
    [BsonExtraElements] public BsonDocument? Extra { get; set; }
}

/// <summary>
/// 12. Mongoose model 'SurveyInvitation' (SurveyInvitation.ts). Typed 2026-08-18.
/// References are plain strings here (unlike its two neighbours in this slice).
///
/// invitation_token is a bearer credential, and the legacy database was readable during
/// the #70 exposure window - so whether it carries forward matters. It does, and it is
/// inert: legacy minted these as <c>uuidv4()</c> (invitation-service.ts:110), 36
/// characters, while the target's SurveyAccessTokens.HasExpectedShape admits only 43
/// base64url characters and rejects anything else BEFORE the database is queried. A
/// migrated token therefore cannot authenticate anyone; it is a historical record.
/// </summary>
public sealed class LegacySurveyInvitation : LegacyDocument
{
    [BsonElement("survey_id")] public string? SurveyId { get; set; }
    [BsonElement("user_id")] public string? UserId { get; set; }
    [BsonElement("company_id")] public string? CompanyId { get; set; }
    [BsonElement("email")] public string? Email { get; set; }
    [BsonElement("invitation_token")] public string? InvitationToken { get; set; }
    [BsonElement("status")] public string? Status { get; set; }
    [BsonElement("sent_at")] public DateTime? SentAt { get; set; }
    [BsonElement("opened_at")] public DateTime? OpenedAt { get; set; }
    [BsonElement("started_at")] public DateTime? StartedAt { get; set; }
    [BsonElement("completed_at")] public DateTime? CompletedAt { get; set; }
    [BsonElement("reminder_count")] public int? ReminderCount { get; set; }
    [BsonElement("last_reminder_sent")] public DateTime? LastReminderSent { get; set; }
    [BsonElement("expires_at")] public DateTime? ExpiresAt { get; set; }
    [BsonElement("metadata")] public LegacyInvitationMetadata? Metadata { get; set; }
    [BsonElement("created_at")] public DateTime? CreatedAt { get; set; }
    [BsonElement("updated_at")] public DateTime? UpdatedAt { get; set; }
    [BsonElement("__v")] public int? Version { get; set; }
}

public sealed class LegacyInvitationMetadata
{
    [BsonElement("user_agent")] public string? UserAgent { get; set; }
    [BsonElement("ip_address")] public string? IpAddress { get; set; }
    [BsonElement("email_client")] public string? EmailClient { get; set; }
    [BsonExtraElements] public BsonDocument? Extra { get; set; }
}

/// <summary>
/// 13. Mongoose model 'SurveyAuditLog' (SurveyAuditLog.ts). Typed 2026-08-18.
///
/// THE ONE COLLECTION WHOSE REFERENCES ARE REAL ObjectIds. Every other legacy model
/// declares cross-collection references as <c>{ type: String }</c> - the design doc says
/// so loudly and the whole ReferenceResolver contract is built on it - but this schema
/// uses <c>Schema.Types.ObjectId</c> with <c>ref:</c> for both survey_id and user_id.
/// They are therefore read as raw <see cref="BsonValue"/> and normalised by
/// <see cref="LegacyReferences.HexOf"/>: Mongo enforced the declared type only for
/// documents Mongoose itself wrote, so a hand-written or imported row may still carry a
/// string, and a reader that assumed either shape would throw on the other.
/// </summary>
public sealed class LegacySurveyAuditLog : LegacyDocument
{
    [BsonElement("survey_id")] public BsonValue? SurveyId { get; set; }
    [BsonElement("action")] public string? Action { get; set; }
    [BsonElement("entity_type")] public string? EntityType { get; set; }
    [BsonElement("entity_id")] public string? EntityId { get; set; }
    [BsonElement("changes")] public LegacyAuditChanges? Changes { get; set; }
    [BsonElement("user_id")] public BsonValue? UserId { get; set; }
    [BsonElement("user_name")] public string? UserName { get; set; }
    [BsonElement("user_email")] public string? UserEmail { get; set; }
    [BsonElement("user_role")] public string? UserRole { get; set; }
    [BsonElement("timestamp")] public DateTime? Timestamp { get; set; }
    [BsonElement("ip_address")] public string? IpAddress { get; set; }
    [BsonElement("user_agent")] public string? UserAgent { get; set; }
    [BsonElement("session_id")] public string? SessionId { get; set; }
    [BsonElement("metadata")] public LegacyAuditMetadata? Metadata { get; set; }
    [BsonElement("__v")] public int? Version { get; set; }
}

/// <summary>The legacy before/after/diff shape. The target's own changes shape is
/// <c>SurveyAuditChangeSet</c> (fields/from/to/version_number) - a different vocabulary,
/// so the mapper translates rather than copies, and keeps this raw under metadata.</summary>
public sealed class LegacyAuditChanges
{
    [BsonElement("before")] public BsonValue? Before { get; set; }
    [BsonElement("after")] public BsonValue? After { get; set; }
    [BsonElement("diff")] public BsonValue? Diff { get; set; }
    [BsonExtraElements] public BsonDocument? Extra { get; set; }
}

public sealed class LegacyAuditMetadata
{
    [BsonElement("reason")] public string? Reason { get; set; }
    [BsonElement("automated")] public bool? Automated { get; set; }
    [BsonElement("api_version")] public string? ApiVersion { get; set; }
    [BsonExtraElements] public BsonDocument? Extra { get; set; }
}

/// <summary>14. Mongoose model 'Response' (Response.ts) - the volume driver. Typed 2026-08-18 from the legacy schema.</summary>
public sealed class LegacyResponse : LegacyDocument
{
    [BsonElement("survey_id")] public string? SurveyId { get; set; }

    // Optional by design: an anonymous response stores no user id, ever - the
    // anonymity constraint the product is built around.
    [BsonElement("user_id")] public string? UserId { get; set; }
    [BsonElement("session_id")] public string? SessionId { get; set; }
    [BsonElement("company_id")] public string? CompanyId { get; set; }
    [BsonElement("department_id")] public string? DepartmentId { get; set; }
    [BsonElement("responses")] public List<LegacyQuestionResponseItem>? Responses { get; set; }
    [BsonElement("demographics")] public List<LegacyDemographicResponseItem>? Demographics { get; set; }
    [BsonElement("is_complete")] public bool? IsComplete { get; set; }
    [BsonElement("is_anonymous")] public bool? IsAnonymous { get; set; }
    [BsonElement("start_time")] public DateTime? StartTime { get; set; }
    [BsonElement("completion_time")] public DateTime? CompletionTime { get; set; }
    [BsonElement("total_time_seconds")] public int? TotalTimeSeconds { get; set; }
    [BsonElement("ip_address")] public string? IpAddress { get; set; }
    [BsonElement("user_agent")] public string? UserAgent { get; set; }
    [BsonElement("created_at")] public DateTime? CreatedAt { get; set; }
    [BsonElement("updated_at")] public DateTime? UpdatedAt { get; set; }
    [BsonElement("__v")] public int? Version { get; set; }
}

/// <summary>
/// An answer subdocument (QuestionResponseSchema, <c>_id: false</c>). question_id is
/// the survey-scoped question id string; response_value is Mixed
/// (string | number | string[] | boolean per the legacy union).
/// </summary>
public sealed class LegacyQuestionResponseItem
{
    [BsonElement("question_id")] public string? QuestionId { get; set; }
    [BsonElement("response_value")] public BsonValue? ResponseValue { get; set; }
    [BsonElement("response_text")] public string? ResponseText { get; set; }
    [BsonElement("time_spent_seconds")] public int? TimeSpentSeconds { get; set; }
    [BsonExtraElements] public BsonDocument? Extra { get; set; }
}

/// <summary>A demographic answer subdocument; value is Mixed (string | number).</summary>
public sealed class LegacyDemographicResponseItem
{
    [BsonElement("field")] public string? Field { get; set; }
    [BsonElement("value")] public BsonValue? Value { get; set; }
    [BsonExtraElements] public BsonDocument? Extra { get; set; }
}

/// <summary>
/// 15. Mongoose model 'Microclimate' (Microclimate.ts). Typed 2026-08-18.
/// Three embedded arrays fan out: questions, targeting.department_ids, and ai_insights.
/// </summary>
public sealed class LegacyMicroclimate : LegacyDocument
{
    [BsonElement("title")] public string? Title { get; set; }
    [BsonElement("description")] public string? Description { get; set; }
    [BsonElement("company_id")] public string? CompanyId { get; set; }
    [BsonElement("created_by")] public string? CreatedBy { get; set; }
    [BsonElement("targeting")] public LegacyMicroclimateTargeting? Targeting { get; set; }
    [BsonElement("scheduling")] public LegacyMicroclimateScheduling? Scheduling { get; set; }
    [BsonElement("real_time_settings")] public LegacyRealTimeSettings? RealTimeSettings { get; set; }
    [BsonElement("template_id")] public string? TemplateId { get; set; }
    [BsonElement("questions")] public List<LegacyMicroclimateQuestion>? Questions { get; set; }
    [BsonElement("status")] public string? Status { get; set; }
    [BsonElement("response_count")] public int? ResponseCount { get; set; }
    [BsonElement("target_participant_count")] public int? TargetParticipantCount { get; set; }
    [BsonElement("participation_rate")] public double? ParticipationRate { get; set; }
    [BsonElement("live_results")] public LegacyLiveResults? LiveResults { get; set; }
    [BsonElement("ai_insights")] public List<LegacyMicroclimateAiInsight>? AiInsights { get; set; }
    [BsonElement("created_at")] public DateTime? CreatedAt { get; set; }
    [BsonElement("updated_at")] public DateTime? UpdatedAt { get; set; }
    [BsonElement("__v")] public int? Version { get; set; }
}

public sealed class LegacyMicroclimateTargeting
{
    [BsonElement("department_ids")] public List<string>? DepartmentIds { get; set; }
    [BsonElement("role_filters")] public List<string>? RoleFilters { get; set; }
    [BsonElement("tenure_filters")] public List<string>? TenureFilters { get; set; }
    [BsonElement("custom_filters")] public BsonValue? CustomFilters { get; set; }
    [BsonElement("include_managers")] public bool? IncludeManagers { get; set; }
    [BsonElement("max_participants")] public int? MaxParticipants { get; set; }
    [BsonExtraElements] public BsonDocument? Extra { get; set; }
}

/// <summary>
/// The target stores an explicit end_time; legacy stored a duration. The mapper derives
/// end = start + duration_minutes, which is what the legacy product itself computed at
/// read time. auto_close has no target column on a microclimate (only on a template's
/// settings) and is a named drop.
/// </summary>
public sealed class LegacyMicroclimateScheduling
{
    [BsonElement("start_time")] public DateTime? StartTime { get; set; }
    [BsonElement("duration_minutes")] public int? DurationMinutes { get; set; }
    [BsonElement("timezone")] public string? Timezone { get; set; }
    [BsonElement("auto_close")] public bool? AutoClose { get; set; }
    [BsonElement("reminder_settings")] public BsonValue? ReminderSettings { get; set; }
    [BsonExtraElements] public BsonDocument? Extra { get; set; }
}

public sealed class LegacyRealTimeSettings
{
    [BsonElement("show_live_results")] public bool? ShowLiveResults { get; set; }
    [BsonElement("anonymous_responses")] public bool? AnonymousResponses { get; set; }
    [BsonElement("allow_comments")] public bool? AllowComments { get; set; }
    [BsonElement("word_cloud_enabled")] public bool? WordCloudEnabled { get; set; }
    [BsonElement("sentiment_analysis_enabled")] public bool? SentimentAnalysisEnabled { get; set; }
    [BsonElement("participation_threshold")] public int? ParticipationThreshold { get; set; }
    [BsonExtraElements] public BsonDocument? Extra { get; set; }
}

public sealed class LegacyLiveResults
{
    [BsonElement("sentiment_score")] public double? SentimentScore { get; set; }
    [BsonElement("engagement_level")] public string? EngagementLevel { get; set; }
    [BsonElement("top_themes")] public List<string>? TopThemes { get; set; }
    [BsonElement("word_cloud_data")] public BsonValue? WordCloudData { get; set; }
    [BsonElement("response_distribution")] public BsonValue? ResponseDistribution { get; set; }
    [BsonExtraElements] public BsonDocument? Extra { get; set; }
}

/// <summary>Embedded question. Simpler than a survey's: no scale, no comment config.</summary>
public sealed class LegacyMicroclimateQuestion
{
    [BsonElement("id")] public string? Id { get; set; }
    [BsonElement("text")] public string? Text { get; set; }
    [BsonElement("type")] public string? Type { get; set; }
    [BsonElement("options")] public List<string>? Options { get; set; }
    [BsonElement("required")] public bool? Required { get; set; }
    [BsonElement("order")] public int? Order { get; set; }
    [BsonExtraElements] public BsonDocument? Extra { get; set; }
}

/// <summary>An embedded insight. Carries NO id, so identity is positional.</summary>
public sealed class LegacyMicroclimateAiInsight
{
    [BsonElement("type")] public string? Type { get; set; }
    [BsonElement("message")] public string? Message { get; set; }
    [BsonElement("confidence")] public double? Confidence { get; set; }
    [BsonElement("timestamp")] public DateTime? Timestamp { get; set; }
    [BsonExtraElements] public BsonDocument? Extra { get; set; }
}

/// <summary>16. Mongoose model 'MicroclimateTemplate' (MicroclimateTemplate.ts). Typed 2026-08-18.</summary>
public sealed class LegacyMicroclimateTemplate : LegacyDocument
{
    [BsonElement("name")] public string? Name { get; set; }
    [BsonElement("description")] public string? Description { get; set; }
    [BsonElement("category")] public string? Category { get; set; }
    [BsonElement("questions")] public List<LegacyMicroclimateQuestion>? Questions { get; set; }
    [BsonElement("settings")] public LegacyMicroclimateTemplateSettings? Settings { get; set; }
    [BsonElement("company_id")] public string? CompanyId { get; set; }
    [BsonElement("created_by")] public string? CreatedBy { get; set; }
    [BsonElement("is_system_template")] public bool? IsSystemTemplate { get; set; }
    [BsonElement("usage_count")] public int? UsageCount { get; set; }
    [BsonElement("is_active")] public bool? IsActive { get; set; }
    [BsonElement("tags")] public List<string>? Tags { get; set; }
    [BsonElement("created_at")] public DateTime? CreatedAt { get; set; }
    [BsonElement("updated_at")] public DateTime? UpdatedAt { get; set; }
    [BsonElement("__v")] public int? Version { get; set; }
}

public sealed class LegacyMicroclimateTemplateSettings
{
    [BsonElement("default_duration_minutes")] public int? DefaultDurationMinutes { get; set; }
    [BsonElement("suggested_frequency")] public string? SuggestedFrequency { get; set; }
    [BsonElement("max_participants")] public int? MaxParticipants { get; set; }
    [BsonElement("anonymous_by_default")] public bool? AnonymousByDefault { get; set; }
    [BsonElement("auto_close")] public bool? AutoClose { get; set; }
    [BsonElement("show_live_results")] public bool? ShowLiveResults { get; set; }
    [BsonExtraElements] public BsonDocument? Extra { get; set; }
}

/// <summary>
/// 17. Mongoose model 'MicroclimateInvitation' (MicroclimateInvitation.ts). Typed
/// 2026-08-18. Structurally the survey invitation's twin, and its token is inert for
/// the same reason with a different shape: microclimate-invitation-service.ts:108 mints
/// <c>crypto.randomBytes(32).toString('hex')</c> - 64 hex characters - where the target
/// admits only 43 base64url ones.
/// </summary>
public sealed class LegacyMicroclimateInvitation : LegacyDocument
{
    [BsonElement("microclimate_id")] public BsonValue? MicroclimateId { get; set; }
    [BsonElement("user_id")] public BsonValue? UserId { get; set; }
    [BsonElement("company_id")] public BsonValue? CompanyId { get; set; }
    [BsonElement("email")] public string? Email { get; set; }
    [BsonElement("invitation_token")] public string? InvitationToken { get; set; }
    [BsonElement("status")] public string? Status { get; set; }
    [BsonElement("sent_at")] public DateTime? SentAt { get; set; }
    [BsonElement("opened_at")] public DateTime? OpenedAt { get; set; }
    [BsonElement("started_at")] public DateTime? StartedAt { get; set; }
    [BsonElement("completed_at")] public DateTime? CompletedAt { get; set; }
    [BsonElement("reminder_count")] public int? ReminderCount { get; set; }
    [BsonElement("last_reminder_sent")] public DateTime? LastReminderSent { get; set; }
    [BsonElement("expires_at")] public DateTime? ExpiresAt { get; set; }
    [BsonElement("metadata")] public LegacyInvitationMetadata? Metadata { get; set; }
    [BsonElement("created_at")] public DateTime? CreatedAt { get; set; }
    [BsonElement("updated_at")] public DateTime? UpdatedAt { get; set; }
    [BsonElement("__v")] public int? Version { get; set; }
}

/// <summary>18. Mongoose model 'ActionPlan' (ActionPlan.ts).</summary>
public sealed class LegacyActionPlan : LegacyDocument;

/// <summary>19. Mongoose model 'ActionPlanTemplate' (ActionPlanTemplate.ts).</summary>
public sealed class LegacyActionPlanTemplate : LegacyDocument;

/// <summary>
/// 20. Mongoose model 'AIInsight'. Registered by BOTH AIInsight.ts and Analytics.ts under
/// the same name (first registration wins via the <c>mongoose.models.AIInsight ||</c>
/// guard) - one collection, two competing shapes, which is #152's report-service bug.
/// </summary>
public sealed class LegacyAiInsight : LegacyDocument;

/// <summary>21. Mongoose model 'AnalyticsInsight' (Analytics.ts).</summary>
public sealed class LegacyAnalyticsInsight : LegacyDocument;

/// <summary>22. Mongoose model 'Benchmark' (Benchmark.ts).</summary>
public sealed class LegacyBenchmark : LegacyDocument;

/// <summary>23. Mongoose model 'Report' (Report.ts).</summary>
public sealed class LegacyReport : LegacyDocument;

/// <summary>24. Mongoose model 'Notification' (Notification.ts).</summary>
public sealed class LegacyNotification : LegacyDocument;

/// <summary>25. Mongoose model 'NotificationTemplate' (NotificationTemplate.ts).</summary>
public sealed class LegacyNotificationTemplate : LegacyDocument;

/// <summary>
/// 26. Mongoose model 'UserInvitation' (UserInvitation.ts). Typed 2026-08-18.
/// demographics fans out to UserInvitationDemographic under the SAME #193 rule as
/// User: every key must name a DemographicField of the inviting company.
/// </summary>
public sealed class LegacyUserInvitation : LegacyDocument
{
    [BsonElement("email")] public string? Email { get; set; }
    [BsonElement("company_id")] public string? CompanyId { get; set; }
    [BsonElement("department_id")] public string? DepartmentId { get; set; }
    [BsonElement("invited_by")] public string? InvitedBy { get; set; }
    [BsonElement("invitation_token")] public string? InvitationToken { get; set; }
    [BsonElement("invitation_type")] public string? InvitationType { get; set; }
    [BsonElement("role")] public string? Role { get; set; }
    [BsonElement("status")] public string? Status { get; set; }
    [BsonElement("expires_at")] public DateTime? ExpiresAt { get; set; }
    [BsonElement("sent_at")] public DateTime? SentAt { get; set; }
    [BsonElement("opened_at")] public DateTime? OpenedAt { get; set; }
    [BsonElement("accepted_at")] public DateTime? AcceptedAt { get; set; }
    [BsonElement("reminder_count")] public int? ReminderCount { get; set; }
    [BsonElement("last_reminder_sent")] public DateTime? LastReminderSent { get; set; }
    [BsonElement("metadata")] public BsonValue? Metadata { get; set; }
    [BsonElement("invitation_data")] public BsonValue? InvitationData { get; set; }
    [BsonElement("demographics")] public BsonDocument? Demographics { get; set; }
    [BsonElement("created_at")] public DateTime? CreatedAt { get; set; }
    [BsonElement("updated_at")] public DateTime? UpdatedAt { get; set; }
    [BsonElement("__v")] public int? Version { get; set; }
}

/// <summary>
/// 27. Mongoose model 'AuditLog' (AuditLog.ts). Typed 2026-08-18. The cross-domain
/// compliance log, and the one collection that maps almost 1:1 - both sides carry
/// action/resource/resource_id/details/success/error_message/timestamp with the same
/// meanings. Its action and resource enums are wide and free-form on the target
/// (varchar(100), no validated vocabulary class), so values carry verbatim.
/// </summary>
public sealed class LegacyAuditLog : LegacyDocument
{
    [BsonElement("user_id")] public BsonValue? UserId { get; set; }
    [BsonElement("company_id")] public BsonValue? CompanyId { get; set; }
    [BsonElement("action")] public string? Action { get; set; }
    [BsonElement("resource")] public string? Resource { get; set; }
    [BsonElement("resource_id")] public string? ResourceId { get; set; }
    [BsonElement("details")] public BsonValue? Details { get; set; }
    [BsonElement("ip_address")] public string? IpAddress { get; set; }
    [BsonElement("user_agent")] public string? UserAgent { get; set; }
    [BsonElement("success")] public bool? Success { get; set; }
    [BsonElement("error_message")] public string? ErrorMessage { get; set; }
    [BsonElement("timestamp")] public DateTime? Timestamp { get; set; }
    [BsonElement("__v")] public int? Version { get; set; }
}

/// <summary>28. Mongoose model 'LibraryQuestion' (LibraryQuestion.ts) - excluded as dead code; reader exists to prove the row count is 0.</summary>
public sealed class LegacyLibraryQuestion : LegacyDocument;

/// <summary>29. Mongoose model 'QuestionPool' (QuestionPool.ts) - blocked on #113.</summary>
public sealed class LegacyQuestionPool : LegacyDocument;

/// <summary>30. Mongoose model 'QuestionBank' (QuestionBank.ts) - blocked on #58.</summary>
public sealed class LegacyQuestionBank : LegacyDocument;

/// <summary>31. Mongoose model 'QuestionCategory' (QuestionCategory.ts) - blocked on #58.</summary>
public sealed class LegacyQuestionCategory : LegacyDocument;

/// <summary>32. Mongoose model 'QuestionLibrary' (QuestionLibrary.ts) - blocked on #58.</summary>
public sealed class LegacyQuestionLibrary : LegacyDocument;

/// <summary>33. Mongoose model 'QuestionEffectiveness' (QuestionPool.ts) - adaptive-engine storage, under #113 with QuestionPool.</summary>
public sealed class LegacyQuestionEffectiveness : LegacyDocument;

/// <summary>34. Mongoose model 'QuestionCombination' (QuestionPool.ts) - adaptive-engine storage, under #113 with QuestionPool.</summary>
public sealed class LegacyQuestionCombination : LegacyDocument;

/// <summary>35. Mongoose model 'QuestionGeneration' (QuestionPool.ts) - adaptive-engine storage, under #113 with QuestionPool.</summary>
public sealed class LegacyQuestionGeneration : LegacyDocument;
