using ClimateProject.Domain.Entities;
using ClimateProject.Infrastructure.Persistence;
using ClimateProject.IntegrationTests.Support;
using Microsoft.EntityFrameworkCore;

namespace ClimateProject.IntegrationTests.Persistence;

[Collection("Postgres")]
public class ActionPlanTests(PostgresContainerFixture postgres)
{
    private ClimateProjectDbContext CreateContext()
    {
        var options = new DbContextOptionsBuilder<ClimateProjectDbContext>()
            .UseNpgsql(postgres.ConnectionString)
            .Options;
        return new ClimateProjectDbContext(options);
    }

    private async Task<(Company company, Department department, User user, ActionPlanTemplate template)> SeedScaffoldAsync(
        ClimateProjectDbContext db, string suffix)
    {
        var company = new Company { Id = Guid.NewGuid(), Name = $"Acme {suffix}", CreatedAt = DateTimeOffset.UtcNow };
        var department = new Department
        {
            Id = Guid.NewGuid(), CompanyId = company.Id, Name = "Eng",
            CreatedAt = DateTimeOffset.UtcNow, UpdatedAt = DateTimeOffset.UtcNow,
        };
        var user = new User
        {
            Id = Guid.NewGuid(), CompanyId = company.Id, Email = $"admin-{Guid.NewGuid():N}@acme.test", Name = "Admin",
            Role = "company_admin", CreatedAt = DateTimeOffset.UtcNow, UpdatedAt = DateTimeOffset.UtcNow,
        };
        var template = new ActionPlanTemplate
        {
            Id = Guid.NewGuid(), Name = "T", Description = "d", Category = "general", CompanyId = company.Id,
            CreatedBy = user.Id, CreatedAt = DateTimeOffset.UtcNow, UpdatedAt = DateTimeOffset.UtcNow,
        };
        db.Companies.Add(company);
        db.Departments.Add(department);
        db.Users.Add(user);
        db.ActionPlanTemplates.Add(template);
        await db.SaveChangesAsync();
        return (company, department, user, template);
    }

    [Fact]
    public async Task ActionPlan_round_trips_with_arrays_and_optional_links()
    {
        await using var db = CreateContext();
        await db.Database.MigrateAsync();
        var (company, department, user, template) = await SeedScaffoldAsync(db, "1");

        // source_survey_id is a real foreign key since #168, so this used to be a bare
        // Guid.NewGuid() and the row it wrote was the defect: an action plan naming a survey
        // that had never existed. The plan still has to link to a survey for the round trip to
        // prove anything, so the survey is seeded instead of invented.
        var survey = new Survey
        {
            Id = Guid.NewGuid(), CompanyId = company.Id, CreatedBy = user.Id, TitleEn = "Engagement Q3",
            Type = "custom", StartDate = DateTimeOffset.UtcNow, EndDate = DateTimeOffset.UtcNow.AddDays(7),
            CreatedAt = DateTimeOffset.UtcNow, UpdatedAt = DateTimeOffset.UtcNow,
        };
        db.Surveys.Add(survey);
        await db.SaveChangesAsync();
        var surveyId = survey.Id;

        // source_insight_id is deliberately still unconstrained -- nothing records whether it
        // points at ai_insights or analytics_insights -- so a free guid is still what the column
        // accepts, and this assertion is the pin on that. See docs/decisions/survey-foreign-keys.md.
        var insightId = Guid.NewGuid();

        var plan = new ActionPlan
        {
            Id = Guid.NewGuid(),
            Title = "Improve engineering morale",
            Description = "Quarterly follow-up on the last engagement survey.",
            CompanyId = company.Id,
            DepartmentId = department.Id,
            CreatedBy = user.Id,
            DueDate = DateTimeOffset.UtcNow.AddMonths(3),
            Status = "in_progress",
            Priority = "high",
            AiRecommendations = ["Run more 1:1s", "Increase async updates"],
            Tags = ["morale", "q3"],
            TemplateId = template.Id,
            SourceSurveyId = surveyId,
            SourceInsightId = insightId,
            CreatedAt = DateTimeOffset.UtcNow,
            UpdatedAt = DateTimeOffset.UtcNow,
        };
        db.ActionPlans.Add(plan);
        await db.SaveChangesAsync();

        await using var readDb = CreateContext();
        var loaded = await readDb.ActionPlans.SingleAsync(a => a.Id == plan.Id);
        Assert.Equal("in_progress", loaded.Status);
        Assert.Equal("high", loaded.Priority);
        Assert.Equal(["Run more 1:1s", "Increase async updates"], loaded.AiRecommendations);
        Assert.Equal(["morale", "q3"], loaded.Tags);
        Assert.Equal(template.Id, loaded.TemplateId);
        Assert.Equal(surveyId, loaded.SourceSurveyId);
        Assert.Equal(insightId, loaded.SourceInsightId);
    }

