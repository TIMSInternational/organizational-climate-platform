using ClimateProject.Application.Surveys;
using ClimateProject.DataMigration.Loading;
using ClimateProject.DataMigration.Mapping;
using ClimateProject.DataMigration.Reporting;
using ClimateProject.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using MongoDB.Bson;
using MongoDB.Driver;
using Testcontainers.MongoDb;
using Testcontainers.PostgreSql;

namespace ClimateProject.DataMigration.Tests;

/// <summary>
/// One Mongo and one Postgres container for the whole class - a container per test
/// case is the mistake #279 existed to stop. Each test gets its own logical Mongo
/// database; Postgres state is reset per test by deleting from the five loaded tables
/// (child-first), because the schema comes from the real EF migrations.
/// </summary>
public sealed class EtlContainersFixture : IAsyncLifetime
{
    private readonly MongoDbContainer _mongo = new MongoDbBuilder("mongo:7.0").Build();
    private readonly PostgreSqlContainer _postgres = new PostgreSqlBuilder("postgres:16-alpine")
        .WithDatabase("etl_target").WithUsername("postgres").WithPassword("postgres").Build();

    public MongoClient Mongo { get; private set; } = null!;

    public string PostgresConnectionString => _postgres.GetConnectionString();

    public ClimateProjectDbContext CreateDb()
        => new(new DbContextOptionsBuilder<ClimateProjectDbContext>()
            .UseNpgsql(PostgresConnectionString).Options);

    public async Task ResetTargetAsync()
    {
        await using var db = CreateDb();
        await db.Database.ExecuteSqlRawAsync(
            """
            DELETE FROM question_responses;
            DELETE FROM response_demographics;
            DELETE FROM responses;
            DELETE FROM microclimate_invitations;
            DELETE FROM microclimate_ai_insights;
            DELETE FROM microclimate_department_targets;
            DELETE FROM microclimate_question_options;
            DELETE FROM microclimate_questions;
            DELETE FROM microclimates;
            DELETE FROM microclimate_template_question_options;
            DELETE FROM microclimate_template_questions;
            DELETE FROM microclimate_templates;
            DELETE FROM survey_audit_logs;
            DELETE FROM survey_invitations;
            DELETE FROM survey_distributions;
            DELETE FROM survey_drafts;
            DELETE FROM survey_versions;
            DELETE FROM template_question_options;
            DELETE FROM template_questions;
            DELETE FROM survey_templates;
            DELETE FROM question_options;
            DELETE FROM question_emoji_options;
            DELETE FROM question_conditional_logic;
            DELETE FROM questions;
            DELETE FROM survey_department_targets;
            DELETE FROM surveys;
            DELETE FROM user_demographics;
            DELETE FROM demographic_field_options;
            DELETE FROM users;
            DELETE FROM departments;
            DELETE FROM demographic_fields;
            DELETE FROM system_settings;
            DELETE FROM companies;
            """);
    }

    public async Task InitializeAsync()
    {
        await Task.WhenAll(_mongo.StartAsync(), _postgres.StartAsync());
        Mongo = new MongoClient(_mongo.GetConnectionString());
        await using var db = CreateDb();
        await db.Database.MigrateAsync();
    }

    public async Task DisposeAsync()
    {
        await _mongo.DisposeAsync();
        await _postgres.DisposeAsync();
    }
}

public class PipelineTests : IClassFixture<EtlContainersFixture>
{
    private readonly EtlContainersFixture _fx;

    public PipelineTests(EtlContainersFixture fixture) => _fx = fixture;

    private static readonly ObjectId AcmeOid = ObjectId.Parse("64b000000000000000000001");
    private static readonly ObjectId EngOid = ObjectId.Parse("64b000000000000000000011");
    private static readonly ObjectId ApiOid = ObjectId.Parse("64b000000000000000000012");
    private static readonly ObjectId AdaOid = ObjectId.Parse("64b000000000000000000021");
    private static readonly ObjectId GraceOid = ObjectId.Parse("64b000000000000000000022");
    private static readonly ObjectId RootOid = ObjectId.Parse("64b000000000000000000023");
    private static readonly ObjectId TenureOid = ObjectId.Parse("64b000000000000000000031");
    private static readonly ObjectId SurveyOid = ObjectId.Parse("64b000000000000000000051");
    private static readonly ObjectId ResponseOid = ObjectId.Parse("64b000000000000000000061");
    private static readonly ObjectId AnonResponseOid = ObjectId.Parse("64b000000000000000000062");
    private static readonly ObjectId TemplateOid = ObjectId.Parse("64b000000000000000000071");
    private static readonly ObjectId VersionOid = ObjectId.Parse("64b000000000000000000081");
    private static readonly ObjectId AuditOid = ObjectId.Parse("64b000000000000000000091");
    private static readonly ObjectId AuditDeletedOid = ObjectId.Parse("64b000000000000000000092");
    private static readonly ObjectId DraftOid = ObjectId.Parse("64b0000000000000000000a1");
    private static readonly ObjectId DistOid = ObjectId.Parse("64b0000000000000000000b1");
    private static readonly ObjectId InviteOid = ObjectId.Parse("64b0000000000000000000c1");
    private static readonly ObjectId McTemplateOid = ObjectId.Parse("64b0000000000000000000d1");
    private static readonly ObjectId McOid = ObjectId.Parse("64b0000000000000000000e1");

