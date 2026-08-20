using ClimateProject.Api.Infrastructure.Auditing;
using ClimateProject.Application.Scheduling;
using ClimateProject.Application.Surveys;
using ClimateProject.Domain.Entities;
using ClimateProject.Infrastructure.Persistence;
using ClimateProject.Infrastructure.Scheduling;
using ClimateProject.IntegrationTests.Support;
using ClimateProject.Workers;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;

namespace ClimateProject.IntegrationTests.Scheduling;

/// <summary>
/// The survey lifecycle sweep against a real Postgres.
///
/// <para>The claim under test is that <c>surveys.status</c> is <b>written</b>, because status is
/// the only thing anything reads: <c>SurveyStatuses.AcceptsResponses</c> is
/// <c>status == active</c> and the submit endpoint checks nothing else, so a survey whose dates
/// have arrived and whose status has not is indistinguishable from one nobody scheduled. That
/// is precisely why this went unnoticed for the whole life of the product.</para>
///
/// <para>Half of these tests assert that nothing happened. A job that changes a status on live
/// customer data is judged mostly by what it refuses, and every refusal here is a row an
/// administrator would notice having moved: a draft that went live untranslated, a mis-dated
/// survey whose only route back to draft was taken away, a closed survey reopened.</para>
///
/// <para>Like the other deployment-wide sweeps in this assembly this one takes no company id,
/// so a survey another test left behind is inside the measurement. Hence
/// <c>TRUNCATE companies CASCADE</c> before each test, the isolation
/// <c>SchedulingJobTests</c> established and for the same reason.</para>
/// </summary>
[Collection("Postgres")]
public class SurveyLifecycleJobTests(PostgresContainerFixture postgres)
{
    private static readonly DateTimeOffset Now = new(2026, 8, 19, 12, 0, 0, TimeSpan.Zero);

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

    private static async Task<(Guid CompanyId, Guid UserId)> SeedTenantAsync(ClimateProjectDbContext db)
    {
        var company = new Company
        {
            Id = Guid.NewGuid(),
            Name = $"Lifecycle-{Guid.NewGuid():N}",
            Settings = new CompanySettings { Timezone = "UTC" },
            CreatedAt = Now,
        };

        var user = new User
        {
            Id = Guid.NewGuid(),
            CompanyId = company.Id,
            // Own e-mail domain: companies.email_domain has a filtered unique index and this
            // class shares its database with every other integration test.
            Email = $"author-{Guid.NewGuid():N}@survey-lifecycle.test",
            Name = "Author",
            Role = "company_admin",
            CreatedAt = Now,
            UpdatedAt = Now,
        };

        db.Companies.Add(company);
        db.Users.Add(user);
        await db.SaveChangesAsync();

        return (company.Id, user.Id);
    }

    private static Survey NewSurvey(
        Guid companyId,
        Guid createdBy,
        string status,
        DateTimeOffset startDate,
        DateTimeOffset endDate) => new()
        {
            Id = Guid.NewGuid(),
            CompanyId = companyId,
            CreatedBy = createdBy,
            TitleEn = "Q3 Climate Survey",
            TitleEs = "Encuesta de Clima Q3",
            Language = "both",
            Type = "custom",
            Status = status,
            StartDate = startDate,
            EndDate = endDate,
            CreatedAt = startDate.AddDays(-7),
            UpdatedAt = startDate.AddDays(-7),
        };

    private static Task<SurveyLifecycleSweepResult> SweepAsync(ClimateProjectDbContext db)
        => SurveyLifecycleJob.RunAsync(
            db, NullLoggerFactory.Instance, Now, SurveyLifecycleJob.DefaultBatchSize, default);

    private async Task<string> StatusOfAsync(Guid surveyId)
    {
        // A second context, so the answer comes from the table rather than the change tracker.
        await using var read = CreateContext();
        return await read.Surveys.Where(s => s.Id == surveyId).Select(s => s.Status).SingleAsync();
    }

    // -- opening -------------------------------------------------------------------------

