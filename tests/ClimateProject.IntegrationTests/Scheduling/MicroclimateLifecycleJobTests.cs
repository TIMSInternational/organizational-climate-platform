using System.Data.Common;
using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using ClimateProject.Api.Endpoints;
using ClimateProject.Api.Infrastructure.Auditing;
using ClimateProject.Application.Auth;
using ClimateProject.Application.Microclimates;
using ClimateProject.Application.Scheduling;
using ClimateProject.Domain.Entities;
using ClimateProject.Infrastructure.Persistence;
using ClimateProject.Infrastructure.Scheduling;
using ClimateProject.IntegrationTests.Support;
using ClimateProject.Workers;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;

namespace ClimateProject.IntegrationTests.Scheduling;

/// <summary>
/// The microclimate lifecycle sweep against a real Postgres.
///
/// <para>The claim under test is that <c>microclimates.status</c> is <b>written</b>, because
/// status is the only thing anything reads:
/// <see cref="MicroclimateStatuses.AcceptsResponses"/> is <c>status == active</c> and
/// <c>MicroclimateEndpoints.SubmitResponseAsync</c> checks that and nothing else, so a session
/// whose deadline has passed and whose status has not is indistinguishable from one that is
/// still running. That is precisely why the schedule was decoration for the whole life of the
/// feature.</para>
///
/// <para>Most of these tests assert that nothing happened. A job that changes a status on live
/// customer data is judged mostly by what it refuses, and here every refusal is worse than the
/// survey equivalent: <c>closed</c> has no outgoing edges at all, so a session this sweep closes
/// by mistake cannot be reopened, re-dated, returned to draft or duplicated by anybody.</para>
///
/// <para>Like the other deployment-wide sweeps in this assembly this one takes no company id, so
/// a microclimate another test left behind is inside the measurement. Hence
/// <c>TRUNCATE companies CASCADE</c> before each test, the isolation <c>SchedulingJobTests</c>
/// established and for the same reason.</para>
/// </summary>
[Collection("Postgres")]
public class MicroclimateLifecycleJobTests(PostgresContainerFixture postgres)
{
    private static readonly DateTimeOffset Now = new(2026, 8, 24, 12, 0, 0, TimeSpan.Zero);

    private ClimateProjectDbContext CreateContext(params IInterceptor[] interceptors)
        => new(new DbContextOptionsBuilder<ClimateProjectDbContext>()
            .UseNpgsql(postgres.ConnectionString)
            .AddInterceptors(interceptors)
            .Options);

    private async Task<ClimateProjectDbContext> FreshAsync()
    {
        var db = CreateContext();
        await db.Database.MigrateAsync();
        await db.Database.ExecuteSqlRawAsync("TRUNCATE TABLE companies CASCADE");
        return db;
    }