    /// <summary>The fixture corpus: every FK edge, both second passes, one of each misfit.</summary>
    private static async Task SeedLegacyAsync(IMongoDatabase legacy)
    {
        await legacy.GetCollection<BsonDocument>("companies").InsertManyAsync(
        [
            new BsonDocument
            {
                ["_id"] = AcmeOid, ["name"] = "Acme Inc", ["domain"] = "acme.com",
                ["settings"] = new BsonDocument { ["language"] = "en" },
                ["created_at"] = new DateTime(2024, 1, 1, 0, 0, 0, DateTimeKind.Utc),
            },
        ]);

        await legacy.GetCollection<BsonDocument>("demographicfields").InsertManyAsync(
        [
            new BsonDocument
            {
                ["_id"] = TenureOid, ["company_id"] = AcmeOid.ToString(),
                ["field"] = "tenure", ["label"] = "Tenure", ["type"] = "select",
                ["options"] = new BsonArray { "0-1", "1-3" },
            },
        ]);

        await legacy.GetCollection<BsonDocument>("departments").InsertManyAsync(
        [
            new BsonDocument
            {
                ["_id"] = EngOid, ["name"] = "Engineering", ["company_id"] = AcmeOid.ToString(),
                ["manager_id"] = GraceOid.ToString(),
                ["hierarchy"] = new BsonDocument { ["level"] = 0, ["path"] = "engineering" },
            },
            new BsonDocument
            {
                ["_id"] = ApiOid, ["name"] = "Backend API", ["company_id"] = AcmeOid.ToString(),
                ["hierarchy"] = new BsonDocument
                {
                    ["parent_department_id"] = EngOid.ToString(),
                    ["level"] = 1,
                    ["path"] = "engineering/backend-api",
                },
            },
        ]);

        await legacy.GetCollection<BsonDocument>("users").InsertManyAsync(
        [
            new BsonDocument
            {
                ["_id"] = AdaOid, ["name"] = "Ada Lovelace", ["email"] = "ada@acme.com",
                ["role"] = "employee", ["company_id"] = AcmeOid.ToString(),
                ["department_id"] = ApiOid.ToString(),
                ["manager_id"] = GraceOid.ToString(),
                ["demographics"] = new BsonDocument { ["tenure"] = "1-3", ["unknown_key"] = "x" },
                ["preferences"] = new BsonDocument
                {
                    ["notification_settings"] = new BsonDocument { ["email_reminders"] = false },
                },
            },
            new BsonDocument
            {
                ["_id"] = GraceOid, ["name"] = "Grace Hopper", ["email"] = "grace@acme.com",
                ["role"] = "department_admin", ["company_id"] = AcmeOid.ToString(),
                ["department_id"] = EngOid.ToString(),
            },
            new BsonDocument
            {
                ["_id"] = RootOid, ["name"] = "Root", ["email"] = "root@platform.example",
                ["role"] = "super_admin",
            },
        ]);

        await legacy.GetCollection<BsonDocument>("systemsettings").InsertManyAsync(
        [
            new BsonDocument
            {
                ["_id"] = ObjectId.Parse("64b000000000000000000041"),
                ["login_enabled"] = true, ["maintenance_mode"] = false,
                ["maintenance_message"] = "Back soon.",
            },
        ]);

        await legacy.GetCollection<BsonDocument>("surveys").InsertManyAsync(
        [
            new BsonDocument
            {
                ["_id"] = SurveyOid,
                ["title"] = "Q3 Climate Pulse",
                ["description"] = "How the quarter felt.",
                ["type"] = "general_climate",
                ["company_id"] = AcmeOid.ToString(),
                ["created_by"] = AdaOid.ToString(),
                // One resolvable target, one dangling - the degraded path.
                ["department_ids"] = new BsonArray { EngOid.ToString(), ObjectId.GenerateNewId().ToString() },
                ["questions"] = new BsonArray
                {
                    new BsonDocument
                    {
                        ["id"] = "sq-1",
                        ["text"] = "I feel safe speaking up.",
                        ["type"] = "likert",
                        ["scale_min"] = 1, ["scale_max"] = 5,
                        ["scale_labels"] = new BsonDocument { ["min"] = "Disagree", ["max"] = "Agree" },
                        // The Mongoose-baked default: must scrub, not become a comment box.
                        ["comment_prompt"] = "Please explain your answer:",
                        ["required"] = true,
                        ["order"] = 0,
                        ["category"] = "safety",
                    },
                    new BsonDocument
                    {
                        ["id"] = "sq-2",
                        ["text"] = "Which describes your week?",
                        ["type"] = "multiple_choice",
                        ["options"] = new BsonArray { "Calm", "Busy", "Overloaded" },
                        ["order"] = 1,
                        ["conditional_logic"] = new BsonDocument
                        {
                            ["condition_question_id"] = "sq-1",
                            ["condition_operator"] = "greater_than",
                            ["condition_value"] = 3,
                            ["action"] = "show",
                        },
                    },
                },
                ["settings"] = new BsonDocument
                {
                    ["anonymous"] = true,
                    ["invitation_settings"] = new BsonDocument { ["custom_message"] = "Your voice matters." },
                },
                ["start_date"] = new DateTime(2026, 7, 1, 0, 0, 0, DateTimeKind.Utc),
                ["end_date"] = new DateTime(2026, 7, 15, 0, 0, 0, DateTimeKind.Utc),
                ["status"] = "completed",
                ["response_count"] = 12,
                ["version"] = 2,
            },
        ]);

        await legacy.GetCollection<BsonDocument>("surveytemplates").InsertManyAsync(
        [
            new BsonDocument
            {
                ["_id"] = TemplateOid,
                ["name"] = "Quarterly Pulse",
                ["description"] = "The standard quarterly check-in.",
                ["category"] = "climate",
                ["company_id"] = AcmeOid.ToString(),
                ["created_by"] = AdaOid.ToString(),
                ["source_survey_id"] = SurveyOid.ToString(),
                ["questions"] = new BsonArray
                {
                    new BsonDocument
                    {
                        ["id"] = "tq-1",
                        ["text"] = "I feel heard.",
                        ["type"] = "likert",
                        ["comment_prompt"] = "Please explain your answer:",
                        ["order"] = 0,
                    },
                    new BsonDocument
                    {
                        ["id"] = "tq-2",
                        ["text"] = "Preferred cadence?",
                        ["type"] = "multiple_choice",
                        ["options"] = new BsonArray { "Weekly", "Monthly" },
                        ["order"] = 1,
                    },
                },
                ["is_public"] = false,
                ["usage_count"] = 7,
                ["rating"] = 4.5,
                ["tags"] = new BsonArray { "pulse" },
            },
        ]);

        await legacy.GetCollection<BsonDocument>("surveyversions").InsertManyAsync(
        [
            new BsonDocument
            {
                ["_id"] = VersionOid,
                ["survey_id"] = SurveyOid.ToString(),
                ["version_number"] = 2,
                ["title"] = "Q3 Climate Pulse",
                ["description"] = "How the quarter felt.",
                ["questions"] = new BsonArray
                {
                    new BsonDocument { ["id"] = "sq-1", ["text"] = "I feel safe speaking up.", ["type"] = "likert" },
                },
                ["settings"] = new BsonDocument { ["anonymous"] = true },
                ["changes"] = new BsonArray { "Added the safety item" },
                ["reason"] = "Added the psychological-safety item",
                ["created_by"] = AdaOid.ToString(),
                ["created_at"] = new DateTime(2026, 7, 5, 0, 0, 0, DateTimeKind.Utc),
            },
        ]);

        await legacy.GetCollection<BsonDocument>("surveyauditlogs").InsertManyAsync(
        [
            new BsonDocument
            {
                // Real ObjectId references - the shape unique to this collection.
                ["_id"] = AuditOid,
                ["survey_id"] = SurveyOid,
                ["action"] = "published",
                ["entity_type"] = "survey",
                ["user_id"] = AdaOid,
                ["user_name"] = "Ada Lovelace",
                ["user_email"] = "ada@acme.com",
                ["user_role"] = "company_admin",
                ["timestamp"] = new DateTime(2026, 7, 1, 8, 0, 0, DateTimeKind.Utc),
            },
            new BsonDocument
            {
                // An action the target vocabulary cannot express: reported, not written.
                ["_id"] = AuditDeletedOid,
                ["survey_id"] = SurveyOid,
                ["action"] = "draft_saved",
                ["entity_type"] = "draft",
                ["user_id"] = AdaOid,
                ["user_name"] = "Ada Lovelace",
                ["user_email"] = "ada@acme.com",
                ["user_role"] = "company_admin",
                ["timestamp"] = new DateTime(2026, 6, 30, 8, 0, 0, DateTimeKind.Utc),
            },
        ]);

        await legacy.GetCollection<BsonDocument>("surveydrafts").InsertManyAsync(
        [
            new BsonDocument
            {
                ["_id"] = DraftOid,
                ["user_id"] = AdaOid,
                ["company_id"] = AcmeOid,
                ["session_id"] = "sess-draft-1",
                ["step1_data"] = new BsonDocument { ["survey_type"] = "climate", ["title"] = "Next quarter" },
                ["current_step"] = 1,
                ["expires_at"] = new DateTime(2026, 7, 25, 0, 0, 0, DateTimeKind.Utc),
                ["created_at"] = new DateTime(2026, 7, 18, 0, 0, 0, DateTimeKind.Utc),
            },
        ]);

        await legacy.GetCollection<BsonDocument>("surveydistributions").InsertManyAsync(
        [
            new BsonDocument
            {
                ["_id"] = DistOid,
                ["survey_id"] = SurveyOid,
                ["access_type"] = "tokenized",
                ["qr_code_url"] = "https://cdn.example.com/qr/q3.png",
                // A legacy share link: dropped, because its token is refused by shape.
                ["public_url"] = "https://legacy.example.com/survey/9f8e7d6c-1234-4abc-9def-0123456789ab",
                ["tokenized_links_generated"] = 12,
                ["qr_customization"] = new BsonDocument { ["color"] = "#112233", ["error_correction"] = "H" },
            },
        ]);

        await legacy.GetCollection<BsonDocument>("surveyinvitations").InsertManyAsync(
        [
            new BsonDocument
            {
                ["_id"] = InviteOid,
                ["survey_id"] = SurveyOid.ToString(),
                ["user_id"] = AdaOid.ToString(),
                ["company_id"] = AcmeOid.ToString(),
                ["email"] = "ada@acme.com",
                ["invitation_token"] = "9f8e7d6c-1234-4abc-9def-0123456789ab",
                // A status the target lacks: reconstructed from the timestamps.
                ["status"] = "bounced",
                ["sent_at"] = new DateTime(2026, 7, 1, 9, 0, 0, DateTimeKind.Utc),
                ["expires_at"] = new DateTime(2026, 7, 31, 0, 0, 0, DateTimeKind.Utc),
                ["created_at"] = new DateTime(2026, 7, 1, 8, 0, 0, DateTimeKind.Utc),
            },
        ]);

        await legacy.GetCollection<BsonDocument>("microclimatetemplates").InsertManyAsync(
        [
            new BsonDocument
            {
                ["_id"] = McTemplateOid,
                ["name"] = "Weekly pulse",
                ["description"] = "Three quick questions.",
                ["category"] = "pulse_check",
                ["company_id"] = AcmeOid.ToString(),
                ["questions"] = new BsonArray
                {
                    new BsonDocument
                    {
                        ["id"] = "mtq-1", ["text"] = "Mood?", ["type"] = "multiple_choice",
                        ["options"] = new BsonArray { "Good", "Bad" }, ["order"] = 0,
                    },
                },
                ["settings"] = new BsonDocument { ["default_duration_minutes"] = 15 },
            },
        ]);

        await legacy.GetCollection<BsonDocument>("microclimates").InsertManyAsync(
        [
            new BsonDocument
            {
                ["_id"] = McOid,
                ["title"] = "Monday pulse",
                ["company_id"] = AcmeOid.ToString(),
                ["created_by"] = AdaOid.ToString(),
                ["template_id"] = McTemplateOid.ToString(),
                ["targeting"] = new BsonDocument
                {
                    ["department_ids"] = new BsonArray { EngOid.ToString() },
                    ["include_managers"] = false,
                },
                ["scheduling"] = new BsonDocument
                {
                    ["start_time"] = new DateTime(2026, 7, 6, 9, 0, 0, DateTimeKind.Utc),
                    ["duration_minutes"] = 45,
                },
                ["questions"] = new BsonArray
                {
                    new BsonDocument { ["id"] = "mq-1", ["text"] = "How is your week?", ["type"] = "likert", ["order"] = 0 },
                    // Unrepresentable: no emoji table on a microclimate question.
                    new BsonDocument { ["id"] = "mq-2", ["text"] = "Mood?", ["type"] = "emoji_rating", ["order"] = 1 },
                },
                ["ai_insights"] = new BsonArray
                {
                    new BsonDocument { ["type"] = "pattern", ["message"] = "Workload rising.", ["confidence"] = 0.8 },
                },
                ["status"] = "completed",
                ["created_at"] = new DateTime(2026, 7, 5, 0, 0, 0, DateTimeKind.Utc),
            },
        ]);

        await legacy.GetCollection<BsonDocument>("responses").InsertManyAsync(
        [
            new BsonDocument
            {
                ["_id"] = ResponseOid,
                ["survey_id"] = SurveyOid.ToString(),
                ["user_id"] = AdaOid.ToString(),
                ["session_id"] = "sess-ada-1",
                ["company_id"] = AcmeOid.ToString(),
                ["department_id"] = ApiOid.ToString(),
                ["responses"] = new BsonArray
                {
                    new BsonDocument { ["question_id"] = "sq-1", ["response_value"] = 4 },
                    new BsonDocument
                    {
                        ["question_id"] = "sq-2",
                        ["response_value"] = "Calm",
                        ["response_text"] = "A good week overall.",
                    },
                },
                ["demographics"] = new BsonArray
                {
                    new BsonDocument { ["field"] = "tenure", ["value"] = "1-3" },
                },
                ["is_complete"] = true,
                ["start_time"] = new DateTime(2026, 7, 2, 9, 0, 0, DateTimeKind.Utc),
                ["completion_time"] = new DateTime(2026, 7, 2, 9, 6, 40, DateTimeKind.Utc),
                ["total_time_seconds"] = 400,
            },
            new BsonDocument
            {
                ["_id"] = AnonResponseOid,
                ["survey_id"] = SurveyOid.ToString(),
                // No user_id: the anonymity constraint, not a defect.
                ["session_id"] = "sess-anon-1",
                ["company_id"] = AcmeOid.ToString(),
                ["responses"] = new BsonArray
                {
                    new BsonDocument { ["question_id"] = "sq-1", ["response_value"] = 2 },
                    // References a question the survey never had: the reported path.
                    new BsonDocument { ["question_id"] = "sq-404", ["response_value"] = 1 },
                },
                ["is_complete"] = true,
                ["is_anonymous"] = true,
                ["start_time"] = new DateTime(2026, 7, 3, 14, 0, 0, DateTimeKind.Utc),
            },
        ]);
    }

