using ClimateProject.DataMigration;
using ClimateProject.DataMigration.Legacy;
using ClimateProject.DataMigration.Mapping;
using ClimateProject.DataMigration.Reporting;
using MongoDB.Bson;
using MongoDB.Bson.Serialization;

namespace ClimateProject.DataMigration.Tests;

/// <summary>
/// The last legacy shape: action plans and their templates. Four edges carry the weight
/// here - the tenant-leak skip on the template, the assignment field that has no target
/// column at all, the child ids that legacy actually declares (unlike every other
/// embedded shape in this migration), and the two nested update arrays whose rows point
/// at a KPI or objective through a real foreign key.
/// </summary>
public class ActionPlanMapperTests
{
    private static readonly ObjectId CompanyOid = ObjectId.Parse("656000000000000000000001");
    private static readonly ObjectId OtherCompanyOid = ObjectId.Parse("656000000000000000000002");
    private static readonly ObjectId DepartmentOid = ObjectId.Parse("656000000000000000000011");
    private static readonly ObjectId UserOid = ObjectId.Parse("656000000000000000000021");
    private static readonly ObjectId GhostUserOid = ObjectId.Parse("656000000000000000000022");
    private static readonly ObjectId SurveyOid = ObjectId.Parse("656000000000000000000031");
    private static readonly ObjectId InsightOid = ObjectId.Parse("656000000000000000000041");
    private static readonly ObjectId TemplateOid = ObjectId.Parse("656000000000000000000051");
    private static readonly ObjectId PlanOid = ObjectId.Parse("656000000000000000000061");

    private static readonly Guid CompanyId = MigrationIds.For("companies", CompanyOid);
    private static readonly Guid DepartmentId = MigrationIds.For("departments", DepartmentOid);
    private static readonly Guid UserId = MigrationIds.For("users", UserOid);
    private static readonly Guid SurveyId = MigrationIds.For("surveys", SurveyOid);
    private static readonly Guid InsightId = MigrationIds.For("aiinsights", InsightOid);
    private static readonly Guid TemplateId = MigrationIds.For("actionplantemplates", TemplateOid);

    private static T Load<T>(BsonDocument document) where T : LegacyDocument
        => BsonSerializer.Deserialize<T>(document);

    private static MappingContext Context(DataQualityReport report) => new()
    {
        Report = report,
        Companies = new HashSet<Guid> { CompanyId },
        Departments = new HashSet<Guid> { DepartmentId },
        Users = new HashSet<Guid> { UserId },
        Surveys = new HashSet<Guid> { SurveyId },
        AiInsights = new HashSet<Guid> { InsightId },
        ActionPlanTemplates = new HashSet<Guid> { TemplateId },
    };

    private static bool Fired(DataQualityReport report, string rule)
        => report.Entries.Any(e => e.Rule == rule);