    private static async Task<(Guid CompanyId, Guid UserId)> SeedTenantAsync(
        ClimateProjectDbContext db,
        string? emailDomain = null)
    {
        var company = new Company
        {
            Id = Guid.NewGuid(),
            Name = $"Pulse-{Guid.NewGuid():N}",
            EmailDomain = emailDomain,
            Settings = new CompanySettings { Timezone = "UTC" },
            CreatedAt = Now,
        };

        var user = new User
        {
            Id = Guid.NewGuid(),
            CompanyId = company.Id,
            // Own e-mail domain: companies.email_domain has a filtered unique index and this
            // class shares its database with every other integration test.
            Email = $"author-{Guid.NewGuid():N}@microclimate-lifecycle.test",
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

    private static Microclimate NewMicroclimate(
        Guid companyId,
        Guid createdBy,
        string status,
        DateTimeOffset startTime,
        DateTimeOffset endTime) => new()
        {
            Id = Guid.NewGuid(),
            CompanyId = companyId,
            CreatedBy = createdBy,
            TitleEn = "Monday pulse",
            TitleEs = "Pulso del lunes",
            Language = "both",
            Status = status,
            Scheduling = new MicroclimateScheduling
            {
                StartTime = startTime,
                EndTime = endTime,
                Timezone = "UTC",
            },
            CreatedAt = startTime.AddDays(-1),
            UpdatedAt = startTime.AddDays(-1),
        };

    private static Task<MicroclimateLifecycleSweepResult> SweepAsync(ClimateProjectDbContext db)
        => SweepAsync(db, MicroclimateLifecycleJob.DefaultBatchSize);

    private static Task<MicroclimateLifecycleSweepResult> SweepAsync(ClimateProjectDbContext db, int batchSize)
        => SweepAsync(db, batchSize, Now);

    private static Task<MicroclimateLifecycleSweepResult> SweepAsync(
        ClimateProjectDbContext db,
        int batchSize,
        DateTimeOffset nowUtc)
        => MicroclimateLifecycleJob.RunAsync(db, NullLoggerFactory.Instance, nowUtc, batchSize, default);

    private async Task<string> StatusOfAsync(Guid microclimateId)
    {
        // A second context, so the answer comes from the table rather than the change tracker.
        await using var read = CreateContext();
        return await read.Microclimates.Where(m => m.Id == microclimateId).Select(m => m.Status).SingleAsync();
    }

    // -- closing ---------------------------------------------------------------------------

    [Fact]
    public async Task An_active_microclimate_closes_once_its_end_time_has_passed()
    {
        await using var db = await FreshAsync();
        var (companyId, userId) = await SeedTenantAsync(db);

        var over = NewMicroclimate(companyId, userId, MicroclimateStatuses.Active, Now.AddHours(-4), Now.AddHours(-1));
        var running = NewMicroclimate(companyId, userId, MicroclimateStatuses.Active, Now.AddHours(-4), Now.AddHours(1));
        db.Microclimates.AddRange(over, running);
        await db.SaveChangesAsync();

        var result = await SweepAsync(db);

        Assert.Equal(1, result.Closed);
        Assert.Equal(MicroclimateStatuses.Closed, await StatusOfAsync(over.Id));
        Assert.Equal(MicroclimateStatuses.Active, await StatusOfAsync(running.Id));
    }

    /// <summary>
    /// The product consequence, asserted through the predicate the whole response path actually
    /// reads. Asserting the status string alone would pass identically if <c>closed</c> still
    /// accepted responses, and "the status moved" is not the thing anybody wanted.
    /// </summary>
    [Fact]
    public async Task Closing_is_what_stops_the_microclimate_accepting_responses()
    {
        await using var db = await FreshAsync();
        var (companyId, userId) = await SeedTenantAsync(db);

        var pulse = NewMicroclimate(companyId, userId, MicroclimateStatuses.Active, Now.AddHours(-4), Now.AddHours(-1));
        db.Microclimates.Add(pulse);
        await db.SaveChangesAsync();

        Assert.True(MicroclimateStatuses.AcceptsResponses(await StatusOfAsync(pulse.Id)));

        await SweepAsync(db);

        Assert.False(MicroclimateStatuses.AcceptsResponses(await StatusOfAsync(pulse.Id)));
    }

    /// <summary>
    /// The whole defect, end to end, through the product's own surfaces and nothing else.
    ///
    /// <para>Every fixture here is written by a real producer: the session is created by
    /// <c>POST /microclimates</c>, activated by the endpoint that runs the #195 translation gate,
    /// and answered by an anonymous <c>POST /microclimates/{id}/responses</c> -- the exact path a
    /// respondent takes. Nothing is assembled by hand, so nothing can be assembled into a shape
    /// production never produces. Then the clock moves past the deadline the admin set, one sweep
    /// runs, and the same request that was accepted a moment ago is refused.</para>
    ///
    /// <para>Before this job existed the second submission returned <c>201 Created</c> and its
    /// words went into the word cloud, for as long as anyone kept the link. That is what the
    /// issue means by "not repairable retroactively": there is no per-response row, so the late
    /// answer below could not afterwards be told from the on-time one.</para>
    /// </summary>
    [Fact]
    public async Task A_session_built_and_run_through_the_api_stops_taking_answers_after_the_sweep()
    {
        var domain = $"pulse-{Guid.NewGuid():N}.test";

        await using (var seed = await FreshAsync())
        {
            await SeedTenantAsync(seed, domain);
        }

        Guid companyId;
        await using (var lookup = CreateContext())
        {
            companyId = await lookup.Companies.Where(c => c.EmailDomain == domain).Select(c => c.Id).SingleAsync();
        }

        var admin = postgres.App.CreateClient();
        var token = await SignUpAsAdminAsync(admin, domain, companyId);
        admin.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);

        // The admin's own window: open now, shut in an hour.
        var startTime = DateTimeOffset.UtcNow;
        var endTime = startTime.AddHours(1);

        var createResponse = await admin.PostAsJsonAsync("/microclimates", new CreateMicroclimateRequest(
            "Monday pulse",
            null,
            companyId,
            startTime,
            endTime,
            4,
            true,
            null,
            [new CreateQuestionInput("How is the week going?", "open_ended", null, true, 1)]));
        Assert.Equal(HttpStatusCode.Created, createResponse.StatusCode);
        var created = await createResponse.Content.ReadFromJsonAsync<MicroclimateDetail>();

        var activated = await admin.PostAsync($"/microclimates/{created!.Id}/activate", null);
        Assert.Equal(HttpStatusCode.OK, activated.StatusCode);

        var questionId = created.Questions.Single().Id;
        var respondent = postgres.App.CreateClient(); // deliberately no Authorization header

        var onTime = await respondent.PostAsJsonAsync(
            $"/microclimates/{created.Id}/responses",
            new SubmitResponseRequest(new Dictionary<Guid, string> { [questionId] = "busy but good" }));
        Assert.Equal(HttpStatusCode.Created, onTime.StatusCode);

        // An hour after the admin's deadline. One tick.
        await using (var sweep = CreateContext())
        {
            var result = await SweepAsync(sweep, MicroclimateLifecycleJob.DefaultBatchSize, endTime.AddHours(1));
            Assert.Equal(1, result.Closed);
        }

        var late = await respondent.PostAsJsonAsync(
            $"/microclimates/{created.Id}/responses",
            new SubmitResponseRequest(new Dictionary<Guid, string> { [questionId] = "still going" }));

        Assert.Equal(HttpStatusCode.BadRequest, late.StatusCode);

        // And the on-time answer is still counted. The job reads no response and writes no
        // count, so closing a session must not disturb the results it already collected -- a
        // sweep that reset the aggregate would pass every status assertion above.
        var results = await admin.GetAsync($"/microclimates/{created.Id}/live-results");
        Assert.Equal(HttpStatusCode.OK, results.StatusCode);
        var live = await results.Content.ReadFromJsonAsync<LiveResultsDetail>();
        Assert.Equal(1, live!.ResponseCount);
    }

    // -- the refusals -----------------------------------------------------------------------

    /// <summary>
    /// The decision this issue turned on. A microclimate's <c>draft</c> means "still being
    /// authored" -- there is no <c>scheduled</c> status to open out of -- and publishing runs a
    /// translation gate inside the endpoint that a background job can neither run usefully nor
    /// report back. So no date opens a draft, however long its start time has been behind it,
    /// and the sweep reports it instead.
    /// </summary>
    [Fact]
    public async Task A_draft_whose_window_has_come_and_gone_is_never_opened_and_is_reported()
    {
        await using var db = await FreshAsync();
        var (companyId, userId) = await SeedTenantAsync(db);

        // Its start time passed AND its end time passed: the strongest case for opening it, and
        // the one an auto-open would definitely have caught.
        var stranded = NewMicroclimate(
            companyId, userId, MicroclimateStatuses.Draft, Now.AddDays(-2), Now.AddDays(-1));

        // Still inside its window, so an auto-open would have put it live right now.
        var live = NewMicroclimate(
            companyId, userId, MicroclimateStatuses.Draft, Now.AddHours(-1), Now.AddHours(1));

        db.Microclimates.AddRange(stranded, live);
        await db.SaveChangesAsync();

        var result = await SweepAsync(db);

        Assert.Equal(0, result.Closed);
        Assert.Equal(1, result.Stranded);
        Assert.Equal(MicroclimateStatuses.Draft, await StatusOfAsync(stranded.Id));
        Assert.Equal(MicroclimateStatuses.Draft, await StatusOfAsync(live.Id));

        // And no audit row: nothing happened, and a row claiming otherwise would be worse than
        // the silence the warning was written to break.
        await using var read = CreateContext();
        Assert.Equal(0, await read.AuditLogs.CountAsync());
    }

    [Fact]
    public async Task A_closed_microclimate_is_never_touched_whatever_its_dates_say()
    {
        await using var db = await FreshAsync();
        var (companyId, userId) = await SeedTenantAsync(db);

        var closed = NewMicroclimate(companyId, userId, MicroclimateStatuses.Closed, Now.AddDays(-2), Now.AddDays(-1));
        db.Microclimates.Add(closed);
        await db.SaveChangesAsync();

        var before = await UpdatedAtOfAsync(closed.Id);

        var result = await SweepAsync(db);

        Assert.Equal(0, result.Closed);
        Assert.Equal(0, result.Stranded);
        Assert.Equal(MicroclimateStatuses.Closed, await StatusOfAsync(closed.Id));
        Assert.Equal(before, await UpdatedAtOfAsync(closed.Id));
    }

    // -- idempotence -------------------------------------------------------------------------

    [Fact]
    public async Task A_second_sweep_over_the_same_row_does_nothing()
    {
        await using var db = await FreshAsync();
        var (companyId, userId) = await SeedTenantAsync(db);

        db.Microclimates.Add(NewMicroclimate(
            companyId, userId, MicroclimateStatuses.Active, Now.AddHours(-4), Now.AddHours(-1)));
        await db.SaveChangesAsync();

        var first = await SweepAsync(db);
        Assert.Equal(1, first.Closed);

        // On a fresh context: the second sweep must decide from the table, not from a change
        // tracker that already knows the answer.
        await using var second = CreateContext();
        var again = await SweepAsync(second);

        Assert.Equal(0, again.Closed);

        // One audit row, not two. A sweep that re-fired would double the trail while every
        // status assertion above still passed.
        await using var read = CreateContext();
        Assert.Equal(1, await read.AuditLogs.CountAsync());
    }

    // -- every tenant at once -----------------------------------------------------------------

    /// <summary>
    /// One sweep closes microclimates in every company. The single most load-bearing property of
    /// this job -- it is the only automatic writer of <c>microclimates.status</c> that exists, it
    /// runs with no authenticated principal, and there is no per-tenant scheduler behind it, so a
    /// sweep that silently served one tenant would leave every other company's sessions
    /// collecting answers past their deadline with nothing anywhere reporting a problem.
    /// </summary>
    [Fact]
    public async Task One_sweep_closes_microclimates_in_every_company()
    {
        await using var db = await FreshAsync();
        var (companyA, userA) = await SeedTenantAsync(db);
        var (companyB, userB) = await SeedTenantAsync(db);
        Assert.NotEqual(companyA, companyB);

        var inA = NewMicroclimate(companyA, userA, MicroclimateStatuses.Active, Now.AddHours(-4), Now.AddHours(-2));
        var inB = NewMicroclimate(companyB, userB, MicroclimateStatuses.Active, Now.AddHours(-4), Now.AddHours(-1));
        db.Microclimates.AddRange(inA, inB);
        await db.SaveChangesAsync();

        var result = await SweepAsync(db);

        Assert.Equal(2, result.Closed);
        Assert.Equal(MicroclimateStatuses.Closed, await StatusOfAsync(inA.Id));
        Assert.Equal(MicroclimateStatuses.Closed, await StatusOfAsync(inB.Id));

        // And each row's trail lands in its own tenant. Cross-tenant work with a mis-attributed
        // audit row would put company B's transition into company A's /audit listing, which is a
        // leak rather than a bookkeeping slip.
        await using var read = CreateContext();
        var rows = await read.AuditLogs.AsNoTracking().ToListAsync();
        Assert.Equal(2, rows.Count);
        Assert.Equal(companyA, rows.Single(r => r.ResourceId == inA.Id.ToString()).CompanyId);
        Assert.Equal(companyB, rows.Single(r => r.ResourceId == inB.Id.ToString()).CompanyId);
    }

    // -- racing a human -------------------------------------------------------------------------

    /// <summary>
    /// A status change made between this sweep's SELECT and its UPDATE wins; the job does not
    /// clobber it, and writes no audit row claiming it closed a session somebody else closed.
    ///
    /// <para>The lease serialises this job against itself and against nothing else. Four routes
    /// change a microclimate's status and the API serves them at any moment, while the window
    /// between reading a candidate and writing it is the whole of a sweep. Unconditionally the
    /// scheduler wins that race every time, because it is the one holding a transaction open --
    /// and here it would stamp its own <c>updated_at</c> over the admin's and file a
    /// null-actor "the platform closed this" row for an action a person took. A false name in an
    /// audit trail is worse than a gap.</para>
    ///
    /// <para>The race is made deterministic with an interceptor rather than a second thread: it
    /// fires once, after the sweep's first read of <c>microclimates</c>, on its own
    /// connection.</para>
    /// </summary>
    [Fact]
    public async Task A_concurrent_close_by_a_human_wins_over_the_sweep_instead_of_being_clobbered()
    {
        Guid microclimateId;
        var humanStamp = Now.AddMinutes(-1);

        await using (var seed = await FreshAsync())
        {
            var (companyId, userId) = await SeedTenantAsync(seed);
            var pulse = NewMicroclimate(
                companyId, userId, MicroclimateStatuses.Active, Now.AddHours(-4), Now.AddHours(-1));
            seed.Microclimates.Add(pulse);
            await seed.SaveChangesAsync();
            microclimateId = pulse.Id;
        }

        // An administrator closes the session by hand -- the tracked read, assignment and save
        // that `PUT /microclimates/{id}/status` performs, on its own connection.
        var human = new AfterFirstMicroclimateReadInterceptor(async () =>
        {
            await using var byHand = CreateContext();
            var mine = await byHand.Microclimates.SingleAsync(m => m.Id == microclimateId);
            mine.Status = MicroclimateStatuses.Closed;
            mine.UpdatedAt = humanStamp;
            await byHand.SaveChangesAsync();
        });

        await using var db = CreateContext(human);
        var result = await SweepAsync(db);

        // Without this the test would pass on a job that never read the row at all.
        Assert.True(human.Fired, "the concurrent transition never ran, so nothing about the race was tested");

        Assert.Equal(0, result.Closed);
        Assert.Equal(MicroclimateStatuses.Closed, await StatusOfAsync(microclimateId));

        // The admin's stamp survives, and no row claims the platform did it.
        Assert.Equal(humanStamp, await UpdatedAtOfAsync(microclimateId));

        await using var read = CreateContext();
        Assert.Equal(0, await read.AuditLogs.CountAsync());
    }

    /// <summary>
    /// The other half of the compare-and-swap, and the one that is this surface's own rather than
    /// a port of #371's.
    ///
    /// <para><c>PUT /microclimates/{id}</c> accepts an <c>EndTime</c> change while a session is
    /// live, and the moment an admin uses it is the moment the deadline is about to lapse -- so
    /// the stale-read window and the deadline-extension window are the same window. A
    /// compare-and-swap on the status alone does not notice: the row is still <c>active</c>, so
    /// the sweep closes it on a deadline that no longer exists. And <c>closed</c> is terminal
    /// here -- no edge back to <c>active</c>, none back to <c>draft</c>, and no
    /// <c>duplicate</c> route -- so the extension is not merely lost, the session can never be
    /// run.</para>
    /// </summary>
    [Fact]
    public async Task An_extended_deadline_wins_over_the_sweep_that_already_read_the_old_one()
    {
        Guid microclimateId;

        await using (var seed = await FreshAsync())
        {
            var (companyId, userId) = await SeedTenantAsync(seed);
            var pulse = NewMicroclimate(
                companyId, userId, MicroclimateStatuses.Active, Now.AddHours(-4), Now.AddMinutes(-1));
            seed.Microclimates.Add(pulse);
            await seed.SaveChangesAsync();
            microclimateId = pulse.Id;
        }

        // "Give everyone another two hours", sent while the sweep is mid-flight.
        var extendedTo = Now.AddHours(2);
        var human = new AfterFirstMicroclimateReadInterceptor(async () =>
        {
            await using var byHand = CreateContext();
            var mine = await byHand.Microclimates.SingleAsync(m => m.Id == microclimateId);
            mine.Scheduling.EndTime = extendedTo;
            mine.UpdatedAt = Now.AddSeconds(-1);
            await byHand.SaveChangesAsync();
        });

        await using var db = CreateContext(human);
        var result = await SweepAsync(db);

        Assert.True(human.Fired, "the deadline was never extended, so nothing about the race was tested");

        Assert.Equal(0, result.Closed);

        // Still open, still collecting -- asserted through the predicate the submit endpoint
        // reads, because that is the thing the extension was for.
        Assert.True(MicroclimateStatuses.AcceptsResponses(await StatusOfAsync(microclimateId)));

        await using var read = CreateContext();
        Assert.Equal(0, await read.AuditLogs.CountAsync());

        // And the next tick honours the new deadline rather than re-deciding from the old one:
        // at the moment the sweep ran it is open, two hours later it is not.
        await using var later = CreateContext();
        var next = await SweepAsync(later, MicroclimateLifecycleJob.DefaultBatchSize, extendedTo);
        Assert.Equal(1, next.Closed);
        Assert.False(MicroclimateStatuses.AcceptsResponses(await StatusOfAsync(microclimateId)));
    }

    // -- what a sweep leaves behind ---------------------------------------------------------

    /// <summary>
    /// A close stamps <c>updated_at</c>, and a refusal leaves it alone.
    ///
    /// <para>Not cosmetic. Every "recently changed" surface in the product orders on this column,
    /// so a session the platform closed on its own would be the one change an admin could not
    /// find by looking at what changed. And the second half matters as much: a sweep that stamped
    /// every row it examined would push every live microclimate in the database to the top of
    /// that listing every five minutes.</para>
    /// </summary>
    [Fact]
    public async Task A_close_stamps_updated_at_and_a_refusal_leaves_it_alone()
    {
        await using var db = await FreshAsync();
        var (companyId, userId) = await SeedTenantAsync(db);

        var closing = NewMicroclimate(
            companyId, userId, MicroclimateStatuses.Active, Now.AddHours(-4), Now.AddHours(-1));
        var running = NewMicroclimate(
            companyId, userId, MicroclimateStatuses.Active, Now.AddHours(-4), Now.AddHours(1));
        db.Microclimates.AddRange(closing, running);
        await db.SaveChangesAsync();

        var untouchedBefore = running.UpdatedAt;
        Assert.NotEqual(Now, untouchedBefore);

        await SweepAsync(db);

        Assert.Equal(Now, await UpdatedAtOfAsync(closing.Id));
        Assert.Equal(untouchedBefore, await UpdatedAtOfAsync(running.Id));
    }

    /// <summary>
    /// <c>MoreRemaining</c> means "the cap bit", and it is the only thing that tells an operator a
    /// backlog is draining rather than stalled -- it is what the worker logs on. Pinned in both
    /// directions, because the failure that matters is the quiet one: a flag stuck at false hides
    /// a backlog, and a flag that fires whenever a page happens to be exactly full cries wolf on
    /// every tick. The second assertion is the whole reason <c>TakeAsync</c> asks for
    /// <c>cap + 1</c> rows instead of comparing the count to the cap.
    /// </summary>
    [Fact]
    public async Task MoreRemaining_says_the_cap_bit_and_nothing_else()
    {
        await using (var seed = await FreshAsync())
        {
            var (companyId, userId) = await SeedTenantAsync(seed);
            seed.Microclimates.AddRange(
                NewMicroclimate(companyId, userId, MicroclimateStatuses.Active, Now.AddHours(-4), Now.AddHours(-2)),
                NewMicroclimate(companyId, userId, MicroclimateStatuses.Active, Now.AddHours(-4), Now.AddHours(-1)));
            await seed.SaveChangesAsync();
        }

        // Two due, a cap of one: one moves, and the flag says there is more.
        await using (var capped = CreateContext())
        {
            var result = await SweepAsync(capped, batchSize: 1);
            Assert.Equal(1, result.Closed);
            Assert.True(result.MoreRemaining);
        }

        // One due, the same cap: the page is exactly full and there is nothing behind it.
        await using (var exact = CreateContext())
        {
            var result = await SweepAsync(exact, batchSize: 1);
            Assert.Equal(1, result.Closed);
            Assert.False(result.MoreRemaining);
        }

        // Nothing due at all.
        await using var drained = CreateContext();
        var empty = await SweepAsync(drained, batchSize: 1);
        Assert.Equal(0, empty.Closed);
        Assert.False(empty.MoreRemaining);
    }

    // -- attribution --------------------------------------------------------------------------

    [Fact]
    public async Task Each_close_writes_one_system_attributed_audit_row()
    {
        await using var db = await FreshAsync();
        var (companyId, userId) = await SeedTenantAsync(db);

        var deadline = Now.AddHours(-1);
        var closing = NewMicroclimate(companyId, userId, MicroclimateStatuses.Active, Now.AddHours(-4), deadline);
        db.Microclimates.Add(closing);
        await db.SaveChangesAsync();

        await SweepAsync(db);

        await using var read = CreateContext();
        var row = await read.AuditLogs.SingleAsync();

        // Null, and load-bearing: this is what tells an operator the scheduler did it. A borrowed
        // user id would make an automatic close indistinguishable from an administrator's.
        Assert.Null(row.UserId);
        Assert.Equal(companyId, row.CompanyId);
        Assert.Equal(MicroclimateLifecycleJob.AuditResource, row.Resource);
        Assert.Equal(MicroclimateLifecycleJob.ClosedAction, row.Action);
        Assert.Equal(closing.Id.ToString(), row.ResourceId);
        Assert.True(row.Success);
        Assert.Equal(Now, row.Timestamp);

        // The details carry the transition and the deadline that came due -- the one fact a
        // reader cannot recover later, since PUT /microclimates/{id} keeps accepting an EndTime
        // change while a session is live.
        Assert.NotNull(row.Details);
        Assert.Contains(MicroclimateStatuses.Active, row.Details);
        Assert.Contains(MicroclimateStatuses.Closed, row.Details);
        Assert.Contains(deadline.UtcDateTime.ToString("yyyy-MM-ddTHH:mm:ss"), row.Details);
    }

    /// <summary>
    /// The constant is hand-written in the job and derived from the routing table by the audit
    /// middleware, so this pins them together against the live <see cref="EndpointDataSource"/>.
    /// If they drift, the one filter that was supposed to return every status change a
    /// microclimate ever had returns half of them, and nothing else would say so.
    /// </summary>
    [Fact]
    public void The_audit_resource_matches_what_the_status_endpoint_derives()
    {
        var endpoint = postgres.App.Services
            .GetRequiredService<EndpointDataSource>()
            .Endpoints
            .OfType<RouteEndpoint>()
            .Single(e => e.RoutePattern.RawText == "/microclimates/{id:guid}/status"
                         && (e.Metadata.GetMetadata<HttpMethodMetadata>()?.HttpMethods.Contains("PUT") ?? false));

        Assert.Equal(MicroclimateLifecycleJob.AuditResource, AuditPolicy.DeriveResource(endpoint));
    }

    // -- the worker ---------------------------------------------------------------------------

    [Fact]
    public async Task The_worker_tick_honours_the_configured_batch_size()
    {
        // Configuration is only wired if something reads it. Asserting the option's value passes
        // identically whether the worker passes `_batchSize` to the job or a hard-coded 100, and
        // a cap nobody honours is the unbounded transaction the cap exists to prevent. So this
        // asserts through the rows: three sessions due to close, a cap of two, one survivor.
        await using (var seed = await FreshAsync())
        {
            var (companyId, userId) = await SeedTenantAsync(seed);
            for (var i = 0; i < 3; i++)
            {
                seed.Microclimates.Add(NewMicroclimate(
                    companyId,
                    userId,
                    MicroclimateStatuses.Active,
                    DateTimeOffset.UtcNow.AddHours(-4),
                    DateTimeOffset.UtcNow.AddHours(-1 - i)));
            }

            await seed.SaveChangesAsync();
        }

        // The worker supplies its own clock, so the fixtures above are dated against UtcNow
        // rather than the class's frozen Now.
        await using var provider = BuildWorkerHost(("Scheduling:MicroclimateLifecycleBatchSize", "2"));
        var worker = provider.GetServices<IHostedService>().OfType<MicroclimateLifecycleWorker>().Single();

        await worker.TickAsync(default);

        await using (var afterFirst = CreateContext())
        {
            Assert.Equal(1, await afterFirst.Microclimates.CountAsync(m => m.Status == MicroclimateStatuses.Active));
        }

        // And the leftover is not stranded: the next tick takes it. A cap bounds one transaction,
        // not what the sweep will ever do.
        await worker.TickAsync(default);

        await using var afterSecond = CreateContext();
        Assert.Equal(0, await afterSecond.Microclimates.CountAsync(m => m.Status == MicroclimateStatuses.Active));
    }

    [Fact]
    public void The_lifecycle_worker_is_registered_and_ticks_every_five_minutes()
    {
        // Registration is the failure mode with no symptom: the job can be perfect and sessions
        // still never close if nothing constructs it. The interval is pinned here so the cadence
        // in the doc comment cannot silently drift from the code.
        using var provider = BuildWorkerHost();
        var worker = provider.GetServices<IHostedService>().OfType<MicroclimateLifecycleWorker>().Single();

        Assert.Equal(WorkerJobs.MicroclimateLifecycle, worker.JobName);
        Assert.Equal(TimeSpan.FromMinutes(5), worker.Interval);
    }

    /// <summary>
    /// Registered in <see cref="WorkerJobs.All"/>, so it declares a heartbeat and appears on
    /// <c>/admin/system/status</c>. A job absent from that list has no lock key of its own and is
    /// invisible to the System Health screen, which is the surface that exists to notice a job
    /// that stopped.
    /// </summary>
    [Fact]
    public void The_job_is_in_the_registry_with_a_lock_key_of_its_own()
    {
        var keys = WorkerJobs.All.Select(DeterministicNotificationId.LockKey).ToList();

        Assert.Contains(WorkerJobs.MicroclimateLifecycle, WorkerJobs.All);
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
                ["Scheduling:MicroclimateLifecycleInterval"] = "00:00:00",
            })
            .Build();