    private async Task<(MigrationResult Result, DataQualityReport Report)> RunAsync(
        IMongoDatabase legacy, CancellationToken ct = default)
    {
        await using var db = _fx.CreateDb();
        var report = new DataQualityReport();
        var pipeline = new MigrationPipeline(legacy, db, report, dryRun: false);
        var result = await pipeline.RunAsync([], ct);
        return (result, report);
    }

    [Fact]
    public async Task Full_load_satisfies_every_edge_and_reconciles_exactly()
    {
        await _fx.ResetTargetAsync();
        var legacy = _fx.Mongo.GetDatabase("full_load");
        await SeedLegacyAsync(legacy);

        var (result, report) = await RunAsync(legacy);
        result.AssertReconciled();

        await using var db = _fx.CreateDb();

        var ada = await db.Users.SingleAsync(u => u.Email == "ada@acme.com");
        var grace = await db.Users.SingleAsync(u => u.Email == "grace@acme.com");
        var api = await db.Departments.SingleAsync(d => d.Name == "Backend API");
        var eng = await db.Departments.SingleAsync(d => d.Name == "Engineering");

        // Second passes: parent chain, department manager, user manager.
        Assert.Equal(eng.Id, api.ParentDepartmentId);
        Assert.Equal(grace.Id, eng.ManagerId);
        Assert.Equal(grace.Id, ada.ManagerId);

        // #155 backfill: the raw legacy hex rides on both identity columns.
        Assert.Equal(AdaOid.ToString(), ada.PersonaExternalId);
        Assert.Equal(EngOid.ToString(), eng.LegacyExternalId);

        // #192: the present opt-out survives, the absent five stay at defaults.
        Assert.False(ada.Notifications.EmailReminders);
        Assert.True(ada.Notifications.EmailSurveys);

        // department_admin remap landed and was reported by name.
        Assert.Equal("leader", grace.Role);
        Assert.Contains(report.Entries, e => e.Rule == MigrationRules.RoleDepartmentAdminRemapped);

        // #193: resolved key fanned out; unknown key reported, not dropped in silence.
        var demographic = await db.UserDemographics.SingleAsync(d => d.UserId == ada.Id);
        Assert.Equal("1-3", demographic.Value);
        Assert.Contains(report.Entries, e => e.Rule == MigrationRules.DemographicKeyUnresolved);

        // The recomputed hierarchy agrees with the legacy derived values: no findings.
        Assert.DoesNotContain(report.Entries, e => e.Rule == MigrationRules.DepartmentHierarchyMismatch);

        // The survey fan-out: deterministic ids all the way down.
        var survey = await db.Surveys.SingleAsync();
        Assert.Equal(MigrationIds.For("surveys", SurveyOid), survey.Id);
        Assert.Equal(ada.Id, survey.CreatedBy);
        Assert.Equal("en", survey.Language);
        Assert.Equal("Q3 Climate Pulse", survey.TitleEn);
        Assert.Null(survey.TitleEs);
        Assert.Equal("closed", survey.Status); // legacy 'completed', remapped by name
        Assert.Equal(12, survey.ResponseCount);
        Assert.True(survey.Settings.Anonymous);
        Assert.Equal("Your voice matters.", survey.Settings.InvitationCustomMessageEn);
        Assert.Contains(report.Entries, e => e.Rule == MigrationRules.SurveyStatusCompletedRemapped);

        var sq1Id = MigrationIds.ForChild("surveys", SurveyOid, SurveyMapper.QuestionScope, "sq-1");
        var sq2Id = MigrationIds.ForChild("surveys", SurveyOid, SurveyMapper.QuestionScope, "sq-2");
        var sq1 = await db.Questions.SingleAsync(q => q.Id == sq1Id);
        Assert.Equal(survey.Id, sq1.SurveyId);
        Assert.Equal("I feel safe speaking up.", sq1.TextEn);
        Assert.Equal("Agree", sq1.ScaleLabelMaxEn);
        Assert.Equal("safety", sq1.Category);
        // The Mongoose-baked default prompt was scrubbed, not turned into a comment box.
        Assert.Null(sq1.CommentPromptEn);
        Assert.Contains(report.Entries, e => e.Rule == MigrationRules.CommentPromptDefaultScrubbed);

        var options = await db.QuestionOptions
            .Where(o => o.QuestionId == sq2Id).OrderBy(o => o.Order).ToListAsync();
        Assert.Equal(["Calm", "Busy", "Overloaded"], options.Select(o => o.Value));

        var logic = await db.QuestionConditionalLogics.SingleAsync(l => l.QuestionId == sq2Id);
        Assert.Equal(sq1Id, logic.ConditionQuestionId);
        Assert.Equal("3", logic.ConditionValue);

        // One resolvable department target landed; the dangling one degraded by name.
        var target = Assert.Single(await db.SurveyDepartmentTargets.ToListAsync());
        Assert.Equal(eng.Id, target.DepartmentId);
        Assert.Contains(report.Entries,
            e => e.Kind == ReportEntryKind.Degraded && e.Field == "department_ids");

        // The response fan-out: answers re-derive their question ids, values encode
        // through the app's one jsonb encoding, demographics ride along.
        var responseId = MigrationIds.For("responses", ResponseOid);
        var response = await db.Responses.SingleAsync(r => r.Id == responseId);
        Assert.Equal(ada.Id, response.UserId);
        Assert.Equal(survey.Id, response.SurveyId);
        Assert.Equal(api.Id, response.DepartmentId);
        Assert.Equal("en", response.Language);
        Assert.Equal(400, response.TotalTimeSeconds);

        var answers = await db.QuestionResponses.Where(a => a.ResponseId == responseId).ToListAsync();
        Assert.Equal(2, answers.Count);
        Assert.Equal("\"4\"", answers.Single(a => a.QuestionId == sq1Id).ResponseValue);
        var optionAnswer = answers.Single(a => a.QuestionId == sq2Id);
        Assert.Equal("\"Calm\"", optionAnswer.ResponseValue);
        Assert.Equal("A good week overall.", optionAnswer.ResponseText);
        var demographicRow = Assert.Single(
            await db.ResponseDemographics.Where(d => d.ResponseId == responseId).ToListAsync());
        Assert.Equal("\"1-3\"", demographicRow.Value);

        // The anonymous response: no user id by design, and its answer to a question
        // the survey never had is a reported miss, not a written FK violation.
        var anonymous = await db.Responses.SingleAsync(
            r => r.Id == MigrationIds.For("responses", AnonResponseOid));
        Assert.Null(anonymous.UserId);
        Assert.True(anonymous.IsAnonymous);
        Assert.Equal(1, await db.QuestionResponses.CountAsync(a => a.ResponseId == anonymous.Id));
        Assert.Contains(report.Entries, e => e.Rule == MigrationRules.ResponseAnswerQuestionUnresolved);

        // The template fan-out: source survey resolved, questions on deterministic
        // child ids, the shared scrub firing under the template's own collection name.
        var template = await db.SurveyTemplates.SingleAsync();
        Assert.Equal(MigrationIds.For("surveytemplates", TemplateOid), template.Id);
        Assert.Equal(ada.Id, template.CreatedBy);
        Assert.Equal(survey.Id, template.SourceSurveyId);
        Assert.Equal(4.5, template.Rating);
        var tq1 = await db.TemplateQuestions.SingleAsync(q => q.Id == MigrationIds.ForChild(
            "surveytemplates", TemplateOid, SurveyTemplateMapper.QuestionScope, "tq-1"));
        Assert.Equal(template.Id, tq1.TemplateId);
        Assert.Equal("I feel heard.", tq1.TextEn);
        Assert.Null(tq1.CommentPromptEn);
        Assert.Contains(report.Entries, e => e.Rule == MigrationRules.CommentPromptDefaultScrubbed
            && e.Collection == "surveytemplates");
        var templateOptions = await db.TemplateQuestionOptions
            .OrderBy(o => o.Order).Select(o => o.Value).ToListAsync();
        Assert.Equal(["Weekly", "Monthly"], templateOptions);

        // The history pair. The version attributes from its SURVEY and keeps its
        // snapshot as evidence rather than re-mapping it through today's rules.
        var version = await db.SurveyVersions.SingleAsync();
        Assert.Equal(MigrationIds.For("surveyversions", VersionOid), version.Id);
        Assert.Equal(survey.Id, version.SurveyId);
        Assert.Equal(ada.Id, version.CreatedBy);
        Assert.Equal(2, version.VersionNumber);
        Assert.Equal("Q3 Climate Pulse", version.TitleEn);
        Assert.Equal(["Added the safety item"], version.Changes);
        Assert.Contains("sq-1", version.QuestionsSnapshot);

        // The audit feed: the lifecycle row folded into status_changed carrying its
        // destination, and the draft row was refused rather than written unrenderable.
        var auditEntry = await db.SurveyAuditLogs.SingleAsync();
        Assert.Equal(MigrationIds.For("surveyauditlogs", AuditOid), auditEntry.Id);
        Assert.Equal(survey.Id, auditEntry.SurveyId);
        Assert.Equal(ada.Id, auditEntry.UserId);
        Assert.Equal("status_changed", auditEntry.Action);
        Assert.Equal("status", auditEntry.EntityType);
        // Parsed, not string-matched: Postgres normalises jsonb (it stores
        // {"to": "active"}, with the space), so a literal compare would test the
        // database's formatter rather than the mapper's translation.
        Assert.Equal("active", SurveyAuditChangeSet.FromJson(auditEntry.Changes)!.To);
        Assert.Contains("published", auditEntry.Metadata);
        Assert.Contains(report.Entries, e => e.Rule == MigrationRules.AuditActionUnrepresentable);

        // The delivery trio.
        var draft = await db.SurveyDrafts.SingleAsync();
        Assert.Equal(ada.Id, draft.UserId);
        Assert.Contains("Next quarter", draft.DraftData);

        var distribution = await db.SurveyDistributions.SingleAsync();
        Assert.Equal(survey.Id, distribution.SurveyId);
        Assert.Equal(12, distribution.TokenizedLinksGenerated);
        Assert.Equal("#112233", distribution.QrCustomization.ForegroundColor);
        // The legacy share link is dropped: its token cannot pass HasExpectedShape.
        Assert.Null(distribution.PublicUrl);
        Assert.Contains(report.Entries, e => e.Rule == MigrationRules.DistributionPublicLinkDropped);

        var invitation = await db.SurveyInvitations.SingleAsync();
        Assert.Equal(survey.Id, invitation.SurveyId);
        Assert.Equal("ada@acme.com", invitation.Email);
        // 'bounced' has no target member; sent_at is the furthest evidence.
        Assert.Equal("sent", invitation.Status);
        Assert.Contains("bounced", invitation.Metadata);
        Assert.Contains(report.Entries, e => e.Rule == MigrationRules.InvitationStatusReconstructed);
        Assert.Contains(report.Entries, e => e.Rule == MigrationRules.InvitationTokenInert);
        Assert.False(SurveyAccessTokens.HasExpectedShape(invitation.InvitationToken));

        // The Microclimate domain: derived window, positional insight ids, the emoji
        // question refused, and the template link resolved.
        var microTemplate = await db.MicroclimateTemplates.SingleAsync();
        Assert.Equal(15, microTemplate.Settings.DefaultDurationMinutes);
        Assert.Equal(2, await db.MicroclimateTemplateQuestionOptions.CountAsync());

        var micro = await db.Microclimates.SingleAsync();
        Assert.Equal(MigrationIds.For("microclimates", McOid), micro.Id);
        Assert.Equal(microTemplate.Id, micro.TemplateId);
        Assert.Equal(ada.Id, micro.CreatedBy);
        Assert.Equal("closed", micro.Status); // legacy 'completed'
        Assert.Equal(new DateTimeOffset(2026, 7, 6, 9, 45, 0, TimeSpan.Zero), micro.Scheduling.EndTime);
        Assert.False(micro.Targeting.IncludeManagers);

        // Only the likert question survives; the emoji one has nowhere to land.
        Assert.Equal(1, await db.MicroclimateQuestions.CountAsync());
        Assert.Contains(report.Entries, e => e.Rule == MigrationRules.MicroclimateQuestionEmojiUnrepresentable);
        Assert.Equal(eng.Id, (await db.MicroclimateDepartmentTargets.SingleAsync()).DepartmentId);
        var insight = await db.MicroclimateAiInsights.SingleAsync();
        Assert.Equal(
            MigrationIds.ForChild("microclimates", McOid, MicroclimateMapper.InsightScope, "#0"), insight.Id);

        // Attribution: en company label + the platform maintenance message, then the
        // survey's title, description, invitation message and two question texts,
        // the template's two question texts, the version's title and description,
        // then each response's served language.
        Assert.Equal(5, report.Entries.Count(
            e => e.Kind == ReportEntryKind.Attribution && e.Collection == "surveys"));
        Assert.Equal(2, report.Entries.Count(
            e => e.Kind == ReportEntryKind.Attribution && e.Collection == "surveytemplates"));
        Assert.Equal(2, report.Entries.Count(
            e => e.Kind == ReportEntryKind.Attribution && e.Collection == "responses"));
        Assert.Equal(2, report.Entries.Count(
            e => e.Kind == ReportEntryKind.Attribution && e.Collection == "surveyversions"));
        // + the microclimate's title and its one surviving question text, + the
        // template's question text.
        Assert.Equal(16, report.Entries.Count(e => e.Kind == ReportEntryKind.Attribution));
    }

