using ClimateProject.Domain.Entities;
using ClimateProject.Infrastructure.Persistence;
using ClimateProject.IntegrationTests.Support;
using Microsoft.EntityFrameworkCore;

namespace ClimateProject.IntegrationTests.Persistence;

[Collection("Postgres")]
public class ReportTests(PostgresContainerFixture postgres)
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
    public async Task Report_round_trips_with_jsonb_filters_config_output_and_shared_with_array()
    {
        await using var db = CreateContext();
        await db.Database.MigrateAsync();
        var (company, user) = await SeedCompanyAndUserAsync(db);

        var report = new Report
        {
            Id = Guid.NewGuid(),
            Title = "Q3 Survey Analysis",
            Description = "Quarterly survey analysis report",
            Type = "survey_analysis",
            CompanyId = company.Id,
            CreatedBy = user.Id,
            Filters = """{"time_filter": {"start_date": "2026-01-01", "end_date": "2026-03-31"}}""",
            Config = """{"include_charts": true, "include_raw_data": false}""",
            Status = "completed",
            Format = "pdf",
            FilePath = "/reports/q3.pdf",
            FileSize = 204800,
            GenerationStartedAt = DateTimeOffset.UtcNow.AddMinutes(-5),
            GenerationCompletedAt = DateTimeOffset.UtcNow,
            SharedWith = [user.Id.ToString(), Guid.NewGuid().ToString()],
            DownloadCount = 3,
            ReportOutput = """{"metrics": {"engagementScore": 82}}""",
            CreatedAt = DateTimeOffset.UtcNow,
            UpdatedAt = DateTimeOffset.UtcNow,
        };
        db.Reports.Add(report);
        await db.SaveChangesAsync();

        await using var readDb = CreateContext();
        var loaded = await readDb.Reports.SingleAsync(r => r.Id == report.Id);
        Assert.Equal("completed", loaded.Status);
        Assert.Equal("pdf", loaded.Format);
        Assert.Equal(204800, loaded.FileSize);
        Assert.Equal(2, loaded.SharedWith.Count);
        Assert.Contains(user.Id.ToString(), loaded.SharedWith);
        Assert.Contains("engagementScore", loaded.ReportOutput);
        Assert.Contains("time_filter", loaded.Filters);
    }

    [Fact]
    public async Task Minimal_report_row_inserted_via_raw_SQL_still_loads_with_DB_level_defaults()
    {
        // Proves the NOT NULL columns with non-CLR-default intended values (status="generating",
        // is_recurring=false, shared_with=empty array, download_count=0) are enforced at the
        // Postgres column-default level, not just via the C# object-initializer default -- a row
        // inserted directly via SQL (bypassing EF entirely) must still read back with the correct
        // domain defaults.
        await using var db = CreateContext();
        await db.Database.MigrateAsync();
        var (company, user) = await SeedCompanyAndUserAsync(db);

        var minimalReportId = Guid.NewGuid();
        var now = DateTimeOffset.UtcNow;
        await db.Database.ExecuteSqlInterpolatedAsync(
            $"""
             INSERT INTO reports ("Id", title, type, company_id, created_by, format, created_at, updated_at)
             VALUES ({minimalReportId}, {"Minimal Report"}, {"custom"}, {company.Id}, {user.Id}, {"json"}, {now}, {now})
             """);

        await using var readDb = CreateContext();
        var loaded = await readDb.Reports.SingleAsync(r => r.Id == minimalReportId);
        Assert.Equal("generating", loaded.Status);
        Assert.False(loaded.IsRecurring);
        Assert.Empty(loaded.SharedWith);
        Assert.Equal(0, loaded.DownloadCount);
        Assert.Null(loaded.Filters);
        Assert.Null(loaded.Config);
        Assert.Null(loaded.ReportOutput);
    }
}
