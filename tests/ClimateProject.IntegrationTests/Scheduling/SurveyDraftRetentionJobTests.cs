using ClimateProject.Application.Scheduling;
using ClimateProject.Domain.Entities;
using ClimateProject.Infrastructure.Persistence;
using ClimateProject.Infrastructure.Scheduling;
using ClimateProject.IntegrationTests.Support;
using ClimateProject.Workers;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;

namespace ClimateProject.IntegrationTests.Scheduling;

/// <summary>
/// The draft retention sweep (#272) against a real Postgres.
///
/// <para>The claim under test is specifically that an expired draft is <b>gone</b>, not merely
/// hidden. Every read filters on <c>expires_at &gt; now</c>, so an assertion made through the
/// API would pass identically whether the sweep deleted the row or did nothing at all -- which
/// is exactly how this went unnoticed. So these tests count rows in the table directly.</para>
///
/// <para>Like the other deployment-wide sweeps in this assembly, this one takes no company id,
/// so any expired draft another test left behind is inside the measurement. Hence
/// <c>TRUNCATE companies CASCADE</c> before each test, the same isolation
/// <c>SchedulingJobTests</c> uses and for the same reason; the collection serialises us
/// against every other Postgres-backed class.</para>
/// </summary>
[Collection("Postgres")]
public class SurveyDraftRetentionJobTests(PostgresContainerFixture postgres)
{
    private ClimateProjectDbContext CreateContext()
        => new(new DbContextOptionsBuilder<ClimateProjectDbContext>()
            .UseNpgsql(postgres.ConnectionString)
            .Options);

    private async Task<ClimateProjectDbContext> FreshAsync()
    {
        var db = CreateContext();
        await db.Database.MigrateAsync();
        await db.Database.ExecuteSqlRawAsync("TRUNCATE TABLE companies CASCADE");
        return db;
    }

    private static async Task<(Guid CompanyId, Guid UserId)> SeedAuthorAsync(ClimateProjectDbContext db)
    {
        var now = DateTimeOffset.UtcNow;
        var company = new Company
        {
            Id = Guid.NewGuid(),
            Name = $"Retention-{Guid.NewGuid():N}",
            Settings = new CompanySettings { Timezone = "UTC" },
            CreatedAt = now,
        };
        var user = new User
        {
            Id = Guid.NewGuid(),
            CompanyId = company.Id,
            // Own email domain: companies.email_domain has a filtered unique index and this
            // class shares its database with every other integration test.
            Email = $"author-{Guid.NewGuid():N}@draft-retention.test",
            Name = "Author",
            Role = "company_admin",
            CreatedAt = now,
            UpdatedAt = now,
        };

        db.Companies.Add(company);
        db.Users.Add(user);
        await db.SaveChangesAsync();

        return (company.Id, user.Id);
    }

    private static SurveyDraft NewDraft(Guid companyId, Guid userId, DateTimeOffset expiresAt)
    {
        var now = DateTimeOffset.UtcNow;
        return new SurveyDraft
        {
            Id = Guid.NewGuid(),
            UserId = userId,
            CompanyId = companyId,
            SessionId = Guid.NewGuid().ToString("N"),
            CurrentStep = 1,
            Version = 1,
            ExpiresAt = expiresAt,
            DraftData = """{"language":"en","title":{"en":"Draft"}}""",
            CreatedAt = now,
            UpdatedAt = now,
        };
    }

    // -- the sweep ----------------------------------------------------------------------

    [Fact]
    public async Task The_sweep_deletes_expired_drafts_and_leaves_live_ones()
    {
        await using var db = await FreshAsync();
        var (companyId, userId) = await SeedAuthorAsync(db);

        var now = DateTimeOffset.UtcNow;
        var expired = NewDraft(companyId, userId, now.AddDays(-1));
        var live = NewDraft(companyId, userId, now.AddDays(29));
        db.SurveyDrafts.AddRange(expired, live);
        await db.SaveChangesAsync();

        var result = await SurveyDraftRetentionJob.RunAsync(
            db, NullLoggerFactory.Instance, now, SurveyDraftRetentionJob.DefaultBatchSize, default);

        Assert.Equal(1, result.Deleted);
        Assert.False(result.MoreRemaining);

        // Read on a second context so the answer comes from the table, not the change tracker.
        await using var read = CreateContext();
        Assert.False(await read.SurveyDrafts.AnyAsync(d => d.Id == expired.Id));
        Assert.True(await read.SurveyDrafts.AnyAsync(d => d.Id == live.Id));
    }