    [Fact]
    public async Task Existing_action_plan_row_without_explicit_values_gets_intended_defaults()
    {
        await using var db = CreateContext();
        await db.Database.MigrateAsync();
        var (company, _, user, _) = await SeedScaffoldAsync(db, "2");

        var minimalId = Guid.NewGuid();
        await db.Database.ExecuteSqlInterpolatedAsync(
            $"""
             INSERT INTO action_plans ("Id", title, description, company_id, created_by, due_date, created_at, updated_at)
             VALUES ({minimalId}, {"Minimal Plan"}, {"desc"}, {company.Id}, {user.Id}, {DateTimeOffset.UtcNow.AddDays(30)}, {DateTimeOffset.UtcNow}, {DateTimeOffset.UtcNow})
             """);

        await using var readDb = CreateContext();
        var loaded = await readDb.ActionPlans.SingleAsync(a => a.Id == minimalId);
        Assert.Equal("not_started", loaded.Status);
        Assert.Equal("medium", loaded.Priority);
        Assert.Empty(loaded.AiRecommendations);
        Assert.Empty(loaded.Tags);
        Assert.Null(loaded.DepartmentId);
        Assert.Null(loaded.TemplateId);
    }

    [Fact]
    public async Task Deleting_department_sets_action_plan_department_id_null()
    {
        await using var db = CreateContext();
        await db.Database.MigrateAsync();
        var (company, department, user, _) = await SeedScaffoldAsync(db, "3");

        var plan = new ActionPlan
        {
            Id = Guid.NewGuid(), Title = "P", Description = "d", CompanyId = company.Id, DepartmentId = department.Id,
            CreatedBy = user.Id, DueDate = DateTimeOffset.UtcNow.AddDays(30),
            CreatedAt = DateTimeOffset.UtcNow, UpdatedAt = DateTimeOffset.UtcNow,
        };
        db.ActionPlans.Add(plan);
        await db.SaveChangesAsync();

        db.Departments.Remove(department);
        await db.SaveChangesAsync();

        await using var readDb = CreateContext();
        var loaded = await readDb.ActionPlans.SingleAsync(a => a.Id == plan.Id);
        Assert.Null(loaded.DepartmentId);
    }

    [Fact]
    public async Task Deleting_template_sets_action_plan_template_id_null()
    {
        await using var db = CreateContext();
        await db.Database.MigrateAsync();
        var (company, _, user, template) = await SeedScaffoldAsync(db, "4");

        var plan = new ActionPlan
        {
            Id = Guid.NewGuid(), Title = "P", Description = "d", CompanyId = company.Id, TemplateId = template.Id,
            CreatedBy = user.Id, DueDate = DateTimeOffset.UtcNow.AddDays(30),
            CreatedAt = DateTimeOffset.UtcNow, UpdatedAt = DateTimeOffset.UtcNow,
        };
        db.ActionPlans.Add(plan);
        await db.SaveChangesAsync();

        db.ActionPlanTemplates.Remove(template);
        await db.SaveChangesAsync();

        await using var readDb = CreateContext();
        var loaded = await readDb.ActionPlans.SingleAsync(a => a.Id == plan.Id);
        Assert.Null(loaded.TemplateId);
    }

    [Fact]
    public async Task Deleting_company_cascades_delete_of_its_action_plans()
    {
        // Deliberately does not use SeedScaffoldAsync: that helper also creates an
        // ActionPlanTemplate, and ActionPlanTemplate.CreatedBy (User, Restrict) combined
        // with User.CompanyId->Company (Cascade, established pre-existing behavior) means
        // a company with a template would itself be un-deletable regardless of ActionPlan.
        // That's a pre-existing cross-entity conflict from the already-merged
        // ActionPlanTemplate task, out of scope here — this test isolates ActionPlan's own
        // company_id cascade behavior with a plain company + user.
        await using var db = CreateContext();
        await db.Database.MigrateAsync();
        var company = new Company { Id = Guid.NewGuid(), Name = "Acme 5", CreatedAt = DateTimeOffset.UtcNow };
        var user = new User
        {
            Id = Guid.NewGuid(), CompanyId = company.Id, Email = $"admin-{Guid.NewGuid():N}@acme.test", Name = "Admin",
            Role = "company_admin", CreatedAt = DateTimeOffset.UtcNow, UpdatedAt = DateTimeOffset.UtcNow,
        };
        db.Companies.Add(company);
        db.Users.Add(user);
        await db.SaveChangesAsync();

        var planId = Guid.NewGuid();
        db.ActionPlans.Add(new ActionPlan
        {
            Id = planId, Title = "P", Description = "d", CompanyId = company.Id,
            CreatedBy = user.Id, DueDate = DateTimeOffset.UtcNow.AddDays(30),
            CreatedAt = DateTimeOffset.UtcNow, UpdatedAt = DateTimeOffset.UtcNow,
        });
        await db.SaveChangesAsync();

        db.Companies.Remove(company);
        await db.SaveChangesAsync();

        await using var readDb = CreateContext();
        Assert.False(await readDb.ActionPlans.AnyAsync(a => a.Id == planId));
    }
}
