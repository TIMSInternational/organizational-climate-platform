using ClimateProject.Domain.Entities;
using Microsoft.EntityFrameworkCore;

namespace ClimateProject.Infrastructure.Persistence;

public class ClimateProjectDbContext(DbContextOptions<ClimateProjectDbContext> options)
    : DbContext(options)
{
    public DbSet<Company> Companies => Set<Company>();
    public DbSet<SystemSettings> SystemSettings => Set<SystemSettings>();
    public DbSet<User> Users => Set<User>();
    public DbSet<Department> Departments => Set<Department>();
    public DbSet<UserInvitation> UserInvitations => Set<UserInvitation>();
    public DbSet<Survey> Surveys => Set<Survey>();
    public DbSet<Question> Questions => Set<Question>();
    public DbSet<QuestionConditionalLogic> QuestionConditionalLogics => Set<QuestionConditionalLogic>();
    public DbSet<QuestionEmojiOption> QuestionEmojiOptions => Set<QuestionEmojiOption>();
    public DbSet<SurveyDepartmentTarget> SurveyDepartmentTargets => Set<SurveyDepartmentTarget>();
    public DbSet<SurveyTemplate> SurveyTemplates => Set<SurveyTemplate>();
    public DbSet<TemplateQuestion> TemplateQuestions => Set<TemplateQuestion>();
    public DbSet<SurveyDraft> SurveyDrafts => Set<SurveyDraft>();
    public DbSet<SurveyVersion> SurveyVersions => Set<SurveyVersion>();
    public DbSet<AuditLog> AuditLogs => Set<AuditLog>();
    public DbSet<SurveyDistribution> SurveyDistributions => Set<SurveyDistribution>();
    public DbSet<SurveyInvitation> SurveyInvitations => Set<SurveyInvitation>();
    public DbSet<SurveyAuditLog> SurveyAuditLogs => Set<SurveyAuditLog>();
    public DbSet<Response> Responses => Set<Response>();
    public DbSet<QuestionResponse> QuestionResponses => Set<QuestionResponse>();
    public DbSet<ResponseDemographic> ResponseDemographics => Set<ResponseDemographic>();
    public DbSet<MicroclimateTemplate> MicroclimateTemplates => Set<MicroclimateTemplate>();
    public DbSet<MicroclimateTemplateQuestion> MicroclimateTemplateQuestions => Set<MicroclimateTemplateQuestion>();
    public DbSet<Microclimate> Microclimates => Set<Microclimate>();
    public DbSet<MicroclimateDepartmentTarget> MicroclimateDepartmentTargets => Set<MicroclimateDepartmentTarget>();
    public DbSet<MicroclimateQuestion> MicroclimateQuestions => Set<MicroclimateQuestion>();
    public DbSet<MicroclimateAiInsight> MicroclimateAiInsights => Set<MicroclimateAiInsight>();
    public DbSet<MicroclimateInvitation> MicroclimateInvitations => Set<MicroclimateInvitation>();
    public DbSet<ActionPlanTemplate> ActionPlanTemplates => Set<ActionPlanTemplate>();
    public DbSet<ActionPlanTemplateKpi> ActionPlanTemplateKpis => Set<ActionPlanTemplateKpi>();
    public DbSet<ActionPlanTemplateObjective> ActionPlanTemplateObjectives => Set<ActionPlanTemplateObjective>();
    public DbSet<ActionPlan> ActionPlans => Set<ActionPlan>();
    public DbSet<ActionPlanKpi> ActionPlanKpis => Set<ActionPlanKpi>();
    public DbSet<ActionPlanObjective> ActionPlanObjectives => Set<ActionPlanObjective>();
    public DbSet<ActionPlanProgressUpdate> ActionPlanProgressUpdates => Set<ActionPlanProgressUpdate>();
    public DbSet<ActionPlanKpiUpdate> ActionPlanKpiUpdates => Set<ActionPlanKpiUpdate>();
    public DbSet<ActionPlanObjectiveUpdate> ActionPlanObjectiveUpdates => Set<ActionPlanObjectiveUpdate>();
    public DbSet<Report> Reports => Set<Report>();
    public DbSet<Benchmark> Benchmarks => Set<Benchmark>();
    public DbSet<BenchmarkMetric> BenchmarkMetrics => Set<BenchmarkMetric>();
    public DbSet<AnalyticsInsight> AnalyticsInsights => Set<AnalyticsInsight>();
    public DbSet<AnalyticsMetricData> AnalyticsMetricData => Set<AnalyticsMetricData>();
    public DbSet<AnalyticsTimeSeries> AnalyticsTimeSeries => Set<AnalyticsTimeSeries>();
    public DbSet<AIInsight> AIInsights => Set<AIInsight>();
    public DbSet<DemographicField> DemographicFields => Set<DemographicField>();
    public DbSet<DemographicSnapshot> DemographicSnapshots => Set<DemographicSnapshot>();
    public DbSet<DemographicSnapshotEntry> DemographicSnapshotEntries => Set<DemographicSnapshotEntry>();
    public DbSet<DemographicSnapshotChange> DemographicSnapshotChanges => Set<DemographicSnapshotChange>();
    public DbSet<Notification> Notifications => Set<Notification>();
    public DbSet<NotificationTemplate> NotificationTemplates => Set<NotificationTemplate>();
    public DbSet<NotificationTemplateVariable> NotificationTemplateVariables => Set<NotificationTemplateVariable>();
    public DbSet<NotificationPersonalizationRule> NotificationPersonalizationRules => Set<NotificationPersonalizationRule>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.ApplyConfigurationsFromAssembly(typeof(ClimateProjectDbContext).Assembly);
    }
}
