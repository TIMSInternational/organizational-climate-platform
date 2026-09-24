using ClimateProject.Domain.Entities;
using ClimateProject.Infrastructure.Persistence;
using ClimateProject.IntegrationTests.Support;
using Microsoft.EntityFrameworkCore;

namespace ClimateProject.IntegrationTests.Persistence;

[Collection("Postgres")]
public class CompanyServiceLicenseTests(PostgresContainerFixture postgres)
{
    private ClimateProjectDbContext CreateContext()
    {
        var options = new DbContextOptionsBuilder<ClimateProjectDbContext>()
            .UseNpgsql(postgres.ConnectionString)
            .Options;
        return new ClimateProjectDbContext(options);
    }

    private static async Task<Company> SeedCompanyAsync(ClimateProjectDbContext db)
    {
        var company = new Company { Id = Guid.NewGuid(), Name = "Acme", CreatedAt = DateTimeOffset.UtcNow };
        db.Companies.Add(company);
        await db.SaveChangesAsync();
        return company;
    }

    [Fact]
    public async Task Grant_creates_then_updates_the_single_row_for_a_company_and_service()
    {
        await using var db = CreateContext();
        await db.Database.MigrateAsync();
        var company = await SeedCompanyAsync(db);
        var now = DateTimeOffset.UtcNow;

        var created = await CompanyLicenses.GrantOrUpdateAsync(
            db, company.Id, ClimateServiceTypes.GeneralClimate, seatsTotal: 100, notes: "PO-1", now, default);
        Assert.Equal(100, created.SeatsTotal);
        Assert.Equal(0, created.SeatsUsed);
        Assert.Equal(LicenseStatuses.Active, created.Status);

        var updated = await CompanyLicenses.GrantOrUpdateAsync(
            db, company.Id, ClimateServiceTypes.GeneralClimate, seatsTotal: 250, notes: "PO-2", now.AddMinutes(1), default);
        Assert.Equal(created.Id, updated.Id);
        Assert.Equal(250, updated.SeatsTotal);

        await using var verify = CreateContext();
        var rows = await CompanyLicenses.ListAsync(verify, company.Id, default);
        Assert.Single(rows);
        Assert.Equal(250, rows[0].SeatsTotal);
        Assert.Equal("PO-2", rows[0].Notes);
    }

    [Fact]
    public async Task Consume_spends_a_seat_when_one_is_available()
    {
        await using var db = CreateContext();
        await db.Database.MigrateAsync();
        var company = await SeedCompanyAsync(db);
        var now = DateTimeOffset.UtcNow;
        await CompanyLicenses.GrantOrUpdateAsync(db, company.Id, ClimateServiceTypes.GeneralClimate, 2, null, now, default);

        var first = await CompanyLicenses.TryConsumeSeatAsync(db, company.Id, ClimateServiceTypes.GeneralClimate, now, default);
        var second = await CompanyLicenses.TryConsumeSeatAsync(db, company.Id, ClimateServiceTypes.GeneralClimate, now, default);

        Assert.Equal(SeatConsumeOutcome.Consumed, first);
        Assert.Equal(SeatConsumeOutcome.Consumed, second);

        await using var verify = CreateContext();
        var lic = await verify.CompanyServiceLicenses.AsNoTracking().SingleAsync(l => l.CompanyId == company.Id);
        Assert.Equal(2, lic.SeatsUsed);
    }

    [Fact]
    public async Task Consume_refuses_and_does_not_increment_once_exhausted()
    {
        await using var db = CreateContext();
        await db.Database.MigrateAsync();
        var company = await SeedCompanyAsync(db);
        var now = DateTimeOffset.UtcNow;
        await CompanyLicenses.GrantOrUpdateAsync(db, company.Id, ClimateServiceTypes.Microclimate, 1, null, now, default);

        Assert.Equal(SeatConsumeOutcome.Consumed,
            await CompanyLicenses.TryConsumeSeatAsync(db, company.Id, ClimateServiceTypes.Microclimate, now, default));
        Assert.Equal(SeatConsumeOutcome.Exhausted,
            await CompanyLicenses.TryConsumeSeatAsync(db, company.Id, ClimateServiceTypes.Microclimate, now, default));

        await using var verify = CreateContext();
        var lic = await verify.CompanyServiceLicenses.AsNoTracking().SingleAsync(l => l.CompanyId == company.Id);
        Assert.Equal(1, lic.SeatsUsed);
    }

