using ClimateProject.Domain.Entities;
using ClimateProject.Infrastructure.Persistence;
using ClimateProject.IntegrationTests.Support;
using Microsoft.EntityFrameworkCore;

namespace ClimateProject.IntegrationTests.Persistence;

[Collection("Postgres")]
public class SurveyDraftAndVersionTests(PostgresContainerFixture postgres)
{
    private ClimateProjectDbContext CreateContext()
    {
        var options = new DbContextOptionsBuilder<ClimateProjectDbContext>()
            .UseNpgsql(postgres.ConnectionString)
            .Options;
        return new ClimateProjectDbContext(options);
    }

    private async Task<(Company company, User user, Survey survey)> SeedSurveyAsync(ClimateProjectDbContext db)
    {
        var company = new Company { Id = Guid.NewGuid(), Name = "Acme", CreatedAt = DateTimeOffset.UtcNow };
        var user = new User
        {
            Id = Guid.NewGuid(), CompanyId = company.Id, Email = $"admin-{Guid.NewGuid():N}@acme.test", Name = "Admin",
            Role = "company_admin", CreatedAt = DateTimeOffset.UtcNow, UpdatedAt = DateTimeOffset.UtcNow,
        };
        db.Companies.Add(company);
        db.Users.Add(user);
        await db.SaveChangesAsync();

        var survey = new Survey
        {
            Id = Guid.NewGuid(), CompanyId = company.Id, CreatedBy = user.Id, Title = "Survey", Type = "custom",
            StartDate = DateTimeOffset.UtcNow, EndDate = DateTimeOffset.UtcNow.AddDays(7),
            CreatedAt = DateTimeOffset.UtcNow, UpdatedAt = DateTimeOffset.UtcNow,
        };
        db.Surveys.Add(survey);
        await db.SaveChangesAsync();
        return (company, user, survey);
    }

    [Fact]
    public async Task Draft_round_trips_with_jsonb_scratchpad()
    {
        await using var db = CreateContext();
        await db.Database.MigrateAsync();
        var (company, user, _) = await SeedSurveyAsync(db);

        var draft = new SurveyDraft
        {
            Id = Guid.NewGuid(), UserId = user.Id, CompanyId = company.Id, SessionId = "session-123",
            CurrentStep = 2, AutoSaveCount = 4, Version = 3,
            DraftData = """{"step1_data":{"title":"Draft Title"}}""",
            ExpiresAt = DateTimeOffset.UtcNow.AddDays(7),
            CreatedAt = DateTimeOffset.UtcNow, UpdatedAt = DateTimeOffset.UtcNow,
        };
        db.SurveyDrafts.Add(draft);
        await db.SaveChangesAsync();

        await using var readDb = CreateContext();
        var loaded = await readDb.SurveyDrafts.SingleAsync(d => d.Id == draft.Id);
        Assert.Equal(2, loaded.CurrentStep);
        Assert.Equal(3, loaded.Version);
        Assert.Contains("Draft Title", loaded.DraftData);
        Assert.False(loaded.IsRecovered);
    }

    [Fact]
    public async Task Version_history_round_trips_with_snapshots_and_enforces_unique_version_number()
    {
        await using var db = CreateContext();
        await db.Database.MigrateAsync();
        var (_, user, survey) = await SeedSurveyAsync(db);

        var version = new SurveyVersion
        {
            Id = Guid.NewGuid(), SurveyId = survey.Id, VersionNumber = 1, Title = survey.Title,
            Changes = ["Initial version"], Reason = "Created", CreatedBy = user.Id,
            QuestionsSnapshot = "[]", SettingsSnapshot = "{}",
            CreatedAt = DateTimeOffset.UtcNow,
        };
        db.SurveyVersions.Add(version);
        await db.SaveChangesAsync();

        await using var readDb = CreateContext();
        var loaded = await readDb.SurveyVersions.SingleAsync(v => v.Id == version.Id);
        Assert.Equal(["Initial version"], loaded.Changes);
        Assert.Equal("[]", loaded.QuestionsSnapshot);
        Assert.Null(loaded.DemographicsSnapshot);

        db.SurveyVersions.Add(new SurveyVersion
        {
            Id = Guid.NewGuid(), SurveyId = survey.Id, VersionNumber = 1, Title = survey.Title,
            Reason = "Duplicate version number", CreatedBy = user.Id,
            CreatedAt = DateTimeOffset.UtcNow,
        });
        await Assert.ThrowsAsync<DbUpdateException>(() => db.SaveChangesAsync());
    }

    [Fact]
    public async Task Existing_draft_row_without_new_defaults_still_loads_with_intended_defaults()
    {
        await using var db = CreateContext();
        await db.Database.MigrateAsync();
        var (company, user, _) = await SeedSurveyAsync(db);

        var minimalDraftId = Guid.NewGuid();
        var now = DateTimeOffset.UtcNow;
        await db.Database.ExecuteSqlInterpolatedAsync(
            $"""
             INSERT INTO survey_drafts ("Id", user_id, company_id, session_id, expires_at, created_at, updated_at)
             VALUES ({minimalDraftId}, {user.Id}, {company.Id}, {"sess-1"}, {now.AddDays(7)}, {now}, {now})
             """);

        await using var readDb = CreateContext();
        var loaded = await readDb.SurveyDrafts.SingleAsync(d => d.Id == minimalDraftId);
        Assert.Equal(1, loaded.CurrentStep);
        Assert.Equal(0, loaded.AutoSaveCount);
        Assert.Equal(1, loaded.Version);
        Assert.False(loaded.IsRecovered);
        Assert.Null(loaded.DraftData);
    }
}
