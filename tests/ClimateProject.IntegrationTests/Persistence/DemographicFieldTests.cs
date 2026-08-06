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
            LabelEn = "Gender",
            Type = "select",
            Required = true,
            Order = 1,
            CreatedAt = DateTimeOffset.UtcNow,
            UpdatedAt = DateTimeOffset.UtcNow,
        };
        db.DemographicFields.Add(field);
        // Options are rows, not an array column (#195): each carries a stable
        // locale-independent value beside its per-language labels.
        string[] values = ["Male", "Female", "Non-binary", "Prefer not to say"];
        for (var order = 0; order < values.Length; order++)
        {
            db.DemographicFieldOptions.Add(new DemographicFieldOption
            {
                DemographicFieldId = field.Id,
                Order = order,
                Value = values[order],
                LabelEn = values[order],
            });
        }

        await db.SaveChangesAsync();

        await using var readDb = CreateContext();
        var loaded = await readDb.DemographicFields.SingleAsync(f => f.Id == field.Id);
        Assert.Equal("select", loaded.Type);
        var options = await readDb.DemographicFieldOptions
            .Where(o => o.DemographicFieldId == field.Id)
            .OrderBy(o => o.Order)
            .ToListAsync();
        Assert.Equal(4, options.Count);
        Assert.Equal(values, options.Select(o => o.Value));
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
            Id = Guid.NewGuid(), CompanyId = company.Id, Field = "tenure", LabelEn = "Tenure", Type = "text",
            CreatedAt = DateTimeOffset.UtcNow, UpdatedAt = DateTimeOffset.UtcNow,
        });
        await db.SaveChangesAsync();

        db.DemographicFields.Add(new DemographicField
        {
            Id = Guid.NewGuid(), CompanyId = company.Id, Field = "tenure", LabelEn = "Tenure Duplicate", Type = "text",
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
             INSERT INTO demographic_fields ("Id", company_id, field, label_en, type, created_at, updated_at)
             VALUES ({minimalFieldId}, {company.Id}, {"location"}, {"Location"}, {"text"}, {now}, {now})
             """);

        await using var readDb = CreateContext();
        var loaded = await readDb.DemographicFields.SingleAsync(f => f.Id == minimalFieldId);
        Assert.False(loaded.Required);
        Assert.Equal(0, loaded.Order);
        Assert.True(loaded.IsActive);
        Assert.Empty(await readDb.DemographicFieldOptions.Where(o => o.DemographicFieldId == minimalFieldId).ToListAsync());
    }
}
