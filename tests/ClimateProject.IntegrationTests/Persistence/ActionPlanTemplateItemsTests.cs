using ClimateProject.Domain.Entities;
using ClimateProject.Infrastructure.Persistence;
using ClimateProject.IntegrationTests.Support;
using Microsoft.EntityFrameworkCore;

namespace ClimateProject.IntegrationTests.Persistence;

[Collection("Postgres")]
public class ActionPlanTemplateItemsTests(PostgresContainerFixture postgres)
{
    private ClimateProjectDbContext CreateContext()
    {
        var options = new DbContextOptionsBuilder<ClimateProjectDbContext>()
            .UseNpgsql(postgres.ConnectionString)
            .Options;
        return new ClimateProjectDbContext(options);
    }

    private async Task<ActionPlanTemplate> SeedTemplateAsync(ClimateProjectDbContext db, string suffix)
    {
        var company = new Company { Id = Guid.NewGuid(), Name = $"Acme {suffix}", CreatedAt = DateTimeOffset.UtcNow };
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
        db.Users.Add(user);
        db.ActionPlanTemplates.Add(template);
        await db.SaveChangesAsync();
        return template;
    }

    [Fact]
    public async Task Template_kpi_and_objective_rows_round_trip()
    {
        await using var db = CreateContext();
        await db.Database.MigrateAsync();
        var template = await SeedTemplateAsync(db, "1");

        var kpi = new ActionPlanTemplateKpi
        {
            Id = Guid.NewGuid(), TemplateId = template.Id, Name = "Response rate",
            TargetValue = 85m, Unit = "%", MeasurementFrequency = "monthly",
        };
        var objective = new ActionPlanTemplateObjective
        {
            Id = Guid.NewGuid(), TemplateId = template.Id,
            Description = "Improve team cohesion", SuccessCriteria = "Two team events run",
        };
        db.ActionPlanTemplateKpis.Add(kpi);
        db.ActionPlanTemplateObjectives.Add(objective);
        await db.SaveChangesAsync();

        await using var readDb = CreateContext();
        var loadedKpi = await readDb.ActionPlanTemplateKpis.SingleAsync(k => k.Id == kpi.Id);
        Assert.Equal(85m, loadedKpi.TargetValue);
        Assert.Equal("monthly", loadedKpi.MeasurementFrequency);

        var loadedObjective = await readDb.ActionPlanTemplateObjectives.SingleAsync(o => o.Id == objective.Id);
        Assert.Equal("Two team events run", loadedObjective.SuccessCriteria);
    }

    [Fact]
    public async Task Deleting_a_template_cascades_delete_of_its_kpi_and_objective_rows()
    {
        await using var db = CreateContext();
        await db.Database.MigrateAsync();
        var template = await SeedTemplateAsync(db, "2");

        var kpiId = Guid.NewGuid();
        var objectiveId = Guid.NewGuid();
        db.ActionPlanTemplateKpis.Add(new ActionPlanTemplateKpi
        {
            Id = kpiId, TemplateId = template.Id, Name = "K", TargetValue = 1m, Unit = "count", MeasurementFrequency = "weekly",
        });
        db.ActionPlanTemplateObjectives.Add(new ActionPlanTemplateObjective
        {
            Id = objectiveId, TemplateId = template.Id, Description = "d", SuccessCriteria = "s",
        });
        await db.SaveChangesAsync();

        db.ActionPlanTemplates.Remove(template);
        await db.SaveChangesAsync();

        await using var readDb = CreateContext();
        Assert.False(await readDb.ActionPlanTemplateKpis.AnyAsync(k => k.Id == kpiId));
        Assert.False(await readDb.ActionPlanTemplateObjectives.AnyAsync(o => o.Id == objectiveId));
    }
}
