namespace ClimateProject.DataMigration.Legacy;

/// <summary>
/// The census: every collection the legacy database can contain, as a typed reader.
///
/// Collection names are Mongoose defaults - <c>mongoose.pluralize()</c> of the registered
/// model name - because no model in climate-project/src/models/ passes an explicit
/// <c>collection</c> option and nothing overrides the pluralizer. Each name here was
/// computed by calling the legacy repo's own installed
/// <c>mongoose/lib/helpers/pluralize.js</c>, not by hand; the derivation is recorded in the
/// design doc's 2026-08-15 addendum. If production disagrees (an ops-created collection, a
/// renamed one), the census run against the dump - sub-issue A - is where that surfaces.
/// </summary>
public static class LegacyCollections
{
    public static readonly IReadOnlyList<ILegacyCollectionReader> All =
    [
        new LegacyCollectionReader<LegacyCompany>("companies"),
        new LegacyCollectionReader<LegacyDepartment>("departments"),
        new LegacyCollectionReader<LegacyUser>("users"),
        new LegacyCollectionReader<LegacySystemSettings>("systemsettings"),
        new LegacyCollectionReader<LegacyDemographicField>("demographicfields"),
        new LegacyCollectionReader<LegacyDemographicSnapshot>("demographicsnapshots"),
        new LegacyCollectionReader<LegacySurvey>("surveys"),
        new LegacyCollectionReader<LegacySurveyVersion>("surveyversions"),
        new LegacyCollectionReader<LegacySurveyDraft>("surveydrafts"),
        new LegacyCollectionReader<LegacySurveyTemplate>("surveytemplates"),
        new LegacyCollectionReader<LegacySurveyDistribution>("surveydistributions"),
        new LegacyCollectionReader<LegacySurveyInvitation>("surveyinvitations"),
        new LegacyCollectionReader<LegacySurveyAuditLog>("surveyauditlogs"),
        new LegacyCollectionReader<LegacyResponse>("responses"),
        new LegacyCollectionReader<LegacyMicroclimate>("microclimates"),
        new LegacyCollectionReader<LegacyMicroclimateTemplate>("microclimatetemplates"),
        new LegacyCollectionReader<LegacyMicroclimateInvitation>("microclimateinvitations"),
        new LegacyCollectionReader<LegacyActionPlan>("actionplans"),
        new LegacyCollectionReader<LegacyActionPlanTemplate>("actionplantemplates"),
        new LegacyCollectionReader<LegacyAiInsight>("aiinsights"),
        new LegacyCollectionReader<LegacyAnalyticsInsight>("analyticsinsights"),
        new LegacyCollectionReader<LegacyBenchmark>("benchmarks"),
        new LegacyCollectionReader<LegacyReport>("reports"),
        new LegacyCollectionReader<LegacyNotification>("notifications"),
        new LegacyCollectionReader<LegacyNotificationTemplate>("notificationtemplates"),
        new LegacyCollectionReader<LegacyUserInvitation>("userinvitations"),
        new LegacyCollectionReader<LegacyAuditLog>("auditlogs"),
        new LegacyCollectionReader<LegacyLibraryQuestion>("libraryquestions"),
        new LegacyCollectionReader<LegacyQuestionPool>("questionpools"),
        new LegacyCollectionReader<LegacyQuestionBank>("questionbanks"),
        new LegacyCollectionReader<LegacyQuestionCategory>("questioncategories"),
        new LegacyCollectionReader<LegacyQuestionLibrary>("questionlibraries"),

        // The three the design doc's 32-file census missed: QuestionPool.ts registers
        // three further models for the adaptive-question engine. They share #113's
        // decision with QuestionPool; the readers exist so the production row-count
        // census can say whether they hold data at all.
        new LegacyCollectionReader<LegacyQuestionEffectiveness>("questioneffectivenesses"),
        new LegacyCollectionReader<LegacyQuestionCombination>("questioncombinations"),
        new LegacyCollectionReader<LegacyQuestionGeneration>("questiongenerations"),
    ];
}