    [Fact]
    public async Task Running_twice_converges_and_never_rekeys_a_security_stamp()
    {
        await _fx.ResetTargetAsync();
        var legacy = _fx.Mongo.GetDatabase("idempotency");
        await SeedLegacyAsync(legacy);

        await RunAsync(legacy);

        Guid stampAfterFirstRun;
        int usersAfterFirstRun;
        await using (var db = _fx.CreateDb())
        {
            stampAfterFirstRun = (await db.Users.SingleAsync(u => u.Email == "ada@acme.com")).SecurityStamp;
            usersAfterFirstRun = await db.Users.CountAsync();
        }

        var (second, _) = await RunAsync(legacy);
        second.AssertReconciled();

        await using (var db = _fx.CreateDb())
        {
            Assert.Equal(usersAfterFirstRun, await db.Users.CountAsync());
            Assert.Equal(1, await db.UserDemographics.CountAsync(d => d.Value == "1-3"));
            // Sub-issue D's sharpest AC: a re-run must not end anyone's session.
            Assert.Equal(stampAfterFirstRun,
                (await db.Users.SingleAsync(u => u.Email == "ada@acme.com")).SecurityStamp);

            // The whole survey fan-out converges too - upserted questions, wholesale-
            // replaced options and targets, in-place conditional logic.
            Assert.Equal(1, await db.Surveys.CountAsync());
            Assert.Equal(2, await db.Questions.CountAsync());
            Assert.Equal(3, await db.QuestionOptions.CountAsync());
            Assert.Equal(1, await db.QuestionConditionalLogics.CountAsync());
            Assert.Equal(1, await db.SurveyDepartmentTargets.CountAsync());

            // And the volume driver: responses, answers and demographics all converge.
            Assert.Equal(2, await db.Responses.CountAsync());
            Assert.Equal(3, await db.QuestionResponses.CountAsync());
            Assert.Equal(1, await db.ResponseDemographics.CountAsync());

            Assert.Equal(1, await db.Microclimates.CountAsync());
            Assert.Equal(1, await db.MicroclimateQuestions.CountAsync());
            Assert.Equal(1, await db.MicroclimateAiInsights.CountAsync());
            Assert.Equal(1, await db.MicroclimateTemplates.CountAsync());
            Assert.Equal(1, await db.SurveyDrafts.CountAsync());
            Assert.Equal(1, await db.SurveyDistributions.CountAsync());
            Assert.Equal(1, await db.SurveyInvitations.CountAsync());
            Assert.Equal(1, await db.SurveyVersions.CountAsync());
            Assert.Equal(1, await db.SurveyAuditLogs.CountAsync());
            Assert.Equal(1, await db.SurveyTemplates.CountAsync());
            Assert.Equal(2, await db.TemplateQuestions.CountAsync());
            Assert.Equal(2, await db.TemplateQuestionOptions.CountAsync());
        }
    }

