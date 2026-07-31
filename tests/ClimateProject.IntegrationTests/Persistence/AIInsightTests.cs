using ClimateProject.Domain.Entities;
using ClimateProject.Infrastructure.Persistence;
using ClimateProject.IntegrationTests.Support;
using Microsoft.EntityFrameworkCore;

namespace ClimateProject.IntegrationTests.Persistence;

[Collection("Postgres")]
public class AIInsightTests(PostgresContainerFixture postgres)
{
    private ClimateProjectDbContext CreateContext()
    {
        var options = new DbContextOptionsBuilder<ClimateProjectDbContext>()
            .UseNpgsql(postgres.ConnectionString)
            .Options;
        return new ClimateProjectDbContext(options);
    }

    private async Task<(Company company, User user)> SeedCompanyAndUserAsync(ClimateProjectDbContext db)
    {
        var company = new Company { Id = Guid.NewGuid(), Name = "Acme", CreatedAt = DateTimeOffset.UtcNow };
        db.Companies.Add(company);
        await db.SaveChangesAsync();

        var user = new User
        {
            Id = Guid.NewGuid(), CompanyId = company.Id, Email = $"admin-{Guid.NewGuid():N}@acme.test", Name = "Admin",
            Role = "company_admin", CreatedAt = DateTimeOffset.UtcNow, UpdatedAt = DateTimeOffset.UtcNow,
        };
        db.Users.Add(user);
        await db.SaveChangesAsync();
        return (company, user);
    }

    [Fact]
    public async Task AIInsight_round_trips_with_int_confidence_score_and_array_columns()
    {
        await using var db = CreateContext();
        await db.Database.MigrateAsync();
        var (company, user) = await SeedCompanyAndUserAsync(db);

        var insight = new AIInsight
        {
            Id = Guid.NewGuid(),
            CompanyId = company.Id,
            Type = "risk",
            Category = "attrition",
            Title = "Elevated attrition risk in Engineering",
            Description = "Engagement scores trending down over the last 3 cycles",
            ConfidenceScore = 87,
            Priority = "high",
            AffectedSegments = ["Engineering", "QA"],
            RecommendedActions = ["Schedule 1:1s", "Review workload distribution"],
            SupportingData = """{"trend": [80, 75, 68]}""",
            IsAcknowledged = true,
            AcknowledgedBy = user.Id,
            AcknowledgedAt = DateTimeOffset.UtcNow,
            CreatedAt = DateTimeOffset.UtcNow,
            UpdatedAt = DateTimeOffset.UtcNow,
        };
        db.AIInsights.Add(insight);
        await db.SaveChangesAsync();

        await using var readDb = CreateContext();
        var loaded = await readDb.AIInsights.SingleAsync(i => i.Id == insight.Id);
        Assert.Equal(87, loaded.ConfidenceScore);
        Assert.Equal(2, loaded.AffectedSegments.Count);
        Assert.Contains("Engineering", loaded.AffectedSegments);
        Assert.Equal(2, loaded.RecommendedActions.Count);
        Assert.True(loaded.IsAcknowledged);
        Assert.Equal(user.Id, loaded.AcknowledgedBy);
        Assert.Contains("trend", loaded.SupportingData);
    }

    [Fact]
    public async Task Minimal_ai_insight_row_inserted_via_raw_SQL_still_loads_with_DB_level_defaults()
    {
        await using var db = CreateContext();
        await db.Database.MigrateAsync();
        var (company, _) = await SeedCompanyAndUserAsync(db);

        var minimalInsightId = Guid.NewGuid();
        var now = DateTimeOffset.UtcNow;
        await db.Database.ExecuteSqlInterpolatedAsync(
            $"""
             INSERT INTO ai_insights ("Id", company_id, type, category, title, description, confidence_score, priority, created_at, updated_at)
             VALUES ({minimalInsightId}, {company.Id}, {"pattern"}, {"engagement"}, {"Title"}, {"Description"}, {50}, {"medium"}, {now}, {now})
             """);

        await using var readDb = CreateContext();
        var loaded = await readDb.AIInsights.SingleAsync(i => i.Id == minimalInsightId);
        Assert.False(loaded.IsAcknowledged);
        Assert.Empty(loaded.AffectedSegments);
        Assert.Empty(loaded.RecommendedActions);
        Assert.Null(loaded.AcknowledgedBy);
        Assert.Null(loaded.SupportingData);
    }
}
