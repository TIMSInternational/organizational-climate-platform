using ClimateProject.Domain.Entities;
using ClimateProject.Infrastructure.Persistence;
using ClimateProject.IntegrationTests.Support;
using Microsoft.EntityFrameworkCore;
using Npgsql;

namespace ClimateProject.IntegrationTests.Persistence;

/// <summary>
/// #168. Four columns named for <c>surveys</c> gained a real foreign key; the whole point of the
/// exercise was the <c>ON DELETE</c> behaviour, and it is not the same for all four.
/// </summary>
/// <remarks>
/// <para>
/// <b>Why these are database assertions and not endpoint assertions.</b> A survey is
/// hard-deleted (<c>SurveyEndpoints.cs:930</c>, <c>db.Surveys.Remove</c>), so what happens to
/// the rows that named it is decided by the constraint, not by any C# the request runs. The
/// deletes below therefore go through a context that has loaded nothing but the survey, exactly
/// as the endpoint's does, so no EF client-side fixup can stand in for the constraint and make
/// a green test out of a database that would have behaved differently.
/// </para>
/// <para>
/// Each fact here fails loudly if the delete behaviour is ever changed by a later migration --
/// which is the point. The three <c>SET NULL</c>s and the one <c>CASCADE</c> are a trade that
/// was argued in <c>docs/decisions/survey-foreign-keys.md</c>; a future change to any of them
/// should have to rewrite the argument, not just the schema.
/// </para>
/// </remarks>
[Collection("Postgres")]
public class SurveyForeignKeyDeleteBehaviourTests(PostgresContainerFixture postgres)
{
    private ClimateProjectDbContext CreateContext()
    {
        var options = new DbContextOptionsBuilder<ClimateProjectDbContext>()
            .UseNpgsql(postgres.ConnectionString)
            .Options;
        return new ClimateProjectDbContext(options);
    }

    private static Survey NewSurvey(Guid companyId, Guid createdBy) => new()
    {
        Id = Guid.NewGuid(),
        CompanyId = companyId,
        CreatedBy = createdBy,
        TitleEn = "Engagement",
        Type = "custom",
        StartDate = DateTimeOffset.UtcNow,
        EndDate = DateTimeOffset.UtcNow.AddDays(7),
        CreatedAt = DateTimeOffset.UtcNow,
        UpdatedAt = DateTimeOffset.UtcNow,
    };

    private async Task<(Company company, User user)> SeedCompanyAndUserAsync(ClimateProjectDbContext db)
    {
        var company = new Company { Id = Guid.NewGuid(), Name = "FkAcme", CreatedAt = DateTimeOffset.UtcNow };
        db.Companies.Add(company);
        await db.SaveChangesAsync();

        var user = new User
        {
            Id = Guid.NewGuid(),
            CompanyId = company.Id,
            Email = $"fk-admin-{Guid.NewGuid():N}@fkacme.test",
            Name = "Admin",
            Role = "company_admin",
            CreatedAt = DateTimeOffset.UtcNow,
            UpdatedAt = DateTimeOffset.UtcNow,
        };
        db.Users.Add(user);
        await db.SaveChangesAsync();
        return (company, user);
    }

    /// <summary>
    /// Deletes the survey the way the endpoint does: through a context that knows about nothing
    /// else, so the referential action is Postgres's and not EF's.
    /// </summary>
    private async Task DeleteSurveyAsync(Guid surveyId)
    {
        await using var db = CreateContext();
        var survey = await db.Surveys.SingleAsync(s => s.Id == surveyId);
        db.Surveys.Remove(survey);
        await db.SaveChangesAsync();
    }

    [Fact]
    public async Task Deleting_a_survey_keeps_the_action_plan_and_nulls_its_provenance()
    {
        await using var db = CreateContext();
        await db.Database.MigrateAsync();
        var (company, user) = await SeedCompanyAndUserAsync(db);
        var survey = NewSurvey(company.Id, user.Id);
        db.Surveys.Add(survey);
        await db.SaveChangesAsync();

        var plan = new ActionPlan
        {
            Id = Guid.NewGuid(),
            Title = "Follow up on Q3",
            Description = "Plan drawn from the Q3 engagement survey.",
            CompanyId = company.Id,
            CreatedBy = user.Id,
            DueDate = DateTimeOffset.UtcNow.AddMonths(1),
            SourceSurveyId = survey.Id,
            CreatedAt = DateTimeOffset.UtcNow,
            UpdatedAt = DateTimeOffset.UtcNow,
        };
        db.ActionPlans.Add(plan);
        await db.SaveChangesAsync();

        await DeleteSurveyAsync(survey.Id);

        await using var readDb = CreateContext();
        var loaded = await readDb.ActionPlans.SingleOrDefaultAsync(a => a.Id == plan.Id);
        Assert.NotNull(loaded);
        Assert.Null(loaded.SourceSurveyId);
        // The plan itself is untouched -- SET NULL drops the pointer, not the work.
        Assert.Equal("Follow up on Q3", loaded.Title);
    }

