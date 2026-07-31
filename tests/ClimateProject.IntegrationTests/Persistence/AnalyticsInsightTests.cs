using ClimateProject.Domain.Entities;
using ClimateProject.Infrastructure.Persistence;
using ClimateProject.IntegrationTests.Support;
using Microsoft.EntityFrameworkCore;

namespace ClimateProject.IntegrationTests.Persistence;

[Collection("Postgres")]
public class AnalyticsInsightTests(PostgresContainerFixture postgres)
{
    private ClimateProjectDbContext CreateContext()
    {
        var options = new DbContextOptionsBuilder<ClimateProjectDbContext>()
            .UseNpgsql(postgres.ConnectionString)
            .Options;
        return new ClimateProjectDbContext(options);
    }

    private async Task<Company> SeedCompanyAsync(ClimateProjectDbContext db)
    {
        var company = new Company { Id = Guid.NewGuid(), Name = "Acme", CreatedAt = DateTimeOffset.UtcNow };
        db.Companies.Add(company);
        await db.SaveChangesAsync();
        return company;
    }

    [Fact]
    public async Task AnalyticsInsight_round_trips_with_metric_data_and_time_series()
    {
        await using var db = CreateContext();
        await db.Database.MigrateAsync();
        var company = await SeedCompanyAsync(db);

        var insight = new AnalyticsInsight
        {
            Id = Guid.NewGuid(),
            CompanyId = company.Id,
            AggregationType = "company",
            MetricType = "distribution",
            MetricName = "engagement_by_department",
            MetricDescription = "Engagement score distribution across departments",
            TotalResponses = 240,
            CalculationDate = DateTimeOffset.UtcNow,
            CreatedAt = DateTimeOffset.UtcNow,
            UpdatedAt = DateTimeOffset.UtcNow,
        };
        db.AnalyticsInsights.Add(insight);
        await db.SaveChangesAsync();

        var metricData = new AnalyticsMetricData
        {
            Id = Guid.NewGuid(),
            InsightId = insight.Id,
            Label = "Engineering",
            Value = 82.3,
            Count = 40,
            Percentage = 33.3,
        };
        var timeSeries = new AnalyticsTimeSeries
        {
            Id = Guid.NewGuid(),
            InsightId = insight.Id,
            Date = DateTimeOffset.UtcNow.AddDays(-30),
            Value = 79.1,
            Count = 200,
        };
        db.AnalyticsMetricData.Add(metricData);
        db.AnalyticsTimeSeries.Add(timeSeries);
        await db.SaveChangesAsync();

        await using var readDb = CreateContext();
        var loadedInsight = await readDb.AnalyticsInsights.SingleAsync(i => i.Id == insight.Id);
        Assert.True(loadedInsight.IsCurrent);
        Assert.Equal(240, loadedInsight.TotalResponses);

        var loadedMetric = await readDb.AnalyticsMetricData.SingleAsync(m => m.Id == metricData.Id);
        Assert.Equal(insight.Id, loadedMetric.InsightId);
        Assert.Equal("Engineering", loadedMetric.Label);

        var loadedSeries = await readDb.AnalyticsTimeSeries.SingleAsync(t => t.Id == timeSeries.Id);
        Assert.Equal(insight.Id, loadedSeries.InsightId);
        Assert.Equal(200, loadedSeries.Count);
    }

    [Fact]
    public async Task Minimal_analytics_insight_row_inserted_via_raw_SQL_still_loads_with_DB_level_defaults()
    {
        await using var db = CreateContext();
        await db.Database.MigrateAsync();
        var company = await SeedCompanyAsync(db);

        var minimalInsightId = Guid.NewGuid();
        var now = DateTimeOffset.UtcNow;
        await db.Database.ExecuteSqlInterpolatedAsync(
            $"""
             INSERT INTO analytics_insights ("Id", company_id, aggregation_type, metric_type, metric_name, total_responses, calculation_date, created_at, updated_at)
             VALUES ({minimalInsightId}, {company.Id}, {"survey"}, {"average"}, {"avg_score"}, {100}, {now}, {now}, {now})
             """);

        await using var readDb = CreateContext();
        var loaded = await readDb.AnalyticsInsights.SingleAsync(i => i.Id == minimalInsightId);
        Assert.True(loaded.IsCurrent);
        Assert.Null(loaded.SurveyId);
        Assert.Null(loaded.DepartmentId);
    }
}
