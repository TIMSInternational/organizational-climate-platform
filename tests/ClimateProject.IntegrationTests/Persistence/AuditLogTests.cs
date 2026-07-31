using ClimateProject.Domain.Entities;
using ClimateProject.Infrastructure.Persistence;
using ClimateProject.IntegrationTests.Support;
using Microsoft.EntityFrameworkCore;

namespace ClimateProject.IntegrationTests.Persistence;

[Collection("Postgres")]
public class AuditLogTests(PostgresContainerFixture postgres)
{
    private ClimateProjectDbContext CreateContext()
    {
        var options = new DbContextOptionsBuilder<ClimateProjectDbContext>()
            .UseNpgsql(postgres.ConnectionString)
            .Options;
        return new ClimateProjectDbContext(options);
    }

    [Fact]
    public async Task AuditLog_round_trips_with_nullable_user_and_jsonb_details()
    {
        await using var db = CreateContext();
        await db.Database.MigrateAsync();

        var company = new Company { Id = Guid.NewGuid(), Name = "Acme", CreatedAt = DateTimeOffset.UtcNow };
        db.Companies.Add(company);
        await db.SaveChangesAsync();

        var systemEntry = new AuditLog
        {
            Id = Guid.NewGuid(),
            UserId = null,
            CompanyId = company.Id,
            Action = "create",
            Resource = "user",
            ResourceId = Guid.NewGuid().ToString(),
            Details = """{"method": "invitation", "role": "employee"}""",
            Success = true,
            Timestamp = DateTimeOffset.UtcNow,
        };
        db.AuditLogs.Add(systemEntry);
        await db.SaveChangesAsync();

        await using var readDb = CreateContext();
        var loaded = await readDb.AuditLogs.SingleAsync(a => a.Id == systemEntry.Id);
        Assert.Null(loaded.UserId);
        Assert.Equal("create", loaded.Action);
        Assert.Contains("invitation", loaded.Details);
    }

    [Fact]
    public async Task AuditLog_orders_by_company_and_timestamp_via_the_composite_index()
    {
        await using var db = CreateContext();
        await db.Database.MigrateAsync();

        var company = new Company { Id = Guid.NewGuid(), Name = "Acme2", CreatedAt = DateTimeOffset.UtcNow };
        db.Companies.Add(company);
        await db.SaveChangesAsync();

        var older = new AuditLog { Id = Guid.NewGuid(), CompanyId = company.Id, Action = "login", Resource = "user", Success = true, Timestamp = DateTimeOffset.UtcNow.AddMinutes(-10) };
        var newer = new AuditLog { Id = Guid.NewGuid(), CompanyId = company.Id, Action = "login", Resource = "user", Success = true, Timestamp = DateTimeOffset.UtcNow };
        db.AuditLogs.AddRange(older, newer);
        await db.SaveChangesAsync();

        await using var readDb = CreateContext();
        var ordered = await readDb.AuditLogs
            .Where(a => a.CompanyId == company.Id)
            .OrderByDescending(a => a.Timestamp)
            .Select(a => a.Id)
            .ToListAsync();

        Assert.Equal([newer.Id, older.Id], ordered);
    }
}
