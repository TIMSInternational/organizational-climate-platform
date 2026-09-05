using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using ClimateProject.Api.Endpoints;
using ClimateProject.Application.Auth;
using ClimateProject.Application.Reports;
using ClimateProject.Application.Scheduling;
using ClimateProject.Domain.Entities;
using ClimateProject.Infrastructure.Persistence;
using ClimateProject.Infrastructure.Scheduling;
using ClimateProject.IntegrationTests.Support;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging.Abstractions;

namespace ClimateProject.IntegrationTests.Reports;

/// <summary>
/// <c>PUT</c>/<c>DELETE /admin/reports/{id}/schedule</c> -- the writer for the three columns
/// <c>ScheduledReportJob</c> has always read.
///
/// <para><b>The defect these exist for.</b> <c>is_recurring</c>, <c>recurrence_pattern</c> and
/// <c>next_generation</c> were on the entity, mapped by <c>ReportConfiguration</c>, filtered on
/// by the sweep and delivered by <c>DeliveringScheduledReportRunner</c> -- and written by no
/// endpoint and no screen, with <c>is_recurring</c> defaulting to <c>false</c>. The sweep ran
/// every fifteen minutes against a predicate nothing could satisfy. Every component worked, so
/// no test of any component could see it; the first test below is the shape that can, because
/// it drives the sweep on both sides of the write.</para>
/// </summary>
[Collection("Postgres")]
public class ReportScheduleEndpointTests : IAsyncLifetime
{
    private readonly AuthWebApplicationFactory _factory;
    private readonly string _companyDomain = $"sched-{Guid.NewGuid():N}.test";
    private Guid _companyId;

    public ReportScheduleEndpointTests(PostgresContainerFixture postgres) => _factory = postgres.App;

    public async Task InitializeAsync()
    {
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>();
        var company = new Company
        {
            Id = Guid.NewGuid(),
            Name = "Schedule Co",
            EmailDomain = _companyDomain,
            CreatedAt = DateTimeOffset.UtcNow,
        };
        db.Companies.Add(company);
        _companyId = company.Id;
        await db.SaveChangesAsync();
    }

    public Task DisposeAsync() => Task.CompletedTask;

    /// <summary>
    /// Records what the sweep handed it. The real runner's generation and delivery are
    /// <c>ScheduledReportRunnerTests</c>' subject; what is under test here is whether the sweep
    /// <b>finds</b> the report at all, which is precisely what the missing writer prevented.
    /// </summary>
    private sealed class RecordingRunner : IScheduledReportRunner
    {
        public List<ScheduledReportOccurrence> Occurrences { get; } = [];

        public Task RunAsync(ScheduledReportOccurrence occurrence, CancellationToken cancellationToken)
        {
            Occurrences.Add(occurrence);
            return Task.CompletedTask;
        }
    }

