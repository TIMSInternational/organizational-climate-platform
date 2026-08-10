using ClimateProject.Domain.Entities;
using ClimateProject.Infrastructure.Persistence;
using ClimateProject.Infrastructure.Scheduling;
using ClimateProject.IntegrationTests.Support;
using Microsoft.EntityFrameworkCore;

namespace ClimateProject.IntegrationTests.Persistence;

/// <summary>
/// <c>IX_survey_drafts_expires_at</c> (#278), asserted through the planner rather than through
/// <c>pg_indexes</c>.
///
/// <para><b>Why not just assert the index exists.</b> That test passes the moment the migration
/// applies and keeps passing if the sweep's predicate later drifts to something the index cannot
/// serve -- a function on the column, a different comparison, a composite the leading column no
/// longer matches. The defect in #278 was never "no index row in the catalogue", it was "the
/// query the retention job runs is a sequential scan". So these tests run the retention job for
/// real, capture the statements it sends, and assert on the plan Postgres chose for those exact
/// statements with those exact parameters.</para>
///
/// <para><b>Why the row count matters.</b> The planner will happily sequentially scan a table
/// of ten rows however it is indexed, so a test seeded with a handful of drafts cannot tell an
/// index scan from a seq scan -- it would report "no index used" against a perfectly good index.
/// These seed <see cref="RowCount"/> drafts and <c>ANALYZE</c> so the choice is made on real
/// statistics.</para>
///
/// <para><b>Why the drafts are all live.</b> That is the steady state the issue is about: the
/// TTL is 30 days and every autosave pushes <c>expires_at</c> out, so the hourly sweep almost
/// always matches zero rows. Zero matches is the case where the difference is starkest -- an
/// index scan touches a couple of pages to learn there is nothing to do, a seq scan reads the
/// whole table for the same answer.</para>
///
/// <para>Like the other sweep tests, this one truncates first: the retention job takes no
/// company id, so any draft another class left behind is inside the measurement.</para>
/// </summary>
[Collection("Postgres")]
public class SurveyDraftExpiryIndexTests(PostgresContainerFixture postgres)
{
    private const string IndexName = "IX_survey_drafts_expires_at";

    /// <summary>
    /// Enough rows that a sequential scan is measurably the worse plan, and few enough that
    /// seeding them is one statement and a second or so.
    /// </summary>
    private const int RowCount = 20_000;

    /// <summary>Stand-in for the wizard's autosaved scratchpad; nothing here reads it.</summary>
    private const string DraftJson = """{"language":"en"}""";

    private ClimateProjectDbContext CreateContext(ExplainCapturingInterceptor? interceptor = null)
    {
        var builder = new DbContextOptionsBuilder<ClimateProjectDbContext>()
            .UseNpgsql(postgres.ConnectionString);
        if (interceptor is not null)
        {
            builder.AddInterceptors(interceptor);
        }

        return new ClimateProjectDbContext(builder.Options);
    }

    /// <summary>
    /// A truncated table holding <see cref="RowCount"/> unexpired drafts, with statistics
    /// current so the planner is choosing on facts.
    /// </summary>
    private async Task SeedLiveDraftsAsync()
    {
        await using var db = CreateContext();
        await db.Database.MigrateAsync();
        await db.Database.ExecuteSqlRawAsync("TRUNCATE TABLE companies CASCADE");

        var now = DateTimeOffset.UtcNow;
        var company = new Company
        {
            Id = Guid.NewGuid(),
            Name = $"ExpiryIndex-{Guid.NewGuid():N}",
            Settings = new CompanySettings { Timezone = "UTC" },
            CreatedAt = now,
        };
        var user = new User
        {
            Id = Guid.NewGuid(),
            CompanyId = company.Id,
            Email = $"author-{Guid.NewGuid():N}@draft-expiry-index.test",
            Name = "Author",
            Role = "company_admin",
            CreatedAt = now,
            UpdatedAt = now,
        };
        db.Companies.Add(company);
        db.Users.Add(user);
        await db.SaveChangesAsync();

        // Expiries spread across the whole 30-day TTL window rather than all equal, so the
        // column has a real distribution to build statistics from.
        await db.Database.ExecuteSqlInterpolatedAsync(
            $"""
             INSERT INTO survey_drafts
                 ("Id", user_id, company_id, session_id, current_step, auto_save_count,
                  version, expires_at, is_recovered, draft_data, created_at, updated_at)
             SELECT gen_random_uuid(), {user.Id}, {company.Id}, 'bulk-' || g, 1, 0, 1,
                    {now} + make_interval(secs => g * 129), false,
                    {DraftJson}::jsonb, {now}, {now}
             FROM generate_series(1, {RowCount}) AS g
             """);

        await db.Database.ExecuteSqlRawAsync("ANALYZE survey_drafts");
    }