    [Fact]
    public async Task A_draft_expiring_exactly_now_is_reclaimed()
    {
        // The boundary the read filters draw: `expires_at > now` hides a draft whose expiry is
        // exactly now, so the sweep has to take it. If the two disagreed by one instant there
        // would be a row that is invisible forever and reclaimable never.
        await using var db = await FreshAsync();
        var (companyId, userId) = await SeedAuthorAsync(db);

        var now = DateTimeOffset.UtcNow;
        var boundary = NewDraft(companyId, userId, now);
        db.SurveyDrafts.Add(boundary);
        await db.SaveChangesAsync();

        var result = await SurveyDraftRetentionJob.RunAsync(
            db, NullLoggerFactory.Instance, now, SurveyDraftRetentionJob.DefaultBatchSize, default);

        Assert.Equal(1, result.Deleted);

        await using var read = CreateContext();
        Assert.False(await read.SurveyDrafts.AnyAsync(d => d.Id == boundary.Id));
    }

    [Fact]
    public async Task A_second_sweep_over_the_same_rows_does_nothing()
    {
        // Idempotence is what makes a missed tick free, and it is why the cadence can be
        // chosen for transaction size rather than for correctness.
        await using var db = await FreshAsync();
        var (companyId, userId) = await SeedAuthorAsync(db);

        var now = DateTimeOffset.UtcNow;
        db.SurveyDrafts.Add(NewDraft(companyId, userId, now.AddDays(-1)));
        await db.SaveChangesAsync();

        Assert.Equal(1, (await SurveyDraftRetentionJob.RunAsync(
            db, NullLoggerFactory.Instance, now, SurveyDraftRetentionJob.DefaultBatchSize, default)).Deleted);

        var again = await SurveyDraftRetentionJob.RunAsync(
            db, NullLoggerFactory.Instance, now, SurveyDraftRetentionJob.DefaultBatchSize, default);

        Assert.Equal(0, again.Deleted);
        Assert.False(again.MoreRemaining);
    }

    [Fact]
    public async Task A_capped_run_takes_only_its_cap_and_the_next_one_takes_the_rest()
    {
        // The cap is asserted by count, not by which rows went: the sweep is deliberately
        // unordered, since every row in the set is already invisible and ordering it would
        // force a full scan plus a sort to produce a difference nobody can see.
        await using var db = await FreshAsync();
        var (companyId, userId) = await SeedAuthorAsync(db);

        var now = DateTimeOffset.UtcNow;
        db.SurveyDrafts.AddRange(
            NewDraft(companyId, userId, now.AddDays(-3)),
            NewDraft(companyId, userId, now.AddDays(-2)),
            NewDraft(companyId, userId, now.AddDays(-1)));
        await db.SaveChangesAsync();

        var first = await SurveyDraftRetentionJob.RunAsync(
            db, NullLoggerFactory.Instance, now, batchSize: 2, default);

        Assert.Equal(2, first.Deleted);
        Assert.True(first.MoreRemaining);

        await using (var read = CreateContext())
        {
            Assert.Equal(1, await read.SurveyDrafts.CountAsync());
        }

        // The next tick takes the rest -- a backlog drains over ticks, it is not abandoned.
        var second = await SurveyDraftRetentionJob.RunAsync(
            db, NullLoggerFactory.Instance, now, batchSize: 2, default);

        Assert.Equal(1, second.Deleted);
        Assert.False(second.MoreRemaining);
        await using var after = CreateContext();
        Assert.Equal(0, await after.SurveyDrafts.CountAsync());
    }

    [Fact]
    public async Task A_backlog_of_exactly_the_cap_does_not_claim_that_more_remain()
    {
        // `MoreRemaining` was `ids.Count == cap`, which is true both when the cap bit and when
        // the backlog happened to land exactly on it. The second case is the one where there is
        // nothing left, so the log line said a backlog was draining when it had just finished.
        await using var db = await FreshAsync();
        var (companyId, userId) = await SeedAuthorAsync(db);

        var now = DateTimeOffset.UtcNow;
        db.SurveyDrafts.AddRange(
            NewDraft(companyId, userId, now.AddDays(-2)),
            NewDraft(companyId, userId, now.AddDays(-1)));
        await db.SaveChangesAsync();

        var result = await SurveyDraftRetentionJob.RunAsync(
            db, NullLoggerFactory.Instance, now, batchSize: 2, default);

        Assert.Equal(2, result.Deleted);
        Assert.False(result.MoreRemaining);

        await using var read = CreateContext();
        Assert.Equal(0, await read.SurveyDrafts.CountAsync());
    }