    [Fact]
    public async Task Consume_refuses_a_suspended_licence()
    {
        await using var db = CreateContext();
        await db.Database.MigrateAsync();
        var company = await SeedCompanyAsync(db);
        var now = DateTimeOffset.UtcNow;
        await CompanyLicenses.GrantOrUpdateAsync(db, company.Id, ClimateServiceTypes.GeneralClimate, 5, null, now, default);
        Assert.True(await CompanyLicenses.SetStatusAsync(db, company.Id, ClimateServiceTypes.GeneralClimate, LicenseStatuses.Suspended, now, default));

        var outcome = await CompanyLicenses.TryConsumeSeatAsync(db, company.Id, ClimateServiceTypes.GeneralClimate, now, default);
        Assert.Equal(SeatConsumeOutcome.Suspended, outcome);

        await using var verify = CreateContext();
        var lic = await verify.CompanyServiceLicenses.AsNoTracking().SingleAsync(l => l.CompanyId == company.Id);
        Assert.Equal(0, lic.SeatsUsed);
    }

    [Fact]
    public async Task Consume_grandfathers_a_company_with_no_licence_row()
    {
        await using var db = CreateContext();
        await db.Database.MigrateAsync();
        var company = await SeedCompanyAsync(db);

        var outcome = await CompanyLicenses.TryConsumeSeatAsync(
            db, company.Id, ClimateServiceTypes.GeneralClimate, DateTimeOffset.UtcNow, default);

        Assert.Equal(SeatConsumeOutcome.NoLicense, outcome);
        Assert.True(outcome.Allows());
    }

    [Fact]
    public async Task Consume_never_meters_a_custom_survey()
    {
        await using var db = CreateContext();
        await db.Database.MigrateAsync();
        var company = await SeedCompanyAsync(db);

        var outcome = await CompanyLicenses.TryConsumeSeatAsync(
            db, company.Id, "custom", DateTimeOffset.UtcNow, default);

        Assert.Equal(SeatConsumeOutcome.NotMetered, outcome);
        Assert.True(outcome.Allows());
    }

    [Fact]
    public async Task Concurrent_completions_never_oversell_the_last_seats()
    {
        await using var setup = CreateContext();
        await setup.Database.MigrateAsync();
        var company = await SeedCompanyAsync(setup);
        await CompanyLicenses.GrantOrUpdateAsync(
            setup, company.Id, ClimateServiceTypes.GeneralClimate, seatsTotal: 3, notes: null, DateTimeOffset.UtcNow, default);

        const int concurrency = 12;
        var tasks = Enumerable.Range(0, concurrency).Select(async _ =>
        {
            await using var ctx = CreateContext();
            return await CompanyLicenses.TryConsumeSeatAsync(
                ctx, company.Id, ClimateServiceTypes.GeneralClimate, DateTimeOffset.UtcNow, default);
        }).ToArray();

        var outcomes = await Task.WhenAll(tasks);

        Assert.Equal(3, outcomes.Count(o => o == SeatConsumeOutcome.Consumed));
        Assert.Equal(concurrency - 3, outcomes.Count(o => o == SeatConsumeOutcome.Exhausted));

        await using var verify = CreateContext();
        var lic = await verify.CompanyServiceLicenses.AsNoTracking().SingleAsync(l => l.CompanyId == company.Id);
        Assert.Equal(3, lic.SeatsUsed);
    }

    // -----------------------------------------------------------------------
    // Release (#496) -- the compensation the microclimate submission path needs,
    // because it has no transaction to roll a seat back for it.
    // -----------------------------------------------------------------------

    [Fact]
    public async Task Release_gives_a_consumed_seat_back()
    {
        await using var db = CreateContext();
        await db.Database.MigrateAsync();
        var company = await SeedCompanyAsync(db);
        var now = DateTimeOffset.UtcNow;
        await CompanyLicenses.GrantOrUpdateAsync(db, company.Id, ClimateServiceTypes.Microclimate, 5, null, now, default);

        Assert.Equal(
            SeatConsumeOutcome.Consumed,
            await CompanyLicenses.TryConsumeSeatAsync(db, company.Id, ClimateServiceTypes.Microclimate, now, default));
        Assert.True(await CompanyLicenses.ReleaseSeatAsync(db, company.Id, ClimateServiceTypes.Microclimate, now, default));

        await using var verify = CreateContext();
        var lic = await verify.CompanyServiceLicenses.AsNoTracking().SingleAsync(l => l.CompanyId == company.Id);
        Assert.Equal(0, lic.SeatsUsed);
    }