    private static BsonDocument NominalPlan() => new()
    {
        ["_id"] = PlanOid,
        ["title"] = "Lift engineering psychological safety",
        ["description"] = "Follow-up on the Q2 climate survey.",
        ["company_id"] = CompanyOid.ToString(),
        ["department_id"] = DepartmentOid.ToString(),
        ["created_by"] = UserOid.ToString(),
        ["assigned_to"] = new BsonArray { UserOid.ToString(), GhostUserOid.ToString() },
        ["due_date"] = new DateTime(2026, 12, 1, 0, 0, 0, DateTimeKind.Utc),
        ["status"] = "in_progress",
        ["priority"] = "high",
        ["template_id"] = TemplateOid.ToString(),
        ["source_survey_id"] = SurveyOid.ToString(),
        ["source_insight_id"] = InsightOid.ToString(),
        ["ai_recommendations"] = new BsonArray { "Run listening sessions", "  " },
        ["tags"] = new BsonArray { "engagement", "q3" },
        ["kpis"] = new BsonArray
        {
            new BsonDocument
            {
                ["id"] = "kpi-safety",
                ["name"] = "Psychological safety score",
                // Int32 on the wire: the Node driver writes integral JS Numbers as
                // Int32, so the double? stub has to widen one.
                ["target_value"] = 4,
                ["current_value"] = 3.2,
                ["unit"] = "score",
                ["measurement_frequency"] = "monthly",
            },
        },
        ["qualitative_objectives"] = new BsonArray
        {
            new BsonDocument
            {
                ["id"] = "obj-1on1",
                ["description"] = "Every lead runs weekly 1:1s",
                ["success_criteria"] = "100% of leads with a recurring invite",
                ["current_status"] = "started",
                ["completion_percentage"] = 40,
            },
        },
        ["progress_updates"] = new BsonArray
        {
            new BsonDocument
            {
                ["id"] = "upd-aug",
                ["update_date"] = new DateTime(2026, 8, 1, 0, 0, 0, DateTimeKind.Utc),
                ["overall_notes"] = "Sessions booked.",
                ["updated_by"] = UserOid.ToString(),
                ["kpi_updates"] = new BsonArray
                {
                    new BsonDocument { ["kpi_id"] = "kpi-safety", ["new_value"] = 3.6, ["notes"] = "up" },
                },
                ["qualitative_updates"] = new BsonArray
                {
                    new BsonDocument
                    {
                        ["objective_id"] = "obj-1on1",
                        ["status_update"] = "Most leads booked",
                        ["completion_percentage"] = 70,
                    },
                },
            },
        },
        ["created_at"] = new DateTime(2026, 7, 15, 0, 0, 0, DateTimeKind.Utc),
        ["updated_at"] = new DateTime(2026, 8, 1, 0, 0, 0, DateTimeKind.Utc),
    };

    private static BsonDocument NominalTemplate() => new()
    {
        ["_id"] = TemplateOid,
        ["name"] = "Psychological safety playbook",
        ["description"] = "Standard remedy for a low safety dimension.",
        ["category"] = "engagement",
        ["company_id"] = CompanyOid.ToString(),
        ["created_by"] = UserOid.ToString(),
        ["kpi_templates"] = new BsonArray
        {
            new BsonDocument
            {
                ["name"] = "Safety score", ["target_value"] = 4.2, ["unit"] = "score",
                ["measurement_frequency"] = "monthly",
            },
        },
        ["qualitative_objective_templates"] = new BsonArray
        {
            new BsonDocument { ["description"] = "Weekly 1:1s", ["success_criteria"] = "All leads" },
        },
        ["ai_recommendation_templates"] = new BsonArray { "Run listening sessions" },
        ["tags"] = new BsonArray { "engagement" },
        ["usage_count"] = 7,
        ["created_at"] = new DateTime(2026, 6, 1, 0, 0, 0, DateTimeKind.Utc),
    };

    [Fact]
    public void Plan_maps_with_its_full_child_fan_out()
    {
        var report = new DataQualityReport();

        var mapped = ActionPlanMapper.Map(Load<LegacyActionPlan>(NominalPlan()), Context(report));

        Assert.NotNull(mapped);
        Assert.Equal(CompanyId, mapped!.Plan.CompanyId);
        Assert.Equal(DepartmentId, mapped.Plan.DepartmentId);
        Assert.Equal(UserId, mapped.Plan.CreatedBy);
        Assert.Equal(TemplateId, mapped.Plan.TemplateId);
        Assert.Equal(SurveyId, mapped.Plan.SourceSurveyId);
        Assert.Equal(InsightId, mapped.Plan.SourceInsightId);
        Assert.Equal("in_progress", mapped.Plan.Status);
        Assert.Equal("high", mapped.Plan.Priority);

        // The whitespace-only recommendation is not a recommendation.
        Assert.Equal(["Run listening sessions"], mapped.Plan.AiRecommendations);
        Assert.Equal(["engagement", "q3"], mapped.Plan.Tags);

        var kpi = Assert.Single(mapped.Kpis);
        Assert.Equal(MigrationIds.ForChild("actionplans", PlanOid, "kpi", "kpi-safety"), kpi.Id);
        Assert.Equal(4m, kpi.TargetValue);
        Assert.Equal(3.2m, kpi.CurrentValue);
        Assert.Equal("monthly", kpi.MeasurementFrequency);

        var objective = Assert.Single(mapped.Objectives);
        Assert.Equal(MigrationIds.ForChild("actionplans", PlanOid, "objective", "obj-1on1"), objective.Id);
        Assert.Equal(40, objective.CompletionPercentage);
        Assert.Equal("started", objective.CurrentStatus);

        var update = Assert.Single(mapped.ProgressUpdates);
        Assert.Equal(MigrationIds.ForChild("actionplans", PlanOid, "progress", "upd-aug"), update.Id);
        Assert.Equal(UserId, update.UpdatedBy);
        Assert.Equal(new DateTimeOffset(2026, 8, 1, 0, 0, 0, TimeSpan.Zero), update.UpdateDate);

        // Each nested row resolves to the child it names, through the plan's own id map.
        var kpiUpdate = Assert.Single(mapped.KpiUpdates);
        Assert.Equal(update.Id, kpiUpdate.ProgressUpdateId);
        Assert.Equal(kpi.Id, kpiUpdate.KpiId);
        Assert.Equal(3.6m, kpiUpdate.NewValue);

        var objectiveUpdate = Assert.Single(mapped.ObjectiveUpdates);
        Assert.Equal(update.Id, objectiveUpdate.ProgressUpdateId);
        Assert.Equal(objective.Id, objectiveUpdate.ObjectiveId);
        Assert.Equal(70, objectiveUpdate.CompletionPercentage);
    }

