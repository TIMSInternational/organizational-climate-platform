using ClimateProject.Domain.Entities;
using ClimateProject.Infrastructure.Persistence;
using ClimateProject.IntegrationTests.Support;
using Microsoft.EntityFrameworkCore;

namespace ClimateProject.IntegrationTests.Persistence;

[Collection("Postgres")]
public class ActionPlanTemplateTests(PostgresContainerFixture postgres)
{
    private ClimateProjectDbContext CreateContext()
    {
        var options = new DbContextOptionsBuilder<ClimateProjectDbContext>()
            .UseNpgsql(postgres.ConnectionString)
            .Options;
        return new ClimateProjectDbContext(options);
    }

    private async Task<(Company company, User user)> SeedCompanyAndUserAsync(ClimateProjectDbContext db, string suffix)
    {
        var company = new Company { Id = Guid.NewGuid(), Name = $"Acme {suffix}", CreatedAt = DateTimeOffset.UtcNow };
        var user = new User
        {
            Id = Guid.NewGuid(), CompanyId = company.Id, Email = $"admin-{suffix}@acme.test", Name = "Admin",
            Role = "company_admin", CreatedAt = DateTimeOffset.UtcNow, UpdatedAt = DateTimeOffset.UtcNow,
        };
        db.Companies.Add(company);
        db.Users.Add(user);
        await db.SaveChangesAsync();
        return (company, user);
    }

    [Fact]
    public async Task ActionPlanTemplate_round_trips_company_scoped_and_global_variants()
    {
        await using var db = CreateContext();
        await db.Database.MigrateAsync();
        var (company, user) = await SeedCompanyAndUserAsync(db, "1");

        var scoped = new ActionPlanTemplate
        {
            Id = Guid.NewGuid(),
            Name = "Engagement Boost",
            Description = "Standard playbook for low engagement scores.",
            Category = "engagement",
            CompanyId = company.Id,
            CreatedBy = user.Id,
            AiRecommendationTemplates = ["Schedule 1:1s", "Run a pulse survey"],
            Tags = ["engagement", "quarterly"],
            IsActive = true,
            CreatedAt = DateTimeOffset.UtcNow,
            UpdatedAt = DateTimeOffset.UtcNow,
        };
        var global = new ActionPlanTemplate
        {
            Id = Guid.NewGuid(),
            Name = "Generic Improvement",
            Description = "Global default template.",
            Category = "general",
            CompanyId = null,
            CreatedBy = user.Id,
            CreatedAt = DateTimeOffset.UtcNow,
            UpdatedAt = DateTimeOffset.UtcNow,
        };
        db.ActionPlanTemplates.AddRange(scoped, global);
        await db.SaveChangesAsync();

        await using var readDb = CreateContext();
        var loadedScoped = await readDb.ActionPlanTemplates.SingleAsync(t => t.Id == scoped.Id);
        Assert.Equal(company.Id, loadedScoped.CompanyId);
        Assert.Equal(["Schedule 1:1s", "Run a pulse survey"], loadedScoped.AiRecommendationTemplates);
        Assert.Equal(["engagement", "quarterly"], loadedScoped.Tags);

        var loadedGlobal = await readDb.ActionPlanTemplates.SingleAsync(t => t.Id == global.Id);
        Assert.Null(loadedGlobal.CompanyId);
    }

    [Fact]
    public async Task Existing_template_row_without_explicit_values_gets_intended_defaults()
    {
        // Proves the migration's CreateTable declares real SQL-level defaults, not just C#
        // object-initializer defaults that only apply when inserting through EF.
        await using var db = CreateContext();
        await db.Database.MigrateAsync();
        var (_, user) = await SeedCompanyAndUserAsync(db, "2");

        var minimalId = Guid.NewGuid();
        await db.Database.ExecuteSqlInterpolatedAsync(
            $"""
             INSERT INTO action_plan_templates ("Id", name, description, category, created_by, created_at, updated_at)
             VALUES ({minimalId}, {"Minimal Template"}, {"desc"}, {"general"}, {user.Id}, {DateTimeOffset.UtcNow}, {DateTimeOffset.UtcNow})
             """);

        await using var readDb = CreateContext();
        var loaded = await readDb.ActionPlanTemplates.SingleAsync(t => t.Id == minimalId);
        Assert.Null(loaded.CompanyId);
        Assert.Empty(loaded.AiRecommendationTemplates);
        Assert.Empty(loaded.Tags);
        Assert.Equal(0, loaded.UsageCount);
        Assert.True(loaded.IsActive);
    }

    [Fact]
    public async Task Deleting_the_creating_user_is_restricted()
    {
        await using var db = CreateContext();
        await db.Database.MigrateAsync();
        var (_, user) = await SeedCompanyAndUserAsync(db, "3");

        db.ActionPlanTemplates.Add(new ActionPlanTemplate
        {
            Id = Guid.NewGuid(), Name = "T", Description = "d", Category = "general",
            CreatedBy = user.Id, CreatedAt = DateTimeOffset.UtcNow, UpdatedAt = DateTimeOffset.UtcNow,
        });
        await db.SaveChangesAsync();

        // Use a fresh context so the dependent ActionPlanTemplate isn't already tracked -
        // otherwise EF's change tracker detects the severed required relationship itself and
        // throws InvalidOperationException client-side before ever reaching Postgres. Deleting
        // through an untracked context lets the real FK constraint (ON DELETE NO ACTION) fire.
        await using var deleteDb = CreateContext();
        var trackedUser = await deleteDb.Users.SingleAsync(u => u.Id == user.Id);
        deleteDb.Users.Remove(trackedUser);
        await Assert.ThrowsAsync<DbUpdateException>(() => deleteDb.SaveChangesAsync());
    }
}
