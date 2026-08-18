using ClimateProject.DataMigration;
using ClimateProject.DataMigration.Legacy;
using ClimateProject.DataMigration.Mapping;
using ClimateProject.DataMigration.Reporting;
using MongoDB.Bson;
using MongoDB.Bson.Serialization;

namespace ClimateProject.DataMigration.Tests;

/// <summary>
/// Sub-issue B's unit layer for the Response fan-out: answer identity re-derivation,
/// the SurveyResponseValues encoding for every legacy Mixed shape, the anonymity
/// constraint, and the non-nominal paths (unresolved questions, duplicates, invalid
/// values, fabricated session ids).
/// </summary>
public class ResponseMapperTests
{
    private static readonly ObjectId CompanyOid = ObjectId.Parse("64d000000000000000000001");
    private static readonly ObjectId UserOid = ObjectId.Parse("64d000000000000000000011");
    private static readonly ObjectId DepartmentOid = ObjectId.Parse("64d000000000000000000021");
    private static readonly ObjectId SurveyOid = ObjectId.Parse("64d000000000000000000031");
    private static readonly ObjectId ResponseOid = ObjectId.Parse("64d000000000000000000041");

    private static readonly Guid CompanyId = MigrationIds.For("companies", CompanyOid);
    private static readonly Guid UserId = MigrationIds.For("users", UserOid);
    private static readonly Guid DepartmentId = MigrationIds.For("departments", DepartmentOid);
    private static readonly Guid SurveyId = MigrationIds.For("surveys", SurveyOid);
    private static readonly Guid Q1 = MigrationIds.ForChild("surveys", SurveyOid, SurveyMapper.QuestionScope, "sq-1");
    private static readonly Guid Q2 = MigrationIds.ForChild("surveys", SurveyOid, SurveyMapper.QuestionScope, "sq-2");

    private static LegacyResponse Load(BsonDocument document)
        => BsonSerializer.Deserialize<LegacyResponse>(document);

    private static MappingContext Context(DataQualityReport report, string language = "en") => new()
    {
        Report = report,
        Companies = new HashSet<Guid> { CompanyId },
        CompanyLanguages = new Dictionary<Guid, string> { [CompanyId] = language },
        Departments = new HashSet<Guid> { DepartmentId },
        Users = new HashSet<Guid> { UserId },
        Surveys = new HashSet<Guid> { SurveyId },
        Questions = new HashSet<Guid> { Q1, Q2 },
    };

    private static BsonDocument NominalResponse() => new()
    {
        ["_id"] = ResponseOid,
        ["survey_id"] = SurveyOid.ToString(),
        ["user_id"] = UserOid.ToString(),
        ["session_id"] = "sess-abc123",
        ["company_id"] = CompanyOid.ToString(),
        ["department_id"] = DepartmentOid.ToString(),
        ["responses"] = new BsonArray(),
        ["is_complete"] = true,
        ["start_time"] = new DateTime(2026, 7, 2, 9, 0, 0, DateTimeKind.Utc),
        ["completion_time"] = new DateTime(2026, 7, 2, 9, 6, 40, DateTimeKind.Utc),
        ["total_time_seconds"] = 400,
        ["created_at"] = new DateTime(2026, 7, 2, 9, 0, 0, DateTimeKind.Utc),
        ["updated_at"] = new DateTime(2026, 7, 2, 9, 6, 40, DateTimeKind.Utc),
    };

