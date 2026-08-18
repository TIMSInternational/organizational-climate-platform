using ClimateProject.DataMigration;
using ClimateProject.DataMigration.Legacy;
using ClimateProject.DataMigration.Mapping;
using ClimateProject.DataMigration.Reporting;
using MongoDB.Bson;
using MongoDB.Bson.Serialization;

namespace ClimateProject.DataMigration.Tests;

/// <summary>
/// Sub-issue B's unit layer for the SurveyTemplate fan-out: the tenant-leak skip, the
/// global-template fallback locale, positional question identity, the unrepresentable
/// emoji drop, and the scrub rules shared with the survey mapper.
/// </summary>
public class SurveyTemplateMapperTests
{
    private static readonly ObjectId CompanyOid = ObjectId.Parse("64e000000000000000000001");
    private static readonly ObjectId EsCompanyOid = ObjectId.Parse("64e000000000000000000002");
    private static readonly ObjectId CreatorOid = ObjectId.Parse("64e000000000000000000011");
    private static readonly ObjectId SurveyOid = ObjectId.Parse("64e000000000000000000021");
    private static readonly ObjectId TemplateOid = ObjectId.Parse("64e000000000000000000031");

    private static readonly Guid CompanyId = MigrationIds.For("companies", CompanyOid);
    private static readonly Guid EsCompanyId = MigrationIds.For("companies", EsCompanyOid);
    private static readonly Guid CreatorId = MigrationIds.For("users", CreatorOid);
    private static readonly Guid SurveyId = MigrationIds.For("surveys", SurveyOid);

    private static LegacySurveyTemplate Load(BsonDocument document)
        => BsonSerializer.Deserialize<LegacySurveyTemplate>(document);

    private static MappingContext Context(DataQualityReport report) => new()
    {
        Report = report,
        Companies = new HashSet<Guid> { CompanyId, EsCompanyId },
        CompanyLanguages = new Dictionary<Guid, string> { [CompanyId] = "en", [EsCompanyId] = "es" },
        Users = new HashSet<Guid> { CreatorId },
        Surveys = new HashSet<Guid> { SurveyId },
    };

    private static BsonDocument NominalTemplate() => new()
    {
        ["_id"] = TemplateOid,
        ["name"] = "Quarterly Pulse",
        ["description"] = "The standard quarterly check-in.",
        ["category"] = "climate",
        ["company_id"] = CompanyOid.ToString(),
        ["created_by"] = CreatorOid.ToString(),
        ["questions"] = new BsonArray(),
        ["is_public"] = false,
        ["usage_count"] = 7,
        ["rating"] = 4.5,
        ["tags"] = new BsonArray { "pulse", "  ", "quarterly" },
        ["created_at"] = new DateTime(2026, 5, 1, 0, 0, 0, DateTimeKind.Utc),
        ["updated_at"] = new DateTime(2026, 6, 1, 0, 0, 0, DateTimeKind.Utc),
    };

    [Fact]
    public void Template_maps_nominal_document_with_question_fan_out_and_attribution()
    {
        var report = new DataQualityReport();
        var doc = NominalTemplate();
        doc["source_survey_id"] = SurveyOid.ToString();
        doc["questions"] = new BsonArray
        {
            new BsonDocument
            {
                ["id"] = "tq-1",
                ["text"] = "I feel heard.",
                ["type"] = "likert",
                ["comment_prompt"] = "Please explain your answer:", // the baked-in default
                ["order"] = 0,
            },
            new BsonDocument
            {
                ["id"] = "tq-2",
                ["text"] = "Preferred cadence?",
                ["type"] = "multiple_choice",
                ["options"] = new BsonArray { "Weekly", "Monthly", "Weekly" },
                ["order"] = 1,
            },
        };

        var mapped = SurveyTemplateMapper.Map(Load(doc), Context(report));

        Assert.NotNull(mapped);
        Assert.Equal(MigrationIds.For("surveytemplates", TemplateOid), mapped!.Template.Id);
        Assert.Equal("Quarterly Pulse", mapped.Template.Name);
        Assert.Equal(CompanyId, mapped.Template.CompanyId);
        Assert.Equal(CreatorId, mapped.Template.CreatedBy);
        Assert.Equal(SurveyId, mapped.Template.SourceSurveyId);
        Assert.Equal(4.5, mapped.Template.Rating);
        Assert.Equal(["pulse", "quarterly"], mapped.Template.Tags);

        Assert.Equal(2, mapped.Questions.Count);
        var likert = mapped.Questions[0];
        Assert.Equal(
            MigrationIds.ForChild("surveytemplates", TemplateOid, SurveyTemplateMapper.QuestionScope, "tq-1"),
            likert.Id);
        Assert.Equal("I feel heard.", likert.TextEn);
        Assert.Null(likert.TextEs);
        Assert.Null(likert.CommentPromptEn); // scrubbed via the SHARED rule
        Assert.Contains(report.Entries, e => e.Rule == MigrationRules.CommentPromptDefaultScrubbed
            && e.Collection == "surveytemplates");

        Assert.Equal(["Weekly", "Monthly"], mapped.Options.Select(o => o.Value));
        Assert.Contains(report.Entries, e => e.Rule == MigrationRules.QuestionOptionDuplicateValue);
        Assert.Equal(2, report.Entries.Count(e => e.Kind == ReportEntryKind.Attribution));
    }

