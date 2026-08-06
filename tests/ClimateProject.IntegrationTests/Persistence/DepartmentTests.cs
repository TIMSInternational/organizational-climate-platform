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

    private static async Task<User> SeedUserAsync(ClimateProjectDbContext db, Company company, string label)
    {
        var user = new User
        {
            Id = Guid.NewGuid(),
            CompanyId = company.Id,
            Email = $"{label}-{Guid.NewGuid():N}@acme.test",
            Name = label,
            Role = "company_admin",
            IsActive = true,
            CreatedAt = DateTimeOffset.UtcNow,
            UpdatedAt = DateTimeOffset.UtcNow,
        };
        db.Users.Add(user);
        await db.SaveChangesAsync();
        return user;
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

    // #150: manager_id held a user id with no constraint behind it, so a department could name
    // a manager who had never existed. The storage layer must reject that outright.
    [Fact]
    public async Task Department_with_an_unknown_manager_id_is_rejected()
    {
        await using var db = CreateContext();
        await db.Database.MigrateAsync();
        var company = await SeedCompanyAsync(db);

        db.Departments.Add(new Department
        {
            Id = Guid.NewGuid(),
            CompanyId = company.Id,
            Name = "Ghost-managed",
            ManagerId = Guid.NewGuid(),
            CreatedAt = DateTimeOffset.UtcNow,
            UpdatedAt = DateTimeOffset.UtcNow,
        });

        await Assert.ThrowsAsync<DbUpdateException>(() => db.SaveChangesAsync());
    }

    // The FK is optional, not required -- ManagerId is Guid? and a department with no manager
    // is an ordinary state, not a violation. Pinned because EF flips an FK to required on the
    // slightest provocation and the migration would then reject every unmanaged department.
    [Fact]
    public async Task Department_without_a_manager_still_saves()
    {
        await using var db = CreateContext();
        await db.Database.MigrateAsync();
        var company = await SeedCompanyAsync(db);

        var department = new Department
        {
            Id = Guid.NewGuid(),
            CompanyId = company.Id,
            Name = "Unmanaged",
            ManagerId = null,
            CreatedAt = DateTimeOffset.UtcNow,
            UpdatedAt = DateTimeOffset.UtcNow,
        };
        db.Departments.Add(department);
        await db.SaveChangesAsync();

        await using var readDb = CreateContext();
        Assert.Null((await readDb.Departments.SingleAsync(d => d.Id == department.Id)).ManagerId);
    }

    // The delete behaviour is the deliberate half of #150. SET NULL, not Restrict (which would
    // block GDPR erasure of anyone who manages a department, #144) and emphatically not Cascade
    // (which would delete the department along with the person). Assert both halves: the
    // department survives, and its pointer is cleared rather than left dangling.
    [Fact]
    public async Task Deleting_a_manager_nulls_the_departments_manager_id_and_keeps_the_department()
    {
        await using var db = CreateContext();
        await db.Database.MigrateAsync();
        var company = await SeedCompanyAsync(db);
        var manager = await SeedUserAsync(db, company, "manager");

        var department = new Department
        {
            Id = Guid.NewGuid(),
            CompanyId = company.Id,
            Name = "Managed",
            ManagerId = manager.Id,
            CreatedAt = DateTimeOffset.UtcNow,
            UpdatedAt = DateTimeOffset.UtcNow,
        };
        db.Departments.Add(department);
        await db.SaveChangesAsync();

        // Delete through a fresh context so the department is not tracked -- otherwise EF's
        // client-side fixup could null the pointer in memory and hide whether the DB-level
        // ON DELETE SET NULL is actually there.
        await using var deleteDb = CreateContext();
        deleteDb.Users.Remove(await deleteDb.Users.SingleAsync(u => u.Id == manager.Id));
        await deleteDb.SaveChangesAsync();

        await using var readDb = CreateContext();
        var reloaded = await readDb.Departments.SingleAsync(d => d.Id == department.Id);
        Assert.Null(reloaded.ManagerId);
        Assert.Equal("Managed", reloaded.Name);
    }

    // The migration's cleanup step nulls orphaned manager_id values before adding the
    // constraint. Once the constraint exists an orphan cannot be created, so the only way to
    // exercise the cleanup is to reconstruct the pre-migration world: inside a transaction that
    // is rolled back, drop the constraint, plant an orphan, then run the migration's UPDATE and
    // re-add the constraint. Without the UPDATE the ADD CONSTRAINT fails -- which is exactly
    // the deploy-time failure the cleanup exists to prevent, and which an integration suite
    // starting from an empty container would otherwise never see.
    [Fact]
    public async Task Migration_cleanup_nulls_orphaned_manager_ids_so_the_constraint_can_be_added()
    {
        await using var db = CreateContext();
        await db.Database.MigrateAsync();
        var company = await SeedCompanyAsync(db);

        await using var conn = new NpgsqlConnection(postgres.ConnectionString);
        await conn.OpenAsync();
        await using var tx = await conn.BeginTransactionAsync();

        async Task ExecuteAsync(string sql, params (string Name, object Value)[] parameters)
        {
            await using var cmd = new NpgsqlCommand(sql, conn, tx);
            foreach (var (name, value) in parameters)
            {
                cmd.Parameters.AddWithValue(name, value);
            }

            await cmd.ExecuteNonQueryAsync();
        }

        await ExecuteAsync("ALTER TABLE departments DROP CONSTRAINT \"FK_departments_users_manager_id\"");

        var orphanId = Guid.NewGuid();
        await ExecuteAsync(
            """
            INSERT INTO departments ("Id", company_id, name, manager_id, created_at, updated_at)
            VALUES (@id, @companyId, 'Orphan-managed', @managerId, now(), now())
            """,
            ("id", orphanId), ("companyId", company.Id), ("managerId", Guid.NewGuid()));

        // Verbatim from ConstrainDepartmentManagerId.Up.
        await ExecuteAsync(
            """
            UPDATE departments d
            SET manager_id = NULL
            WHERE d.manager_id IS NOT NULL
              AND NOT EXISTS (SELECT 1 FROM users u WHERE u."Id" = d.manager_id);
            """);

        await ExecuteAsync(
            """
            ALTER TABLE departments ADD CONSTRAINT "FK_departments_users_manager_id"
            FOREIGN KEY (manager_id) REFERENCES users ("Id") ON DELETE SET NULL
            """);

        await using (var check = new NpgsqlCommand("SELECT manager_id FROM departments WHERE \"Id\" = @id", conn, tx))
        {
            check.Parameters.AddWithValue("id", orphanId);
            Assert.IsType<DBNull>(await check.ExecuteScalarAsync());
        }

        await tx.RollbackAsync();
    }
}
