using ClimateProject.Domain.Entities;
using ClimateProject.Infrastructure.Persistence;
using ClimateProject.IntegrationTests.Support;
using Microsoft.EntityFrameworkCore;

namespace ClimateProject.IntegrationTests.Persistence;

[Collection("Postgres")]
public class DemographicFieldTests(PostgresContainerFixture postgres)
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
    public async Task DemographicField_round_trips_with_options_array()
    {
        await using var db = CreateContext();
        await db.Database.MigrateAsync();
        var company = await SeedCompanyAsync(db);

        var field = new DemographicField
        {
            Id = Guid.NewGuid(),
            CompanyId = company.Id,
            Field = "gender",
            Label = "Gender",
            Type = "select",
            Options = ["Male", "Female", "Non-binary", "Prefer not to say"],
            Required = true,
            Order = 1,
            CreatedAt = DateTimeOffset.UtcNow,
            UpdatedAt = DateTimeOffset.UtcNow,
        };
        db.DemographicFields.Add(field);
        await db.SaveChangesAsync();

        await using var readDb = CreateContext();
        var loaded = await readDb.DemographicFields.SingleAsync(f => f.Id == field.Id);
        Assert.Equal("select", loaded.Type);
        Assert.NotNull(loaded.Options);
        Assert.Equal(4, loaded.Options!.Count);
        Assert.True(loaded.Required);
    }

    [Fact]
    public async Task Company_field_combination_is_unique()
    {
        await using var db = CreateContext();
        await db.Database.MigrateAsync();
        var company = await SeedCompanyAsync(db);

        db.DemographicFields.Add(new DemographicField
        {
            Id = Guid.NewGuid(), CompanyId = company.Id, Field = "tenure", Label = "Tenure", Type = "text",
            CreatedAt = DateTimeOffset.UtcNow, UpdatedAt = DateTimeOffset.UtcNow,
        });
        await db.SaveChangesAsync();

        db.DemographicFields.Add(new DemographicField
        {
            Id = Guid.NewGuid(), CompanyId = company.Id, Field = "tenure", Label = "Tenure Duplicate", Type = "text",
            CreatedAt = DateTimeOffset.UtcNow, UpdatedAt = DateTimeOffset.UtcNow,
        });

        await Assert.ThrowsAsync<DbUpdateException>(() => db.SaveChangesAsync());
    }

    [Fact]
    public async Task Minimal_demographic_field_row_inserted_via_raw_SQL_still_loads_with_DB_level_defaults()
    {
        await using var db = CreateContext();
        await db.Database.MigrateAsync();
        var company = await SeedCompanyAsync(db);

        var minimalFieldId = Guid.NewGuid();
        var now = DateTimeOffset.UtcNow;
        await db.Database.ExecuteSqlInterpolatedAsync(
            $"""
             INSERT INTO demographic_fields ("Id", company_id, field, label, type, created_at, updated_at)
             VALUES ({minimalFieldId}, {company.Id}, {"location"}, {"Location"}, {"text"}, {now}, {now})
             """);

        await using var readDb = CreateContext();
        var loaded = await readDb.DemographicFields.SingleAsync(f => f.Id == minimalFieldId);
        Assert.False(loaded.Required);
        Assert.Equal(0, loaded.Order);
        Assert.True(loaded.IsActive);
        Assert.Null(loaded.Options);
    }
}
