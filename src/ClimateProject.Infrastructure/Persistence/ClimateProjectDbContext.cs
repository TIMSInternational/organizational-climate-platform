using ClimateProject.Domain.Entities;
using Microsoft.EntityFrameworkCore;

namespace ClimateProject.Infrastructure.Persistence;

public class ClimateProjectDbContext(DbContextOptions<ClimateProjectDbContext> options)
    : DbContext(options)
{
    public DbSet<Company> Companies => Set<Company>();
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

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.ApplyConfigurationsFromAssembly(typeof(ClimateProjectDbContext).Assembly);
    }
}
