using ClimateProject.Domain.Entities;
using ClimateProject.Infrastructure.Persistence;
using ClimateProject.IntegrationTests.Support;
using Microsoft.EntityFrameworkCore;

namespace ClimateProject.IntegrationTests.Persistence;

[Collection("Postgres")]
public class MicroclimateAiInsightTests(PostgresContainerFixture postgres)
{
    private ClimateProjectDbContext CreateContext()
    {
        var options = new DbContextOptionsBuilder<ClimateProjectDbContext>()
            .UseNpgsql(postgres.ConnectionString)
            .Options;
        return new ClimateProjectDbContext(options);
    }

    private async Task<Microclimate> SeedMicroclimateAsync(ClimateProjectDbContext db)
    {
        var company = new Company { Id = Guid.NewGuid(), Name = "Acme", CreatedAt = DateTimeOffset.UtcNow };
        db.Companies.Add(company);
        var creator = new User
        {
            Id = Guid.NewGuid(), CompanyId = company.Id, Email = $"creator-{Guid.NewGuid():N}@acme.test", Name = "Creator",
            Role = "company_admin", CreatedAt = DateTimeOffset.UtcNow, UpdatedAt = DateTimeOffset.UtcNow,
        };
        db.Users.Add(creator);
        await db.SaveChangesAsync();

        var now = DateTimeOffset.UtcNow;
        var microclimate = new Microclimate
        {
            Id = Guid.NewGuid(), TitleEn = "Pulse", CompanyId = company.Id, CreatedBy = creator.Id,
            Scheduling = new MicroclimateScheduling { StartTime = now, EndTime = now.AddMinutes(30) },
            CreatedAt = now, UpdatedAt = now,
        };
        db.Microclimates.Add(microclimate);
        await db.SaveChangesAsync();
        return microclimate;
    }

    [Fact]
    public async Task Insight_round_trips()
    {
        await using var db = CreateContext();
        await db.Database.MigrateAsync();
        var microclimate = await SeedMicroclimateAsync(db);

        var insight = new MicroclimateAiInsight
        {
            Id = Guid.NewGuid(),
            MicroclimateId = microclimate.Id,
            Type = "alert",
            Message = "Participation is trending below target.",
            Confidence = 0.82,
            Timestamp = DateTimeOffset.UtcNow,
        };
        db.MicroclimateAiInsights.Add(insight);
        await db.SaveChangesAsync();

        await using var readDb = CreateContext();
        var loaded = await readDb.MicroclimateAiInsights.SingleAsync(i => i.Id == insight.Id);
        Assert.Equal(microclimate.Id, loaded.MicroclimateId);
        Assert.Equal("alert", loaded.Type);
        Assert.Equal(0.82, loaded.Confidence);
    }

    [Fact]
    public async Task Deleting_microclimate_cascades_to_its_insights()
    {
        await using var db = CreateContext();
        await db.Database.MigrateAsync();
        var microclimate = await SeedMicroclimateAsync(db);

        var insight = new MicroclimateAiInsight
        {
            Id = Guid.NewGuid(), MicroclimateId = microclimate.Id, Type = "pattern",
            Message = "Recurring theme detected.", Confidence = 0.5, Timestamp = DateTimeOffset.UtcNow,
        };
        db.MicroclimateAiInsights.Add(insight);
        await db.SaveChangesAsync();

        db.Microclimates.Remove(microclimate);
        await db.SaveChangesAsync();

        await using var readDb = CreateContext();
        Assert.False(await readDb.MicroclimateAiInsights.AnyAsync(i => i.Id == insight.Id));
    }
}
