using ClimateProject.Domain.Entities;
using ClimateProject.Infrastructure.Persistence;
using ClimateProject.IntegrationTests.Support;
using Microsoft.EntityFrameworkCore;

namespace ClimateProject.IntegrationTests.Persistence;

[Collection("Postgres")]
public class ActionPlanProgressUpdateItemsTests(PostgresContainerFixture postgres)
{
    private ClimateProjectDbContext CreateContext()
    {
        var options = new DbContextOptionsBuilder<ClimateProjectDbContext>()
            .UseNpgsql(postgres.ConnectionString)
            .Options;
        return new ClimateProjectDbContext(options);
    }

    private record Scaffold(ActionPlan Plan, ActionPlanKpi Kpi, ActionPlanObjective Objective, User User);

    private async Task<Scaffold> SeedScaffoldAsync(ClimateProjectDbContext db, string suffix)
    {
        var company = new Company { Id = Guid.NewGuid(), Name = $"Acme {suffix}", CreatedAt = DateTimeOffset.UtcNow };
        var user = new User
        {
            Id = Guid.NewGuid(), CompanyId = company.Id, Email = $"admin-{suffix}-{Guid.NewGuid():N}@acme.test", Name = "Admin",
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

        var kpi = new ActionPlanKpi
        {
            Id = Guid.NewGuid(), ActionPlanId = plan.Id, Name = "eNPS", TargetValue = 50m, Unit = "points", MeasurementFrequency = "quarterly",
        };
        var objective = new ActionPlanObjective
        {
            Id = Guid.NewGuid(), ActionPlanId = plan.Id, Description = "d", SuccessCriteria = "s",
        };
        db.ActionPlanKpis.Add(kpi);
        db.ActionPlanObjectives.Add(objective);
        await db.SaveChangesAsync();

        return new Scaffold(plan, kpi, objective, user);
    }

    [Fact]
    public async Task Kpi_and_objective_updates_round_trip_the_full_progress_audit_trail()
    {
        await using var db = CreateContext();
        await db.Database.MigrateAsync();
        var scaffold = await SeedScaffoldAsync(db, "1");

        var progress = new ActionPlanProgressUpdate
        {
            Id = Guid.NewGuid(), ActionPlanId = scaffold.Plan.Id, UpdateDate = DateTimeOffset.UtcNow,
            OverallNotes = "First monthly check-in.", UpdatedBy = scaffold.User.Id,
        };
        db.ActionPlanProgressUpdates.Add(progress);
        await db.SaveChangesAsync();

        var kpiUpdate = new ActionPlanKpiUpdate
        {
            Id = Guid.NewGuid(), ProgressUpdateId = progress.Id, KpiId = scaffold.Kpi.Id, NewValue = 42m, Notes = "Trending up.",
        };
        var objectiveUpdate = new ActionPlanObjectiveUpdate
        {
            Id = Guid.NewGuid(), ProgressUpdateId = progress.Id, ObjectiveId = scaffold.Objective.Id,
            StatusUpdate = "On track", CompletionPercentage = 40,
        };
        db.ActionPlanKpiUpdates.Add(kpiUpdate);
        db.ActionPlanObjectiveUpdates.Add(objectiveUpdate);
        await db.SaveChangesAsync();

        await using var readDb = CreateContext();
        var progressOverTimeForKpi = await readDb.ActionPlanKpiUpdates
            .Where(u => u.KpiId == scaffold.Kpi.Id)
            .Join(readDb.ActionPlanProgressUpdates, u => u.ProgressUpdateId, p => p.Id, (u, p) => new { u.NewValue, p.UpdateDate })
            .OrderBy(x => x.UpdateDate)
            .ToListAsync();
        Assert.Single(progressOverTimeForKpi);
        Assert.Equal(42m, progressOverTimeForKpi[0].NewValue);

        var loadedObjectiveUpdate = await readDb.ActionPlanObjectiveUpdates.SingleAsync(u => u.Id == objectiveUpdate.Id);
        Assert.Equal("On track", loadedObjectiveUpdate.StatusUpdate);
        Assert.Equal(40, loadedObjectiveUpdate.CompletionPercentage);
    }

    [Fact]
    public async Task Deleting_progress_update_cascades_delete_of_its_kpi_and_objective_updates()
    {
        await using var db = CreateContext();
        await db.Database.MigrateAsync();
        var scaffold = await SeedScaffoldAsync(db, "2");

        var progress = new ActionPlanProgressUpdate
        {
            Id = Guid.NewGuid(), ActionPlanId = scaffold.Plan.Id, UpdateDate = DateTimeOffset.UtcNow, UpdatedBy = scaffold.User.Id,
        };
        db.ActionPlanProgressUpdates.Add(progress);
        await db.SaveChangesAsync();

        var kpiUpdateId = Guid.NewGuid();
        var objectiveUpdateId = Guid.NewGuid();
        db.ActionPlanKpiUpdates.Add(new ActionPlanKpiUpdate { Id = kpiUpdateId, ProgressUpdateId = progress.Id, KpiId = scaffold.Kpi.Id, NewValue = 1m });
        db.ActionPlanObjectiveUpdates.Add(new ActionPlanObjectiveUpdate { Id = objectiveUpdateId, ProgressUpdateId = progress.Id, ObjectiveId = scaffold.Objective.Id, StatusUpdate = "s" });
        await db.SaveChangesAsync();

        db.ActionPlanProgressUpdates.Remove(progress);
        await db.SaveChangesAsync();

        await using var readDb = CreateContext();
        Assert.False(await readDb.ActionPlanKpiUpdates.AnyAsync(u => u.Id == kpiUpdateId));
        Assert.False(await readDb.ActionPlanObjectiveUpdates.AnyAsync(u => u.Id == objectiveUpdateId));
    }

    [Fact]
    public async Task Deleting_the_whole_action_plan_cascades_through_both_update_paths_without_conflict()
    {
        // Regression test for the deliberate Cascade-not-Restrict choice on KpiId/ObjectiveId:
        // deleting the ActionPlan cascades into action_plan_kpis AND (via progress updates)
        // into action_plan_kpi_updates at the same time. If KpiId's FK were Restrict, this
        // could abort depending on delete ordering. It must not.
        await using var db = CreateContext();
        await db.Database.MigrateAsync();
        var scaffold = await SeedScaffoldAsync(db, "3");

        var progress = new ActionPlanProgressUpdate
        {
            Id = Guid.NewGuid(), ActionPlanId = scaffold.Plan.Id, UpdateDate = DateTimeOffset.UtcNow, UpdatedBy = scaffold.User.Id,
        };
        db.ActionPlanProgressUpdates.Add(progress);
        await db.SaveChangesAsync();

        db.ActionPlanKpiUpdates.Add(new ActionPlanKpiUpdate { Id = Guid.NewGuid(), ProgressUpdateId = progress.Id, KpiId = scaffold.Kpi.Id, NewValue = 1m });
        db.ActionPlanObjectiveUpdates.Add(new ActionPlanObjectiveUpdate { Id = Guid.NewGuid(), ProgressUpdateId = progress.Id, ObjectiveId = scaffold.Objective.Id, StatusUpdate = "s" });
        await db.SaveChangesAsync();

        db.ActionPlans.Remove(scaffold.Plan);
        await db.SaveChangesAsync();

        await using var readDb = CreateContext();
        Assert.False(await readDb.ActionPlans.AnyAsync(a => a.Id == scaffold.Plan.Id));
        Assert.False(await readDb.ActionPlanKpis.AnyAsync(k => k.Id == scaffold.Kpi.Id));
        Assert.False(await readDb.ActionPlanKpiUpdates.AnyAsync(u => u.KpiId == scaffold.Kpi.Id));
    }
}
