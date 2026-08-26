using ClimateProject.Domain.Entities;
using ClimateProject.Infrastructure.Persistence;
using ClimateProject.IntegrationTests.Support;
using Microsoft.EntityFrameworkCore;

namespace ClimateProject.IntegrationTests.Persistence;

[Collection("Postgres")]
public class BenchmarkTests(PostgresContainerFixture postgres)
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
    public async Task Benchmark_round_trips_with_metrics_and_prior_period_link()
    {
        await using var db = CreateContext();
        await db.Database.MigrateAsync();
        var (company, user) = await SeedCompanyAndUserAsync(db);

        var priorPeriod = new Benchmark
        {
            Id = Guid.NewGuid(),
            Name = "2025 Engagement Benchmark",
            Description = "Prior period industry benchmark",
            Type = "industry",
            Category = "engagement",
            Source = "external-survey-2025",
            CreatedBy = user.Id,
            CreatedAt = DateTimeOffset.UtcNow,
            UpdatedAt = DateTimeOffset.UtcNow,
        };
        db.Benchmarks.Add(priorPeriod);
        await db.SaveChangesAsync();

        var current = new Benchmark
        {
            Id = Guid.NewGuid(),
            Name = "2026 Engagement Benchmark",
            Description = "Current period industry benchmark",
            Type = "industry",
            Category = "engagement",
            Source = "external-survey-2026",
            Industry = "Software",
            CompanySize = "medium",
            Region = "LatAm",
            CreatedBy = user.Id,
            CompanyId = company.Id,
            // Was the bare literal "validated", which is not one of the four values
            // BenchmarkValidationStatuses defines and which nothing in `src/` has ever
            // written. It survived because the column had no check constraint and nothing
            // read it -- the round trip asserted the string it had just written, so a fifth
            // vocabulary invented in a test file round-tripped perfectly. #90's
            // ck_benchmarks_validation_status is what found it, on its first run, which is
            // the constraint doing the job it was added for.
            ValidationStatus = BenchmarkValidationStatuses.Verified,
            QualityScore = 0.87,
            Metadata = """{"sample_size": 5000}""",
            PriorPeriodBenchmarkId = priorPeriod.Id,
            // Not optional beside the pointer: ck_benchmarks_prior_period_status (#89) makes
            // the two one fact, so the row this test used to write -- a pointer with the
            // default `unlinked` status -- is now rejected outright. That is the constraint
            // doing its job on the exact shape it exists for, a writer that sets the id and
            // leaves the status behind.
            PriorPeriodStatus = PriorPeriodStatuses.Linked,
            CreatedAt = DateTimeOffset.UtcNow,
            UpdatedAt = DateTimeOffset.UtcNow,
        };
        db.Benchmarks.Add(current);
        await db.SaveChangesAsync();

        var metric = new BenchmarkMetric
        {
            Id = Guid.NewGuid(),
            BenchmarkId = current.Id,
            MetricName = "engagement_score",
            Value = 78.5,
            Unit = "percentage",
            Percentile = 65,
            SampleSize = 5000,
            ConfidenceIntervalLower = 76.2,
            ConfidenceIntervalUpper = 80.8,
        };
        db.BenchmarkMetrics.Add(metric);
        await db.SaveChangesAsync();

        await using var readDb = CreateContext();
        var loadedBenchmark = await readDb.Benchmarks.SingleAsync(b => b.Id == current.Id);
        Assert.Equal(priorPeriod.Id, loadedBenchmark.PriorPeriodBenchmarkId);
        Assert.Equal(PriorPeriodStatuses.Linked, loadedBenchmark.PriorPeriodStatus);
        // The prior period itself took the column default, which is the pre-#89 state of
        // every row that already existed: nobody has said whether IT has a predecessor.
        Assert.Equal(
            PriorPeriodStatuses.Unlinked,
            (await readDb.Benchmarks.SingleAsync(b => b.Id == priorPeriod.Id)).PriorPeriodStatus);
        Assert.Equal(BenchmarkValidationStatuses.Verified, loadedBenchmark.ValidationStatus);
        Assert.Equal(0.87, loadedBenchmark.QualityScore);

        var loadedMetric = await readDb.BenchmarkMetrics.SingleAsync(m => m.Id == metric.Id);
        Assert.Equal(current.Id, loadedMetric.BenchmarkId);
        Assert.Equal(78.5, loadedMetric.Value);
        Assert.Equal(76.2, loadedMetric.ConfidenceIntervalLower);
    }

    [Fact]
    public async Task Minimal_benchmark_row_inserted_via_raw_SQL_still_loads_with_DB_level_defaults()
    {
        await using var db = CreateContext();
        await db.Database.MigrateAsync();
        var (_, user) = await SeedCompanyAndUserAsync(db);

        var minimalBenchmarkId = Guid.NewGuid();
        var now = DateTimeOffset.UtcNow;
        await db.Database.ExecuteSqlInterpolatedAsync(
            $"""
             INSERT INTO benchmarks ("Id", name, description, type, category, source, created_by, created_at, updated_at)
             VALUES ({minimalBenchmarkId}, {"Minimal"}, {"Minimal desc"}, {"internal"}, {"engagement"}, {"survey"}, {user.Id}, {now}, {now})
             """);

        await using var readDb = CreateContext();
        var loaded = await readDb.Benchmarks.SingleAsync(b => b.Id == minimalBenchmarkId);
        Assert.True(loaded.IsActive);
        Assert.Equal("pending", loaded.ValidationStatus);
        Assert.Equal(0, loaded.QualityScore);
        Assert.Null(loaded.CompanyId);
        Assert.Null(loaded.PriorPeriodBenchmarkId);
        Assert.Null(loaded.Metadata);
    }
}
