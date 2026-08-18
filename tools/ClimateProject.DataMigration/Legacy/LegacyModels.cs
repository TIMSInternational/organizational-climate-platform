using MongoDB.Bson;
using MongoDB.Bson.Serialization.Attributes;

namespace ClimateProject.DataMigration.Legacy;

// One stub per registered Mongoose model in climate-project/src/models/. The five
// foundational collections (Company, Department, User, SystemSettings, DemographicField)
// plus Survey and Response are typed field-by-field from the legacy Mongoose schemas per sub-issue B
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

/// <summary>8. Mongoose model 'SurveyVersion' (SurveyVersion.ts).</summary>
public sealed class LegacySurveyVersion : LegacyDocument;

/// <summary>9. Mongoose model 'SurveyDraft' (SurveyDraft.ts).</summary>
public sealed class LegacySurveyDraft : LegacyDocument;

/// <summary>10. Mongoose model 'SurveyTemplate' (SurveyTemplate.ts).</summary>
public sealed class LegacySurveyTemplate : LegacyDocument;

/// <summary>11. Mongoose model 'SurveyDistribution' (SurveyDistribution.ts).</summary>
public sealed class LegacySurveyDistribution : LegacyDocument;

/// <summary>12. Mongoose model 'SurveyInvitation' (SurveyInvitation.ts).</summary>
public sealed class LegacySurveyInvitation : LegacyDocument;

/// <summary>13. Mongoose model 'SurveyAuditLog' (SurveyAuditLog.ts).</summary>
public sealed class LegacySurveyAuditLog : LegacyDocument;

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

/// <summary>15. Mongoose model 'Microclimate' (Microclimate.ts).</summary>
public sealed class LegacyMicroclimate : LegacyDocument;

/// <summary>16. Mongoose model 'MicroclimateTemplate' (MicroclimateTemplate.ts).</summary>
public sealed class LegacyMicroclimateTemplate : LegacyDocument;

/// <summary>17. Mongoose model 'MicroclimateInvitation' (MicroclimateInvitation.ts).</summary>
public sealed class LegacyMicroclimateInvitation : LegacyDocument;

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

/// <summary>26. Mongoose model 'UserInvitation' (UserInvitation.ts).</summary>
public sealed class LegacyUserInvitation : LegacyDocument;

/// <summary>27. Mongoose model 'AuditLog' (AuditLog.ts).</summary>
public sealed class LegacyAuditLog : LegacyDocument;

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