    [Fact]
    public async Task A_live_draft_is_not_counted_against_the_cap()
    {
        // The cap applies to the expired set, not to the table. Reading ids off the unfiltered
        // table and capping afterwards would let live drafts crowd expired ones out of a tick
        // and, at a small cap, stall the sweep permanently.
        await using var db = await FreshAsync();
        var (companyId, userId) = await SeedAuthorAsync(db);

        var now = DateTimeOffset.UtcNow;
        db.SurveyDrafts.AddRange(
            NewDraft(companyId, userId, now.AddDays(29)),
            NewDraft(companyId, userId, now.AddDays(28)),
            NewDraft(companyId, userId, now.AddDays(-1)));
        await db.SaveChangesAsync();

        var result = await SurveyDraftRetentionJob.RunAsync(
            db, NullLoggerFactory.Instance, now, batchSize: 2, default);

        Assert.Equal(1, result.Deleted);
        Assert.False(result.MoreRemaining);

        await using var read = CreateContext();
        Assert.Equal(2, await read.SurveyDrafts.CountAsync());
    }

    [Fact]
    public async Task The_uncapped_sweep_the_manual_route_uses_clears_everything_in_one_pass()
    {
        await using var db = await FreshAsync();
        var (companyId, userId) = await SeedAuthorAsync(db);

        var now = DateTimeOffset.UtcNow;
        for (var i = 1; i <= 5; i++)
        {
            db.SurveyDrafts.Add(NewDraft(companyId, userId, now.AddDays(-i)));
        }

        await db.SaveChangesAsync();

        var result = await SurveyDraftRetentionJob.PurgeAsync(db, now, maxRows: null, default);

        Assert.Equal(5, result.Deleted);
        Assert.False(result.MoreRemaining);
        await using var read = CreateContext();
        Assert.Equal(0, await read.SurveyDrafts.CountAsync());
    }

    // -- the schedule -------------------------------------------------------------------

    [Fact]
    public async Task One_tick_of_the_worker_reclaims_expired_drafts()
    {
        // The whole point of the issue: not "the sweep works when called" -- it always did --
        // but that something calls it without a human. This drives the real BackgroundService
        // through one tick, lease and all, exactly as the timer would.
        await using (var seed = await FreshAsync())
        {
            var (companyId, userId) = await SeedAuthorAsync(seed);
            seed.SurveyDrafts.Add(NewDraft(companyId, userId, DateTimeOffset.UtcNow.AddDays(-1)));
            seed.SurveyDrafts.Add(NewDraft(companyId, userId, DateTimeOffset.UtcNow.AddDays(29)));
            await seed.SaveChangesAsync();
        }

        await using var provider = BuildWorkerHost();
        var worker = provider.GetServices<IHostedService>().OfType<SurveyDraftRetentionWorker>().Single();

        await worker.TickAsync(default);

        await using var read = CreateContext();
        var remaining = await read.SurveyDrafts.ToListAsync();
        Assert.Single(remaining);
        Assert.True(remaining[0].ExpiresAt > DateTimeOffset.UtcNow);
    }

    [Fact]
    public async Task The_worker_tick_honours_the_configured_batch_size()
    {
        // Configuration is only wired if something reads it. Asserting the option's value --
        // which the test below this one does -- passes identically whether the worker passes
        // `_batchSize` to the job or a hard-coded 1000, and a cap nobody honours is exactly the
        // unbounded transaction the cap exists to prevent. So this asserts through the rows:
        // three expired drafts, a cap of two, one tick, one survivor.
        await using (var seed = await FreshAsync())
        {
            var (companyId, userId) = await SeedAuthorAsync(seed);
            var expiry = DateTimeOffset.UtcNow.AddDays(-1);
            seed.SurveyDrafts.AddRange(
                NewDraft(companyId, userId, expiry),
                NewDraft(companyId, userId, expiry),
                NewDraft(companyId, userId, expiry));
            await seed.SaveChangesAsync();
        }

        await using var provider = BuildWorkerHost(("Scheduling:SurveyDraftRetentionBatchSize", "2"));
        var worker = provider.GetServices<IHostedService>().OfType<SurveyDraftRetentionWorker>().Single();

        await worker.TickAsync(default);

        await using (var afterFirst = CreateContext())
        {
            Assert.Equal(1, await afterFirst.SurveyDrafts.CountAsync());
        }

        // And the leftover is not stranded: the next tick takes it, which is what makes a cap
        // a bound on one transaction rather than a bound on what the sweep will ever reclaim.
        await worker.TickAsync(default);

        await using var afterSecond = CreateContext();
        Assert.Equal(0, await afterSecond.SurveyDrafts.CountAsync());
    }

