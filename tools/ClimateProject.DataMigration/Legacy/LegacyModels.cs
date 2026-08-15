namespace ClimateProject.DataMigration.Legacy;

// One stub per registered Mongoose model in climate-project/src/models/. Deliberately
// field-less: each declares only what LegacyDocument gives it (_id + the Extra catch-all),
// because the per-collection field mapping is sub-issue B's work
// (docs/migration/sub-issues.md) and a stub that guesses fields is worse than one that
// declares none - everything undeclared lands in Extra, visibly. What the stubs DO fix at
// compile time is the census: one CLR type per collection, bound to its collection name in
// LegacyCollections, so "which collections exist" stops being a string convention.
//
// Ordering and numbering follow the design doc's collection table
// (docs/superpowers/specs/2026-08-03-mongo-to-postgres-etl-design.md). 33-35 are the three
// models that table missed: QuestionPool.ts registers them alongside QuestionPool itself
// (see the doc's 2026-08-15 addendum).

/// <summary>1. Mongoose model 'Company' (Company.ts).</summary>
public sealed class LegacyCompany : LegacyDocument;

/// <summary>2. Mongoose model 'Department' (Department.ts).</summary>
public sealed class LegacyDepartment : LegacyDocument;

/// <summary>3. Mongoose model 'User' (User.ts).</summary>
public sealed class LegacyUser : LegacyDocument;

/// <summary>4. Mongoose model 'SystemSettings' (SystemSettings.ts).</summary>
public sealed class LegacySystemSettings : LegacyDocument;

/// <summary>5. Mongoose model 'DemographicField' (DemographicField.ts).</summary>
public sealed class LegacyDemographicField : LegacyDocument;

/// <summary>6. Mongoose model 'DemographicSnapshot' (DemographicSnapshot.ts).</summary>
public sealed class LegacyDemographicSnapshot : LegacyDocument;

/// <summary>7. Mongoose model 'Survey' (Survey.ts).</summary>
public sealed class LegacySurvey : LegacyDocument;

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

/// <summary>14. Mongoose model 'Response' (Response.ts) - the volume driver.</summary>
public sealed class LegacyResponse : LegacyDocument;

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
