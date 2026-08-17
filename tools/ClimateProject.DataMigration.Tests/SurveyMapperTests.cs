using ClimateProject.DataMigration;
using ClimateProject.DataMigration.Legacy;
using ClimateProject.DataMigration.Mapping;
using ClimateProject.DataMigration.Reporting;
using MongoDB.Bson;
using MongoDB.Bson.Serialization;

namespace ClimateProject.DataMigration.Tests;

/// <summary>
/// Sub-issue B's unit layer for the Survey fan-out: the mapper as a pure function over
/// fixture documents, including the non-nominal ones - the vocabulary remaps, the #332
/// default scrubs, duplicate ids/values, and the #195 attribution both ways.
/// </summary>
public class SurveyMapperTests
{
    private static readonly ObjectId CompanyOid = ObjectId.Parse("64c000000000000000000001");
    private static readonly ObjectId EsCompanyOid = ObjectId.Parse("64c000000000000000000002");
    private static readonly ObjectId CreatorOid = ObjectId.Parse("64c000000000000000000011");
    private static readonly ObjectId DepartmentOid = ObjectId.Parse("64c000000000000000000021");
    private static readonly ObjectId SurveyOid = ObjectId.Parse("64c000000000000000000031");

    private static readonly Guid CompanyId = MigrationIds.For("companies", CompanyOid);
    private static readonly Guid EsCompanyId = MigrationIds.For("companies", EsCompanyOid);
    private static readonly Guid CreatorId = MigrationIds.For("users", CreatorOid);
    private static readonly Guid DepartmentId = MigrationIds.For("departments", DepartmentOid);

    private static LegacySurvey Load(BsonDocument document)
        => BsonSerializer.Deserialize<LegacySurvey>(document);

    private static MappingContext Context(DataQualityReport report) => new()
    {
        Report = report,
        Companies = new HashSet<Guid> { CompanyId, EsCompanyId },
        CompanyLanguages = new Dictionary<Guid, string> { [CompanyId] = "en", [EsCompanyId] = "es" },
        Departments = new HashSet<Guid> { DepartmentId },
        Users = new HashSet<Guid> { CreatorId },
    };

    private static BsonDocument NominalSurvey(ObjectId? companyOid = null) => new()
    {
        ["_id"] = SurveyOid,
        ["title"] = "Q3 Climate Pulse",
        ["type"] = "general_climate",
        ["company_id"] = (companyOid ?? CompanyOid).ToString(),
        ["created_by"] = CreatorOid.ToString(),
        ["questions"] = new BsonArray(),
        ["start_date"] = new DateTime(2026, 7, 1, 0, 0, 0, DateTimeKind.Utc),
        ["end_date"] = new DateTime(2026, 7, 15, 0, 0, 0, DateTimeKind.Utc),
        ["status"] = "active",
        ["created_at"] = new DateTime(2026, 6, 20, 0, 0, 0, DateTimeKind.Utc),
        ["updated_at"] = new DateTime(2026, 7, 1, 0, 0, 0, DateTimeKind.Utc),
    };