    [Fact]
    public async Task Deleting_a_survey_keeps_the_ai_insight_and_its_acknowledgement()
    {
        await using var db = CreateContext();
        await db.Database.MigrateAsync();
        var (company, user) = await SeedCompanyAndUserAsync(db);
        var survey = NewSurvey(company.Id, user.Id);
        db.Surveys.Add(survey);
        await db.SaveChangesAsync();

        var acknowledgedAt = DateTimeOffset.UtcNow;
        var insight = new AIInsight
        {
            Id = Guid.NewGuid(),
            SurveyId = survey.Id,
            CompanyId = company.Id,
            Type = "risk",
            Category = "attrition",
            Title = "Elevated attrition risk",
            Description = "Engagement trending down.",
            ConfidenceScore = 80,
            Priority = "high",
            IsAcknowledged = true,
            AcknowledgedBy = user.Id,
            AcknowledgedAt = acknowledgedAt,
            CreatedAt = DateTimeOffset.UtcNow,
            UpdatedAt = DateTimeOffset.UtcNow,
        };
        db.AIInsights.Add(insight);
        await db.SaveChangesAsync();

        await DeleteSurveyAsync(survey.Id);

        await using var readDb = CreateContext();
        var loaded = await readDb.AIInsights.SingleOrDefaultAsync(i => i.Id == insight.Id);
        Assert.NotNull(loaded);
        Assert.Null(loaded.SurveyId);
        // This is the reason the column is SET NULL rather than CASCADE: the sign-off survives.
        Assert.True(loaded.IsAcknowledged);
        Assert.Equal(user.Id, loaded.AcknowledgedBy);
    }

    [Fact]
    public async Task Deleting_a_survey_keeps_the_analytics_insight_and_its_children()
    {
        await using var db = CreateContext();
        await db.Database.MigrateAsync();
        var (company, user) = await SeedCompanyAndUserAsync(db);
        var survey = NewSurvey(company.Id, user.Id);
        db.Surveys.Add(survey);
        await db.SaveChangesAsync();

        var insight = new AnalyticsInsight
        {
            Id = Guid.NewGuid(),
            SurveyId = survey.Id,
            CompanyId = company.Id,
            AggregationType = "company",
            MetricType = "engagement",
            MetricName = "Overall engagement",
            TotalResponses = 42,
            CalculationDate = DateTimeOffset.UtcNow,
            CreatedAt = DateTimeOffset.UtcNow,
            UpdatedAt = DateTimeOffset.UtcNow,
        };
        db.AnalyticsInsights.Add(insight);
        await db.SaveChangesAsync();

        var point = new AnalyticsMetricData
        {
            Id = Guid.NewGuid(), InsightId = insight.Id, Label = "Engineering", Value = 7.5,
        };
        db.AnalyticsMetricData.Add(point);
        await db.SaveChangesAsync();

        await DeleteSurveyAsync(survey.Id);

        await using var readDb = CreateContext();
        var loaded = await readDb.AnalyticsInsights.SingleOrDefaultAsync(i => i.Id == insight.Id);
        Assert.NotNull(loaded);
        Assert.Null(loaded.SurveyId);
        // SET NULL on the parent must not reach the children by any other route.
        Assert.True(await readDb.AnalyticsMetricData.AnyAsync(m => m.Id == point.Id));
    }

    [Fact]
    public async Task Deleting_a_survey_deletes_its_demographic_snapshot_and_the_snapshot_children()
    {
        await using var db = CreateContext();
        await db.Database.MigrateAsync();
        var (company, user) = await SeedCompanyAndUserAsync(db);
        var survey = NewSurvey(company.Id, user.Id);
        db.Surveys.Add(survey);
        await db.SaveChangesAsync();

        var snapshot = new DemographicSnapshot
        {
            Id = Guid.NewGuid(),
            SurveyId = survey.Id,
            CompanyId = company.Id,
            Version = 1,
            Timestamp = DateTimeOffset.UtcNow,
            CreatedBy = user.Id,
            Reason = "Initial snapshot at survey launch",
            CreatedAt = DateTimeOffset.UtcNow,
            UpdatedAt = DateTimeOffset.UtcNow,
        };
        db.DemographicSnapshots.Add(snapshot);
        await db.SaveChangesAsync();

        var entry = new DemographicSnapshotEntry
        {
            Id = Guid.NewGuid(), SnapshotId = snapshot.Id, UserId = user.Id,
            Department = "Engineering", Role = "company_admin", Tenure = "1-2 years",
        };
        db.DemographicSnapshotEntries.Add(entry);
        await db.SaveChangesAsync();

        await DeleteSurveyAsync(survey.Id);

        await using var readDb = CreateContext();
        // survey_id is NOT NULL, so there is no third option: the snapshot goes with the survey.
        Assert.False(await readDb.DemographicSnapshots.AnyAsync(s => s.Id == snapshot.Id));
        // And the cascade reaches the snapshot's own children, which is the cost this trade
        // accepted knowingly -- see the migration's comment and the decision note.
        Assert.False(await readDb.DemographicSnapshotEntries.AnyAsync(e => e.Id == entry.Id));
    }