    /// <summary>
    /// The guard that stops a release from manufacturing entitlement. Exhaustion is derived from
    /// <c>SeatsUsed &gt;= SeatsTotal</c>, so a negative count is not a harmless off-by-one: it is a
    /// licence reporting free seats nobody bought.
    /// </summary>
    [Fact]
    public async Task Release_cannot_drive_the_seat_count_below_zero()
    {
        await using var db = CreateContext();
        await db.Database.MigrateAsync();
        var company = await SeedCompanyAsync(db);
        var now = DateTimeOffset.UtcNow;
        await CompanyLicenses.GrantOrUpdateAsync(db, company.Id, ClimateServiceTypes.Microclimate, 5, null, now, default);

        // Nothing was ever consumed, so there is nothing to give back -- and saying so is the
        // point: the caller can tell "released" from "there was nothing to release".
        Assert.False(await CompanyLicenses.ReleaseSeatAsync(db, company.Id, ClimateServiceTypes.Microclimate, now, default));

        await using var verify = CreateContext();
        var lic = await verify.CompanyServiceLicenses.AsNoTracking().SingleAsync(l => l.CompanyId == company.Id);
        Assert.Equal(0, lic.SeatsUsed);
    }

    /// <summary>
    /// A licence suspended between the consume and the release must still give the seat back.
    /// Suspension stops new consumption; it is not a reason to keep a seat that bought nothing.
    /// </summary>
    [Fact]
    public async Task Release_works_on_a_licence_suspended_after_the_consume()
    {
        await using var db = CreateContext();
        await db.Database.MigrateAsync();
        var company = await SeedCompanyAsync(db);
        var now = DateTimeOffset.UtcNow;
        await CompanyLicenses.GrantOrUpdateAsync(db, company.Id, ClimateServiceTypes.Microclimate, 5, null, now, default);
        await CompanyLicenses.TryConsumeSeatAsync(db, company.Id, ClimateServiceTypes.Microclimate, now, default);

        await CompanyLicenses.SetStatusAsync(db, company.Id, ClimateServiceTypes.Microclimate, LicenseStatuses.Suspended, now, default);
        Assert.True(await CompanyLicenses.ReleaseSeatAsync(db, company.Id, ClimateServiceTypes.Microclimate, now, default));

        await using var verify = CreateContext();
        var lic = await verify.CompanyServiceLicenses.AsNoTracking().SingleAsync(l => l.CompanyId == company.Id);
        Assert.Equal(0, lic.SeatsUsed);
        Assert.Equal(LicenseStatuses.Suspended, lic.Status);
    }

    [Fact]
    public async Task Release_does_nothing_for_an_unmetered_service_or_a_company_with_no_licence()
    {
        await using var db = CreateContext();
        await db.Database.MigrateAsync();
        var company = await SeedCompanyAsync(db);
        var now = DateTimeOffset.UtcNow;

        Assert.False(await CompanyLicenses.ReleaseSeatAsync(db, company.Id, "custom", now, default));
        Assert.False(await CompanyLicenses.ReleaseSeatAsync(db, company.Id, null, now, default));
        Assert.False(await CompanyLicenses.ReleaseSeatAsync(db, company.Id, ClimateServiceTypes.Microclimate, now, default));
    }

    /// <summary>
    /// Release touches only the service it names. Without this, "releases a seat" and "releases
    /// the right seat" pass identically.
    /// </summary>
    [Fact]
    public async Task Release_is_scoped_to_its_own_service()
    {
        await using var db = CreateContext();
        await db.Database.MigrateAsync();
        var company = await SeedCompanyAsync(db);
        var now = DateTimeOffset.UtcNow;
        await CompanyLicenses.GrantOrUpdateAsync(db, company.Id, ClimateServiceTypes.Microclimate, 5, null, now, default);
        await CompanyLicenses.GrantOrUpdateAsync(db, company.Id, ClimateServiceTypes.GeneralClimate, 5, null, now, default);
        await CompanyLicenses.TryConsumeSeatAsync(db, company.Id, ClimateServiceTypes.Microclimate, now, default);
        await CompanyLicenses.TryConsumeSeatAsync(db, company.Id, ClimateServiceTypes.GeneralClimate, now, default);

        Assert.True(await CompanyLicenses.ReleaseSeatAsync(db, company.Id, ClimateServiceTypes.Microclimate, now, default));

        await using var verify = CreateContext();
        var rows = await CompanyLicenses.ListAsync(verify, company.Id, default);
        Assert.Equal(0, rows.Single(l => l.ServiceType == ClimateServiceTypes.Microclimate).SeatsUsed);
        Assert.Equal(1, rows.Single(l => l.ServiceType == ClimateServiceTypes.GeneralClimate).SeatsUsed);
    }
}