    [Fact]
    public void Survey_maps_nominal_document_with_deterministic_ids_and_attribution()
    {
        var report = new DataQualityReport();
        var doc = NominalSurvey();
        doc["description"] = "How the quarter felt.";
        doc["department_ids"] = new BsonArray { DepartmentOid.ToString() };
        doc["questions"] = new BsonArray
        {
            new BsonDocument
            {
                ["id"] = "sq-1",
                ["text"] = "I feel safe speaking up.",
                ["type"] = "likert",
                ["scale_min"] = 1,
                ["scale_max"] = 5,
                ["scale_labels"] = new BsonDocument { ["min"] = "Disagree", ["max"] = "Agree" },
                ["required"] = true,
                ["order"] = 0,
                ["category"] = "safety",
            },
        };
        doc["settings"] = new BsonDocument
        {
            ["anonymous"] = true,
            ["invitation_settings"] = new BsonDocument { ["custom_message"] = "Your voice matters." },
        };

        var mapped = SurveyMapper.Map(Load(doc), Context(report));

        Assert.NotNull(mapped);
        Assert.Equal(MigrationIds.For("surveys", SurveyOid), mapped!.Survey.Id);
        Assert.Equal(CompanyId, mapped.Survey.CompanyId);
        Assert.Equal(CreatorId, mapped.Survey.CreatedBy);
        Assert.Equal("Q3 Climate Pulse", mapped.Survey.TitleEn);
        Assert.Null(mapped.Survey.TitleEs);
        Assert.Equal("How the quarter felt.", mapped.Survey.DescriptionEn);
        Assert.Equal("en", mapped.Survey.Language);
        Assert.True(mapped.Survey.Settings.Anonymous);
        Assert.Equal("Your voice matters.", mapped.Survey.Settings.InvitationCustomMessageEn);
        Assert.Null(mapped.Survey.Settings.InvitationCustomMessageEs);

        var question = Assert.Single(mapped.Questions);
        Assert.Equal(MigrationIds.ForChild("surveys", SurveyOid, SurveyMapper.QuestionScope, "sq-1"), question.Id);
        Assert.Equal(mapped.Survey.Id, question.SurveyId);
        Assert.Equal("I feel safe speaking up.", question.TextEn);
        Assert.Equal("Agree", question.ScaleLabelMaxEn);
        Assert.Null(question.ScaleLabelMaxEs);
        Assert.Equal("safety", question.Category);
        Assert.True(question.Required);

        var target = Assert.Single(mapped.DepartmentTargets);
        Assert.Equal(DepartmentId, target.DepartmentId);

        // title + description + invitation message + one question text.
        Assert.Equal(4, report.Entries.Count(e => e.Kind == ReportEntryKind.Attribution));
        Assert.DoesNotContain(report.Entries, e => e.Kind == ReportEntryKind.Skip);
    }

    [Fact]
    public void Spanish_company_content_lands_in_es_and_language_is_es()
    {
        var report = new DataQualityReport();
        var doc = NominalSurvey(EsCompanyOid);
        doc["title"] = "Pulso de clima Q3";
        doc["questions"] = new BsonArray
        {
            new BsonDocument { ["id"] = "sq-1", ["text"] = "Me siento seguro.", ["type"] = "likert", ["order"] = 0 },
        };

        var mapped = SurveyMapper.Map(Load(doc), Context(report));

        Assert.Equal("es", mapped!.Survey.Language);
        Assert.Equal("Pulso de clima Q3", mapped.Survey.TitleEs);
        Assert.Null(mapped.Survey.TitleEn);
        Assert.Equal("Me siento seguro.", Assert.Single(mapped.Questions).TextEs);
        Assert.All(report.Entries.Where(e => e.Kind == ReportEntryKind.Attribution),
            e => Assert.Contains("'es'", e.Reason));
    }

    [Fact]
    public void Survey_whose_creator_never_migrated_is_a_reported_skip()
    {
        var report = new DataQualityReport();
        var doc = NominalSurvey();
        doc["created_by"] = ObjectId.GenerateNewId().ToString();

        Assert.Null(SurveyMapper.Map(Load(doc), Context(report)));
        var entry = Assert.Single(report.Entries, e => e.Kind == ReportEntryKind.Skip);
        Assert.Equal(MigrationRules.DanglingReference, entry.Rule);
        Assert.Equal("created_by", entry.Field);
    }

    [Fact]
    public void Retired_statuses_map_to_closed_as_named_rules()
    {
        foreach (var (legacyStatus, rule) in new[]
        {
            ("completed", MigrationRules.SurveyStatusCompletedRemapped),
            ("paused", MigrationRules.SurveyStatusPausedRemapped),
        })
        {
            var report = new DataQualityReport();
            var doc = NominalSurvey();
            doc["status"] = legacyStatus;

            var mapped = SurveyMapper.Map(Load(doc), Context(report));

            Assert.Equal("closed", mapped!.Survey.Status);
            Assert.Contains(report.Entries, e => e.Rule == rule);
        }
    }