    [Fact]
    public void Global_template_without_company_takes_the_fallback_locale()
    {
        var report = new DataQualityReport();
        var doc = NominalTemplate();
        doc.Remove("company_id");
        doc["is_public"] = true;
        doc["questions"] = new BsonArray
        {
            new BsonDocument { ["id"] = "tq-1", ["text"] = "A public question.", ["type"] = "likert", ["order"] = 0 },
        };

        var mapped = SurveyTemplateMapper.Map(Load(doc), Context(report));

        Assert.Null(mapped!.Template.CompanyId);
        Assert.True(mapped.Template.IsPublic);
        Assert.Equal("A public question.", Assert.Single(mapped.Questions).TextEn);
        var attribution = Assert.Single(report.Entries, e => e.Kind == ReportEntryKind.Attribution);
        Assert.Contains("'en'", attribution.Reason);
    }

    [Fact]
    public void Dangling_company_is_a_skip_because_null_would_leak_the_template_globally()
    {
        var report = new DataQualityReport();
        var doc = NominalTemplate();
        doc["company_id"] = ObjectId.GenerateNewId().ToString();

        Assert.Null(SurveyTemplateMapper.Map(Load(doc), Context(report)));
        var entry = Assert.Single(report.Entries, e => e.Kind == ReportEntryKind.Skip);
        Assert.Equal(MigrationRules.DanglingReference, entry.Rule);
        Assert.Equal("company_id", entry.Field);
    }

    [Fact]
    public void Dangling_creator_and_source_survey_degrade_to_null_unlike_the_company()
    {
        var report = new DataQualityReport();
        var doc = NominalTemplate();
        doc["created_by"] = ObjectId.GenerateNewId().ToString();
        doc["source_survey_id"] = "undefined";

        var mapped = SurveyTemplateMapper.Map(Load(doc), Context(report));

        Assert.NotNull(mapped);
        Assert.Null(mapped!.Template.CreatedBy);
        Assert.Null(mapped.Template.SourceSurveyId);
        Assert.Equal(2, report.Entries.Count(e => e.Kind == ReportEntryKind.Degraded));
        Assert.DoesNotContain(report.Entries, e => e.Kind == ReportEntryKind.Skip);
    }

    [Fact]
    public void Emoji_question_is_unrepresentable_and_dropped_by_name()
    {
        var report = new DataQualityReport();
        var doc = NominalTemplate();
        doc["questions"] = new BsonArray
        {
            new BsonDocument
            {
                ["id"] = "tq-1", ["text"] = "How was it?", ["type"] = "emoji_scale", ["order"] = 0,
                ["emoji_options"] = new BsonArray
                {
                    new BsonDocument { ["emoji"] = "😄", ["label"] = "Great", ["value"] = 3 },
                },
            },
            new BsonDocument { ["id"] = "tq-2", ["text"] = "Kept.", ["type"] = "likert", ["order"] = 1 },
        };

        var mapped = SurveyTemplateMapper.Map(Load(doc), Context(report));

        Assert.Equal("Kept.", Assert.Single(mapped!.Questions).TextEn);
        Assert.Contains(report.Entries, e => e.Rule == MigrationRules.SurveyTemplateQuestionEmojiUnrepresentable);
    }

    [Fact]
    public void Conditional_logic_drops_by_name_but_the_question_survives()
    {
        var report = new DataQualityReport();
        var doc = NominalTemplate();
        doc["questions"] = new BsonArray
        {
            new BsonDocument
            {
                ["id"] = "tq-1", ["text"] = "Conditional once.", ["type"] = "likert", ["order"] = 0,
                ["conditional_logic"] = new BsonDocument
                {
                    ["condition_question_id"] = "tq-0", ["condition_operator"] = "equals",
                    ["condition_value"] = "yes", ["action"] = "show",
                },
            },
        };

        var mapped = SurveyTemplateMapper.Map(Load(doc), Context(report));

        Assert.Single(mapped!.Questions);
        Assert.Contains(report.Entries,
            e => e.Rule == MigrationRules.SurveyTemplateQuestionConditionalLogicDropped);
    }

