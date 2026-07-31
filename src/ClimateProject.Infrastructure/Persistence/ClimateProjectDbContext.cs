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

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.ApplyConfigurationsFromAssembly(typeof(ClimateProjectDbContext).Assembly);
    }
}
