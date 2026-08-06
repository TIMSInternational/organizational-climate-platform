using ClimateProject.Domain.Entities;
using ClimateProject.Infrastructure.Persistence;
using ClimateProject.IntegrationTests.Support;
using Microsoft.EntityFrameworkCore;

namespace ClimateProject.IntegrationTests.Persistence;

[Collection("Postgres")]
public class MicroclimateTests(PostgresContainerFixture postgres)
{
    private ClimateProjectDbContext CreateContext()
    {
        var options = new DbContextOptionsBuilder<ClimateProjectDbContext>()
            .UseNpgsql(postgres.ConnectionString)
            .Options;
        return new ClimateProjectDbContext(options);
    }

    private async Task<(Company company, User creator, Department dept)> SeedAsync(ClimateProjectDbContext db)
    {
        var company = new Company { Id = Guid.NewGuid(), Name = "Acme", CreatedAt = DateTimeOffset.UtcNow };
        db.Companies.Add(company);
        await db.SaveChangesAsync();

        var creator = new User
        {
            Id = Guid.NewGuid(), CompanyId = company.Id, Email = $"creator-{Guid.NewGuid():N}@acme.test", Name = "Creator",
            Role = "company_admin", CreatedAt = DateTimeOffset.UtcNow, UpdatedAt = DateTimeOffset.UtcNow,
        };
        db.Users.Add(creator);

        var dept = new Department
        {
            Id = Guid.NewGuid(), CompanyId = company.Id, Name = "Engineering",
            CreatedAt = DateTimeOffset.UtcNow, UpdatedAt = DateTimeOffset.UtcNow,
        };
        db.Departments.Add(dept);
        await db.SaveChangesAsync();

        return (company, creator, dept);
    }

    [Fact]
    public async Task Microclimate_round_trips_with_all_owned_shapes_template_link_and_department_targets()
    {
        await using var db = CreateContext();
        await db.Database.MigrateAsync();
        var (company, creator, dept) = await SeedAsync(db);

        var template = new MicroclimateTemplate
        {
            Id = Guid.NewGuid(), Name = "Weekly Pulse", Description = "desc", Category = "pulse_check",
            CompanyId = company.Id, CreatedBy = creator.Id,
            CreatedAt = DateTimeOffset.UtcNow, UpdatedAt = DateTimeOffset.UtcNow,
        };
        db.MicroclimateTemplates.Add(template);
        await db.SaveChangesAsync();

        var now = DateTimeOffset.UtcNow;
        var microclimate = new Microclimate
        {
            Id = Guid.NewGuid(),
            TitleEn = "Q3 Pulse Check",
            CompanyId = company.Id,
            CreatedBy = creator.Id,
            TemplateId = template.Id,
            Targeting = new MicroclimateTargeting { RoleFilters = ["employee"], MaxParticipants = 25 },
            Scheduling = new MicroclimateScheduling { StartTime = now, EndTime = now.AddMinutes(30), Timezone = "America/Costa_Rica" },
            CreatedAt = now,
            UpdatedAt = now,
        };
        db.Microclimates.Add(microclimate);
        await db.SaveChangesAsync();

        db.MicroclimateDepartmentTargets.Add(new MicroclimateDepartmentTarget { MicroclimateId = microclimate.Id, DepartmentId = dept.Id });
        await db.SaveChangesAsync();

        await using var readDb = CreateContext();
        var loaded = await readDb.Microclimates.SingleAsync(m => m.Id == microclimate.Id);
        Assert.Equal("draft", loaded.Status);
        Assert.Equal(0, loaded.ResponseCount);
        Assert.Equal(template.Id, loaded.TemplateId);
        Assert.Equal(["employee"], loaded.Targeting.RoleFilters!);
        Assert.True(loaded.Targeting.IncludeManagers);
        Assert.Equal(25, loaded.Targeting.MaxParticipants);
        Assert.Equal("America/Costa_Rica", loaded.Scheduling.Timezone);
        Assert.True(loaded.RealtimeSettings.ShowLiveResults);
        Assert.Equal(3, loaded.RealtimeSettings.ParticipationThreshold);
        Assert.Equal("medium", loaded.LiveResults.EngagementLevel);
        Assert.Empty(loaded.LiveResults.TopThemes);

        var target = await readDb.MicroclimateDepartmentTargets
            .SingleAsync(t => t.MicroclimateId == microclimate.Id && t.DepartmentId == dept.Id);
        Assert.Equal(dept.Id, target.DepartmentId);
    }

