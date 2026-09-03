using System.Data.Common;
using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
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
using Microsoft.Extensions.Logging;
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

        // The literal, not MicroclimateLifecycleJob.DefaultBatchSize. The property's initialiser
        // IS that constant, so asserting them equal compared the constant with itself and would
        // have passed at any value, including one that made a "batch" the whole table.
        Assert.Equal(100, options.MicroclimateLifecycleBatchSize);
        Assert.Equal(100, MicroclimateLifecycleJob.DefaultBatchSize);
    }

    /// <summary>
    /// The batch size gets the same startup validation the interval does.
    ///
    /// <para>Only the interval was covered, and the asymmetry was not cosmetic:
    /// <c>Scheduling:MicroclimateLifecycleBatchSize=0</c> booted a host that looked healthy and
    /// then threw <see cref="ArgumentOutOfRangeException"/> out of <c>RunAsync</c> on every tick
    /// for ever, closing nothing. That is precisely the shape #189's fail-at-startup rule exists
    /// to stop, and <see cref="WorkerSchedulingOptions.Validate"/> already checked it -- nothing
    /// held the check in place.</para>
    /// </summary>
    [Fact]
    public void A_zero_lifecycle_batch_size_is_refused_at_startup_rather_than_on_every_tick()
    {
        var configuration = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["Scheduling:MicroclimateLifecycleBatchSize"] = "0",
            })
            .Build();

        var services = new ServiceCollection();

        var thrown = Assert.Throws<InvalidOperationException>(
            () => services.AddClimateProjectScheduling(configuration));

        // Named, so the message tells an operator which of nine settings to fix.
        Assert.Contains(nameof(WorkerSchedulingOptions.MicroclimateLifecycleBatchSize), thrown.Message, StringComparison.Ordinal);
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

    // -- the mirror interleaving: the sweep commits between a human's read and their write ------

    /// <summary>
    /// The other half of the race, and the half nothing covered.
    ///
    /// <para>The compare-and-swap makes a human win when their write lands BEFORE the sweep's
    /// UPDATE. It can do nothing about the mirror image -- the sweep committing between the
    /// human's SELECT and their UPDATE -- because by then the sweep has already decided. That
    /// window is the same size, and it is reached by exactly the same administrator doing exactly
    /// the same thing: extending a deadline seconds before it lapses.</para>
    ///
    /// <para><b>What happened there before this test existed.</b> <c>Microclimate</c> is the only
    /// entity in this schema carrying an optimistic-concurrency token (a shadow <c>RowVersion</c>
    /// over PostgreSQL's <c>xmin</c>), and the sweep's <c>ExecuteUpdateAsync</c> bumps it even
    /// though it bypasses the change tracker. So the admin's <c>SaveChanges</c> matched no row
    /// and EF threw <c>DbUpdateConcurrencyException</c>, which nothing caught: the pipeline's
    /// last-resort handler special-cased only a unique-index violation, so the answer was a bare
    /// <c>500</c> with no body. The extension was lost, the session was <c>closed</c> -- terminal,
    /// no edge back to <c>active</c>, none back to <c>draft</c>, no duplicate route -- and the
    /// administrator had no way to tell whether their edit had landed. That is verbatim the harm
    /// the deadline clause of the compare-and-swap was written to prevent, arrived at from the
    /// other side.</para>
    ///
    /// <para>The interleaving is made deterministic by holding the sweep's transaction open (as
    /// <c>PostgresAdvisoryJobLease</c> holds it for a whole tick) and waiting -- on
    /// <c>pg_stat_activity</c>, not a sleep -- until the administrator's own UPDATE is actually
    /// blocked on the row lock the sweep is holding. If it never blocks, the helper fails the
    /// test rather than letting it pass having raced nothing.</para>
    /// </summary>
    [Fact]
    public async Task An_extension_that_lands_after_the_close_has_committed_is_refused_and_never_a_500()
    {
        var endTime = DateTimeOffset.UtcNow.AddHours(1);
        var (admin, created) = await BuildApiSessionAsync(DateTimeOffset.UtcNow, endTime);

        Assert.Equal(HttpStatusCode.OK, (await admin.PostAsync($"/microclimates/{created.Id}/activate", null)).StatusCode);

        await using var sweepDb = CreateContext();
        await using var tx = await sweepDb.Database.BeginTransactionAsync();
        Assert.Equal(1, (await SweepAsync(sweepDb, MicroclimateLifecycleJob.DefaultBatchSize, endTime.AddHours(1))).Closed);

        // "Give everyone another two hours." Read before the close is visible, written after it.
        var extendedTo = endTime.AddHours(2);
        var extend = admin.PutAsJsonAsync(
            $"/microclimates/{created.Id}",
            new UpdateMicroclimateRequest(null, null, null, extendedTo));

        await WaitForBlockedMicroclimateWriteAsync("the administrator's extension");
        await tx.CommitAsync();

        var response = await extend;

        // A conflict, which is what this is, and never a 500: the request did not crash, it was
        // correctly refused because somebody -- something -- got there first.
        Assert.Equal(HttpStatusCode.Conflict, response.StatusCode);
        Assert.Contains(
            MicroclimateEndpoints.ClosedWindowEditMessage,
            await response.Content.ReadAsStringAsync(),
            StringComparison.Ordinal);

        // And the refusal is honest about the state it left behind: closed, on the deadline that
        // actually came due, not on the one the admin was in the middle of replacing.
        await using var read = CreateContext();
        var after = await read.Microclimates
            .Where(m => m.Id == created.Id)
            .Select(m => new { m.Status, EndTime = m.Scheduling.EndTime })
            .SingleAsync();
        Assert.Equal(MicroclimateStatuses.Closed, after.Status);
        Assert.NotEqual(extendedTo, after.EndTime);
    }

    /// <summary>
    /// The same interleaving on the transition route. <c>PUT /microclimates/{id}/status</c> and
    /// <c>POST /microclimates/{id}/activate</c> are a tracked read-then-save exactly as
    /// <c>PUT /microclimates/{id}</c> is, so they answered a bare 500 in the same window.
    ///
    /// <para>The admin here is closing the session by hand at the very moment the scheduler
    /// closes it, which is not a contrived collision: it is what an administrator does when a
    /// pulse reaches its deadline and they are watching. The correct answer is 200 and a closed
    /// session -- they asked for closed and it is closed -- and that is only reachable because the
    /// handler re-decides against what is now stored. Without that it crashed, and the admin was
    /// left unable to tell whether their close had landed.</para>
    ///
    /// <para>Deliberately <c>closed</c> and not <c>active</c>: a request for <c>active</c> against
    /// a row that still reads <c>active</c> is an idempotent no-op, so it writes nothing, takes no
    /// lock and never reaches this window at all. There is no request that both passes the
    /// transition map on the way in and is refused by it on the way out -- the sweep only ever
    /// touches <c>active</c> rows, and the only move out of <c>active</c> is the one it makes.
    /// The refusal direction of this race lives on <c>PUT /microclimates/{id}</c> instead, where
    /// an <c>EndTime</c> edit is a real change; see the test above.</para>
    /// </summary>
    [Fact]
    public async Task A_close_by_hand_that_races_the_sweep_answers_the_admin_instead_of_crashing()
    {
        var endTime = DateTimeOffset.UtcNow.AddHours(1);
        var (admin, created) = await BuildApiSessionAsync(DateTimeOffset.UtcNow, endTime);

        Assert.Equal(HttpStatusCode.OK, (await admin.PostAsync($"/microclimates/{created.Id}/activate", null)).StatusCode);

        await using var sweepDb = CreateContext();
        await using var tx = await sweepDb.Database.BeginTransactionAsync();
        Assert.Equal(1, (await SweepAsync(sweepDb, MicroclimateLifecycleJob.DefaultBatchSize, endTime.AddHours(1))).Closed);

        var byHand = admin.PutAsJsonAsync(
            $"/microclimates/{created.Id}/status",
            new UpdateMicroclimateStatusRequest(MicroclimateStatuses.Closed));

        await WaitForBlockedMicroclimateWriteAsync("the administrator's status change");
        await tx.CommitAsync();

        var response = await byHand;

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var detail = await response.Content.ReadFromJsonAsync<MicroclimateDetail>();
        Assert.Equal(MicroclimateStatuses.Closed, detail!.Status);
        Assert.Equal(MicroclimateStatuses.Closed, await StatusOfAsync(created.Id));
    }

    /// <summary>
    /// The response half of the same race, and the one the whole issue is about.
    ///
    /// <para><c>SubmitResponseAsync</c> checks <see cref="MicroclimateStatuses.AcceptsResponses"/>
    /// once, on the way in, and then enters a twenty-attempt optimistic-concurrency loop --
    /// because <c>ResponseCount</c> and the word cloud are a read-modify-write aggregate with no
    /// per-response row, so respondents answering at once genuinely do collide. The loop re-read
    /// the row and reapplied the increment on top of it <b>without re-reading the status</b>, and
    /// that was harmless only while every other writer of the row was another respondent.</para>
    ///
    /// <para>This job made the scheduler a routine writer of <c>microclimates.status</c>, on a
    /// timer, landing precisely when respondents are finishing. So every submission in flight when
    /// the close committed was admitted into a <c>closed</c> session and counted -- 201 Created,
    /// and folded into an aggregate the issue itself calls "not repairable retroactively". The
    /// slice's own end-to-end test could not see it: it issues the late request only after the
    /// sweep has fully committed, which is the easy ordering.</para>
    ///
    /// <para>The window here is not the sweep's transaction; it is the whole of one submit
    /// request. So the respondent's POST is fired while the close is uncommitted (their SELECT
    /// sees <c>active</c> and the gate passes), and the sweep commits only once their UPDATE is
    /// demonstrably blocked on the row lock.</para>
    /// </summary>
    [Fact]
    public async Task A_response_in_flight_when_the_close_commits_is_refused_and_not_counted()
    {
        var endTime = DateTimeOffset.UtcNow.AddHours(1);
        var (admin, created) = await BuildApiSessionAsync(DateTimeOffset.UtcNow, endTime);

        Assert.Equal(HttpStatusCode.OK, (await admin.PostAsync($"/microclimates/{created.Id}/activate", null)).StatusCode);

        var questionId = created.Questions.Single().Id;
        var respondent = postgres.App.CreateClient(); // deliberately no Authorization header

        await using var sweepDb = CreateContext();
        await using var tx = await sweepDb.Database.BeginTransactionAsync();
        Assert.Equal(1, (await SweepAsync(sweepDb, MicroclimateLifecycleJob.DefaultBatchSize, endTime.AddHours(1))).Closed);

        var late = respondent.PostAsJsonAsync(
            $"/microclimates/{created.Id}/responses",
            new SubmitResponseRequest(new Dictionary<Guid, string> { [questionId] = "answered as it shut" }));

        await WaitForBlockedMicroclimateWriteAsync("the respondent's submission");
        await tx.CommitAsync();

        var response = await late;

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Contains(
            MicroclimateEndpoints.NotAcceptingResponsesMessage,
            await response.Content.ReadAsStringAsync(),
            StringComparison.Ordinal);

        // The assertion that matters: not merely "the request was refused" but "the aggregate was
        // not moved". A refusal that still incremented the count would be the identical defect.
        await using var read = CreateContext();
        var after = await read.Microclimates
            .Where(m => m.Id == created.Id)
            .Select(m => new { m.Status, m.ResponseCount })
            .SingleAsync();
        Assert.Equal(MicroclimateStatuses.Closed, after.Status);
        Assert.Equal(0, after.ResponseCount);
    }

    // -- the window the sweep now reads has to be a real one ----------------------------------

    /// <summary>
    /// <c>POST /microclimates</c> validated nothing about the window it stored.
    ///
    /// <para><c>SurveyEndpoints</c> refuses <c>StartDate</c> after <c>EndDate</c> on three routes
    /// and <c>MicroclimateTemplateEndpoints.UseAsync</c> refuses this exact pair, so this route
    /// was the only one of the three that took it. Inert while nothing read the dates; now the
    /// first tick after such a session is activated closes it, terminally.</para>
    ///
    /// <para>The second case is the reachable one rather than the contrived one:
    /// <c>CreateMicroclimateRequest.EndTime</c> is non-nullable, so a body that simply omits
    /// <c>endTime</c> stores <c>0001-01-01</c> -- a deadline that has always been in the past.</para>
    /// </summary>
    [Fact]
    public async Task A_window_that_ends_before_it_starts_is_refused_at_creation()
    {
        var (admin, companyId) = await BuildApiAdminAsync();

        var transposed = await admin.PostAsJsonAsync("/microclimates", new CreateMicroclimateRequest(
            "Backwards",
            null,
            companyId,
            DateTimeOffset.UtcNow.AddDays(5),
            DateTimeOffset.UtcNow.AddDays(-5),
            4,
            true,
            null,
            null));

        Assert.Equal(HttpStatusCode.BadRequest, transposed.StatusCode);
        Assert.Contains(
            MicroclimateEndpoints.WindowOutOfOrderMessage,
            await transposed.Content.ReadAsStringAsync(),
            StringComparison.Ordinal);

        // The same refusal for the shape a client reaches by accident: no endTime at all.
        var omitted = await admin.PostAsync(
            "/microclimates",
            JsonContent.Create(new Dictionary<string, object?>
            {
                ["title"] = "No deadline",
                ["companyId"] = companyId,
                ["startTime"] = DateTimeOffset.UtcNow,
                ["targetParticipantCount"] = 4,
                ["anonymousResponses"] = true,
            }));

        Assert.Equal(HttpStatusCode.BadRequest, omitted.StatusCode);
        Assert.Contains(
            MicroclimateEndpoints.WindowOutOfOrderMessage,
            await omitted.Content.ReadAsStringAsync(),
            StringComparison.Ordinal);

        // And nothing was stored by either.
        await using var read = CreateContext();
        Assert.Equal(0, await read.Microclimates.CountAsync(m => m.CompanyId == companyId));
    }

    /// <summary>
    /// A session whose whole window is already behind it cannot be activated.
    ///
    /// <para>This is the guard that keeps the sweep from being the thing that destroys a
    /// microclimate. A window entirely in the past is a legitimate thing to <b>hold</b> -- the
    /// template route allows it and so does creation here -- but publishing one hands it straight
    /// to the next tick, and <c>closed</c> is terminal: no edge back to <c>active</c>, none back
    /// to <c>draft</c>, no duplicate route. Before this branch that sequence was inert; after it,
    /// an admin who published a stale draft lost it within five minutes.</para>
    ///
    /// <para>Asserted on all three routes that publish, because <c>ApplyStatusAsync</c> is the one
    /// place the rule lives and "bulk is a loop, never a bypass" is a claim that has to keep being
    /// true. And asserted in the negative too: <c>draft -&gt; closed</c>, filing an abandoned draft
    /// away, must stay open however long its window has been over -- there is no respondent to
    /// protect on that edge, and a gate that blocks cleanup protects nobody.</para>
    /// </summary>
    [Fact]
    public async Task A_microclimate_whose_window_is_already_over_cannot_be_published_but_can_be_filed_away()
    {
        var (admin, companyId) = await BuildApiAdminAsync();

        async Task<MicroclimateDetail> StaleDraftAsync()
        {
            var response = await admin.PostAsJsonAsync("/microclimates", new CreateMicroclimateRequest(
                "Last month's pulse",
                null,
                companyId,
                DateTimeOffset.UtcNow.AddHours(-2),
                DateTimeOffset.UtcNow.AddHours(-1),
                4,
                true,
                null,
                null));
            Assert.Equal(HttpStatusCode.Created, response.StatusCode);
            return (await response.Content.ReadFromJsonAsync<MicroclimateDetail>())!;
        }

        var viaActivate = await StaleDraftAsync();
        var activate = await admin.PostAsync($"/microclimates/{viaActivate.Id}/activate", null);
        Assert.Equal(HttpStatusCode.BadRequest, activate.StatusCode);
        Assert.Contains(
            "has already passed",
            await activate.Content.ReadAsStringAsync(),
            StringComparison.Ordinal);
        Assert.Equal(MicroclimateStatuses.Draft, await StatusOfAsync(viaActivate.Id));

        var viaUpdate = await StaleDraftAsync();
        var update = await admin.PutAsJsonAsync(
            $"/microclimates/{viaUpdate.Id}",
            new UpdateMicroclimateRequest(null, null, MicroclimateStatuses.Active, null));
        Assert.Equal(HttpStatusCode.BadRequest, update.StatusCode);
        Assert.Equal(MicroclimateStatuses.Draft, await StatusOfAsync(viaUpdate.Id));

        var viaBulk = await StaleDraftAsync();
        var bulk = await admin.PostAsJsonAsync(
            "/microclimates/bulk",
            new BulkMicroclimateActionRequest("activate", [viaBulk.Id]));
        Assert.Equal(HttpStatusCode.OK, bulk.StatusCode);
        var bulkBody = await bulk.Content.ReadFromJsonAsync<BulkMicroclimateActionResponse>();
        var item = Assert.Single(bulkBody!.Results);
        Assert.False(item.Succeeded);
        Assert.Contains("has already passed", item.Message!, StringComparison.Ordinal);
        Assert.Equal(MicroclimateStatuses.Draft, await StatusOfAsync(viaBulk.Id));

        // The negative: the same stale draft can still be filed away.
        var filed = await admin.PutAsJsonAsync(
            $"/microclimates/{viaBulk.Id}/status",
            new UpdateMicroclimateStatusRequest(MicroclimateStatuses.Closed));
        Assert.Equal(HttpStatusCode.OK, filed.StatusCode);
        Assert.Equal(MicroclimateStatuses.Closed, await StatusOfAsync(viaBulk.Id));

        // And "extend it, then publish it" -- the thing an admin actually wants -- still works in
        // one call, because the new deadline is applied before the gate reads it.
        var rescued = await StaleDraftAsync();
        var extendAndPublish = await admin.PutAsJsonAsync(
            $"/microclimates/{rescued.Id}",
            new UpdateMicroclimateRequest(null, null, MicroclimateStatuses.Active, DateTimeOffset.UtcNow.AddHours(3)));
        Assert.Equal(HttpStatusCode.OK, extendAndPublish.StatusCode);
        Assert.Equal(MicroclimateStatuses.Active, await StatusOfAsync(rescued.Id));
    }

    // -- what the sweep's own statement is scoped to -------------------------------------------

    /// <summary>
    /// Two tenants whose sessions end at the <b>identical</b> instant each get their own close,
    /// their own count and their own audit row.
    ///
    /// <para>Nothing pinned the row identity in the conditional UPDATE. Delete
    /// <c>m.Id == microclimate.Id</c> and the statement becomes
    /// <c>WHERE status = @from AND scheduling_end_time = @deadline</c> -- deployment-wide, no
    /// tenant, no row -- and every test in this class still passed, because no fixture anywhere
    /// put two microclimates on the same deadline. Production does, routinely: the wizard sends
    /// <c>new Date(datetime-local).toISOString()</c>, so every deadline a human picks is a whole
    /// minute with no sub-second component, and two companies ending a pulse at the same
    /// wall-clock minute produce byte-identical <c>timestamptz</c> values.</para>
    ///
    /// <para>What that would look like: one tenant's sweep closing another tenant's session, the
    /// <c>Closed</c> count under-reporting it (one statement, two rows, <c>moved</c> incremented
    /// once), and exactly one audit row -- so the second company's close would have no trail at
    /// all. Asserted through all three, because the status column alone would look right.</para>
    /// </summary>
    [Fact]
    public async Task Two_tenants_ending_at_the_same_instant_each_get_their_own_close_and_their_own_row()
    {
        await using var db = await FreshAsync();
        var (companyA, userA) = await SeedTenantAsync(db);
        var (companyB, userB) = await SeedTenantAsync(db);

        var sameDeadline = Now.AddHours(-1);
        var inA = NewMicroclimate(companyA, userA, MicroclimateStatuses.Active, Now.AddHours(-4), sameDeadline);
        var inB = NewMicroclimate(companyB, userB, MicroclimateStatuses.Active, Now.AddHours(-4), sameDeadline);
        db.Microclimates.AddRange(inA, inB);
        await db.SaveChangesAsync();

        var result = await SweepAsync(db);

        Assert.Equal(2, result.Closed);
        Assert.Equal(MicroclimateStatuses.Closed, await StatusOfAsync(inA.Id));
        Assert.Equal(MicroclimateStatuses.Closed, await StatusOfAsync(inB.Id));

        await using var read = CreateContext();
        var rows = await read.AuditLogs.AsNoTracking().ToListAsync();
        Assert.Equal(2, rows.Count);
        Assert.Equal(companyA, rows.Single(r => r.ResourceId == inA.Id.ToString()).CompanyId);
        Assert.Equal(companyB, rows.Single(r => r.ResourceId == inB.Id.ToString()).CompanyId);
    }

    /// <summary>
    /// When the cap bites, the sweep takes the oldest deadlines first.
    ///
    /// <para>The job argues at length that this "is not cosmetic: with a cap in play, ordering is
    /// what makes progress monotone", and nothing held it -- the batch-size test creates three
    /// rows and asserts only how many survive, never which, so reversing the ordering changed
    /// nothing any test could see. It is the difference between a backlog that drains and one
    /// where the session that ended on Tuesday goes on collecting answers while newer ones are
    /// closed ahead of it.</para>
    /// </summary>
    [Fact]
    public async Task When_the_cap_bites_the_oldest_deadline_goes_first()
    {
        Guid oldest, middle, newest;

        await using (var seed = await FreshAsync())
        {
            var (companyId, userId) = await SeedTenantAsync(seed);
            var a = NewMicroclimate(companyId, userId, MicroclimateStatuses.Active, Now.AddHours(-9), Now.AddHours(-3));
            var b = NewMicroclimate(companyId, userId, MicroclimateStatuses.Active, Now.AddHours(-9), Now.AddHours(-2));
            var c = NewMicroclimate(companyId, userId, MicroclimateStatuses.Active, Now.AddHours(-9), Now.AddHours(-1));

            // Inserted newest-first, so a sweep that simply took them in insertion order would
            // look identical to one that ordered descending.
            seed.Microclimates.AddRange(c, b, a);
            await seed.SaveChangesAsync();
            (oldest, middle, newest) = (a.Id, b.Id, c.Id);
        }

        await using (var first = CreateContext())
        {
            Assert.Equal(1, (await SweepAsync(first, batchSize: 1)).Closed);
        }

        Assert.Equal(MicroclimateStatuses.Closed, await StatusOfAsync(oldest));
        Assert.Equal(MicroclimateStatuses.Active, await StatusOfAsync(middle));
        Assert.Equal(MicroclimateStatuses.Active, await StatusOfAsync(newest));

        await using (var second = CreateContext())
        {
            Assert.Equal(1, (await SweepAsync(second, batchSize: 1)).Closed);
        }

        Assert.Equal(MicroclimateStatuses.Closed, await StatusOfAsync(middle));
        Assert.Equal(MicroclimateStatuses.Active, await StatusOfAsync(newest));
    }

    /// <summary>
    /// The stranded query honours the cap, and says so when it bites.
    ///
    /// <para>Two things were unheld. The <c>Take(batchSize)</c> on the stranded query could be
    /// <c>Take(1)</c> with every test still green -- no fixture had more than one stranded draft --
    /// and the count it reported was silently ceilinged, so a deployment with five hundred
    /// forgotten drafts logged "100 microclimate(s)" and an operator had no way to know the
    /// number was a floor. The count is the only thing this half of the issue produces at all.</para>
    /// </summary>
    [Fact]
    public async Task The_stranded_count_honours_the_cap_and_admits_when_it_is_a_floor()
    {
        await using (var seed = await FreshAsync())
        {
            var (companyId, userId) = await SeedTenantAsync(seed);
            for (var i = 1; i <= 3; i++)
            {
                seed.Microclimates.Add(NewMicroclimate(
                    companyId, userId, MicroclimateStatuses.Draft, Now.AddDays(-3), Now.AddHours(-i)));
            }

            await seed.SaveChangesAsync();
        }

        await using (var capped = CreateContext())
        {
            var result = await SweepAsync(capped, batchSize: 2);
            Assert.Equal(2, result.Stranded);
            Assert.True(result.StrandedCapped);
        }

        // Nothing was written, so the same three are still there; a cap that is not reached
        // reports the true number and says so.
        await using var whole = CreateContext();
        var full = await SweepAsync(whole, batchSize: 10);
        Assert.Equal(3, full.Stranded);
        Assert.False(full.StrandedCapped);
    }

    // -- what an operator actually reads ------------------------------------------------------

    /// <summary>
    /// The log lines this job produces, rendered.
    ///
    /// <para>Every test in this class passed a <see cref="NullLoggerFactory"/>, so no line in the
    /// job had ever been formatted by anything. That matters twice over. A template whose
    /// placeholder count disagrees with its arguments throws or silently drops values at render
    /// time, on a background thread, and nothing else here would notice. And the stranded warning
    /// is not decoration: it is the <b>only</b> artefact of the half of #376 this slice
    /// deliberately did not build -- a microclimate whose window came and went while nobody
    /// activated it -- so an unrendered warning means that half produces nothing at all.</para>
    ///
    /// <para>Asserted on the rendered string rather than on the template, and in both directions
    /// of the cap, because "the count is a floor" is a claim that only exists once rendered.</para>
    /// </summary>
    [Fact]
    public async Task The_sweep_renders_a_line_per_close_and_one_honest_warning_for_the_stranded()
    {
        Guid closing, strandedOne;

        await using (var seed = await FreshAsync())
        {
            var (companyId, userId) = await SeedTenantAsync(seed);
            var over = NewMicroclimate(companyId, userId, MicroclimateStatuses.Active, Now.AddHours(-4), Now.AddHours(-1));
            var neverRun = NewMicroclimate(companyId, userId, MicroclimateStatuses.Draft, Now.AddDays(-3), Now.AddDays(-2));
            var alsoNeverRun = NewMicroclimate(companyId, userId, MicroclimateStatuses.Draft, Now.AddDays(-3), Now.AddDays(-1));
            seed.Microclimates.AddRange(over, neverRun, alsoNeverRun);
            await seed.SaveChangesAsync();
            (closing, strandedOne) = (over.Id, neverRun.Id);
        }

        var recorder = new RecordingLoggerFactory();

        await using (var db = CreateContext())
        {
            // A cap of two, and exactly two stranded drafts: the page fills, so the count is a
            // floor and the line has to say so.
            await MicroclimateLifecycleJob.RunAsync(db, recorder, Now, 2, default);
        }

        var lines = recorder.Lines;

        // The per-row close line names the id somebody will ask about, and both ends of the move.
        Assert.Contains(lines, l => l.Contains(closing.ToString(), StringComparison.Ordinal)
                                    && l.Contains($"'{MicroclimateStatuses.Active}' -> '{MicroclimateStatuses.Closed}'", StringComparison.Ordinal));

        // The summary line carries the number, rendered, not the placeholder.
        Assert.Contains(lines, l => l.Contains("closed 1 session(s)", StringComparison.Ordinal));

        // The stranded warning: rendered, honest that the count is a floor, and naming an id.
        var warning = Assert.Single(lines, l => l.Contains("still 'draft'", StringComparison.Ordinal));
        Assert.Contains("2 microclimate(s) or more (this count is capped at the batch size)", warning, StringComparison.Ordinal);
        Assert.Contains(strandedOne.ToString(), warning, StringComparison.Ordinal);

        // Nothing rendered a raw placeholder: a template/argument mismatch shows up here and
        // nowhere else in the suite.
        Assert.DoesNotContain(lines, l => l.Contains("{Stranded}", StringComparison.Ordinal)
                                          || l.Contains("{MicroclimateId}", StringComparison.Ordinal)
                                          || l.Contains("{Closed}", StringComparison.Ordinal));

        // And with room to spare the same warning drops the floor clause rather than always
        // hedging -- an operator who cannot tell a capped count from a real one has neither.
        var second = new RecordingLoggerFactory();
        await using var again = CreateContext();
        await MicroclimateLifecycleJob.RunAsync(again, second, Now, 10, default);

        var uncapped = Assert.Single(second.Lines, l => l.Contains("still 'draft'", StringComparison.Ordinal));
        Assert.Contains("2 microclimate(s) are still 'draft'", uncapped, StringComparison.Ordinal);
        Assert.DoesNotContain("capped", uncapped, StringComparison.Ordinal);
    }

    // -- the audit row an operator has to be able to query -------------------------------------

    /// <summary>
    /// <c>audit_logs.details</c> is written with the default (Pascal) naming policy.
    ///
    /// <para>The job argues that this has to match <c>AuditWritingMiddleware.Describe</c> and
    /// <see cref="SurveyLifecycleJob"/> because "two casing conventions in one jsonb column would
    /// make it unqueryable without knowing which writer produced the row" -- and then the only
    /// assertions on the column were <c>Assert.Contains("active")</c> and
    /// <c>Assert.Contains("closed")</c>, which are VALUES. Serialising with
    /// <c>JsonSerializerDefaults.Web</c> renames every key to camelCase and passes all of them.
    /// So this asserts the keys, and asserts the camelCase ones are absent.</para>
    /// </summary>
    [Fact]
    public async Task The_audit_details_keys_are_pascal_case_like_every_other_writer_of_that_column()
    {
        await using var db = await FreshAsync();
        var (companyId, userId) = await SeedTenantAsync(db);

        db.Microclimates.Add(NewMicroclimate(
            companyId, userId, MicroclimateStatuses.Active, Now.AddHours(-4), Now.AddHours(-1)));
        await db.SaveChangesAsync();

        await SweepAsync(db);

        await using var read = CreateContext();
        var details = (await read.AuditLogs.AsNoTracking().SingleAsync()).Details;

        using var document = JsonDocument.Parse(details!);
        var root = document.RootElement;

        Assert.True(root.TryGetProperty("From", out var from));
        Assert.Equal(MicroclimateStatuses.Active, from.GetString());
        Assert.True(root.TryGetProperty("To", out var to));
        Assert.Equal(MicroclimateStatuses.Closed, to.GetString());
        Assert.True(root.TryGetProperty("Trigger", out _));

        Assert.False(root.TryGetProperty("from", out _));
        Assert.False(root.TryGetProperty("to", out _));
        Assert.False(root.TryGetProperty("trigger", out _));
    }

    /// <summary>
    /// <c>ClosedAction</c> was pinned against itself -- the audit test asserted
    /// <c>row.Action == MicroclimateLifecycleJob.ClosedAction</c>, which holds at any value. Its
    /// whole justification is that it must NOT collide with what the endpoint derives, so that an
    /// operator reading the trail can tell "the scheduler closed this on its end time" from
    /// "somebody sent a PUT". Pinned here against the literal and against the live derivation.
    /// </summary>
    [Fact]
    public void The_scheduler_files_a_different_action_from_the_status_endpoint()
    {
        var endpoint = postgres.App.Services
            .GetRequiredService<EndpointDataSource>()
            .Endpoints
            .OfType<RouteEndpoint>()
            .Single(e => e.RoutePattern.RawText == "/microclimates/{id:guid}/status"
                         && (e.Metadata.GetMetadata<HttpMethodMetadata>()?.HttpMethods.Contains("PUT") ?? false));

        var byHand = AuditPolicy.Decide(endpoint, HttpMethods.Put);
        Assert.True(byHand.IsAudited);

        Assert.Equal("microclimates.status.closed", MicroclimateLifecycleJob.ClosedAction);
        Assert.NotEqual(MicroclimateLifecycleJob.ClosedAction, byHand.Action);

        // Same resource on purpose, so one filter still returns every status change a
        // microclimate ever had -- it is the ACTION that separates the two writers.
        Assert.Equal(MicroclimateLifecycleJob.AuditResource, byHand.Resource);
    }

    // -- helpers for the API-driven races ------------------------------------------------------

    /// <summary>
    /// An admin client and a company of its own, both built through the product's own routes.
    /// </summary>
    private async Task<(HttpClient Admin, Guid CompanyId)> BuildApiAdminAsync()
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

        return (admin, companyId);
    }

    /// <summary>A live session with one open-ended question, created through the API.</summary>
    private async Task<(HttpClient Admin, MicroclimateDetail Created)> BuildApiSessionAsync(
        DateTimeOffset startTime,
        DateTimeOffset endTime)
    {
        var (admin, companyId) = await BuildApiAdminAsync();

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
        return (admin, (await createResponse.Content.ReadFromJsonAsync<MicroclimateDetail>())!);
    }

    /// <summary>
    /// Blocks until some other backend is genuinely waiting on a lock inside a statement that
    /// touches <c>microclimates</c>, and fails the test if none ever does.
    ///
    /// <para>This is what makes the "sweep commits first" interleaving deterministic without a
    /// sleep and a coin toss. The sweep's conditional UPDATE holds a row lock until its
    /// transaction commits -- exactly as <c>PostgresAdvisoryJobLease</c> holds one for a whole
    /// tick -- so a request that has passed its own read and reached its write is observably
    /// parked on that lock. Waiting for the lock rather than for a duration is also what makes the
    /// race impossible to enter vacuously: a test whose request never reached its write would
    /// otherwise pass while proving nothing, which is the failure mode a timed sleep has.</para>
    /// </summary>
    private async Task WaitForBlockedMicroclimateWriteAsync(string who)
    {
        await using var watch = CreateContext();

        for (var attempt = 0; attempt < 300; attempt++)
        {
            var blocked = await watch.Database
                .SqlQuery<int>($@"SELECT count(*)::int AS ""Value"" FROM pg_stat_activity
                                  WHERE datname = current_database()
                                    AND wait_event_type = 'Lock'
                                    AND query ILIKE '%microclimates%'")
                .SingleAsync();

            if (blocked > 0)
            {
                return;
            }

            await Task.Delay(100);
        }

        Assert.Fail(
            $"{who} never blocked on the lock the sweep is holding, so the interleaving under test "
            + "was never entered and any assertion below would be vacuous.");
    }

    /// <summary>
    /// Renders every log line the job writes, so assertions can be made on the rendered text
    /// rather than on the template that produced it.
    /// </summary>
    private sealed class RecordingLoggerFactory : ILoggerFactory
    {
        private readonly List<string> _lines = [];

        public IReadOnlyList<string> Lines
        {
            get
            {
                lock (_lines)
                {
                    return [.. _lines];
                }
            }
        }

        public ILogger CreateLogger(string categoryName) => new RecordingLogger(this);

        public void AddProvider(ILoggerProvider provider)
        {
        }

        public void Dispose()
        {
        }

        private void Record(string line)
        {
            lock (_lines)
            {
                _lines.Add(line);
            }
        }

        private sealed class RecordingLogger(RecordingLoggerFactory owner) : ILogger
        {
            public IDisposable? BeginScope<TState>(TState state)
                where TState : notnull => null;

            public bool IsEnabled(LogLevel logLevel) => true;

            public void Log<TState>(
                LogLevel logLevel,
                EventId eventId,
                TState state,
                Exception? exception,
                Func<TState, Exception?, string> formatter)
            {
                ArgumentNullException.ThrowIfNull(formatter);
                owner.Record(formatter(state, exception));
            }
        }
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
            "/auth/signup", new SignupRequest("Pulse Admin", email, "A-good-passw0rd"));
        Assert.Equal(HttpStatusCode.Created, signup.StatusCode);

        using (var scope = postgres.App.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>();
            var user = await db.Users.FirstAsync(u => u.Email == email);
            user.Role = Roles.CompanyAdmin;
            user.CompanyId = companyId;
            await db.SaveChangesAsync();
        }

        var login = await client.PostAsJsonAsync("/auth/login", new LoginRequest(email, "A-good-passw0rd"));
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