    [Fact]
    public void The_expiry_index_is_declared_on_the_model_and_not_only_in_the_migration()
    {
        // On its own this is the weak test the class docstring warns about, and it is not here
        // to prove the index works -- the plan tests below do that. It is here for a failure the
        // plan tests cannot see: the migration creating an index the model does not declare.
        // `ClimateProjectDbContextModelSnapshot` is generated from the model, so a configuration
        // and a migration that disagree leave the snapshot describing a database that does not
        // exist, and the next `dotnet ef migrations add` on any branch emits a spurious
        // CreateIndex or DropIndex for it.
        //
        // It is not the only guard against that, and the residual claim is narrower than it
        // looks. `MigrateAsync` validates the model against the snapshot itself and throws
        // `PendingModelChangesWarning`, so any test that migrates already fails when the two
        // disagree. Measured: dropping `HasIndex` from SurveyDraftConfiguration with the
        // snapshot left alone failed 9 of 14 in the untouched SurveyDraftRetentionJobTests --
        // exactly its 9 tests that call `MigrateAsync`, every one failing at
        // `Migrator.ValidateMigrations`; the 5 that passed are the ones that never migrate.
        //
        // What is left to this test is the shape that validation is blind to, because it leaves
        // model and snapshot agreeing: both dropping the index while a hand-edited migration
        // still creates it. Nothing then has anything to warn about. Measured: with `HasIndex`
        // removed from the configuration *and* from the snapshot and the migration intact,
        // SurveyDraftRetentionJobTests passed 14 of 14 and this test was the only failure
        // ("Assert.NotNull() Failure: Value is null").
        using var db = CreateContext();

        var index = db.Model
            .FindEntityType(typeof(SurveyDraft))!
            .GetIndexes()
            .SingleOrDefault(i => i.Properties.Count == 1
                && i.Properties[0].Name == nameof(SurveyDraft.ExpiresAt));

        Assert.NotNull(index);
        Assert.Equal(IndexName, index.GetDatabaseName());
    }

    [Fact]
    public async Task The_capped_sweep_harvests_expired_ids_through_the_expiry_index()
    {
        await SeedLiveDraftsAsync();

        var explain = new ExplainCapturingInterceptor("survey_drafts");
        await using var db = CreateContext(explain);

        explain.Enabled = true;
        var result = await SurveyDraftRetentionJob.PurgeAsync(
            db, DateTimeOffset.UtcNow, SurveyDraftRetentionJob.DefaultBatchSize, default);
        explain.Enabled = false;

        // Steady state: nothing is expired, which is exactly when a seq scan is pure waste.
        Assert.Equal(0, result.Deleted);

        var harvest = explain.Single("SELECT");
        Assert.Contains("expires_at <=", harvest.Sql, StringComparison.Ordinal);
        Assert.True(
            harvest.Uses(IndexName),
            $"The sweep's harvest did not use {IndexName}.\n{harvest.Sql}\n{harvest.Plan}");
        Assert.False(
            harvest.SequentiallyScans("survey_drafts"),
            $"The sweep's harvest sequentially scanned survey_drafts.\n{harvest.Sql}\n{harvest.Plan}");
    }

    [Fact]
    public async Task The_uncapped_delete_behind_the_manual_route_uses_the_expiry_index()
    {
        // DELETE /surveys/drafts/expired runs PurgeAsync with no cap, which is a single
        // `DELETE ... WHERE expires_at <= $1` rather than the harvest-then-delete pair. It is a
        // different statement with a different plan, so it needs its own assertion; EXPLAIN
        // without ANALYZE plans it without running it, so nothing here is actually deleted.
        await SeedLiveDraftsAsync();

        var explain = new ExplainCapturingInterceptor("survey_drafts");
        await using var db = CreateContext(explain);

        explain.Enabled = true;
        var result = await SurveyDraftRetentionJob.PurgeAsync(
            db, DateTimeOffset.UtcNow, maxRows: null, default);
        explain.Enabled = false;

        Assert.Equal(0, result.Deleted);

        var delete = explain.Single("DELETE");
        Assert.True(
            delete.Uses(IndexName),
            $"The uncapped sweep did not use {IndexName}.\n{delete.Sql}\n{delete.Plan}");
        Assert.False(
            delete.SequentiallyScans("survey_drafts"),
            $"The uncapped sweep sequentially scanned survey_drafts.\n{delete.Sql}\n{delete.Plan}");
    }

    [Fact]
    public async Task The_sweep_still_finds_expired_rows_among_many_live_ones()
    {
        // The plan assertions above are all made against a query that matches nothing, so on
        // their own they would still pass if the predicate had been broken into one that can
        // never be true. This drops three expired drafts into the same 20k-row table and
        // requires the sweep to return exactly those, so "uses the index" cannot be bought by
        // "matches nothing".
        await SeedLiveDraftsAsync();

        await using var db = CreateContext();
        var live = await db.SurveyDrafts.FirstAsync();
        var now = DateTimeOffset.UtcNow;
        await db.Database.ExecuteSqlInterpolatedAsync(
            $"""
             INSERT INTO survey_drafts
                 ("Id", user_id, company_id, session_id, current_step, auto_save_count,
                  version, expires_at, is_recovered, draft_data, created_at, updated_at)
             SELECT gen_random_uuid(), {live.UserId}, {live.CompanyId}, 'expired-' || g, 1, 0, 1,
                    {now} - make_interval(days => g), false,
                    {DraftJson}::jsonb, {now}, {now}
             FROM generate_series(1, 3) AS g
             """);

        var result = await SurveyDraftRetentionJob.PurgeAsync(
            db, now, SurveyDraftRetentionJob.DefaultBatchSize, default);

        Assert.Equal(3, result.Deleted);
        Assert.False(result.MoreRemaining);

        await using var read = CreateContext();
        Assert.Equal(RowCount, await read.SurveyDrafts.CountAsync());
    }
}