    [Fact]
    public void Assignments_have_no_target_column_and_are_reported_rather_than_dropped_in_silence()
    {
        var report = new DataQualityReport();

        var mapped = ActionPlanMapper.Map(Load<LegacyActionPlan>(NominalPlan()), Context(report));

        Assert.NotNull(mapped);
        var entry = Assert.Single(
            report.Entries, e => e.Rule == MigrationRules.ActionPlanAssignmentsUnrepresentable);
        Assert.Equal("assigned_to", entry.Field);
        Assert.Contains("2 user(s)", entry.Reason);

        // The plan itself still loads: a schema gap degrades the record, it does not
        // disqualify it.
        Assert.Equal(ReportEntryKind.Normalisation, entry.Kind);
        Assert.Equal(0, report.SkipCount("actionplans"));
    }

    [Fact]
    public void Plan_without_a_due_date_is_skipped_rather_than_given_one()
    {
        var report = new DataQualityReport();
        var document = NominalPlan();
        document.Remove("due_date");

        var mapped = ActionPlanMapper.Map(Load<LegacyActionPlan>(document), Context(report));

        Assert.Null(mapped);
        var entry = Assert.Single(report.Entries, e => e.Kind == ReportEntryKind.Skip);
        Assert.Equal("due_date", entry.Field);
        Assert.Equal(1, report.SkipCount("actionplans"));
    }

    [Fact]
    public void Unknown_status_keeps_the_plan_counted_as_outstanding_work()
    {
        var report = new DataQualityReport();
        var document = NominalPlan();
        document["status"] = "on_hold";
        document["priority"] = "urgent";

        var mapped = ActionPlanMapper.Map(Load<LegacyActionPlan>(document), Context(report));

        Assert.NotNull(mapped);

        // The dashboard's definition of open is "not completed and not cancelled", so an
        // unreadable status must never be the reason a plan claims to be finished.
        Assert.Equal("not_started", mapped!.Plan.Status);
        Assert.Equal("medium", mapped.Plan.Priority);
        Assert.True(Fired(report, MigrationRules.ActionPlanStatusUnknown));
        Assert.True(Fired(report, MigrationRules.ActionPlanPriorityUnknown));
    }

    [Fact]
    public void Kpi_with_an_unreadable_measurement_frequency_is_dropped_with_the_updates_that_cite_it()
    {
        var report = new DataQualityReport();
        var document = NominalPlan();
        document["kpis"].AsBsonArray[0].AsBsonDocument["measurement_frequency"] = "fortnightly";

        var mapped = ActionPlanMapper.Map(Load<LegacyActionPlan>(document), Context(report));

        Assert.NotNull(mapped);
        Assert.Empty(mapped!.Kpis);

        // The progress update survives - it still carries its notes and its objective
        // movement - but the KPI row that pointed at a KPI nobody migrated does not.
        Assert.Single(mapped.ProgressUpdates);
        Assert.Empty(mapped.KpiUpdates);
        Assert.Single(mapped.ObjectiveUpdates);
        Assert.True(Fired(report, MigrationRules.ActionPlanKpiFrequencyUnknown));
        Assert.True(Fired(report, MigrationRules.ActionPlanProgressItemUnresolved));
    }