        var services = new ServiceCollection();

        Assert.Throws<InvalidOperationException>(() => services.AddClimateProjectScheduling(configuration));
    }

    [Fact]
    public void The_options_carry_the_documented_five_minute_default()
    {
        var options = new WorkerSchedulingOptions();

        Assert.Equal(TimeSpan.FromMinutes(5), options.MicroclimateLifecycleInterval);
        Assert.Equal(MicroclimateLifecycleJob.DefaultBatchSize, options.MicroclimateLifecycleBatchSize);
    }

    [Fact]
    public void The_configured_interval_and_batch_size_are_honoured()
    {
        using var provider = BuildWorkerHost(
            ("Scheduling:MicroclimateLifecycleInterval", "00:02:00"),
            ("Scheduling:MicroclimateLifecycleBatchSize", "7"));

        var worker = provider.GetServices<IHostedService>().OfType<MicroclimateLifecycleWorker>().Single();

        Assert.Equal(TimeSpan.FromMinutes(2), worker.Interval);
        Assert.Equal(7, provider.GetRequiredService<IOptions<WorkerSchedulingOptions>>()
            .Value.MicroclimateLifecycleBatchSize);
    }

    private async Task<DateTimeOffset> UpdatedAtOfAsync(Guid microclimateId)
    {
        await using var read = CreateContext();
        return await read.Microclimates
            .Where(m => m.Id == microclimateId)
            .Select(m => m.UpdatedAt)
            .SingleAsync();
    }

    private async Task<string> SignUpAsAdminAsync(HttpClient client, string emailDomain, Guid companyId)
    {
        var email = $"{Guid.NewGuid():N}@{emailDomain}";
        var signup = await client.PostAsJsonAsync(
            "/auth/signup", new SignupRequest("Pulse Admin", email, "a-good-password"));
        Assert.Equal(HttpStatusCode.Created, signup.StatusCode);

        using (var scope = postgres.App.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>();
            var user = await db.Users.FirstAsync(u => u.Email == email);
            user.Role = Roles.CompanyAdmin;
            user.CompanyId = companyId;
            await db.SaveChangesAsync();
        }

        var login = await client.PostAsJsonAsync("/auth/login", new LoginRequest(email, "a-good-password"));
        return (await login.Content.ReadFromJsonAsync<TokenResponse>())!.Token;
    }

    private ServiceProvider BuildWorkerHost(params (string Key, string Value)[] settings)
    {
        var services = new ServiceCollection();
        services.AddLogging();
        services.AddDbContext<ClimateProjectDbContext>(options => options.UseNpgsql(postgres.ConnectionString));
        services.AddClimateProjectScheduling(new ConfigurationBuilder()
            .AddInMemoryCollection(settings.ToDictionary(s => s.Key, s => (string?)s.Value))
            .Build());

        // Every other job in the host would need its own collaborators; only the lifecycle worker
        // is resolved here, and its scope needs nothing but the context and the lease that
        // AddClimateProjectScheduling already registered.
        return services.BuildServiceProvider();
    }

    /// <summary>
    /// Runs <paramref name="interfere"/> exactly once, after the intercepted context's first read
    /// of <c>microclimates</c> and therefore before any write it decides to make. That is
    /// precisely the window a human edit has to land in, and it is not reachable from a second
    /// thread without a sleep and a coin toss.
    ///
    /// <para>The callback opens its own connection: it is a different actor, and running it on
    /// the sweep's connection would be a self-update rather than a race. The sweep's SELECT holds
    /// no row locks, so nothing blocks.</para>
    /// </summary>
    private sealed class AfterFirstMicroclimateReadInterceptor(Func<Task> interfere) : DbCommandInterceptor
    {
        /// <summary>Asserted by the test: a race nobody entered proves nothing.</summary>
        public bool Fired { get; private set; }

        public override async ValueTask<DbDataReader> ReaderExecutedAsync(
            DbCommand command,
            CommandExecutedEventData eventData,
            DbDataReader result,
            CancellationToken cancellationToken = default)
        {
            if (!Fired && command.CommandText.Contains("FROM microclimates", StringComparison.Ordinal))
            {
                Fired = true;
                await interfere();
            }

            return await base.ReaderExecutedAsync(command, eventData, result, cancellationToken);
        }
    }
}
