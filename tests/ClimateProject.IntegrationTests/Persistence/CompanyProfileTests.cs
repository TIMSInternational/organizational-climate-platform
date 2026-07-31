using ClimateProject.Domain.Entities;
using ClimateProject.Infrastructure.Persistence;
using ClimateProject.IntegrationTests.Support;
using Microsoft.EntityFrameworkCore;

namespace ClimateProject.IntegrationTests.Persistence;

[Collection("Postgres")]
public class CompanyProfileTests(PostgresContainerFixture postgres)
{
    private ClimateProjectDbContext CreateContext()
    {
        var options = new DbContextOptionsBuilder<ClimateProjectDbContext>()
            .UseNpgsql(postgres.ConnectionString)
            .Options;
        return new ClimateProjectDbContext(options);
    }

    [Fact]
    public async Task Company_profile_fields_and_owned_types_round_trip()
    {
        await using var db = CreateContext();
        await db.Database.MigrateAsync();

        var company = new Company
        {
            Id = Guid.NewGuid(),
            Name = "Acme Corp",
            Industry = "Software",
            Size = "enterprise",
            Country = "Costa Rica",
            SubscriptionTier = "professional",
            Branding = new CompanyBranding { LogoUrl = "https://example.test/logo.png" },
            Settings = new CompanySettings { SurveyFrequency = "monthly", AnonymousSurveys = true },
            CreatedAt = DateTimeOffset.UtcNow,
        };
        db.Companies.Add(company);
        await db.SaveChangesAsync();

        await using var readDb = CreateContext();
        var loaded = await readDb.Companies.SingleAsync(c => c.Id == company.Id);
        Assert.Equal("enterprise", loaded.Size);
        Assert.Equal("professional", loaded.SubscriptionTier);
        Assert.Equal("https://example.test/logo.png", loaded.Branding.LogoUrl);
        Assert.Equal("#3B82F6", loaded.Branding.PrimaryColor);
        Assert.Equal("monthly", loaded.Settings.SurveyFrequency);
        Assert.True(loaded.Settings.AnonymousSurveys);
    }

    [Fact]
    public async Task Existing_company_without_new_fields_still_loads_with_defaults()
    {
        // Simulates a row that existed BEFORE this migration ran (e.g. #48 seed/testing data):
        // run the migration first, then insert a row via raw SQL that only sets the pre-migration
        // (#48-era) columns, leaving every new column to whatever the DB-level column default is.
        // Reading it back via EF must show the intended domain defaults, proving those defaults are
        // baked into the migration's AddColumn calls (defaultValue: ...) rather than only existing as
        // C# object-initializer defaults that a legacy row would never pick up.
        await using var db = CreateContext();
        await db.Database.MigrateAsync();

        var minimalCompanyId = Guid.NewGuid();
        await db.Database.ExecuteSqlInterpolatedAsync(
            $"""
             INSERT INTO companies ("Id", name, created_at)
             VALUES ({minimalCompanyId}, {"Minimal Co"}, {DateTimeOffset.UtcNow})
             """);

        await using var readDb = CreateContext();
        var loaded = await readDb.Companies.SingleAsync(c => c.Id == minimalCompanyId);
        Assert.Null(loaded.Industry);
        Assert.Null(loaded.Size);
        Assert.Null(loaded.Country);
        Assert.Null(loaded.SubscriptionTier);
        Assert.Equal("quarterly", loaded.Settings.SurveyFrequency);
        Assert.True(loaded.Settings.MicroclimateEnabled);
        Assert.True(loaded.Settings.AiInsightsEnabled);
        Assert.False(loaded.Settings.AnonymousSurveys);
        Assert.Equal(2555, loaded.Settings.DataRetentionDays);
        Assert.Equal("UTC", loaded.Settings.Timezone);
        Assert.Equal("en", loaded.Settings.Language);
        Assert.Equal("#3B82F6", loaded.Branding.PrimaryColor);
        Assert.Equal("#1F2937", loaded.Branding.SecondaryColor);
        Assert.Equal("Inter", loaded.Branding.FontFamily);
        Assert.Null(loaded.Branding.LogoUrl);
        Assert.Null(loaded.Branding.CustomCss);
    }
}