    [Fact]
    public void Progress_update_by_an_unresolvable_user_is_not_migrated()
    {
        var report = new DataQualityReport();
        var document = NominalPlan();
        document["progress_updates"].AsBsonArray[0].AsBsonDocument["updated_by"] = GhostUserOid.ToString();

        var mapped = ActionPlanMapper.Map(Load<LegacyActionPlan>(document), Context(report));

        Assert.NotNull(mapped);
        Assert.Empty(mapped!.ProgressUpdates);

        // Its children go with it: a row whose parent was never written is unreachable.
        Assert.Empty(mapped.KpiUpdates);
        Assert.Empty(mapped.ObjectiveUpdates);
        Assert.True(Fired(report, MigrationRules.ActionPlanProgressActorUnresolved));

        // A child that cannot load is a degradation of the plan, not a skip of it.
        Assert.Equal(0, report.SkipCount("actionplans"));
    }

    [Fact]
    public void Undated_progress_update_takes_the_plans_own_time_never_the_wall_clock()
    {
        var report = new DataQualityReport();
        var document = NominalPlan();
        document["progress_updates"].AsBsonArray[0].AsBsonDocument.Remove("update_date");

        var mapped = ActionPlanMapper.Map(Load<LegacyActionPlan>(document), Context(report));

        Assert.NotNull(mapped);
        var update = Assert.Single(mapped!.ProgressUpdates);
        Assert.Equal(mapped.Plan.CreatedAt, update.UpdateDate);
        Assert.Equal(new DateTimeOffset(2026, 7, 15, 0, 0, 0, TimeSpan.Zero), update.UpdateDate);
        Assert.True(Fired(report, MigrationRules.ActionPlanProgressDateDerived));
    }

    [Fact]
    public void Duplicate_child_id_derives_one_row_so_the_second_is_refused()
    {
        var report = new DataQualityReport();
        var document = NominalPlan();
        document["kpis"] = new BsonArray
        {
            new BsonDocument
            {
                ["id"] = "kpi-safety", ["name"] = "First", ["target_value"] = 4.0,
                ["unit"] = "score", ["measurement_frequency"] = "monthly",
            },
            new BsonDocument
            {
                ["id"] = "kpi-safety", ["name"] = "Second", ["target_value"] = 5.0,
                ["unit"] = "score", ["measurement_frequency"] = "monthly",
            },
        };

        var mapped = ActionPlanMapper.Map(Load<LegacyActionPlan>(document), Context(report));

        Assert.NotNull(mapped);
        var kpi = Assert.Single(mapped!.Kpis);
        Assert.Equal("First", kpi.Name);
        Assert.True(Fired(report, MigrationRules.ActionPlanChildDuplicateId));
    }

    [Fact]
    public void Child_without_the_id_the_schema_requires_falls_back_to_its_position()
    {
        var report = new DataQualityReport();
        var document = NominalPlan();
        document["qualitative_objectives"].AsBsonArray[0].AsBsonDocument.Remove("id");

        var mapped = ActionPlanMapper.Map(Load<LegacyActionPlan>(document), Context(report));

        Assert.NotNull(mapped);
        var objective = Assert.Single(mapped!.Objectives);
        Assert.Equal(MigrationIds.ForChild("actionplans", PlanOid, "objective", "#0"), objective.Id);
        Assert.True(Fired(report, MigrationRules.ActionPlanChildIdFromPosition));

        // Nothing can reference it any more: the update that named the old id is reported,
        // not silently attached to the positionally-keyed row.
        Assert.Empty(mapped.ObjectiveUpdates);
        Assert.True(Fired(report, MigrationRules.ActionPlanProgressItemUnresolved));
    }