    [Fact]
    public async Task Deleting_the_template_sets_microclimate_template_id_to_null()
    {
        await using var db = CreateContext();
        await db.Database.MigrateAsync();
        var (company, creator, _) = await SeedAsync(db);

        var template = new MicroclimateTemplate
        {
            Id = Guid.NewGuid(), Name = "Temp", Description = "desc", Category = "custom",
            CompanyId = company.Id, CreatedBy = creator.Id,
            CreatedAt = DateTimeOffset.UtcNow, UpdatedAt = DateTimeOffset.UtcNow,
        };
        db.MicroclimateTemplates.Add(template);

        var now = DateTimeOffset.UtcNow;
        var microclimate = new Microclimate
        {
            Id = Guid.NewGuid(), TitleEn = "Uses Template", CompanyId = company.Id, CreatedBy = creator.Id,
            TemplateId = template.Id,
            Scheduling = new MicroclimateScheduling { StartTime = now, EndTime = now.AddMinutes(30) },
            CreatedAt = now, UpdatedAt = now,
        };
        db.Microclimates.Add(microclimate);
        await db.SaveChangesAsync();

        db.MicroclimateTemplates.Remove(template);
        await db.SaveChangesAsync();

        await using var readDb = CreateContext();
        var loaded = await readDb.Microclimates.SingleAsync(m => m.Id == microclimate.Id);
        Assert.Null(loaded.TemplateId);
    }

    [Fact]
    public async Task Minimal_row_inserted_via_raw_SQL_still_loads_with_true_intended_defaults()
    {
        await using var db = CreateContext();
        await db.Database.MigrateAsync();
        var (company, creator, _) = await SeedAsync(db);

        var minimalId = Guid.NewGuid();
        var now = DateTimeOffset.UtcNow;
        await db.Database.ExecuteSqlInterpolatedAsync(
            $"""
             INSERT INTO microclimates ("Id", title_en, company_id, created_by, scheduling_start_time, scheduling_end_time, created_at, updated_at)
             VALUES ({minimalId}, {"Minimal"}, {company.Id}, {creator.Id}, {now}, {now.AddMinutes(30)}, {now}, {now})
             """);

        await using var readDb = CreateContext();
        var loaded = await readDb.Microclimates.SingleAsync(m => m.Id == minimalId);
        Assert.Equal("draft", loaded.Status);
        Assert.Equal(0, loaded.ResponseCount);
        Assert.Equal(0, loaded.TargetParticipantCount);
        Assert.Equal(0, loaded.ParticipationRate);
        Assert.True(loaded.Targeting.IncludeManagers);
        Assert.Equal("UTC", loaded.Scheduling.Timezone);
        Assert.True(loaded.RealtimeSettings.ShowLiveResults);
        Assert.True(loaded.RealtimeSettings.AnonymousResponses);
        Assert.True(loaded.RealtimeSettings.AllowComments);
        Assert.True(loaded.RealtimeSettings.WordCloudEnabled);
        Assert.True(loaded.RealtimeSettings.SentimentAnalysisEnabled);
        Assert.Equal(3, loaded.RealtimeSettings.ParticipationThreshold);
        Assert.Equal(0, loaded.LiveResults.SentimentScore);
        Assert.Equal("medium", loaded.LiveResults.EngagementLevel);
        Assert.Empty(loaded.LiveResults.TopThemes);
    }
}
