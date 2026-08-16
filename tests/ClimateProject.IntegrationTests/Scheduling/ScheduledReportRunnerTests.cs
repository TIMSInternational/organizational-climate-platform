using System.Text.Json;
using ClimateProject.Api.Scheduling;
using ClimateProject.Application.Notifications;
using ClimateProject.Application.Reports;
using ClimateProject.Application.Scheduling;
using ClimateProject.Application.Surveys;
using ClimateProject.Domain.Entities;
using ClimateProject.Infrastructure.Persistence;
using ClimateProject.Infrastructure.Scheduling;
using ClimateProject.IntegrationTests.Support;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging.Abstractions;

namespace ClimateProject.IntegrationTests.Scheduling;

/// <summary>
/// #91's runner against a real Postgres: a due recurring report must come out the other end
/// as a generated document and one pending email-channel notification, and must NOT come out
/// as anything else -- not a second notification on a replay, not a mail to a deactivated
/// account, and never a suppressed group's headcount in the stored document.
///
/// <para>The stub's contract is asserted here too, because it is half of the delivery-truth
/// property: when <c>LoggingScheduledReportRunner</c> runs (the unconfigured-mail state, and
/// which runner runs is pinned by <c>ApiSchedulingCoHostTests</c> /
/// <c>EmailDeliveryRegistrationTests</c>), the schedule advances and nothing anywhere claims
/// a report was generated or delivered.</para>
///
/// <para>Mutation-tested 2026-08-16, each guard broken one at a time and restored:
/// deleting the runner's <c>db.Notifications.Add</c> block fails the delivery assertions;
/// deleting its duplicate-id guard fails the replay test with the primary-key violation the
/// deterministic id exists to cause; raising <c>SurveyResultsPrivacy</c>'s segment floor out
/// of the way (segment suppression never firing) fails the suppression test; making
/// <c>Program.cs</c> select the real runner unconditionally fails
/// <c>ApiSchedulingCoHostTests</c>' unconfigured-mail selection test.</para>
/// </summary>
[Collection("Postgres")]
public class ScheduledReportRunnerTests(PostgresContainerFixture postgres)
{
    private static readonly DateTimeOffset Now = new(2026, 8, 16, 15, 0, 0, TimeSpan.Zero);

    private ClimateProjectDbContext CreateContext()
        => new(new DbContextOptionsBuilder<ClimateProjectDbContext>()
            .UseNpgsql(postgres.ConnectionString)
            .Options);

    /// <summary>Migrated context over an empty database. Same reasoning as <see cref="SchedulingJobTests"/>.</summary>
    private async Task<ClimateProjectDbContext> FreshAsync()
    {
        var db = CreateContext();
        await db.Database.MigrateAsync();
        await db.Database.ExecuteSqlRawAsync("TRUNCATE TABLE companies CASCADE");
        return db;
    }

    private static DeliveringScheduledReportRunner RunnerFor(ClimateProjectDbContext db)
        => new(db, NullLogger<DeliveringScheduledReportRunner>.Instance);

    // -- seeding --------------------------------------------------------------------------

    private sealed record Seeded(Company Company, User Creator, Report Report, Guid EngineeringId, Guid SalesId);