    [Fact]
    public void Unknown_status_is_a_reported_skip()
    {
        var report = new DataQualityReport();
        var doc = NominalSurvey();
        doc["status"] = "haunted";

        Assert.Null(SurveyMapper.Map(Load(doc), Context(report)));
        Assert.Contains(report.Entries,
            e => e.Rule == MigrationRules.SurveyStatusUnknown && e.Kind == ReportEntryKind.Skip);
    }

    [Fact]
    public void Emoji_scale_remaps_to_emoji_rating_and_invalid_emoji_rows_are_reported()
    {
        var report = new DataQualityReport();
        var doc = NominalSurvey();
        doc["questions"] = new BsonArray
        {
            new BsonDocument
            {
                ["id"] = "sq-1",
                ["text"] = "How was your week?",
                ["type"] = "emoji_scale",
                ["order"] = 0,
                ["emoji_options"] = new BsonArray
                {
                    new BsonDocument { ["emoji"] = "😞", ["label"] = "Rough", ["value"] = 1 },
                    new BsonDocument { ["label"] = "No emoji", ["value"] = 2 },
                    new BsonDocument { ["emoji"] = "😄", ["label"] = "Great", ["value"] = 3 },
                },
            },
        };

        var mapped = SurveyMapper.Map(Load(doc), Context(report));

        Assert.Equal("emoji_rating", Assert.Single(mapped!.Questions).Type);
        Assert.Contains(report.Entries, e => e.Rule == MigrationRules.QuestionTypeEmojiScaleRemapped);

        Assert.Equal(2, mapped.EmojiOptions.Count);
        Assert.Equal(["😞", "😄"], mapped.EmojiOptions.Select(o => o.Emoji));
        Assert.Equal([0, 1], mapped.EmojiOptions.Select(o => o.Order));
        Assert.Equal("Rough", mapped.EmojiOptions[0].LabelEn);
        Assert.Contains(report.Entries, e => e.Rule == MigrationRules.QuestionEmojiOptionInvalid);
    }

    [Fact]
    public void Yes_no_comment_folds_into_yes_no_and_an_authored_prompt_survives()
    {
        var report = new DataQualityReport();
        var doc = NominalSurvey();
        doc["questions"] = new BsonArray
        {
            new BsonDocument
            {
                ["id"] = "sq-1",
                ["text"] = "Would you recommend us?",
                ["type"] = "yes_no_comment",
                ["comment_prompt"] = "Tell us what tipped the scale.",
                ["order"] = 0,
                ["binary_comment_config"] = new BsonDocument
                {
                    ["enabled"] = true,
                    ["label"] = "Why?",
                    ["max_length"] = 300,
                },
            },
        };

        var mapped = SurveyMapper.Map(Load(doc), Context(report));

        var question = Assert.Single(mapped!.Questions);
        Assert.Equal("yes_no", question.Type);
        Assert.Contains(report.Entries, e => e.Rule == MigrationRules.QuestionTypeYesNoCommentRemapped);

        // Authored, non-default content carries - in the attributed column.
        Assert.Equal("Tell us what tipped the scale.", question.CommentPromptEn);
        Assert.Null(question.CommentPromptEs);
        Assert.NotNull(question.BinaryCommentConfigEn);
        Assert.Contains("\"enabled\":true", question.BinaryCommentConfigEn);
        Assert.Contains("\"max_length\":300", question.BinaryCommentConfigEn);
        Assert.DoesNotContain(report.Entries, e => e.Rule == MigrationRules.CommentPromptDefaultScrubbed);
    }

