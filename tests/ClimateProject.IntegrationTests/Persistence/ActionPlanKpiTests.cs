using ClimateProject.Domain.Entities;
using ClimateProject.Infrastructure.Persistence;
using ClimateProject.IntegrationTests.Support;
using Microsoft.EntityFrameworkCore;

namespace ClimateProject.IntegrationTests.Persistence;

[Collection("Postgres")]
public class ActionPlanKpiTests(PostgresContainerFixture postgres)
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
    public async Task ActionPlanKpi_round_trips_with_explicit_current_value()
    {
        await using var db = CreateContext();
        await db.Database.MigrateAsync();
        var plan = await SeedActionPlanAsync(db, "1");

        var kpi = new ActionPlanKpi
        {
            Id = Guid.NewGuid(), ActionPlanId = plan.Id, Name = "Response rate",
            TargetValue = 90m, CurrentValue = 42.5m, Unit = "%", MeasurementFrequency = "monthly",
        };
        db.ActionPlanKpis.Add(kpi);
        await db.SaveChangesAsync();

        await using var readDb = CreateContext();
        var loaded = await readDb.ActionPlanKpis.SingleAsync(k => k.Id == kpi.Id);
        Assert.Equal(plan.Id, loaded.ActionPlanId);
        Assert.Equal("Response rate", loaded.Name);
        Assert.Equal(90m, loaded.TargetValue);
        Assert.Equal(42.5m, loaded.CurrentValue);
        Assert.Equal("%", loaded.Unit);
        Assert.Equal("monthly", loaded.MeasurementFrequency);
    }

    [Fact]
    public async Task Existing_kpi_row_without_explicit_current_value_gets_intended_default_of_zero()
    {
        await using var db = CreateContext();
        await db.Database.MigrateAsync();
        var plan = await SeedActionPlanAsync(db, "2");

        var minimalId = Guid.NewGuid();
        await db.Database.ExecuteSqlInterpolatedAsync(
            $"""
             INSERT INTO action_plan_kpis ("Id", action_plan_id, name, target_value, unit, measurement_frequency)
             VALUES ({minimalId}, {plan.Id}, {"Minimal KPI"}, {10m}, {"count"}, {"weekly"})
             """);

        await using var readDb = CreateContext();
        var loaded = await readDb.ActionPlanKpis.SingleAsync(k => k.Id == minimalId);
        Assert.Equal(0m, loaded.CurrentValue);
    }

    [Fact]
    public async Task Deleting_an_action_plan_cascades_delete_of_its_kpi_rows()
    {
        await using var db = CreateContext();
        await db.Database.MigrateAsync();
        var plan = await SeedActionPlanAsync(db, "3");

        var kpiId = Guid.NewGuid();
        db.ActionPlanKpis.Add(new ActionPlanKpi
        {
            Id = kpiId, ActionPlanId = plan.Id, Name = "K", TargetValue = 1m, Unit = "count", MeasurementFrequency = "weekly",
        });
        await db.SaveChangesAsync();

        db.ActionPlans.Remove(plan);
        await db.SaveChangesAsync();

        await using var readDb = CreateContext();
        Assert.False(await readDb.ActionPlanKpis.AnyAsync(k => k.Id == kpiId));
    }
}