    /// <summary>
    /// One company with a due daily report and one active survey whose completed responses
    /// split 5 Engineering / 2 Sales -- above the whole-survey floor of
    /// <see cref="SurveyResultsPrivacy.MinimumRespondents"/>, with Sales below the segment
    /// floor, so the aggregation must suppress exactly one department. The same shape
    /// <c>ReportEndpointsTests</c> uses for the endpoint path, seeded directly because no
    /// HTTP is involved here.
    /// </summary>
    private static async Task<Seeded> SeedAsync(ClimateProjectDbContext db, bool creatorIsActive = true)
    {
        var company = new Company
        {
            Id = Guid.NewGuid(),
            Name = $"Acme-{Guid.NewGuid():N}",
            Settings = new CompanySettings { Timezone = "UTC" },
            CreatedAt = Now.AddMonths(-6),
        };

        var creator = new User
        {
            Id = Guid.NewGuid(),
            CompanyId = company.Id,
            Email = $"admin-{Guid.NewGuid():N}@acme.test",
            Name = "Report Admin",
            Role = "company_admin",
            IsActive = creatorIsActive,
            Preferences = new UserPreferences { Timezone = "UTC", Language = "en" },
            CreatedAt = Now.AddMonths(-6),
            UpdatedAt = Now.AddMonths(-6),
        };

        var engineering = NewDepartment(company.Id, "Engineering");
        var sales = NewDepartment(company.Id, "Sales");

        var survey = new Survey
        {
            Id = Guid.NewGuid(),
            CompanyId = company.Id,
            CreatedBy = creator.Id,
            TitleEn = "Q3 Climate",
            Language = "en",
            Type = "general_climate",
            Status = SurveyStatuses.Active,
            StartDate = Now.AddDays(-30),
            EndDate = Now.AddDays(30),
            CreatedAt = Now.AddDays(-30),
            UpdatedAt = Now.AddDays(-30),
        };

        var question = new Question
        {
            Id = Guid.NewGuid(),
            SurveyId = survey.Id,
            TextEn = "How supported do you feel by leadership?",
            Type = "likert",
            ScaleMin = 1,
            ScaleMax = 5,
            Required = true,
            Order = 0,
            Category = "leadership",
        };

        var report = new Report
        {
            Id = Guid.NewGuid(),
            Title = "Monthly climate report",
            Type = "climate_summary",
            CompanyId = company.Id,
            CreatedBy = creator.Id,
            Status = "completed",
            Format = "pdf",
            IsRecurring = true,
            RecurrencePattern = RecurrenceSchedule.Daily,
            NextGeneration = Now.AddHours(-1),
            CreatedAt = Now.AddMonths(-6),
            UpdatedAt = Now.AddMonths(-6),
        };

        db.Companies.Add(company);
        db.Users.Add(creator);
        db.Departments.AddRange(engineering, sales);
        db.Surveys.Add(survey);
        db.Questions.Add(question);
        db.Reports.Add(report);

        for (var i = 0; i < 5; i++)
        {
            AddCompletedResponse(db, survey, question, engineering.Id, "4");
        }

        AddCompletedResponse(db, survey, question, sales.Id, "2");
        AddCompletedResponse(db, survey, question, sales.Id, "2");

        await db.SaveChangesAsync();

        return new Seeded(company, creator, report, engineering.Id, sales.Id);
    }

    private static Department NewDepartment(Guid companyId, string name) => new()
    {
        Id = Guid.NewGuid(),
        CompanyId = companyId,
        Name = name,
        CreatedAt = Now.AddMonths(-6),
        UpdatedAt = Now.AddMonths(-6),
    };

    /// <summary>
    /// One completed response with one answer, stored the way
    /// <c>question_responses.response_value</c> requires: a serialised JSON string, because
    /// the column is jsonb. Same rule as <c>ReportEndpointsTests.SeedAnswerAsync</c>.
    /// </summary>
    private static void AddCompletedResponse(
        ClimateProjectDbContext db, Survey survey, Question question, Guid departmentId, string value)
    {
        var responseId = Guid.NewGuid();
        db.Responses.Add(new Response
        {
            Id = responseId,
            SurveyId = survey.Id,
            CompanyId = survey.CompanyId,
            UserId = null,
            DepartmentId = departmentId,
            SessionId = Guid.NewGuid().ToString("N"),
            Language = "en",
            IsComplete = true,
            IsAnonymous = true,
            StartTime = Now.AddDays(-2),
            CompletionTime = Now.AddDays(-2).AddMinutes(5),
            TotalTimeSeconds = 300,
            CreatedAt = Now.AddDays(-2),
            UpdatedAt = Now.AddDays(-2),
        });
        db.QuestionResponses.Add(new QuestionResponse
        {
            ResponseId = responseId,
            QuestionId = question.Id,
            ResponseValue = JsonSerializer.Serialize(value),
            ResponseText = null,
        });
    }

    // -- the real runner, end to end through the sweep ------------------------------------