    [Fact]
    public async Task A_scheduled_survey_opens_once_its_start_date_has_passed()
    {
        await using var db = await FreshAsync();
        var (companyId, userId) = await SeedTenantAsync(db);

        var due = NewSurvey(companyId, userId, SurveyStatuses.Scheduled, Now.AddDays(-1), Now.AddDays(20));
        var notYet = NewSurvey(companyId, userId, SurveyStatuses.Scheduled, Now.AddDays(1), Now.AddDays(20));
        db.Surveys.AddRange(due, notYet);
        await db.SaveChangesAsync();

        var result = await SweepAsync(db);

        Assert.Equal(1, result.Opened);
        Assert.Equal(0, result.Closed);
        Assert.Equal(SurveyStatuses.Active, await StatusOfAsync(due.Id));
        Assert.Equal(SurveyStatuses.Scheduled, await StatusOfAsync(notYet.Id));
    }

    // -- closing -------------------------------------------------------------------------

    [Fact]
    public async Task An_active_survey_closes_once_its_end_date_has_passed()
    {
        await using var db = await FreshAsync();
        var (companyId, userId) = await SeedTenantAsync(db);

        var over = NewSurvey(companyId, userId, SurveyStatuses.Active, Now.AddDays(-30), Now.AddDays(-1));
        var running = NewSurvey(companyId, userId, SurveyStatuses.Active, Now.AddDays(-30), Now.AddDays(1));
        db.Surveys.AddRange(over, running);
        await db.SaveChangesAsync();

        var result = await SweepAsync(db);

        Assert.Equal(1, result.Closed);
        Assert.Equal(0, result.Opened);
        Assert.Equal(SurveyStatuses.Closed, await StatusOfAsync(over.Id));
        Assert.Equal(SurveyStatuses.Active, await StatusOfAsync(running.Id));
    }

    /// <summary>
    /// The product consequence, asserted through the predicate the whole response path actually
    /// reads. Asserting the status string alone would pass identically if <c>closed</c> still
    /// accepted responses, and "the status moved" is not the thing anybody wanted.
    /// </summary>
    [Fact]
    public async Task Closing_is_what_stops_the_survey_accepting_responses()
    {
        await using var db = await FreshAsync();
        var (companyId, userId) = await SeedTenantAsync(db);

        var survey = NewSurvey(companyId, userId, SurveyStatuses.Active, Now.AddDays(-30), Now.AddDays(-1));
        db.Surveys.Add(survey);
        await db.SaveChangesAsync();

        Assert.True(SurveyStatuses.AcceptsResponses(await StatusOfAsync(survey.Id)));

        await SweepAsync(db);

        Assert.False(SurveyStatuses.AcceptsResponses(await StatusOfAsync(survey.Id)));
    }

    // -- the refusals ---------------------------------------------------------------------

    /// <summary>
    /// A draft's start date is whatever the authoring wizard defaulted, and the publish gate --
    /// translations, at least one question, the <c>survey_versions</c> snapshot -- lives in the
    /// endpoint, not here. Opening one would put untranslated, unfinished content in front of
    /// respondents with no way back, since there is no <c>active -&gt; draft</c> edge.
    /// </summary>
    [Fact]
    public async Task A_draft_whose_start_date_has_passed_is_left_alone()
    {
        await using var db = await FreshAsync();
        var (companyId, userId) = await SeedTenantAsync(db);

        var draft = NewSurvey(companyId, userId, SurveyStatuses.Draft, Now.AddDays(-5), Now.AddDays(20));
        db.Surveys.Add(draft);
        await db.SaveChangesAsync();

        var result = await SweepAsync(db);

        Assert.Equal(0, result.Opened);
        Assert.Equal(SurveyStatuses.Draft, await StatusOfAsync(draft.Id));
    }

    /// <summary>
    /// <c>scheduled -&gt; closed</c> is legal in the transition map and is still refused:
    /// <c>scheduled</c> is the only status this survey can be returned to draft and re-dated
    /// from, so closing it would tidy the row and remove the fix. It is reported instead.
    /// </summary>
    [Fact]
    public async Task A_scheduled_survey_whose_window_elapsed_stays_scheduled_and_is_reported()
    {
        await using var db = await FreshAsync();
        var (companyId, userId) = await SeedTenantAsync(db);

        var stranded = NewSurvey(companyId, userId, SurveyStatuses.Scheduled, Now.AddDays(-30), Now.AddDays(-1));
        db.Surveys.Add(stranded);
        await db.SaveChangesAsync();

        var result = await SweepAsync(db);

        Assert.Equal(0, result.Opened);
        Assert.Equal(0, result.Closed);
        Assert.Equal(1, result.Stranded);
        Assert.Equal(SurveyStatuses.Scheduled, await StatusOfAsync(stranded.Id));

        // And no audit row: nothing happened, and a row claiming otherwise would be worse than
        // the silence it was written to break.
        await using var read = CreateContext();
        Assert.Equal(0, await read.AuditLogs.CountAsync());
    }