    [Fact]
    public void Out_of_range_completion_is_clamped_and_unrepresentable_numbers_drop_their_row()
    {
        var report = new DataQualityReport();
        var document = NominalPlan();
        document["qualitative_objectives"].AsBsonArray[0].AsBsonDocument["completion_percentage"] = 340.0;
        document["kpis"].AsBsonArray[0].AsBsonDocument["target_value"] = 1e30;

        var mapped = ActionPlanMapper.Map(Load<LegacyActionPlan>(document), Context(report));

        Assert.NotNull(mapped);
        Assert.Equal(100, Assert.Single(mapped!.Objectives).CompletionPercentage);
        Assert.True(Fired(report, MigrationRules.ActionPlanCompletionClamped));

        // 1e30 is a number JS holds and a numeric column's decimal cannot: the KPI is
        // reported and dropped rather than throwing mid-batch.
        Assert.Empty(mapped.Kpis);
        Assert.True(Fired(report, MigrationRules.ActionPlanNumericUnrepresentable));
        Assert.True(Fired(report, MigrationRules.ActionPlanKpiIncomplete));
    }

    [Fact]
    public void Broken_optional_references_degrade_to_null_and_the_plan_still_loads()
    {
        var report = new DataQualityReport();
        var document = NominalPlan();
        document["department_id"] = "not-an-object-id";
        document["template_id"] = ObjectId.Parse("656000000000000000000099").ToString();
        document["source_insight_id"] = ObjectId.Parse("656000000000000000000098").ToString();

        var mapped = ActionPlanMapper.Map(Load<LegacyActionPlan>(document), Context(report));

        Assert.NotNull(mapped);
        Assert.Null(mapped!.Plan.DepartmentId);
        Assert.Null(mapped.Plan.TemplateId);
        Assert.Null(mapped.Plan.SourceInsightId);
        Assert.Equal(SurveyId, mapped.Plan.SourceSurveyId);

        Assert.True(Fired(report, MigrationRules.MalformedReference));
        Assert.True(Fired(report, MigrationRules.DanglingReference));
        Assert.Equal(0, report.SkipCount("actionplans"));
    }

    [Fact]
    public void Plan_whose_company_or_creator_is_unresolvable_is_skipped()
    {
        foreach (var field in new[] { "company_id", "created_by" })
        {
            var report = new DataQualityReport();
            var document = NominalPlan();
            document[field] = GhostUserOid.ToString();

            Assert.Null(ActionPlanMapper.Map(Load<LegacyActionPlan>(document), Context(report)));
            Assert.Equal(1, report.SkipCount("actionplans"));
        }
    }

    [Fact]
    public void Template_maps_with_its_positionally_keyed_children()
    {
        var report = new DataQualityReport();

        var mapped = ActionPlanTemplateMapper.Map(Load<LegacyActionPlanTemplate>(NominalTemplate()), Context(report));

        Assert.NotNull(mapped);
        Assert.Equal(TemplateId, mapped!.Template.Id);
        Assert.Equal(CompanyId, mapped.Template.CompanyId);
        Assert.Equal(UserId, mapped.Template.CreatedBy);
        Assert.Equal(7, mapped.Template.UsageCount);
        Assert.True(mapped.Template.IsActive);

        var kpi = Assert.Single(mapped.Kpis);
        Assert.Equal(MigrationIds.ForChild("actionplantemplates", TemplateOid, "kpi", "#0"), kpi.Id);
        Assert.Equal(4.2m, kpi.TargetValue);

        var objective = Assert.Single(mapped.Objectives);
        Assert.Equal(
            MigrationIds.ForChild("actionplantemplates", TemplateOid, "objective", "#0"), objective.Id);
    }

    [Fact]
    public void Template_with_no_company_is_global_and_loads_with_a_null_company()
    {
        var report = new DataQualityReport();
        var document = NominalTemplate();
        document.Remove("company_id");

        var mapped = ActionPlanTemplateMapper.Map(Load<LegacyActionPlanTemplate>(document), Context(report));

        Assert.NotNull(mapped);
        Assert.Null(mapped!.Template.CompanyId);
        Assert.Equal(0, report.SkipCount("actionplantemplates"));
    }