    [Fact]
    public async Task Interrupted_run_restarted_converges_to_the_uninterrupted_state()
    {
        await _fx.ResetTargetAsync();
        var legacy = _fx.Mongo.GetDatabase("interruption");
        await SeedLegacyAsync(legacy);

        // Writes persist once per stage, so the ONLY partial state a kill can leave
        // behind is a stage boundary - a death mid-collection rolls its stage back to
        // exactly this. Construct that state directly: everything up to departments
        // loaded (their second pass unresolved because users never arrived), users and
        // systemsettings never run.
        await using (var db = _fx.CreateDb())
        {
            var pipeline = new MigrationPipeline(legacy, db, new DataQualityReport(), dryRun: false);
            var partial = await pipeline.RunAsync(["companies", "demographicfields", "departments"], CancellationToken.None);
            partial.AssertReconciled();
        }

        await using (var check = _fx.CreateDb())
        {
            Assert.Equal(0, await check.Users.CountAsync());
            Assert.Null((await check.Departments.SingleAsync(d => d.Name == "Engineering")).ManagerId);
        }

        // And a token canceled before the run starts is honored before anything writes.
        await using (var db = _fx.CreateDb())
        {
            var pipeline = new MigrationPipeline(legacy, db, new DataQualityReport(), dryRun: false);
            await Assert.ThrowsAnyAsync<OperationCanceledException>(
                () => pipeline.RunAsync([], new CancellationToken(canceled: true)));
        }

        // Naive restart, no flags: deterministic ids make "run again" the recovery.
        var (result, _) = await RunAsync(legacy);
        result.AssertReconciled();

        await using (var verify = _fx.CreateDb())
        {
            Assert.Equal(1, await verify.Companies.CountAsync());
            Assert.Equal(2, await verify.Departments.CountAsync());
            Assert.Equal(3, await verify.Users.CountAsync());
            Assert.Equal(1, await verify.Surveys.CountAsync());
            Assert.Equal(2, await verify.Questions.CountAsync());
            Assert.Equal(2, await verify.Responses.CountAsync());
            Assert.Equal(3, await verify.QuestionResponses.CountAsync());
            Assert.Equal(1, await verify.SurveyTemplates.CountAsync());
            Assert.Equal(1, await verify.SurveyVersions.CountAsync());
            Assert.Equal(1, await verify.SurveyAuditLogs.CountAsync());
            Assert.Equal(1, await verify.SurveyInvitations.CountAsync());
            Assert.Equal(1, await verify.Microclimates.CountAsync());
            var api = await verify.Departments.SingleAsync(d => d.Name == "Backend API");
            Assert.NotNull(api.ParentDepartmentId);
            var eng = await verify.Departments.SingleAsync(d => d.Name == "Engineering");
            Assert.NotNull(eng.ManagerId);
        }
    }

