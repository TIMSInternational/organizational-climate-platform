using ClimateProject.Domain.Entities;
using ClimateProject.Infrastructure.Persistence;
using ClimateProject.IntegrationTests.Support;
using Microsoft.EntityFrameworkCore;

namespace ClimateProject.IntegrationTests.Persistence;

[Collection("Postgres")]
public class ActionPlanProgressUpdateTests(PostgresContainerFixture postgres)
{
    private ClimateProjectDbContext CreateContext()
    {
        var options = new DbContextOptionsBuilder<ClimateProjectDbContext>()
            .UseNpgsql(postgres.ConnectionString)
            .Options;
        return new ClimateProjectDbContext(options);
    }

    private async Task<(ActionPlan plan, User user)> SeedActionPlanAsync(ClimateProjectDbContext db, string suffix)
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
        return (plan, user);
    }

    [Fact]
    public async Task ActionPlanProgressUpdate_round_trips_and_defaults_overall_notes_to_empty_string()
    {
        await using var db = CreateContext();
        await db.Database.MigrateAsync();
        var (plan, user) = await SeedActionPlanAsync(db, "1");

        var minimalId = Guid.NewGuid();
        await db.Database.ExecuteSqlInterpolatedAsync(
            $"""
             INSERT INTO action_plan_progress_updates ("Id", action_plan_id, update_date, updated_by)
             VALUES ({minimalId}, {plan.Id}, {DateTimeOffset.UtcNow}, {user.Id})
             """);

        await using var readDb = CreateContext();
        var loaded = await readDb.ActionPlanProgressUpdates.SingleAsync(p => p.Id == minimalId);
        Assert.Equal("", loaded.OverallNotes);
    }

    [Fact]
    public async Task Deleting_action_plan_cascades_delete_of_its_progress_updates()
    {
        await using var db = CreateContext();
        await db.Database.MigrateAsync();
        var (plan, user) = await SeedActionPlanAsync(db, "2");

        var progressId = Guid.NewGuid();
        db.ActionPlanProgressUpdates.Add(new ActionPlanProgressUpdate
        {
            Id = progressId, ActionPlanId = plan.Id, UpdateDate = DateTimeOffset.UtcNow, UpdatedBy = user.Id,
        });
        await db.SaveChangesAsync();

        db.ActionPlans.Remove(plan);
        await db.SaveChangesAsync();

        await using var readDb = CreateContext();
        Assert.False(await readDb.ActionPlanProgressUpdates.AnyAsync(p => p.Id == progressId));
    }

    [Fact]
    public async Task Deleting_the_updating_user_is_restricted()
    {
        await using var db = CreateContext();
        await db.Database.MigrateAsync();
        var (plan, user) = await SeedActionPlanAsync(db, "3");

        db.ActionPlanProgressUpdates.Add(new ActionPlanProgressUpdate
        {
            Id = Guid.NewGuid(), ActionPlanId = plan.Id, UpdateDate = DateTimeOffset.UtcNow, UpdatedBy = user.Id,
        });
        await db.SaveChangesAsync();

        // Use a fresh context so the dependent rows (ActionPlan.CreatedBy and
        // ActionPlanProgressUpdate.UpdatedBy, both Restrict) aren't already tracked -
        // otherwise EF's change tracker detects the severed required relationship itself and
        // throws InvalidOperationException client-side before ever reaching Postgres. Deleting
        // through an untracked context lets the real FK constraint (ON DELETE NO ACTION) fire.
        // (Same pattern as ActionPlanTemplateTests.Deleting_the_creating_user_is_restricted.)
        await using var deleteDb = CreateContext();
        var trackedUser = await deleteDb.Users.SingleAsync(u => u.Id == user.Id);
        deleteDb.Users.Remove(trackedUser);
        await Assert.ThrowsAsync<DbUpdateException>(() => deleteDb.SaveChangesAsync());
    }
}
