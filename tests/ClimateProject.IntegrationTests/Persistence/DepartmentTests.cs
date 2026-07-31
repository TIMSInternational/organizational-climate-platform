using ClimateProject.Domain.Entities;
using ClimateProject.Infrastructure.Persistence;
using ClimateProject.IntegrationTests.Support;
using Microsoft.EntityFrameworkCore;
using Npgsql;

namespace ClimateProject.IntegrationTests.Persistence;

[Collection("Postgres")]
public class DepartmentTests(PostgresContainerFixture postgres)
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
    public async Task Department_round_trips_with_owned_settings()
    {
        await using var db = CreateContext();
        await db.Database.MigrateAsync();
        var company = await SeedCompanyAsync(db);

        var department = new Department
        {
            Id = Guid.NewGuid(),
            CompanyId = company.Id,
            Name = "Engineering",
            EmployeeCount = 12,
            Settings = new DepartmentSettings { MicroclimateFrequency = "weekly", NotificationSlack = true },
            CreatedAt = DateTimeOffset.UtcNow,
            UpdatedAt = DateTimeOffset.UtcNow,
        };
        db.Departments.Add(department);
        await db.SaveChangesAsync();

        await using var readDb = CreateContext();
        var loaded = await readDb.Departments.SingleAsync(d => d.Id == department.Id);
        Assert.Equal("Engineering", loaded.Name);
        Assert.Equal("weekly", loaded.Settings.MicroclimateFrequency);
        Assert.True(loaded.Settings.NotificationSlack);
    }

    [Fact]
    public async Task Department_hierarchy_traverses_via_recursive_CTE()
    {
        await using var db = CreateContext();
        await db.Database.MigrateAsync();
        var company = await SeedCompanyAsync(db);

        var root = new Department { Id = Guid.NewGuid(), CompanyId = company.Id, Name = "Root", CreatedAt = DateTimeOffset.UtcNow, UpdatedAt = DateTimeOffset.UtcNow };
        var mid = new Department { Id = Guid.NewGuid(), CompanyId = company.Id, Name = "Mid", ParentDepartmentId = root.Id, CreatedAt = DateTimeOffset.UtcNow, UpdatedAt = DateTimeOffset.UtcNow };
        var leaf = new Department { Id = Guid.NewGuid(), CompanyId = company.Id, Name = "Leaf", ParentDepartmentId = mid.Id, CreatedAt = DateTimeOffset.UtcNow, UpdatedAt = DateTimeOffset.UtcNow };
        db.Departments.AddRange(root, mid, leaf);
        await db.SaveChangesAsync();

        await using var conn = new NpgsqlConnection(postgres.ConnectionString);
        await conn.OpenAsync();
        await using var cmd = new NpgsqlCommand(
            """
            WITH RECURSIVE ancestry AS (
                SELECT "Id" AS id, name, parent_department_id, 0 AS depth
                FROM departments WHERE "Id" = @leafId
                UNION ALL
                SELECT d."Id" AS id, d.name, d.parent_department_id, a.depth + 1
                FROM departments d
                JOIN ancestry a ON d."Id" = a.parent_department_id
            )
            SELECT name FROM ancestry ORDER BY depth
            """, conn);
        cmd.Parameters.AddWithValue("leafId", leaf.Id);
        await using var reader = await cmd.ExecuteReaderAsync();
        var names = new List<string>();
        while (await reader.ReadAsync())
        {
            names.Add(reader.GetString(0));
        }

        Assert.Equal(["Leaf", "Mid", "Root"], names);
    }

    [Fact]
    public async Task Existing_department_without_new_defaults_still_loads_with_defaults()
    {
        // Simulates a row that existed BEFORE the AddDepartmentDefaults migration ran: run all
        // migrations, then insert a row via raw SQL that only sets the pre-fix (#15-era) columns
        // -- Id, company_id, name, created_at, updated_at -- leaving every NOT NULL column that
        // previously had no DB-level default (employee_count, is_active, and the six
        // settings_* owned-type columns) to whatever the DB-level column default now is.
        // Reading it back via EF must show the intended domain defaults, proving those defaults
        // are baked into the migration's AlterColumn calls (defaultValue: ...) rather than only
        // existing as C# object-initializer defaults that a legacy row would never pick up.
        await using var db = CreateContext();
        await db.Database.MigrateAsync();
        var company = await SeedCompanyAsync(db);

        var minimalDepartmentId = Guid.NewGuid();
        await db.Database.ExecuteSqlInterpolatedAsync(
            $"""
             INSERT INTO departments ("Id", company_id, name, created_at, updated_at)
             VALUES ({minimalDepartmentId}, {company.Id}, {"Minimal Dept"}, {DateTimeOffset.UtcNow}, {DateTimeOffset.UtcNow})
             """);

        await using var readDb = CreateContext();
        var loaded = await readDb.Departments.SingleAsync(d => d.Id == minimalDepartmentId);
        Assert.Equal(0, loaded.EmployeeCount);
        Assert.True(loaded.IsActive);
        Assert.True(loaded.Settings.SurveyParticipationRequired);
        Assert.Equal("monthly", loaded.Settings.MicroclimateFrequency);
        Assert.True(loaded.Settings.AutoActionPlans);
        Assert.True(loaded.Settings.NotificationEmail);
        Assert.False(loaded.Settings.NotificationSlack);
        Assert.False(loaded.Settings.NotificationTeams);
    }
}