    [Fact]
    public async Task A_closed_or_archived_survey_is_never_touched_whatever_its_dates_say()
    {
        await using var db = await FreshAsync();
        var (companyId, userId) = await SeedTenantAsync(db);

        // Dates that would open a scheduled survey and close an active one, on rows that are
        // past both. Reopening is not in the map -- duplicating is the supported way to run a
        // survey again -- and archived is terminal.
        var closed = NewSurvey(companyId, userId, SurveyStatuses.Closed, Now.AddDays(-1), Now.AddDays(20));
        var archived = NewSurvey(companyId, userId, SurveyStatuses.Archived, Now.AddDays(-1), Now.AddDays(-1));
        db.Surveys.AddRange(closed, archived);
        await db.SaveChangesAsync();

        var result = await SweepAsync(db);

        Assert.Equal(0, result.Opened);
        Assert.Equal(0, result.Closed);
        Assert.Equal(SurveyStatuses.Closed, await StatusOfAsync(closed.Id));
        Assert.Equal(SurveyStatuses.Archived, await StatusOfAsync(archived.Id));
    }

    // -- idempotence ----------------------------------------------------------------------

    [Fact]
    public async Task A_second_sweep_over_the_same_rows_does_nothing()
    {
        await using var db = await FreshAsync();
        var (companyId, userId) = await SeedTenantAsync(db);

        db.Surveys.AddRange(
            NewSurvey(companyId, userId, SurveyStatuses.Scheduled, Now.AddDays(-1), Now.AddDays(20)),
            NewSurvey(companyId, userId, SurveyStatuses.Active, Now.AddDays(-30), Now.AddDays(-1)));
        await db.SaveChangesAsync();

        var first = await SweepAsync(db);
        Assert.Equal(1, first.Opened);
        Assert.Equal(1, first.Closed);

        // On a fresh context: the second sweep must decide from the table, not from a change
        // tracker that already knows the answer.
        await using var second = CreateContext();
        var again = await SweepAsync(second);

        Assert.Equal(0, again.Opened);
        Assert.Equal(0, again.Closed);

        // Two audit rows, not four. A sweep that re-fired would double the trail while every
        // status assertion above still passed.
        await using var read = CreateContext();
        Assert.Equal(2, await read.AuditLogs.CountAsync());
    }

    /// <summary>
    /// The survey opened by a tick is not also closed by it. Not a coincidence of ordering: the
    /// open predicate requires <c>end_date</c> to still be ahead, so a row can never satisfy
    /// both, and a survey that flickered open and shut inside one transaction would have taken
    /// its schedule edit window away for nothing.
    /// </summary>
    [Fact]
    public async Task A_survey_opened_by_a_tick_is_not_closed_by_the_same_tick()
    {
        await using var db = await FreshAsync();
        var (companyId, userId) = await SeedTenantAsync(db);

        var survey = NewSurvey(companyId, userId, SurveyStatuses.Scheduled, Now.AddDays(-1), Now.AddMinutes(1));
        db.Surveys.Add(survey);
        await db.SaveChangesAsync();

        var result = await SweepAsync(db);

        Assert.Equal(1, result.Opened);
        Assert.Equal(0, result.Closed);
        Assert.Equal(SurveyStatuses.Active, await StatusOfAsync(survey.Id));
    }

    // -- attribution ----------------------------------------------------------------------