    private async Task<HttpClient> AdminClientAsync()
    {
        var client = _factory.CreateClient();
        var email = $"{Guid.NewGuid():N}@{_companyDomain}";
        // Signup creates the account; the token that matters is the one minted AFTER the role
        // and company are set below, because the claims are stamped at issue time.
        var signup = await client.PostAsJsonAsync("/auth/signup", new SignupRequest("Test User", email, "A-good-passw0rd"));
        signup.EnsureSuccessStatusCode();

        using (var scope = _factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>();
            var user = await db.Users.FirstAsync(u => u.Email == email);
            user.Role = Roles.CompanyAdmin;
            user.CompanyId = _companyId;
            await db.SaveChangesAsync();
        }

        var login = await client.PostAsJsonAsync("/auth/login", new LoginRequest(email, "A-good-passw0rd"));
        var token = (await login.Content.ReadFromJsonAsync<TokenResponse>())!.Token;
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);
        return client;
    }

    private async Task<ReportDetail> CreateReportAsync(HttpClient client, Guid? companyId = null)
    {
        var response = await client.PostAsJsonAsync("/admin/reports", new CreateReportRequest(
            "Monthly Climate Report", null, "climate_summary", companyId ?? _companyId, "pdf", null));
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        return (await response.Content.ReadFromJsonAsync<ReportDetail>())!;
    }

    /// <summary>Runs one sweep at <paramref name="nowUtc"/> and reports what it fired.</summary>
    private async Task<List<ScheduledReportOccurrence>> SweepAsync(DateTimeOffset nowUtc)
    {
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>();
        var runner = new RecordingRunner();
        await ScheduledReportJob.RunAsync(
            db, runner, NullLoggerFactory.Instance, nowUtc, ScheduledReportJob.DefaultBatchSize, default);
        return runner.Occurrences;
    }

    private async Task<Report> ReadReportAsync(Guid id)
    {
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>();
        return await db.Reports.AsNoTracking().SingleAsync(r => r.Id == id);
    }

    // -- the guarantee the whole change exists for -----------------------------------------

    /// <summary>
    /// The sweep cannot find a report before it is scheduled and does find it after -- both
    /// halves in one method, because the "before" half is the defect and a fix asserted without
    /// it is a green test over a feature that was never broken.
    ///
    /// <para>The assertions are on <b>this</b> report's id rather than on
    /// <c>ScheduledReportSweepResult.Fired</c>: the suite shares one Postgres container, so
    /// another test's due report would make a global count flaky in a way that has nothing to
    /// do with this behaviour.</para>
    /// </summary>
    [Fact]
    public async Task A_report_is_invisible_to_the_sweep_until_it_is_scheduled_and_fires_once_it_is()
    {
        var client = await AdminClientAsync();
        var report = await CreateReportAsync(client);

        // Before: the row exists, is completed, and carries no schedule -- so no future sweep,
        // however far ahead, can ever select it. This is the state every report was in.
        Assert.False(report.IsRecurring);
        Assert.Null(report.RecurrencePattern);
        Assert.Null(report.NextGeneration);

        var farFuture = DateTimeOffset.UtcNow.AddYears(1);
        var beforeSchedule = await SweepAsync(farFuture);
        Assert.DoesNotContain(beforeSchedule, o => o.ReportId == report.Id);

        // The write.
        var startAt = DateTimeOffset.UtcNow.AddHours(1);
        var put = await client.PutAsJsonAsync(
            $"/admin/reports/{report.Id}/schedule",
            new SetReportScheduleRequest(RecurrenceSchedule.Monthly, startAt));
        Assert.Equal(HttpStatusCode.OK, put.StatusCode);

        var scheduled = (await put.Content.ReadFromJsonAsync<ReportDetail>())!;
        Assert.True(scheduled.IsRecurring);
        Assert.Equal(RecurrenceSchedule.Monthly, scheduled.RecurrencePattern);
        Assert.NotNull(scheduled.NextGeneration);

        // After: a sweep run past the occurrence finds exactly this report, once.
        var afterSchedule = await SweepAsync(scheduled.NextGeneration!.Value.AddMinutes(1));
        var mine = afterSchedule.Where(o => o.ReportId == report.Id).ToList();
        Assert.Single(mine);
        Assert.Equal(_companyId, mine[0].CompanyId);
        Assert.Equal(RecurrenceSchedule.Monthly, mine[0].RecurrencePattern);

        // And the sweep advanced it rather than leaving it due forever.
        var advanced = await ReadReportAsync(report.Id);
        Assert.True(advanced.IsRecurring);
        Assert.True(advanced.NextGeneration > scheduled.NextGeneration!.Value);
    }

    /// <summary>
    /// The job clears <c>next_generation</c> on an unrecognised pattern and deliberately leaves
    /// <c>is_recurring</c> alone, and its log line tells the administrator that "re-saving the
    /// schedule with a valid pattern resumes it". Nothing could re-save. This asserts the
    /// sentence is now true.
    /// </summary>
    [Fact]
    public async Task Re_saving_a_valid_pattern_resumes_a_schedule_the_sweep_had_cleared()
    {
        var client = await AdminClientAsync();
        var report = await CreateReportAsync(client);

        // Put the row into exactly the state the job's error path leaves behind.
        using (var scope = _factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>();
            var row = await db.Reports.SingleAsync(r => r.Id == report.Id);
            row.IsRecurring = true;
            row.RecurrencePattern = "fortnightly";
            row.NextGeneration = null;
            await db.SaveChangesAsync();
        }

        Assert.DoesNotContain(await SweepAsync(DateTimeOffset.UtcNow.AddYears(1)), o => o.ReportId == report.Id);

        var put = await client.PutAsJsonAsync(
            $"/admin/reports/{report.Id}/schedule",
            new SetReportScheduleRequest(RecurrenceSchedule.Weekly, null));
        Assert.Equal(HttpStatusCode.OK, put.StatusCode);

        var resumed = await ReadReportAsync(report.Id);
        Assert.Equal(RecurrenceSchedule.Weekly, resumed.RecurrencePattern);
        Assert.NotNull(resumed.NextGeneration);
        Assert.Contains(await SweepAsync(resumed.NextGeneration!.Value.AddMinutes(1)), o => o.ReportId == report.Id);
    }

    // -- validation -------------------------------------------------------------------------

    [Theory]
    [InlineData("fortnightly")]
    [InlineData("")]
    [InlineData("* * * * *")]
    [InlineData(null)]
    public async Task An_unrecognised_pattern_is_refused_and_writes_nothing(string? pattern)
    {
        var client = await AdminClientAsync();
        var report = await CreateReportAsync(client);

        var put = await client.PutAsJsonAsync(
            $"/admin/reports/{report.Id}/schedule",
            new SetReportScheduleRequest(pattern, null));

        Assert.Equal(HttpStatusCode.BadRequest, put.StatusCode);

        // The vocabulary is in the message: a caller who guessed cannot discover the right word
        // from a bare 400.
        var body = await put.Content.ReadAsStringAsync();
        Assert.Contains(RecurrenceSchedule.Biweekly, body, StringComparison.Ordinal);

        var untouched = await ReadReportAsync(report.Id);
        Assert.False(untouched.IsRecurring);
        Assert.Null(untouched.RecurrencePattern);
        Assert.Null(untouched.NextGeneration);
    }

    /// <summary>
    /// A start time in the past is refused rather than advanced. The job's catch-up rule exists
    /// for a schedule that fell behind while running; applying it to a brand-new schedule would
    /// answer 200 to "start on the 1st" and quietly mean a different date.
    /// </summary>
    [Fact]
    public async Task A_first_occurrence_in_the_past_is_refused_and_writes_nothing()
    {
        var client = await AdminClientAsync();
        var report = await CreateReportAsync(client);

        var put = await client.PutAsJsonAsync(
            $"/admin/reports/{report.Id}/schedule",
            new SetReportScheduleRequest(RecurrenceSchedule.Daily, DateTimeOffset.UtcNow.AddDays(-1)));

        Assert.Equal(HttpStatusCode.BadRequest, put.StatusCode);

        var untouched = await ReadReportAsync(report.Id);
        Assert.False(untouched.IsRecurring);
        Assert.Null(untouched.NextGeneration);
    }

    [Fact]
    public async Task A_future_start_time_is_stored_as_the_first_occurrence()
    {
        var client = await AdminClientAsync();
        var report = await CreateReportAsync(client);
        var startAt = DateTimeOffset.UtcNow.AddDays(3);

        var put = await client.PutAsJsonAsync(
            $"/admin/reports/{report.Id}/schedule",
            new SetReportScheduleRequest(RecurrenceSchedule.Quarterly, startAt));

        Assert.Equal(HttpStatusCode.OK, put.StatusCode);
        var stored = await ReadReportAsync(report.Id);

        // Round-tripped through JSON and Postgres, so compare the instant, not the struct.
        Assert.Equal(startAt.ToUnixTimeSeconds(), stored.NextGeneration!.Value.ToUnixTimeSeconds());
    }

    /// <summary>
    /// Omitting the start time schedules one period ahead, and the period is the one that was
    /// asked for. Two patterns whose first occurrences cannot overlap, so this fails if the
    /// pattern is ignored -- which a single-pattern assertion on "is in the future" would not.
    /// </summary>
    [Fact]
    public async Task Omitting_the_start_time_schedules_one_period_ahead_of_the_pattern_that_was_asked_for()
    {
        var client = await AdminClientAsync();
        var daily = await CreateReportAsync(client);
        var yearly = await CreateReportAsync(client);
        var before = DateTimeOffset.UtcNow;

        Assert.Equal(HttpStatusCode.OK, (await client.PutAsJsonAsync(
            $"/admin/reports/{daily.Id}/schedule",
            new SetReportScheduleRequest(RecurrenceSchedule.Daily, null))).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await client.PutAsJsonAsync(
            $"/admin/reports/{yearly.Id}/schedule",
            new SetReportScheduleRequest(RecurrenceSchedule.Yearly, null))).StatusCode);

        var dailyNext = (await ReadReportAsync(daily.Id)).NextGeneration!.Value;
        var yearlyNext = (await ReadReportAsync(yearly.Id)).NextGeneration!.Value;

        // Bounds, not equality: the endpoint reads its own clock, and the local-wall-clock
        // arithmetic can move a boundary by an hour across a DST change. Wide enough to be
        // stable on any calendar day, narrow enough that the two patterns cannot be confused.
        Assert.InRange(dailyNext, before.AddHours(22), before.AddHours(26));
        Assert.InRange(yearlyNext, before.AddDays(360), before.AddDays(370));
    }

    // -- clearing ---------------------------------------------------------------------------

    [Fact]
    public async Task Clearing_a_schedule_removes_all_three_columns_and_the_sweep_stops_finding_it()
    {
        var client = await AdminClientAsync();
        var report = await CreateReportAsync(client);

        var put = await client.PutAsJsonAsync(
            $"/admin/reports/{report.Id}/schedule",
            new SetReportScheduleRequest(RecurrenceSchedule.Daily, null));
        var scheduled = (await put.Content.ReadFromJsonAsync<ReportDetail>())!;
        Assert.Contains(await SweepAsync(scheduled.NextGeneration!.Value.AddMinutes(1)), o => o.ReportId == report.Id);

        var delete = await client.DeleteAsync($"/admin/reports/{report.Id}/schedule");
        Assert.Equal(HttpStatusCode.OK, delete.StatusCode);

        var cleared = await ReadReportAsync(report.Id);
        Assert.False(cleared.IsRecurring);
        Assert.Null(cleared.RecurrencePattern);

        // The stale occurrence is gone too. Leaving it would make a schedule switched back on
        // months later fire an occurrence dated to whenever it was switched off.
        Assert.Null(cleared.NextGeneration);
        Assert.DoesNotContain(await SweepAsync(DateTimeOffset.UtcNow.AddYears(1)), o => o.ReportId == report.Id);
    }

    // -- access -----------------------------------------------------------------------------

    [Fact]
    public async Task Another_companys_report_cannot_be_scheduled_or_cleared()
    {
        Guid otherReportId;
        using (var scope = _factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>();
            var other = new Company
            {
                Id = Guid.NewGuid(),
                Name = "Other Co",
                EmailDomain = $"other-{Guid.NewGuid():N}.test",
                CreatedAt = DateTimeOffset.UtcNow,
            };
            db.Companies.Add(other);
            var creator = await db.Users.FirstAsync();
            var report = new Report
            {
                Id = Guid.NewGuid(),
                Title = "Someone else's report",
                Type = "climate_summary",
                CompanyId = other.Id,
                CreatedBy = creator.Id,
                Status = "completed",
                Format = "pdf",
                CreatedAt = DateTimeOffset.UtcNow,
                UpdatedAt = DateTimeOffset.UtcNow,
            };
            db.Reports.Add(report);
            otherReportId = report.Id;
            await db.SaveChangesAsync();
        }

        var client = await AdminClientAsync();

        var put = await client.PutAsJsonAsync(
            $"/admin/reports/{otherReportId}/schedule",
            new SetReportScheduleRequest(RecurrenceSchedule.Daily, null));
        Assert.Equal(HttpStatusCode.Forbidden, put.StatusCode);

        Assert.Equal(
            HttpStatusCode.Forbidden,
            (await client.DeleteAsync($"/admin/reports/{otherReportId}/schedule")).StatusCode);

        var untouched = await ReadReportAsync(otherReportId);
        Assert.False(untouched.IsRecurring);
    }

    [Fact]
    public async Task An_unknown_report_is_not_found_rather_than_forbidden()
    {
        var client = await AdminClientAsync();

        var put = await client.PutAsJsonAsync(
            $"/admin/reports/{Guid.NewGuid()}/schedule",
            new SetReportScheduleRequest(RecurrenceSchedule.Daily, null));

        Assert.Equal(HttpStatusCode.NotFound, put.StatusCode);
    }

    // -- the list carries it ------------------------------------------------------------------

    /// <summary>
    /// The schedule is on the list projection, not only on the detail. Without it the screen
    /// cannot say which of a company's reports mails itself, which is the question the column
    /// exists to answer.
    /// </summary>
    [Fact]
    public async Task The_list_projection_carries_the_schedule()
    {
        var client = await AdminClientAsync();
        var report = await CreateReportAsync(client);
        await client.PutAsJsonAsync(
            $"/admin/reports/{report.Id}/schedule",
            new SetReportScheduleRequest(RecurrenceSchedule.Monthly, null));

        var list = await client.GetFromJsonAsync<List<ReportListItem>>($"/admin/reports?companyId={_companyId}");
        var row = list!.Single(r => r.Id == report.Id);

        Assert.True(row.IsRecurring);
        Assert.Equal(RecurrenceSchedule.Monthly, row.RecurrencePattern);
        Assert.NotNull(row.NextGeneration);
    }
}