    [Fact]
    public void Missing_and_duplicate_question_ids_key_by_position_keeping_the_content()
    {
        var report = new DataQualityReport();
        var doc = NominalTemplate();
        doc["questions"] = new BsonArray
        {
            new BsonDocument { ["text"] = "No id.", ["type"] = "likert", ["order"] = 0 },
            new BsonDocument { ["id"] = "tq-1", ["text"] = "Named.", ["type"] = "likert", ["order"] = 1 },
            new BsonDocument { ["id"] = "tq-1", ["text"] = "Impostor kept too.", ["type"] = "likert", ["order"] = 2 },
        };

        var mapped = SurveyTemplateMapper.Map(Load(doc), Context(report));

        // All three survive - nothing references template question ids - and the two
        // fallbacks are position-keyed, so their ids stay deterministic and distinct.
        Assert.Equal(3, mapped!.Questions.Count);
        Assert.Equal(3, mapped.Questions.Select(q => q.Id).Distinct().Count());
        Assert.Equal(
            MigrationIds.ForChild("surveytemplates", TemplateOid, SurveyTemplateMapper.QuestionScope, "#0"),
            mapped.Questions[0].Id);
        Assert.Equal(2, report.Entries.Count(e => e.Rule == MigrationRules.SurveyTemplateQuestionIdFromPosition));
    }

    [Fact]
    public void Default_settings_and_demographics_config_are_named_drops()
    {
        var report = new DataQualityReport();
        var doc = NominalTemplate();
        doc["default_settings"] = new BsonDocument { ["anonymous"] = true };
        doc["demographics"] = new BsonArray
        {
            new BsonDocument { ["field"] = "tenure", ["label"] = "Tenure", ["type"] = "select" },
        };

        Assert.NotNull(SurveyTemplateMapper.Map(Load(doc), Context(report)));
        Assert.Contains(report.Entries, e => e.Rule == MigrationRules.SurveyTemplateDefaultSettingsDropped);
        Assert.Contains(report.Entries, e => e.Rule == MigrationRules.SurveyTemplateDemographicsConfigDropped);
    }

    [Fact]
    public void Spanish_company_routes_question_content_to_es()
    {
        var report = new DataQualityReport();
        var doc = NominalTemplate();
        doc["company_id"] = EsCompanyOid.ToString();
        doc["questions"] = new BsonArray
        {
            new BsonDocument
            {
                ["id"] = "tq-1", ["text"] = "Me siento escuchado.", ["type"] = "multiple_choice",
                ["options"] = new BsonArray { "Siempre", "A veces" }, ["order"] = 0,
            },
        };

        var mapped = SurveyTemplateMapper.Map(Load(doc), Context(report));

        var question = Assert.Single(mapped!.Questions);
        Assert.Equal("Me siento escuchado.", question.TextEs);
        Assert.Null(question.TextEn);
        Assert.Equal("Siempre", mapped.Options[0].LabelEs);
        Assert.Null(mapped.Options[0].LabelEn);
    }

    [Fact]
    public void Template_without_name_description_or_category_is_a_reported_skip()
    {
        foreach (var missing in new[] { "name", "description", "category" })
        {
            var report = new DataQualityReport();
            var doc = NominalTemplate();
            doc.Remove(missing);

            Assert.Null(SurveyTemplateMapper.Map(Load(doc), Context(report)));
            var entry = Assert.Single(report.Entries, e => e.Kind == ReportEntryKind.Skip);
            Assert.Equal(MigrationRules.MissingRequiredField, entry.Rule);
            Assert.Equal(missing, entry.Field);
        }
    }

    [Fact]
    public void Yes_no_comment_remaps_and_an_authored_prompt_survives_in_the_shared_rules()
    {
        var report = new DataQualityReport();
        var doc = NominalTemplate();
        doc["questions"] = new BsonArray
        {
            new BsonDocument
            {
                ["id"] = "tq-1", ["text"] = "Recommend us?", ["type"] = "yes_no_comment",
                ["comment_prompt"] = "What tipped it?", ["order"] = 0,
            },
        };

        var mapped = SurveyTemplateMapper.Map(Load(doc), Context(report));

        var question = Assert.Single(mapped!.Questions);
        Assert.Equal("yes_no", question.Type);
        Assert.Equal("What tipped it?", question.CommentPromptEn);
        Assert.Contains(report.Entries, e => e.Rule == MigrationRules.QuestionTypeYesNoCommentRemapped);
    }
}