    [Fact]
    public async Task Each_transition_writes_one_system_attributed_audit_row()
    {
        await using var db = await FreshAsync();
        var (companyId, userId) = await SeedTenantAsync(db);

        var opening = NewSurvey(companyId, userId, SurveyStatuses.Scheduled, Now.AddDays(-1), Now.AddDays(20));
        var closing = NewSurvey(companyId, userId, SurveyStatuses.Active, Now.AddDays(-30), Now.AddDays(-2));
        db.Surveys.AddRange(opening, closing);
        await db.SaveChangesAsync();

        await SweepAsync(db);

        await using var read = CreateContext();
        var rows = await read.AuditLogs.OrderBy(a => a.Action).ToListAsync();
        Assert.Equal(2, rows.Count);

        var closeRow = rows.Single(a => a.Action == SurveyLifecycleJob.ClosedAction);
        var openRow = rows.Single(a => a.Action == SurveyLifecycleJob.OpenedAction);

        foreach (var row in rows)
        {
            // Null, and load-bearing: this is what tells an operator the scheduler did it. A
            // borrowed user id would make an automatic transition indistinguishable from an
            // administrator's.
            Assert.Null(row.UserId);
            Assert.Equal(companyId, row.CompanyId);
            Assert.Equal(SurveyLifecycleJob.AuditResource, row.Resource);
            Assert.True(row.Success);
            Assert.Equal(Now, row.Timestamp);
        }

        Assert.Equal(opening.Id.ToString(), openRow.ResourceId);
        Assert.Equal(closing.Id.ToString(), closeRow.ResourceId);

        // The details carry the transition and the date that came due -- the one fact that
        // cannot be recovered later, since the schedule stays editable while a survey is live.
        Assert.NotNull(openRow.Details);
        Assert.NotNull(closeRow.Details);
        Assert.Contains(SurveyStatuses.Scheduled, openRow.Details);
        Assert.Contains(SurveyStatuses.Active, openRow.Details);
        Assert.Contains(SurveyStatuses.Active, closeRow.Details);
        Assert.Contains(SurveyStatuses.Closed, closeRow.Details);
    }

    /// <summary>
    /// The documented gap, pinned rather than left to be discovered.
    ///
    /// <para><c>survey_audit_logs.user_id</c> is NOT NULL behind a RESTRICT foreign key, so the
    /// only way for this job to appear in <c>GET /surveys/{id}/history</c> is to attribute a
    /// scheduler action to a human who did not perform it. This asserts it writes none, so that
    /// closing the gap has to be a deliberate act -- a migration making that column nullable --
    /// rather than somebody quietly passing the survey's author as the actor.</para>
    /// </summary>
    [Fact]
    public async Task No_row_is_written_to_the_per_survey_trail_because_it_cannot_name_the_actor()
    {
        await using var db = await FreshAsync();
        var (companyId, userId) = await SeedTenantAsync(db);

        db.Surveys.Add(NewSurvey(companyId, userId, SurveyStatuses.Active, Now.AddDays(-30), Now.AddDays(-1)));
        await db.SaveChangesAsync();

        await SweepAsync(db);

        await using var read = CreateContext();
        Assert.Equal(1, await read.AuditLogs.CountAsync());
        Assert.Equal(0, await read.SurveyAuditLogs.CountAsync());
    }

    /// <summary>
    /// The constant is hand-written here and derived from the routing table there, so this pins
    /// them together against the live <see cref="EndpointDataSource"/>. If they drift, the one
    /// filter that was supposed to return every status change a survey ever had returns half of
    /// them, and nothing else would say so.
    /// </summary>
    [Fact]
    public void The_audit_resource_matches_what_the_status_endpoint_derives()
    {
        var endpoint = postgres.App.Services
            .GetRequiredService<EndpointDataSource>()
            .Endpoints
            .OfType<RouteEndpoint>()
            .Single(e => e.RoutePattern.RawText == "/surveys/{id:guid}/status"
                         && (e.Metadata.GetMetadata<HttpMethodMetadata>()?.HttpMethods.Contains("PUT") ?? false));

        Assert.Equal(SurveyLifecycleJob.AuditResource, AuditPolicy.DeriveResource(endpoint));
    }

    // -- the worker ------------------------------------------------------------------------

    [Fact]
    public async Task The_worker_tick_honours_the_configured_batch_size()
    {
        // Configuration is only wired if something reads it. Asserting the option's value passes
        // identically whether the worker passes `_batchSize` to the job or a hard-coded 100, and
        // a cap nobody honours is the unbounded transaction the cap exists to prevent. So this
        // asserts through the rows: three surveys due to close, a cap of two, one survivor.
        await using (var seed = await FreshAsync())
        {
            var (companyId, userId) = await SeedTenantAsync(seed);
            for (var i = 0; i < 3; i++)
            {
                seed.Surveys.Add(NewSurvey(
                    companyId, userId, SurveyStatuses.Active, Now.AddDays(-30), Now.AddDays(-1 - i)));
            }

            await seed.SaveChangesAsync();
        }

        await using var provider = BuildWorkerHost(("Scheduling:SurveyLifecycleBatchSize", "2"));
        var worker = provider.GetServices<IHostedService>().OfType<SurveyLifecycleWorker>().Single();

        await worker.TickAsync(default);

        await using (var afterFirst = CreateContext())
        {
            Assert.Equal(1, await afterFirst.Surveys.CountAsync(s => s.Status == SurveyStatuses.Active));
        }

        // And the leftover is not stranded: the next tick takes it. A cap bounds one
        // transaction, not what the sweep will ever do.
        await worker.TickAsync(default);

        await using var afterSecond = CreateContext();
        Assert.Equal(0, await afterSecond.Surveys.CountAsync(s => s.Status == SurveyStatuses.Active));
    }

