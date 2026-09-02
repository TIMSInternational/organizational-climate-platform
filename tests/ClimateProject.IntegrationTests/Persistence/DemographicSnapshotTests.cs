using ClimateProject.Domain.Entities;
using ClimateProject.Infrastructure.Persistence;
using ClimateProject.IntegrationTests.Support;
using Microsoft.EntityFrameworkCore;

namespace ClimateProject.IntegrationTests.Persistence;

[Collection("Postgres")]
public class DemographicSnapshotTests(PostgresContainerFixture postgres)
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
    public async Task DemographicSnapshot_round_trips_with_entries_changes_and_owned_metadata()
    {
        await using var db = CreateContext();
        await db.Database.MigrateAsync();
        var (company, admin) = await SeedCompanyAndUserAsync(db);

        var member = new User
        {
            Id = Guid.NewGuid(), CompanyId = company.Id, Email = $"member-{Guid.NewGuid():N}@acme.test", Name = "Member",
            Role = "employee", CreatedAt = DateTimeOffset.UtcNow, UpdatedAt = DateTimeOffset.UtcNow,
        };
        db.Users.Add(member);
        await db.SaveChangesAsync();

        // survey_id is a real foreign key since #168. It was a bare Guid.NewGuid() here, and the
        // column is NOT NULL, so this test was writing exactly the row the constraint now forbids:
        // a snapshot of a survey that never existed.
        var survey = new Survey
        {
            Id = Guid.NewGuid(), CompanyId = company.Id, CreatedBy = admin.Id, TitleEn = "Launch survey",
            Type = "custom", StartDate = DateTimeOffset.UtcNow, EndDate = DateTimeOffset.UtcNow.AddDays(7),
            CreatedAt = DateTimeOffset.UtcNow, UpdatedAt = DateTimeOffset.UtcNow,
        };
        db.Surveys.Add(survey);
        await db.SaveChangesAsync();
        var surveyId = survey.Id;

        var snapshot = new DemographicSnapshot
        {
            Id = Guid.NewGuid(),
            SurveyId = surveyId,
            CompanyId = company.Id,
            Version = 1,
            Timestamp = DateTimeOffset.UtcNow,
            CreatedBy = admin.Id,
            Reason = "Initial snapshot at survey launch",
            Metadata = new DemographicSnapshotMetadata
            {
                TotalUsers = 1,
                DepartmentsCount = 1,
                RolesDistribution = """{"employee": 1}""",
                TenureDistribution = """{"1-2 years": 1}""",
            },
            CreatedAt = DateTimeOffset.UtcNow,
            UpdatedAt = DateTimeOffset.UtcNow,
        };
        db.DemographicSnapshots.Add(snapshot);
        await db.SaveChangesAsync();

        var entry = new DemographicSnapshotEntry
        {
            Id = Guid.NewGuid(),
            SnapshotId = snapshot.Id,
            UserId = member.Id,
            Department = "Engineering",
            Role = "employee",
            Tenure = "1-2 years",
            CustomAttributes = """{"remote": true}""",
        };
        db.DemographicSnapshotEntries.Add(entry);

        var change = new DemographicSnapshotChange
        {
            Id = Guid.NewGuid(),
            SnapshotId = snapshot.Id,
            Field = $"{member.Id}.department",
            OldValue = "\"Sales\"",
            NewValue = "\"Engineering\"",
            ChangedBy = admin.Id,
            Timestamp = DateTimeOffset.UtcNow,
            Reason = "Department reassignment",
        };
        db.DemographicSnapshotChanges.Add(change);
        await db.SaveChangesAsync();

        await using var readDb = CreateContext();
        var loadedSnapshot = await readDb.DemographicSnapshots.SingleAsync(s => s.Id == snapshot.Id);
        Assert.True(loadedSnapshot.IsActive);
        Assert.Equal(1, loadedSnapshot.Metadata.TotalUsers);
        Assert.Contains("employee", loadedSnapshot.Metadata.RolesDistribution);

        var loadedEntry = await readDb.DemographicSnapshotEntries.SingleAsync(e => e.Id == entry.Id);
        Assert.Equal(snapshot.Id, loadedEntry.SnapshotId);
        Assert.Equal("Engineering", loadedEntry.Department);

        var loadedChange = await readDb.DemographicSnapshotChanges.SingleAsync(c => c.Id == change.Id);
        Assert.Equal(snapshot.Id, loadedChange.SnapshotId);
        Assert.Equal("\"Engineering\"", loadedChange.NewValue);
    }

    [Fact]
    public async Task Minimal_demographic_snapshot_row_inserted_via_raw_SQL_still_loads_with_DB_level_defaults()
    {
        await using var db = CreateContext();
        await db.Database.MigrateAsync();
        var (company, admin) = await SeedCompanyAndUserAsync(db);

        // A real survey, not a free guid: survey_id is a NOT NULL foreign key since #168, so an
        // invented one is rejected by the database even on this raw-SQL path.
        var survey = new Survey
        {
            Id = Guid.NewGuid(), CompanyId = company.Id, CreatedBy = admin.Id, TitleEn = "Minimal survey",
            Type = "custom", StartDate = DateTimeOffset.UtcNow, EndDate = DateTimeOffset.UtcNow.AddDays(7),
            CreatedAt = DateTimeOffset.UtcNow, UpdatedAt = DateTimeOffset.UtcNow,
        };
        db.Surveys.Add(survey);
        await db.SaveChangesAsync();

        var minimalSnapshotId = Guid.NewGuid();
        var now = DateTimeOffset.UtcNow;
        await db.Database.ExecuteSqlInterpolatedAsync(
            $"""
             INSERT INTO demographic_snapshots ("Id", survey_id, company_id, version, "timestamp", created_by, reason, created_at, updated_at)
             VALUES ({minimalSnapshotId}, {survey.Id}, {company.Id}, {1}, {now}, {admin.Id}, {"Minimal"}, {now}, {now})
             """);

        await using var readDb = CreateContext();
        var loaded = await readDb.DemographicSnapshots.SingleAsync(s => s.Id == minimalSnapshotId);
        Assert.True(loaded.IsActive);
        Assert.Equal(0, loaded.Metadata.TotalUsers);
        Assert.Equal(0, loaded.Metadata.DepartmentsCount);
        Assert.Null(loaded.Metadata.RolesDistribution);
        Assert.Null(loaded.Metadata.TenureDistribution);
    }
}
