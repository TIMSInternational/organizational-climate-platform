using ClimateProject.Domain.Entities;
using ClimateProject.Infrastructure.Persistence;
using ClimateProject.IntegrationTests.Support;
using Microsoft.EntityFrameworkCore;

namespace ClimateProject.IntegrationTests.Persistence;

[Collection("Postgres")]
public class SurveyDistributionAndInvitationTests(PostgresContainerFixture postgres)
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
            Id = Guid.NewGuid(), CompanyId = company.Id, CreatedBy = user.Id, TitleEn = "Survey", Type = "custom",
            StartDate = DateTimeOffset.UtcNow, EndDate = DateTimeOffset.UtcNow.AddDays(7),
            CreatedAt = DateTimeOffset.UtcNow, UpdatedAt = DateTimeOffset.UtcNow,
        };
        db.Surveys.Add(survey);
        await db.SaveChangesAsync();
        return (company, user, survey);
    }

    [Fact]
    public async Task Distribution_round_trips_with_owned_access_rules_and_qr_customization()
    {
        await using var db = CreateContext();
        await db.Database.MigrateAsync();
        var (_, user, survey) = await SeedSurveyAsync(db);

        var distribution = new SurveyDistribution
        {
            Id = Guid.NewGuid(), SurveyId = survey.Id, QrCodeUrl = "https://example.test/qr/abc",
            AccessRules = new AccessRules { AllowAnonymous = true, AllowedDomains = ["acme.test"] },
            QrCustomization = new QrCustomization { ForegroundColor = "#123456" },
            CreatedAt = DateTimeOffset.UtcNow, UpdatedAt = DateTimeOffset.UtcNow,
        };
        db.SurveyDistributions.Add(distribution);
        await db.SaveChangesAsync();

        await using var readDb = CreateContext();
        var loaded = await readDb.SurveyDistributions.SingleAsync(d => d.SurveyId == survey.Id);
        Assert.Equal("tokenized", loaded.AccessType);
        Assert.True(loaded.AccessRules.AllowAnonymous);
        Assert.True(loaded.AccessRules.RequireLogin);
        Assert.Equal(["acme.test"], loaded.AccessRules.AllowedDomains!);
        Assert.Equal("#123456", loaded.QrCustomization.ForegroundColor);
        Assert.Equal("#FFFFFF", loaded.QrCustomization.BackgroundColor);
        Assert.Equal(300, loaded.QrCustomization.Size);
    }

    [Fact]
    public async Task Invitation_round_trips_and_enforces_unique_token_and_unique_survey_user_pair()
    {
        await using var db = CreateContext();
        await db.Database.MigrateAsync();
        var (company, user, survey) = await SeedSurveyAsync(db);

        var invitation = new SurveyInvitation
        {
            Id = Guid.NewGuid(), SurveyId = survey.Id, UserId = user.Id, CompanyId = company.Id,
            Email = user.Email, InvitationToken = "tok-abc-123",
            ExpiresAt = DateTimeOffset.UtcNow.AddDays(14),
            CreatedAt = DateTimeOffset.UtcNow, UpdatedAt = DateTimeOffset.UtcNow,
        };
        db.SurveyInvitations.Add(invitation);
        await db.SaveChangesAsync();

        await using var readDb = CreateContext();
        var loaded = await readDb.SurveyInvitations.SingleAsync(i => i.Id == invitation.Id);
        Assert.Equal("pending", loaded.Status);
        Assert.Equal(0, loaded.ReminderCount);

        db.SurveyInvitations.Add(new SurveyInvitation
        {
            Id = Guid.NewGuid(), SurveyId = survey.Id, UserId = user.Id, CompanyId = company.Id,
            Email = user.Email, InvitationToken = "tok-different",
            ExpiresAt = DateTimeOffset.UtcNow.AddDays(14),
            CreatedAt = DateTimeOffset.UtcNow, UpdatedAt = DateTimeOffset.UtcNow,
        });
        await Assert.ThrowsAsync<DbUpdateException>(() => db.SaveChangesAsync());
    }

    [Fact]
    public async Task Existing_distribution_row_without_new_owned_defaults_still_loads_with_intended_defaults()
    {
        await using var db = CreateContext();
        await db.Database.MigrateAsync();
        var (_, _, survey) = await SeedSurveyAsync(db);

        var minimalDistributionId = Guid.NewGuid();
        var now = DateTimeOffset.UtcNow;
        await db.Database.ExecuteSqlInterpolatedAsync(
            $"""
             INSERT INTO survey_distributions ("Id", survey_id, qr_code_url, created_at, updated_at)
             VALUES ({minimalDistributionId}, {survey.Id}, {"https://example.test/qr/minimal"}, {now}, {now})
             """);

        await using var readDb = CreateContext();
        var loaded = await readDb.SurveyDistributions.SingleAsync(d => d.Id == minimalDistributionId);
        Assert.Equal("tokenized", loaded.AccessType);
        Assert.True(loaded.AccessRules.RequireLogin);
        Assert.False(loaded.AccessRules.AllowAnonymous);
        Assert.True(loaded.AccessRules.SingleResponse);
        Assert.False(loaded.AccessRules.ActiveOutsideSchedule);
        Assert.Equal("#000000", loaded.QrCustomization.ForegroundColor);
        Assert.Equal("#FFFFFF", loaded.QrCustomization.BackgroundColor);
        Assert.Equal(300, loaded.QrCustomization.Size);
        Assert.Equal(0, loaded.TokenizedLinksGenerated);
        Assert.Equal(0, loaded.TotalAccesses);
    }
}
