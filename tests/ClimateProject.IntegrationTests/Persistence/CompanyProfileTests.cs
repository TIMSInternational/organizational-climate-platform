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
        await using var db = CreateContext();
        await db.Database.MigrateAsync();

        var minimalCompany = new Company { Id = Guid.NewGuid(), Name = "Minimal Co", CreatedAt = DateTimeOffset.UtcNow };
        db.Companies.Add(minimalCompany);
        await db.SaveChangesAsync();

        await using var readDb = CreateContext();
        var loaded = await readDb.Companies.SingleAsync(c => c.Id == minimalCompany.Id);
        Assert.Null(loaded.Industry);
        Assert.Equal("quarterly", loaded.Settings.SurveyFrequency);
    }
}