    [Fact]
    public void Default_comment_prompt_and_default_binary_config_are_scrubbed_as_named_rules()
    {
        var report = new DataQualityReport();
        var doc = NominalSurvey();
        doc["questions"] = new BsonArray
        {
            new BsonDocument
            {
                ["id"] = "sq-1",
                ["text"] = "I have what I need to do my job.",
                ["type"] = "likert",
                ["order"] = 0,
                // Both exactly what Mongoose baked into every document at write time.
                ["comment_prompt"] = "Please explain your answer:",
                ["binary_comment_config"] = new BsonDocument
                {
                    ["enabled"] = false,
                    ["label"] = "Please explain your answer",
                    ["placeholder"] = "Enter your explanation here...",
                    ["max_length"] = 500,
                    ["required"] = false,
                    ["min_length"] = 0,
                },
            },
        };

        var mapped = SurveyMapper.Map(Load(doc), Context(report));

        var question = Assert.Single(mapped!.Questions);
        Assert.Null(question.CommentPromptEn);
        Assert.Null(question.BinaryCommentConfigEn);
        Assert.Contains(report.Entries, e => e.Rule == MigrationRules.CommentPromptDefaultScrubbed);
        Assert.Contains(report.Entries, e => e.Rule == MigrationRules.BinaryCommentConfigDefaultScrubbed);
    }

    [Fact]
    public void Duplicate_question_ids_and_duplicate_option_values_keep_the_first_and_report_the_rest()
    {
        var report = new DataQualityReport();
        var doc = NominalSurvey();
        doc["questions"] = new BsonArray
        {
            new BsonDocument
            {
                ["id"] = "sq-1",
                ["text"] = "Pick one.",
                ["type"] = "multiple_choice",
                ["order"] = 0,
                ["options"] = new BsonArray { "Calm", "Busy", "Calm", "  " },
            },
            new BsonDocument { ["id"] = "sq-1", ["text"] = "The impostor.", ["type"] = "likert", ["order"] = 1 },
            new BsonDocument { ["text"] = "No id at all.", ["type"] = "likert", ["order"] = 2 },
        };

        var mapped = SurveyMapper.Map(Load(doc), Context(report));

        var question = Assert.Single(mapped!.Questions);
        Assert.Equal("Pick one.", question.TextEn);
        Assert.Contains(report.Entries, e => e.Rule == MigrationRules.SurveyQuestionDuplicateId);
        Assert.Contains(report.Entries, e => e.Rule == MigrationRules.SurveyQuestionMissingId);

        // The duplicate value is refused by name; the whitespace entry carries nothing.
        Assert.Equal(["Calm", "Busy"], mapped.Options.Select(o => o.Value));
        Assert.Equal([0, 1], mapped.Options.Select(o => o.Order));
        Assert.Contains(report.Entries, e => e.Rule == MigrationRules.QuestionOptionDuplicateValue);
    }

    [Fact]
    public void Conditional_logic_resolves_forward_references_and_reports_dangling_ones()
    {
        var report = new DataQualityReport();
        var doc = NominalSurvey();
        doc["questions"] = new BsonArray
        {
            new BsonDocument
            {
                ["id"] = "sq-1",
                ["text"] = "Shown when sq-2 answers yes.",
                ["type"] = "likert",
                ["order"] = 0,
                ["conditional_logic"] = new BsonDocument
                {
                    // Forward reference: sq-2 is declared AFTER this question.
                    ["condition_question_id"] = "sq-2",
                    ["condition_operator"] = "equals",
                    ["condition_value"] = "yes",
                    ["action"] = "show",
                },
            },
            new BsonDocument
            {
                ["id"] = "sq-2",
                ["text"] = "Do you use the tool?",
                ["type"] = "yes_no",
                ["order"] = 1,
                ["conditional_logic"] = new BsonDocument
                {
                    ["condition_question_id"] = "sq-404",
                    ["condition_operator"] = "greater_than",
                    ["condition_value"] = 3,
                    ["action"] = "skip_to",
                    ["target_question_id"] = "sq-1",
                },
            },
        };

        var mapped = SurveyMapper.Map(Load(doc), Context(report));

        var sq1 = MigrationIds.ForChild("surveys", SurveyOid, SurveyMapper.QuestionScope, "sq-1");
        var sq2 = MigrationIds.ForChild("surveys", SurveyOid, SurveyMapper.QuestionScope, "sq-2");
        Assert.Equal(2, mapped!.ConditionalLogic.Count);

        var first = Assert.Single(mapped.ConditionalLogic, l => l.QuestionId == sq1);
        Assert.Equal(sq2, first.ConditionQuestionId);
        Assert.Equal("\"yes\"", first.ConditionValue);

        var second = Assert.Single(mapped.ConditionalLogic, l => l.QuestionId == sq2);
        Assert.Null(second.ConditionQuestionId);
        Assert.Equal("3", second.ConditionValue);
        Assert.Equal(sq1, second.TargetQuestionId);
        Assert.Contains(report.Entries, e => e.Kind == ReportEntryKind.Degraded
            && e.Rule == MigrationRules.DanglingReference
            && e.Field == "questions[1].conditional_logic.condition_question_id");
    }