    [Fact]
    public void The_lifecycle_worker_is_registered_and_ticks_every_five_minutes()
    {
        // Registration is the failure mode with no symptom: the job can be perfect and surveys
        // still never open if nothing constructs it. The interval is pinned here so the cadence
        // in the doc comment cannot silently drift from the code.
        using var provider = BuildWorkerHost();
        var worker = provider.GetServices<IHostedService>().OfType<SurveyLifecycleWorker>().Single();

        Assert.Equal(WorkerJobs.SurveyLifecycle, worker.JobName);
        Assert.Equal(TimeSpan.FromMinutes(5), worker.Interval);
    }

    /// <summary>
    /// Registered in <see cref="WorkerJobs.All"/>, so it declares a heartbeat and appears on
    /// <c>/admin/system/status</c>. A job absent from that list has no lock key of its own and
    /// is invisible to the System Health screen, which is the surface that exists to notice a
    /// job that stopped.
    /// </summary>
    [Fact]
    public void The_job_is_in_the_registry_with_a_lock_key_of_its_own()
    {
        var keys = WorkerJobs.All.Select(DeterministicNotificationId.LockKey).ToList();

        Assert.Contains(WorkerJobs.SurveyLifecycle, WorkerJobs.All);
        Assert.Equal(WorkerJobs.All.Length, keys.Distinct().Count());
    }

    [Fact]
    public void A_zero_lifecycle_interval_is_refused_at_startup_rather_than_inside_a_timer()
    {
        // PeriodicTimer throws on a non-positive interval, from a background thread, where the
        // exception stops one job and leaves the host looking healthy.
        var configuration = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["Scheduling:SurveyLifecycleInterval"] = "00:00:00",
            })
            .Build();

        var services = new ServiceCollection();

        Assert.Throws<InvalidOperationException>(() => services.AddClimateProjectScheduling(configuration));
    }

    [Fact]
    public void The_options_carry_the_documented_five_minute_default()
    {
        var options = new WorkerSchedulingOptions();

        Assert.Equal(TimeSpan.FromMinutes(5), options.SurveyLifecycleInterval);
        Assert.Equal(SurveyLifecycleJob.DefaultBatchSize, options.SurveyLifecycleBatchSize);
    }

    [Fact]
    public void The_configured_interval_and_batch_size_are_honoured()
    {
        using var provider = BuildWorkerHost(
            ("Scheduling:SurveyLifecycleInterval", "00:02:00"),
            ("Scheduling:SurveyLifecycleBatchSize", "7"));

        var worker = provider.GetServices<IHostedService>().OfType<SurveyLifecycleWorker>().Single();

        Assert.Equal(TimeSpan.FromMinutes(2), worker.Interval);
        Assert.Equal(7, provider.GetRequiredService<IOptions<WorkerSchedulingOptions>>()
            .Value.SurveyLifecycleBatchSize);
    }

    private ServiceProvider BuildWorkerHost(params (string Key, string Value)[] settings)
    {
        var services = new ServiceCollection();
        services.AddLogging();
        services.AddDbContext<ClimateProjectDbContext>(options => options.UseNpgsql(postgres.ConnectionString));
        services.AddClimateProjectScheduling(new ConfigurationBuilder()
            .AddInMemoryCollection(settings.ToDictionary(s => s.Key, s => (string?)s.Value))
            .Build());

        // Every other job in the host would need its own collaborators; only the lifecycle
        // worker is resolved here, and its scope needs nothing but the context and the lease
        // that AddClimateProjectScheduling already registered.
        return services.BuildServiceProvider();
    }
}