    [Fact]
    public void Template_whose_company_reference_is_broken_is_skipped_never_published_globally()
    {
        foreach (var reference in new[] { OtherCompanyOid.ToString(), "undefined" })
        {
            var report = new DataQualityReport();
            var document = NominalTemplate();
            document["company_id"] = reference;

            var mapped = ActionPlanTemplateMapper.Map(Load<LegacyActionPlanTemplate>(document), Context(report));

            // THE TENANT-LEAK SKIP: NULL means a global template, so degrading an
            // unresolvable company would publish this company's playbook to every tenant.
            Assert.Null(mapped);
            var entry = Assert.Single(report.Entries, e => e.Kind == ReportEntryKind.Skip);
            Assert.Equal("company_id", entry.Field);
            Assert.Contains("every tenant", entry.Reason);
        }
    }

    [Fact]
    public void Template_children_that_cannot_stand_alone_are_reported_and_left_out()
    {
        var report = new DataQualityReport();
        var document = NominalTemplate();
        document["kpi_templates"] = new BsonArray
        {
            new BsonDocument { ["name"] = "No unit", ["target_value"] = 1.0 },
            new BsonDocument
            {
                ["name"] = "Odd cadence", ["target_value"] = 1.0, ["unit"] = "score",
                ["measurement_frequency"] = "yearly",
            },
        };
        document["qualitative_objective_templates"] = new BsonArray
        {
            new BsonDocument { ["description"] = "No success criteria" },
        };

        var mapped = ActionPlanTemplateMapper.Map(Load<LegacyActionPlanTemplate>(document), Context(report));

        Assert.NotNull(mapped);
        Assert.Empty(mapped!.Kpis);
        Assert.Empty(mapped.Objectives);
        Assert.True(Fired(report, MigrationRules.ActionPlanTemplateKpiIncomplete));
        Assert.True(Fired(report, MigrationRules.ActionPlanTemplateKpiFrequencyUnknown));
        Assert.True(Fired(report, MigrationRules.ActionPlanTemplateObjectiveIncomplete));
    }

    [Fact]
    public void Undeclared_fields_at_every_depth_reach_the_report()
    {
        var report = new DataQualityReport();
        var document = NominalPlan();
        document["budget_cents"] = 50_000;
        document["kpis"].AsBsonArray[0].AsBsonDocument["baseline_value"] = 2.9;
        document["progress_updates"].AsBsonArray[0].AsBsonDocument["kpi_updates"]
            .AsBsonArray[0].AsBsonDocument["source"] = "import";

        Assert.NotNull(ActionPlanMapper.Map(Load<LegacyActionPlan>(document), Context(report)));

        var unmapped = report.Entries
            .Where(e => e.Kind == ReportEntryKind.UnmappedExtra)
            .Select(e => e.Field)
            .ToList();
        Assert.Contains("budget_cents", unmapped);
        Assert.Contains("kpis[0].baseline_value", unmapped);
        Assert.Contains("progress_updates[0].kpi_updates[0].source", unmapped);
    }

    [Fact]
    public void Ids_are_a_pure_function_of_the_source_document_so_a_re_run_derives_them_again()
    {
        var first = ActionPlanMapper.Map(Load<LegacyActionPlan>(NominalPlan()), Context(new DataQualityReport()));
        var second = ActionPlanMapper.Map(Load<LegacyActionPlan>(NominalPlan()), Context(new DataQualityReport()));

        Assert.NotNull(first);
        Assert.NotNull(second);
        Assert.Equal(first!.Plan.Id, second!.Plan.Id);
        Assert.Equal(first.Kpis[0].Id, second.Kpis[0].Id);
        Assert.Equal(first.ProgressUpdates[0].Id, second.ProgressUpdates[0].Id);
        Assert.Equal(first.KpiUpdates[0].Id, second.KpiUpdates[0].Id);
        Assert.Equal(first.ObjectiveUpdates[0].Id, second.ObjectiveUpdates[0].Id);

        // Distinct scopes: a KPI and an objective sharing a legacy id must not collide.
        Assert.NotEqual(
            MigrationIds.ForChild("actionplans", PlanOid, "kpi", "same"),
            MigrationIds.ForChild("actionplans", PlanOid, "objective", "same"));
    }
}