    [Fact]
    public async Task A_due_report_is_generated_and_delivered_as_one_pending_notification_and_a_second_sweep_adds_nothing()
    {
        await using var db = await FreshAsync();
        var seeded = await SeedAsync(db);
        var occurrenceUtc = seeded.Report.NextGeneration!.Value;

        var first = await ScheduledReportJob.RunAsync(
            db, RunnerFor(db), NullLoggerFactory.Instance, Now, ScheduledReportJob.DefaultBatchSize, default);

        Assert.Equal(1, first.Fired);

        await using var read = CreateContext();
        var report = await read.Reports.SingleAsync(r => r.Id == seeded.Report.Id);

        // Generated: the document is real, and the row says when.
        Assert.Equal("completed", report.Status);
        Assert.NotNull(report.ReportOutput);
        Assert.NotNull(report.GenerationStartedAt);
        Assert.NotNull(report.GenerationCompletedAt);
        Assert.Null(report.GenerationError);
        Assert.True(report.NextGeneration > Now);

        // Delivered THROUGH THE NOTIFICATION PATH: one pending email-channel row, addressed
        // to the report's creator, keyed deterministically on (report, occurrence) so a
        // replay is a primary-key violation rather than a second mail. The dispatch worker
        // owns everything from here -- consent, retries, the real transport.
        var notification = await read.Notifications.SingleAsync();
        Assert.Equal(DeterministicNotificationId.ForScheduledReport(seeded.Report.Id, occurrenceUtc), notification.Id);
        Assert.Equal(seeded.Creator.Id, notification.UserId);
        Assert.Equal(seeded.Company.Id, notification.CompanyId);
        Assert.Equal(NotificationChannels.Email, notification.Channel);
        Assert.Equal(NotificationStatuses.Pending, notification.Status);
        Assert.Equal(occurrenceUtc, notification.ScheduledFor);
        Assert.Equal(ScheduledNotificationCopy.ReportReadyTitleFor("en"), notification.Title);
        Assert.Contains("Monthly climate report", notification.Message, StringComparison.Ordinal);

        // The notice names the report and its date and nothing from inside it: no
        // participation figure may ride along in a mail that bypasses the download's
        // authorisation. "5" alone would be too blunt to grep for; the message is instead
        // pinned to the copy template, which interpolates only the title and the date.
        Assert.Equal(
            ScheduledNotificationCopy.ReportReadyBodyFor("en", "Monthly climate report", occurrenceUtc),
            notification.Message);

        // Idempotency of the whole pipeline: the advanced schedule means the next sweep
        // finds nothing, so nothing is regenerated and nothing else is mailed.
        var second = await ScheduledReportJob.RunAsync(
            read, RunnerFor(read), NullLoggerFactory.Instance, Now, ScheduledReportJob.DefaultBatchSize, default);
        Assert.Equal(0, second.Fired);
        Assert.Equal(1, await read.Notifications.CountAsync());
    }

    /// <summary>
    /// The privacy half (#320), through the scheduled path specifically: the stored document
    /// a scheduled report will mail a link to must carry the aggregation's own suppression
    /// decisions. Sales has 2 completed responses, below
    /// <see cref="SurveyResultsPrivacy.MinimumSegmentRespondents"/>; its row must say
    /// suppressed-and-zero, with the withheld headcount surviving only as the breakdown's
    /// reconciliation counter -- exactly what the results screens and POST /admin/reports
    /// serve, because it is exactly the same code.
    /// </summary>
    [Fact]
    public async Task A_scheduled_report_keeps_a_small_department_suppressed_in_the_stored_document()
    {
        await using var db = await FreshAsync();
        var seeded = await SeedAsync(db);

        await ScheduledReportJob.RunAsync(
            db, RunnerFor(db), NullLoggerFactory.Instance, Now, ScheduledReportJob.DefaultBatchSize, default);

        await using var read = CreateContext();
        var report = await read.Reports.SingleAsync(r => r.Id == seeded.Report.Id);
        var document = JsonSerializer.Deserialize<ReportOutputDocument>(report.ReportOutput!, JsonSerializerOptions.Web)!;

        var section = Assert.Single(document.Surveys);
        Assert.False(section.IsSuppressed);
        Assert.Equal(7, section.Participation.CompletedCount);

        var engineering = Assert.Single(section.Departments, d => d.DepartmentId == seeded.EngineeringId.ToString());
        Assert.False(engineering.IsSuppressed);
        Assert.Equal(5, engineering.RespondentCount);

        var sales = Assert.Single(section.Departments, d => d.DepartmentId == seeded.SalesId.ToString());
        Assert.True(sales.IsSuppressed);
        Assert.Equal(0, sales.RespondentCount);
        Assert.Null(sales.ParticipationRate);
        Assert.Equal(1, section.SuppressedDepartmentCount);
        Assert.Equal(2, section.SuppressedRespondentCount);
        Assert.Equal(SurveyResultsPrivacy.MinimumSegmentRespondents, section.MinimumGroupSize);
    }