    [Fact]
    public async Task A_survey_reference_that_names_no_survey_is_now_rejected_by_the_database()
    {
        await using var db = CreateContext();
        await db.Database.MigrateAsync();
        var (company, user) = await SeedCompanyAndUserAsync(db);

        // Before #168 this row inserted happily. Nothing in ActionPlanEndpoints checks the id,
        // so the database is the only thing that ever will.
        db.ActionPlans.Add(new ActionPlan
        {
            Id = Guid.NewGuid(),
            Title = "Plan pointing nowhere",
            Description = "Names a survey id that was never issued.",
            CompanyId = company.Id,
            CreatedBy = user.Id,
            DueDate = DateTimeOffset.UtcNow.AddMonths(1),
            SourceSurveyId = Guid.NewGuid(),
            CreatedAt = DateTimeOffset.UtcNow,
            UpdatedAt = DateTimeOffset.UtcNow,
        });

        var ex = await Assert.ThrowsAsync<DbUpdateException>(() => db.SaveChangesAsync());
        var pg = Assert.IsType<PostgresException>(ex.InnerException);
        Assert.Equal(PostgresErrorCodes.ForeignKeyViolation, pg.SqlState);
    }

    [Fact]
    public async Task A_snapshot_naming_no_survey_is_rejected_even_though_the_constraint_arrives_NOT_VALID()
    {
        await using var db = CreateContext();
        await db.Database.MigrateAsync();
        var (company, user) = await SeedCompanyAndUserAsync(db);

        // The demographic_snapshots constraint is added NOT VALID so that a production row that
        // predates it cannot fail the deploy. NOT VALID defers the check of EXISTING rows only:
        // every insert and update from that moment on is enforced. This is that claim, measured,
        // because "NOT VALID" reads like "not enforced" and is not.
        db.DemographicSnapshots.Add(new DemographicSnapshot
        {
            Id = Guid.NewGuid(),
            SurveyId = Guid.NewGuid(),
            CompanyId = company.Id,
            Version = 1,
            Timestamp = DateTimeOffset.UtcNow,
            CreatedBy = user.Id,
            Reason = "Snapshot of a survey that does not exist",
            CreatedAt = DateTimeOffset.UtcNow,
            UpdatedAt = DateTimeOffset.UtcNow,
        });

        var ex = await Assert.ThrowsAsync<DbUpdateException>(() => db.SaveChangesAsync());
        var pg = Assert.IsType<PostgresException>(ex.InnerException);
        Assert.Equal(PostgresErrorCodes.ForeignKeyViolation, pg.SqlState);
    }

    [Fact]
    public async Task Source_insight_id_still_takes_any_guid_because_its_parent_table_is_undecided()
    {
        await using var db = CreateContext();
        await db.Database.MigrateAsync();
        var (company, user) = await SeedCompanyAndUserAsync(db);

        // Deliberate, not an oversight. ai_insights and analytics_insights are separate tables
        // with separate id spaces and nothing in the schema, the DTOs or the endpoints says which
        // one this column names, so #168 left it unconstrained rather than guessing a parent that
        // a foreign key would then make permanent. This test is the marker: it goes red the day
        // somebody rules, and the ruling is written up in docs/decisions/survey-foreign-keys.md.
        var plan = new ActionPlan
        {
            Id = Guid.NewGuid(),
            Title = "Plan from an insight",
            Description = "source_insight_id has no declared parent table.",
            CompanyId = company.Id,
            CreatedBy = user.Id,
            DueDate = DateTimeOffset.UtcNow.AddMonths(1),
            SourceInsightId = Guid.NewGuid(),
            CreatedAt = DateTimeOffset.UtcNow,
            UpdatedAt = DateTimeOffset.UtcNow,
        };
        db.ActionPlans.Add(plan);
        await db.SaveChangesAsync();

        await using var readDb = CreateContext();
        var loaded = await readDb.ActionPlans.SingleAsync(a => a.Id == plan.Id);
        Assert.Equal(plan.SourceInsightId, loaded.SourceInsightId);
    }
}