    [Fact]
    public void The_retention_worker_is_registered_and_ticks_hourly()
    {
        // Registration is the failure mode with no symptom: the job class can be perfect and
        // the rows still accumulate if nothing ever constructs it. The interval is asserted
        // here too so the cadence in the design doc cannot silently drift from the code.
        using var provider = BuildWorkerHost();
        var worker = provider.GetServices<IHostedService>().OfType<SurveyDraftRetentionWorker>().Single();

        Assert.Equal(WorkerJobs.SurveyDraftRetention, worker.JobName);
        Assert.Equal(TimeSpan.FromHours(1), worker.Interval);
    }

    [Fact]
    public void Every_named_job_has_a_lock_key_of_its_own()
    {
        // Adding a job name adds a lock key. Two jobs sharing one would block each other
        // forever with no error anywhere.
        var keys = WorkerJobs.All.Select(DeterministicNotificationId.LockKey).ToList();

        Assert.Contains(WorkerJobs.SurveyDraftRetention, WorkerJobs.All);
        Assert.Equal(WorkerJobs.All.Length, keys.Distinct().Count());
    }

    private ServiceProvider BuildWorkerHost(params (string Key, string Value)[] settings)
    {
        var services = new ServiceCollection();
        services.AddLogging();
        services.AddDbContext<ClimateProjectDbContext>(options => options.UseNpgsql(postgres.ConnectionString));
        services.AddClimateProjectScheduling(new ConfigurationBuilder()
            .AddInMemoryCollection(settings.ToDictionary(s => s.Key, s => (string?)s.Value))
            .Build());

        // Every other job in the host would otherwise need its own collaborators; only the
        // retention worker is resolved here, and its scope needs nothing but the context and
        // the lease that AddClimateProjectScheduling already registered.
        return services.BuildServiceProvider();
    }

    [Fact]
    public void A_zero_retention_interval_is_refused_at_startup_rather_than_inside_a_timer()
    {
        // PeriodicTimer throws on a non-positive interval, from a background thread, where the
        // exception stops one job and leaves the host looking healthy.
        var configuration = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["Scheduling:SurveyDraftRetentionInterval"] = "00:00:00",
            })
            .Build();

        var services = new ServiceCollection();

        Assert.Throws<InvalidOperationException>(() => services.AddClimateProjectScheduling(configuration));
    }

    [Fact]
    public void The_options_carry_the_documented_hourly_default()
    {
        var options = new WorkerSchedulingOptions();

        Assert.Equal(TimeSpan.FromHours(1), options.SurveyDraftRetentionInterval);
        Assert.Equal(SurveyDraftRetentionJob.DefaultBatchSize, options.SurveyDraftRetentionBatchSize);
    }

    [Fact]
    public void The_configured_interval_and_batch_size_are_honoured()
    {
        var configuration = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["Scheduling:SurveyDraftRetentionInterval"] = "06:00:00",
                ["Scheduling:SurveyDraftRetentionBatchSize"] = "7",
            })
            .Build();

        var services = new ServiceCollection();
        services.AddLogging();
        services.AddDbContext<ClimateProjectDbContext>(options => options.UseNpgsql(postgres.ConnectionString));
        services.AddClimateProjectScheduling(configuration);

        using var provider = services.BuildServiceProvider();
        var worker = provider.GetServices<IHostedService>().OfType<SurveyDraftRetentionWorker>().Single();

        Assert.Equal(TimeSpan.FromHours(6), worker.Interval);
        Assert.Equal(7, provider.GetRequiredService<IOptions<WorkerSchedulingOptions>>()
            .Value.SurveyDraftRetentionBatchSize);
    }
}