    /// <summary>
    /// The seam's idempotency contract, exercised directly: the scheduler promises not to ask
    /// twice under normal operation, so this is the abnormal replay -- a lost lease, a manual
    /// re-run -- handing the SAME occurrence to the runner again. One notification, no
    /// primary-key violation, and the deterministic id is what makes both halves true.
    /// </summary>
    [Fact]
    public async Task Replaying_an_occurrence_regenerates_the_document_but_never_raises_a_second_notification()
    {
        await using var db = await FreshAsync();
        var seeded = await SeedAsync(db);
        var occurrence = new ScheduledReportOccurrence(
            seeded.Report.Id, seeded.Company.Id, seeded.Report.NextGeneration!.Value,
            seeded.Report.RecurrencePattern, seeded.Report.Format);

        var runner = RunnerFor(db);
        await runner.RunAsync(occurrence, default);
        await db.SaveChangesAsync();

        await runner.RunAsync(occurrence, default);
        await db.SaveChangesAsync();

        await using var read = CreateContext();
        Assert.Equal(1, await read.Notifications.CountAsync());
        Assert.NotNull((await read.Reports.SingleAsync(r => r.Id == seeded.Report.Id)).ReportOutput);
    }

    [Fact]
    public async Task A_deactivated_creator_still_gets_the_document_generated_but_no_mail_is_raised()
    {
        await using var db = await FreshAsync();
        var seeded = await SeedAsync(db, creatorIsActive: false);

        await ScheduledReportJob.RunAsync(
            db, RunnerFor(db), NullLoggerFactory.Instance, Now, ScheduledReportJob.DefaultBatchSize, default);

        await using var read = CreateContext();
        var report = await read.Reports.SingleAsync(r => r.Id == seeded.Report.Id);

        // The document exists for whoever is still authorised to fetch it; what must not
        // happen is mail to an account that was deactivated -- or GDPR-erased, which lands
        // in the same IsActive=false state.
        Assert.NotNull(report.ReportOutput);
        Assert.Equal(0, await read.Notifications.CountAsync());
    }

    // -- the stub, i.e. the unconfigured-mail state ---------------------------------------

    /// <summary>
    /// When mail is not configured the logging stub stays selected (pinned by
    /// <c>ApiSchedulingCoHostTests</c>), and this is what that state must mean at the rows:
    /// the schedule advances -- due detection keeps working, nothing re-fires forever -- but
    /// no report row and no notification row records a generation or a delivery that never
    /// happened. The same truthfulness rule the notification path applies to unconfigured
    /// mail, applied one level up.
    /// </summary>
    [Fact]
    public async Task The_logging_stub_advances_the_schedule_without_marking_anything_generated_or_delivered()
    {
        await using var db = await FreshAsync();
        var seeded = await SeedAsync(db);

        var result = await ScheduledReportJob.RunAsync(
            db,
            new LoggingScheduledReportRunner(NullLogger<LoggingScheduledReportRunner>.Instance),
            NullLoggerFactory.Instance,
            Now,
            ScheduledReportJob.DefaultBatchSize,
            default);

        Assert.Equal(1, result.Fired);

        await using var read = CreateContext();
        var report = await read.Reports.SingleAsync(r => r.Id == seeded.Report.Id);

        Assert.True(report.NextGeneration > Now);
        Assert.Null(report.ReportOutput);
        Assert.Null(report.GenerationStartedAt);
        Assert.Null(report.GenerationCompletedAt);
        Assert.Equal(0, await read.Notifications.CountAsync());
    }
}
