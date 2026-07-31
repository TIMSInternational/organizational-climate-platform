using ClimateProject.Domain.Entities;
using ClimateProject.Infrastructure.Persistence;
using ClimateProject.IntegrationTests.Support;
using Microsoft.EntityFrameworkCore;

namespace ClimateProject.IntegrationTests.Persistence;

[Collection("Postgres")]
public class ActionPlanObjectiveTests(PostgresContainerFixture postgres)
{
    private ClimateProjectDbContext CreateContext()
    {
        var options = new DbContextOptionsBuilder<ClimateProjectDbContext>()
            .UseNpgsql(postgres.ConnectionString)
            .Options;
        return new ClimateProjectDbContext(options);
    }

    private async Task<ActionPlan> SeedActionPlanAsync(ClimateProjectDbContext db, string suffix)
    {
        var company = new Company { Id = Guid.NewGuid(), Name = $"Acme {suffix}", CreatedAt = DateTimeOffset.UtcNow };
        var user = new User
        {
            Id = Guid.NewGuid(), CompanyId = company.Id, Email = $"admin-{Guid.NewGuid():N}@acme.test", Name = "Admin",
            Role = "company_admin", CreatedAt = DateTimeOffset.UtcNow, UpdatedAt = DateTimeOffset.UtcNow,
        };
        var plan = new ActionPlan
        {
            Id = Guid.NewGuid(), Title = "P", Description = "d", CompanyId = company.Id,
            CreatedBy = user.Id, DueDate = DateTimeOffset.UtcNow.AddDays(30),
            CreatedAt = DateTimeOffset.UtcNow, UpdatedAt = DateTimeOffset.UtcNow,
        };
        db.Companies.Add(company);
        db.Users.Add(user);
        db.ActionPlans.Add(plan);
        await db.SaveChangesAsync();
        return plan;
    }

    [Fact]
    public async Task ActionPlanObjective_round_trips_and_defaults_status_and_completion()
    {
        await using var db = CreateContext();
        await db.Database.MigrateAsync();
        var plan = await SeedActionPlanAsync(db, "1");

        var minimalId = Guid.NewGuid();
        await db.Database.ExecuteSqlInterpolatedAsync(
            $"""
             INSERT INTO action_plan_objectives ("Id", action_plan_id, description, success_criteria)
             VALUES ({minimalId}, {plan.Id}, {"Improve onboarding"}, {"New hires rate onboarding 8+/10"})
             """);

        await using var readDb = CreateContext();
        var loaded = await readDb.ActionPlanObjectives.SingleAsync(o => o.Id == minimalId);
        Assert.Equal("", loaded.CurrentStatus);
        Assert.Equal(0, loaded.CompletionPercentage);
    }

    [Fact]
    public async Task Deleting_action_plan_cascades_delete_of_its_objectives()
    {
        await using var db = CreateContext();
        await db.Database.MigrateAsync();
        var plan = await SeedActionPlanAsync(db, "2");

        var objectiveId = Guid.NewGuid();
        db.ActionPlanObjectives.Add(new ActionPlanObjective
        {
            Id = objectiveId, ActionPlanId = plan.Id, Description = "d", SuccessCriteria = "s",
        });
        await db.SaveChangesAsync();

        db.ActionPlans.Remove(plan);
        await db.SaveChangesAsync();

        await using var readDb = CreateContext();
        Assert.False(await readDb.ActionPlanObjectives.AnyAsync(o => o.Id == objectiveId));
    }
}