    [Fact]
    public async Task Dry_run_reports_everything_and_persists_nothing()
    {
        await _fx.ResetTargetAsync();
        var legacy = _fx.Mongo.GetDatabase("dry_run");
        await SeedLegacyAsync(legacy);

        await using var db = _fx.CreateDb();
        var report = new DataQualityReport();
        var pipeline = new MigrationPipeline(legacy, db, report, dryRun: true);
        var result = await pipeline.RunAsync([], CancellationToken.None);
        result.AssertReconciled();

        Assert.NotEmpty(report.Entries);
        await using var verify = _fx.CreateDb();
        Assert.Equal(0, await verify.Companies.CountAsync());
        Assert.Equal(0, await verify.Users.CountAsync());
        Assert.Equal(0, await verify.Surveys.CountAsync());
        Assert.Equal(0, await verify.Questions.CountAsync());
        Assert.Equal(0, await verify.Responses.CountAsync());
        Assert.Equal(0, await verify.SurveyTemplates.CountAsync());
        Assert.Equal(0, await verify.SurveyVersions.CountAsync());
        Assert.Equal(0, await verify.SurveyAuditLogs.CountAsync());
        Assert.Equal(0, await verify.SurveyInvitations.CountAsync());
        Assert.Equal(0, await verify.Microclimates.CountAsync());
    }

    [Fact]
    public async Task Unmapped_collection_is_refused_by_name_not_ignored()
    {
        var legacy = _fx.Mongo.GetDatabase("refusal");
        await using var db = _fx.CreateDb();
        var pipeline = new MigrationPipeline(legacy, db, new DataQualityReport(), dryRun: true);

        var exception = await Assert.ThrowsAsync<NotSupportedException>(
            () => pipeline.RunAsync(["companies", "actionplans"], CancellationToken.None));
        Assert.Contains("actionplans", exception.Message);
    }

    [Fact]
    public void Transaction_pooler_connection_string_is_refused_before_anything_connects()
    {
        var options = new MigrationOptions(
            DryRun: true, Collections: [], ReportPath: "r.json",
            MongoUri: "mongodb://localhost", MongoDatabase: "x",
            PostgresConnectionString: "Host=aws-0-us-east-1.pooler.supabase.com;Port=6543;Database=postgres");

        var exception = Assert.Throws<InvalidOperationException>(options.AssertPostgresIsNotTransactionPooler);
        Assert.Contains("6543", exception.Message);
    }
}