    [Fact]
    public void Response_maps_nominal_document_and_every_answer_shape_encodes_like_the_app()
    {
        var report = new DataQualityReport();
        var doc = NominalResponse();
        doc["responses"] = new BsonArray
        {
            // A scale answer as a legacy number -> the string form, JSON-encoded.
            new BsonDocument { ["question_id"] = "sq-1", ["response_value"] = 4, ["time_spent_seconds"] = 12 },
            // An option answer as text -> the stable value, JSON-encoded.
            new BsonDocument
            {
                ["question_id"] = "sq-2",
                ["response_value"] = "Calm",
                ["response_text"] = "A good week overall.",
            },
        };
        doc["demographics"] = new BsonArray
        {
            new BsonDocument { ["field"] = "tenure", ["value"] = "1-3" },
            new BsonDocument { ["field"] = "office_floor", ["value"] = 4 },
        };

        var mapped = ResponseMapper.Map(Load(doc), Context(report));

        Assert.NotNull(mapped);
        Assert.Equal(MigrationIds.For("responses", ResponseOid), mapped!.Response.Id);
        Assert.Equal(SurveyId, mapped.Response.SurveyId);
        Assert.Equal(UserId, mapped.Response.UserId);
        Assert.Equal(DepartmentId, mapped.Response.DepartmentId);
        Assert.Equal("sess-abc123", mapped.Response.SessionId);
        Assert.True(mapped.Response.IsComplete);
        Assert.Equal(400, mapped.Response.TotalTimeSeconds);
        Assert.Equal("en", mapped.Response.Language);
        Assert.Contains(report.Entries,
            e => e.Kind == ReportEntryKind.Attribution && e.Field == "language");

        Assert.Equal(2, mapped.Answers.Count);
        var scale = Assert.Single(mapped.Answers, a => a.QuestionId == Q1);
        Assert.Equal("\"4\"", scale.ResponseValue);
        Assert.Equal(12, scale.TimeSpentSeconds);
        var option = Assert.Single(mapped.Answers, a => a.QuestionId == Q2);
        Assert.Equal("\"Calm\"", option.ResponseValue);
        Assert.Equal("A good week overall.", option.ResponseText);

        Assert.Equal(2, mapped.Demographics.Count);
        Assert.Equal("\"1-3\"", Assert.Single(mapped.Demographics, d => d.Field == "tenure").Value);
        Assert.Equal("\"4\"", Assert.Single(mapped.Demographics, d => d.Field == "office_floor").Value);
    }

    [Fact]
    public void Anonymous_response_without_user_id_is_the_design_not_a_finding()
    {
        var report = new DataQualityReport();
        var doc = NominalResponse();
        doc.Remove("user_id");
        doc["is_anonymous"] = true;

        var mapped = ResponseMapper.Map(Load(doc), Context(report));

        Assert.Null(mapped!.Response.UserId);
        Assert.True(mapped.Response.IsAnonymous);
        Assert.DoesNotContain(report.Entries, e => e.Kind == ReportEntryKind.Degraded);
    }

    [Fact]
    public void Response_whose_survey_never_migrated_is_a_reported_skip()
    {
        var report = new DataQualityReport();
        var doc = NominalResponse();
        doc["survey_id"] = ObjectId.GenerateNewId().ToString();

        Assert.Null(ResponseMapper.Map(Load(doc), Context(report)));
        var entry = Assert.Single(report.Entries, e => e.Kind == ReportEntryKind.Skip);
        Assert.Equal(MigrationRules.DanglingReference, entry.Rule);
        Assert.Equal("survey_id", entry.Field);
    }

    [Fact]
    public void Ranking_answer_encodes_as_an_ordered_json_array()
    {
        var report = new DataQualityReport();
        var doc = NominalResponse();
        doc["responses"] = new BsonArray
        {
            new BsonDocument
            {
                ["question_id"] = "sq-1",
                ["response_value"] = new BsonArray { "Pay", "Growth", "Flexibility" },
            },
        };

        var mapped = ResponseMapper.Map(Load(doc), Context(report));

        Assert.Equal("[\"Pay\",\"Growth\",\"Flexibility\"]", Assert.Single(mapped!.Answers).ResponseValue);
    }

    [Fact]
    public void Boolean_answer_codes_to_the_yes_no_stable_values_as_a_named_rule()
    {
        var report = new DataQualityReport();
        var doc = NominalResponse();
        doc["responses"] = new BsonArray
        {
            new BsonDocument { ["question_id"] = "sq-1", ["response_value"] = true },
            new BsonDocument { ["question_id"] = "sq-2", ["response_value"] = false },
        };

        var mapped = ResponseMapper.Map(Load(doc), Context(report));

        Assert.Equal("\"yes\"", Assert.Single(mapped!.Answers, a => a.QuestionId == Q1).ResponseValue);
        Assert.Equal("\"no\"", Assert.Single(mapped.Answers, a => a.QuestionId == Q2).ResponseValue);
        Assert.Equal(2, report.Entries.Count(e => e.Rule == MigrationRules.ResponseAnswerBooleanCoded));
    }