    [Fact]
    public void Unknown_question_type_is_reported_and_not_migrated()
    {
        var report = new DataQualityReport();
        var doc = NominalSurvey();
        doc["questions"] = new BsonArray
        {
            new BsonDocument { ["id"] = "sq-1", ["text"] = "A matrix.", ["type"] = "matrix", ["order"] = 0 },
        };

        var mapped = SurveyMapper.Map(Load(doc), Context(report));

        Assert.Empty(mapped!.Questions);
        Assert.Contains(report.Entries, e => e.Rule == MigrationRules.QuestionTypeUnknown);
    }

    [Fact]
    public void Template_link_and_demographics_config_are_named_drops_not_silence()
    {
        var report = new DataQualityReport();
        var doc = NominalSurvey();
        doc["template_id"] = ObjectId.GenerateNewId().ToString();
        doc["demographic_field_ids"] = new BsonArray { ObjectId.GenerateNewId().ToString() };
        doc["demographics"] = new BsonArray
        {
            new BsonDocument { ["field"] = "tenure", ["label"] = "Tenure", ["type"] = "select" },
        };

        Assert.NotNull(SurveyMapper.Map(Load(doc), Context(report)));
        Assert.Contains(report.Entries, e => e.Rule == MigrationRules.SurveyTemplateLinkDropped);
        Assert.Contains(report.Entries, e => e.Rule == MigrationRules.SurveyDemographicsConfigDropped);
    }

    [Fact]
    public void Dangling_department_target_degrades_and_resolved_one_lands()
    {
        var report = new DataQualityReport();
        var doc = NominalSurvey();
        doc["department_ids"] = new BsonArray
        {
            DepartmentOid.ToString(),
            ObjectId.GenerateNewId().ToString(),
            DepartmentOid.ToString(), // duplicate converges on one row
        };

        var mapped = SurveyMapper.Map(Load(doc), Context(report));

        var target = Assert.Single(mapped!.DepartmentTargets);
        Assert.Equal(DepartmentId, target.DepartmentId);
        Assert.Contains(report.Entries, e => e.Kind == ReportEntryKind.Degraded && e.Field == "department_ids");
    }

    [Fact]
    public void Overlong_unbounded_legacy_fields_truncate_as_a_named_rule()
    {
        var report = new DataQualityReport();
        var doc = NominalSurvey();
        doc["questions"] = new BsonArray
        {
            new BsonDocument
            {
                ["id"] = "sq-1",
                ["text"] = "Rate it.",
                ["type"] = "rating",
                ["order"] = 0,
                // No Mongoose maxlength existed on category (target: 100) or scale
                // labels (target: 200).
                ["category"] = new string('c', 150),
                ["scale_labels"] = new BsonDocument { ["min"] = new string('m', 250), ["max"] = "High" },
            },
        };

        var mapped = SurveyMapper.Map(Load(doc), Context(report));

        var question = Assert.Single(mapped!.Questions);
        Assert.Equal(100, question.Category!.Length);
        Assert.Equal(200, question.ScaleLabelMinEn!.Length);
        Assert.Equal(2, report.Entries.Count(e => e.Rule == MigrationRules.ContentOverlongTruncated));
    }
}