    [Fact]
    public void Answer_to_a_question_the_survey_mapper_never_kept_is_reported_not_written()
    {
        var report = new DataQualityReport();
        var doc = NominalResponse();
        doc["responses"] = new BsonArray
        {
            new BsonDocument { ["question_id"] = "sq-dropped", ["response_value"] = 3 },
            new BsonDocument { ["response_value"] = 5 }, // no question_id at all
        };

        var mapped = ResponseMapper.Map(Load(doc), Context(report));

        Assert.Empty(mapped!.Answers);
        Assert.Equal(2, report.Entries.Count(e => e.Rule == MigrationRules.ResponseAnswerQuestionUnresolved));
    }

    [Fact]
    public void Duplicate_answers_and_invalid_values_keep_first_and_report_the_rest()
    {
        var report = new DataQualityReport();
        var doc = NominalResponse();
        doc["responses"] = new BsonArray
        {
            new BsonDocument { ["question_id"] = "sq-1", ["response_value"] = 4 },
            // Legacy's own reader took the first match; the second is the anomaly.
            new BsonDocument { ["question_id"] = "sq-1", ["response_value"] = 5 },
            // A subdocument is not in the legacy value union.
            new BsonDocument { ["question_id"] = "sq-2", ["response_value"] = new BsonDocument { ["x"] = 1 } },
        };

        var mapped = ResponseMapper.Map(Load(doc), Context(report));

        var answer = Assert.Single(mapped!.Answers);
        Assert.Equal("\"4\"", answer.ResponseValue);
        Assert.Contains(report.Entries, e => e.Rule == MigrationRules.ResponseAnswerDuplicateQuestion);
        Assert.Contains(report.Entries, e => e.Rule == MigrationRules.ResponseAnswerValueInvalid);
    }

    [Fact]
    public void Missing_session_id_gets_a_marked_synthetic_key_not_a_skip()
    {
        var report = new DataQualityReport();
        var doc = NominalResponse();
        doc.Remove("session_id");

        var mapped = ResponseMapper.Map(Load(doc), Context(report));

        Assert.Equal($"legacy:{ResponseOid}", mapped!.Response.SessionId);
        Assert.Contains(report.Entries, e => e.Rule == MigrationRules.ResponseSessionIdFabricated);
        Assert.DoesNotContain(report.Entries, e => e.Kind == ReportEntryKind.Skip);
    }

    [Fact]
    public void Spanish_company_attributes_the_served_language_as_es()
    {
        var report = new DataQualityReport();

        var mapped = ResponseMapper.Map(Load(NominalResponse()), Context(report, language: "es"));

        Assert.Equal("es", mapped!.Response.Language);
        var attribution = Assert.Single(report.Entries, e => e.Kind == ReportEntryKind.Attribution);
        Assert.Contains("'es'", attribution.Reason);
    }

    [Fact]
    public void Demographic_misfits_are_reported_pairs_never_silent()
    {
        var report = new DataQualityReport();
        var doc = NominalResponse();
        doc["demographics"] = new BsonArray
        {
            new BsonDocument { ["field"] = "tenure", ["value"] = "1-3" },
            new BsonDocument { ["field"] = "tenure", ["value"] = "3+" }, // duplicate field
            new BsonDocument { ["value"] = "orphan" }, // no field name
            new BsonDocument { ["field"] = "nested", ["value"] = new BsonDocument { ["x"] = 1 } },
        };

        var mapped = ResponseMapper.Map(Load(doc), Context(report));

        var kept = Assert.Single(mapped!.Demographics);
        Assert.Equal("\"1-3\"", kept.Value);
        Assert.Contains(report.Entries, e => e.Rule == MigrationRules.ResponseDemographicDuplicateField);
        Assert.Equal(2, report.Entries.Count(e => e.Rule == MigrationRules.ResponseDemographicInvalid));
    }

    [Fact]
    public void Dangling_user_reference_degrades_to_null_unlike_a_missing_one()
    {
        var report = new DataQualityReport();
        var doc = NominalResponse();
        doc["user_id"] = ObjectId.GenerateNewId().ToString();

        var mapped = ResponseMapper.Map(Load(doc), Context(report));

        Assert.Null(mapped!.Response.UserId);
        Assert.Contains(report.Entries,
            e => e.Kind == ReportEntryKind.Degraded && e.Field == "user_id");
    }
}
