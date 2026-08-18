using ClimateProject.Application.ActionPlans;
using ClimateProject.DataMigration.Legacy;
using ClimateProject.DataMigration.Reporting;
using ClimateProject.Domain.Entities;

namespace ClimateProject.DataMigration.Mapping;

/// <summary>A mapped template and its two child fan-outs.</summary>
public sealed record MappedActionPlanTemplate(
    ActionPlanTemplate Template,
    IReadOnlyList<ActionPlanTemplateKpi> Kpis,
    IReadOnlyList<ActionPlanTemplateObjective> Objectives);

/// <summary>
/// A mapped plan and its five child fan-outs, flat and in FK order: KPIs and objectives
/// first, then the progress updates, then the per-update rows that point back at a KPI
/// or an objective.
/// </summary>
public sealed record MappedActionPlan(
    ActionPlan Plan,
    IReadOnlyList<ActionPlanKpi> Kpis,
    IReadOnlyList<ActionPlanObjective> Objectives,
    IReadOnlyList<ActionPlanProgressUpdate> ProgressUpdates,
    IReadOnlyList<ActionPlanKpiUpdate> KpiUpdates,
    IReadOnlyList<ActionPlanObjectiveUpdate> ObjectiveUpdates);

/// <summary>
/// Shared by both action-plan mappers: the vocabularies come from
/// <see cref="ActionPlanValidation"/> - the class the write path validates against - so
/// the migration and the API agree on what a legal value is by construction rather than
/// by a copied list.
/// </summary>
internal static class ActionPlanContent
{
    /// <summary>
    /// The conversion JS Number -> <c>numeric</c> has to survive: a legacy KPI target is
    /// a double, and doubles reach magnitudes and states (NaN, infinity) that no decimal
    /// column can hold. Rather than let the cast throw mid-batch, the value is reported
    /// by name and its row is dropped by the caller.
    /// </summary>
    private const double DecimalLimit = 7.9e28;

    public static decimal? Numeric(
        double? value, string collection, string legacyId, string field, DataQualityReport report)
    {
        if (value is not { } number)
        {
            return null;
        }

        if (double.IsNaN(number) || double.IsInfinity(number) || Math.Abs(number) > DecimalLimit)
        {
            report.Normalisation(MigrationRules.ActionPlanNumericUnrepresentable, collection, legacyId, field,
                $"'{number}' is outside the range this migration converts into a numeric column");
            return null;
        }

        return (decimal)number;
    }

    /// <summary>
    /// The legacy schema constrains completion to 0-100 but Mongo never enforced the
    /// min/max, so an out-of-range percentage is clamped by name - a bar drawn at 340%
    /// is a rendering bug, and a negative one reads as progress lost.
    /// </summary>
    public static int? Completion(
        double? value, string collection, string legacyId, string field, DataQualityReport report)
    {
        if (value is not { } raw || double.IsNaN(raw))
        {
            return null;
        }

        if (raw is < 0d or > 100d)
        {
            report.Normalisation(MigrationRules.ActionPlanCompletionClamped, collection, legacyId, field,
                $"completion is {raw}; the column records a percentage, so it is clamped to 0-100");
        }

        return (int)Math.Round(Math.Clamp(raw, 0d, 100d), MidpointRounding.AwayFromZero);
    }

    public static bool IsKnownFrequency(string? frequency)
        => frequency is not null
           && ActionPlanValidation.ValidMeasurementFrequencies.Contains(frequency, StringComparer.Ordinal);

    public static string[] Strings(List<string>? values)
        => (values ?? [])
            .Select(MapperHelpers.Trimmed)
            .Where(value => value is not null)
            .Select(value => value!)
            .ToArray();
}

/// <summary>
/// Reusable plan playbooks. <c>company_id</c> is optional and the legacy model's own
/// comment says "null for global templates", so this collection gets THE TENANT-LEAK
/// SKIP that SurveyTemplate, MicroclimateTemplate, NotificationTemplate and Benchmark
/// got: absent is legitimately global, unresolvable is a skip. A NULL here would publish
/// one company's playbook - the KPIs it tracks, the targets it sets, the remedies it
/// recommends - to every tenant on the platform.
///
/// Template children carry no ids (the legacy shapes are the instance shapes with the
/// per-instance fields omitted), so they key positionally, and a template KPI list is
/// meaningful in its own order.
/// </summary>
public static class ActionPlanTemplateMapper
{
    public const string Collection = "actionplantemplates";
    public const string KpiScope = "kpi";
    public const string ObjectiveScope = "objective";

    public static MappedActionPlanTemplate? Map(LegacyActionPlanTemplate doc, MappingContext context)
    {
        var report = context.Report;
        var legacyId = doc.Id.ToString();
        MapperHelpers.ReportExtras(report, Collection, doc.Id, ("", doc.Extra));

        var name = MapperHelpers.Truncated(doc.Name, 200, Collection, legacyId, "name", report);
        var description = MapperHelpers.Trimmed(doc.Description);
        var category = MapperHelpers.Truncated(doc.Category, 100, Collection, legacyId, "category", report);
        if (name is null || description is null || category is null)
        {
            report.Skip(MigrationRules.MissingRequiredField, Collection, legacyId,
                "template is missing its name, description or category, all NOT NULL",
                name is null ? "name" : description is null ? "description" : "category");
            return null;
        }

        var creatorRef = ReferenceResolver.Classify(UserMapper.Collection, doc.CreatedBy, context.Users);
        if (creatorRef.Kind != ReferenceKind.Resolved)
        {
            report.Skip(
                creatorRef.Kind == ReferenceKind.Malformed
                    ? MigrationRules.MalformedReference
                    : MigrationRules.DanglingReference,
                Collection, legacyId, "created_by does not resolve; the column is a non-nullable FK", "created_by");
            return null;
        }

        // The tenant-leak skip.
        Guid? companyId = null;
        var companyRef = ReferenceResolver.Classify(CompanyMapper.Collection, doc.CompanyId, context.Companies);
        switch (companyRef.Kind)
        {
            case ReferenceKind.Resolved:
                companyId = companyRef.TargetId;
                break;
            case ReferenceKind.Absent:
                break;
            default:
                report.Skip(
                    companyRef.Kind == ReferenceKind.Malformed
                        ? MigrationRules.MalformedReference
                        : MigrationRules.DanglingReference,
                    Collection, legacyId,
                    "company_id does not resolve; NULL means a global template visible to every tenant, "
                    + "which would publish this company's playbook platform-wide",
                    "company_id");
                return null;
        }

        var template = new ActionPlanTemplate
        {
            Id = MigrationIds.For(Collection, doc.Id),
            Name = name,
            Description = description,
            Category = category,
            CompanyId = companyId,
            CreatedBy = creatorRef.TargetId!.Value,
            AiRecommendationTemplates = ActionPlanContent.Strings(doc.AiRecommendationTemplates),
            Tags = ActionPlanContent.Strings(doc.Tags),
            UsageCount = doc.UsageCount ?? 0,
            IsActive = doc.IsActive ?? true,
            CreatedAt = MapperHelpers.Timestamp(doc.CreatedAt, doc.Id, Collection, "created_at", report),
            UpdatedAt = MapperHelpers.Timestamp(doc.UpdatedAt, doc.Id, Collection, "updated_at", report),
        };

        var kpis = new List<ActionPlanTemplateKpi>();
        for (var index = 0; index < (doc.KpiTemplates?.Count ?? 0); index++)
        {
            var legacy = doc.KpiTemplates![index];
            var field = $"kpi_templates[{index}]";
            MapperHelpers.ReportExtras(report, Collection, doc.Id, (field, legacy.Extra));

            var kpiName = MapperHelpers.Truncated(legacy.Name, 200, Collection, legacyId, $"{field}.name", report);
            var unit = MapperHelpers.Truncated(legacy.Unit, 50, Collection, legacyId, $"{field}.unit", report);
            var target = ActionPlanContent.Numeric(
                legacy.TargetValue, Collection, legacyId, $"{field}.target_value", report);
            if (kpiName is null || unit is null || target is null)
            {
                report.Normalisation(MigrationRules.ActionPlanTemplateKpiIncomplete, Collection, legacyId, field,
                    "template KPI is missing its name, unit or target value, all NOT NULL; not migrated");
                continue;
            }

            var frequency = MapperHelpers.Trimmed(legacy.MeasurementFrequency);
            if (!ActionPlanContent.IsKnownFrequency(frequency))
            {
                report.Normalisation(MigrationRules.ActionPlanTemplateKpiFrequencyUnknown, Collection, legacyId, field,
                    $"measurement_frequency '{legacy.MeasurementFrequency}' is not one of "
                    + $"{string.Join(", ", ActionPlanValidation.ValidMeasurementFrequencies)}; the column is NOT NULL "
                    + "and every member asserts a cadence, so the KPI is not migrated rather than given one");
                continue;
            }

            kpis.Add(new ActionPlanTemplateKpi
            {
                // Positional: template KPIs carry no id, and the list is meaningful in order.
                Id = MigrationIds.ForChild(Collection, doc.Id, KpiScope, $"#{index}"),
                TemplateId = template.Id,
                Name = kpiName,
                TargetValue = target.Value,
                Unit = unit,
                MeasurementFrequency = frequency!,
            });
        }

        var objectives = new List<ActionPlanTemplateObjective>();
        for (var index = 0; index < (doc.QualitativeObjectiveTemplates?.Count ?? 0); index++)
        {
            var legacy = doc.QualitativeObjectiveTemplates![index];
            var field = $"qualitative_objective_templates[{index}]";
            MapperHelpers.ReportExtras(report, Collection, doc.Id, (field, legacy.Extra));

            var objectiveDescription = MapperHelpers.Trimmed(legacy.Description);
            var successCriteria = MapperHelpers.Trimmed(legacy.SuccessCriteria);
            if (objectiveDescription is null || successCriteria is null)
            {
                report.Normalisation(MigrationRules.ActionPlanTemplateObjectiveIncomplete, Collection, legacyId, field,
                    "template objective is missing its description or success criteria, both NOT NULL; "
                    + "an objective with no way to tell whether it was met is not one; not migrated");
                continue;
            }

            objectives.Add(new ActionPlanTemplateObjective
            {
                Id = MigrationIds.ForChild(Collection, doc.Id, ObjectiveScope, $"#{index}"),
                TemplateId = template.Id,
                Description = objectiveDescription,
                SuccessCriteria = successCriteria,
            });
        }

        return new MappedActionPlanTemplate(template, kpis, objectives);
    }
}

/// <summary>
/// The plans themselves, and the last legacy shape the migration had never read.
///
/// Three decisions worth naming.
///
/// <b>assigned_to has nowhere to go.</b> Legacy assigned a plan to a list of people; the
/// target records only <c>created_by</c> and has no join table. Rather than let the field
/// vanish with matching row counts, every plan that named assignees reports how many were
/// lost - the migration cannot fix a schema gap, but it can refuse to hide one.
///
/// <b>Children key off their own ids.</b> Unlike every other embedded shape in this
/// migration, legacy KPIs, objectives and progress updates carry <c>id</c> as a required
/// field, so their target ids derive from it and a progress update can still name the KPI
/// it moved. Only the two arrays nested inside a progress update key positionally.
///
/// <b>Language attribution (#195) does not apply here.</b> Every action-plan content
/// column - title, description, KPI name, objective description, notes - is a single
/// monolingual column on BOTH sides. There is no _en/_es pair to route into, so there is
/// nothing to attribute; adding a rule here would report a decision that was never made.
/// </summary>
public static class ActionPlanMapper
{
    public const string Collection = "actionplans";
    public const string KpiScope = "kpi";
    public const string ObjectiveScope = "objective";
    public const string ProgressScope = "progress";
    public const string KpiUpdateScope = "kpi-update";
    public const string ObjectiveUpdateScope = "objective-update";

    public static MappedActionPlan? Map(LegacyActionPlan doc, MappingContext context)
    {
        var report = context.Report;
        var legacyId = doc.Id.ToString();
        MapperHelpers.ReportExtras(report, Collection, doc.Id, ("", doc.Extra));

        var title = MapperHelpers.Truncated(doc.Title, 300, Collection, legacyId, "title", report);
        var description = MapperHelpers.Trimmed(doc.Description);
        if (title is null || description is null)
        {
            report.Skip(MigrationRules.MissingRequiredField, Collection, legacyId,
                "plan is missing its title or description, both NOT NULL", title is null ? "title" : "description");
            return null;
        }

        if (doc.DueDate is not { } dueDate)
        {
            // No default is safe: the dashboard counts a plan as overdue by comparing
            // due_date to now, so a fabricated date either invents a deadline or invents
            // a breach of one.
            report.Skip(MigrationRules.MissingRequiredField, Collection, legacyId,
                "plan has no due_date; the column is NOT NULL and the dashboard reads it to decide "
                + "whether the plan is overdue, so no substitute is honest",
                "due_date");
            return null;
        }

        var companyRef = ReferenceResolver.Classify(CompanyMapper.Collection, doc.CompanyId, context.Companies);
        if (companyRef.Kind != ReferenceKind.Resolved)
        {
            report.Skip(
                companyRef.Kind == ReferenceKind.Malformed
                    ? MigrationRules.MalformedReference
                    : MigrationRules.DanglingReference,
                Collection, legacyId, "company_id does not resolve; the column is a non-nullable FK", "company_id");
            return null;
        }

        var creatorRef = ReferenceResolver.Classify(UserMapper.Collection, doc.CreatedBy, context.Users);
        if (creatorRef.Kind != ReferenceKind.Resolved)
        {
            report.Skip(
                creatorRef.Kind == ReferenceKind.Malformed
                    ? MigrationRules.MalformedReference
                    : MigrationRules.DanglingReference,
                Collection, legacyId, "created_by does not resolve; the column is a non-nullable FK", "created_by");
            return null;
        }

        var status = MapperHelpers.Trimmed(doc.Status) ?? "not_started";
        if (!ActionPlanValidation.ValidStatuses.Contains(status, StringComparer.Ordinal))
        {
            // 'not_started' is the legacy schema's own default and, crucially, still
            // counts as OPEN work: DashboardQueries treats anything that is not
            // completed and not cancelled as outstanding. A status nobody can read must
            // not be the reason a plan quietly claims to be finished.
            report.Normalisation(MigrationRules.ActionPlanStatusUnknown, Collection, legacyId, "status",
                $"'{doc.Status}' is not one of {string.Join(", ", ActionPlanValidation.ValidStatuses)}; "
                + "recorded as 'not_started', which keeps the plan counted as outstanding work");
            status = "not_started";
        }

        var priority = MapperHelpers.Trimmed(doc.Priority) ?? "medium";
        if (!ActionPlanValidation.ValidPriorities.Contains(priority, StringComparer.Ordinal))
        {
            report.Normalisation(MigrationRules.ActionPlanPriorityUnknown, Collection, legacyId, "priority",
                $"'{doc.Priority}' is not one of {string.Join(", ", ActionPlanValidation.ValidPriorities)}; "
                + "recorded as 'medium', the legacy default and the value that asserts least");
            priority = "medium";
        }

        // The schema gap, reported rather than hidden.
        var assignees = ActionPlanContent.Strings(doc.AssignedTo);
        if (assignees.Length > 0)
        {
            report.Normalisation(MigrationRules.ActionPlanAssignmentsUnrepresentable, Collection, legacyId,
                "assigned_to",
                $"the plan is assigned to {assignees.Length} user(s); the target schema records only created_by "
                + "and has no assignment table, so the assignment is not migrated");
        }

        var plan = new ActionPlan
        {
            Id = MigrationIds.For(Collection, doc.Id),
            Title = title,
            Description = description,
            CompanyId = companyRef.TargetId!.Value,
            DepartmentId = NullableRef(
                DepartmentMapper.Collection, doc.DepartmentId, context.Departments,
                legacyId, "department_id", report),
            CreatedBy = creatorRef.TargetId!.Value,
            DueDate = new DateTimeOffset(DateTime.SpecifyKind(dueDate, DateTimeKind.Utc)),
            Status = status,
            Priority = priority,
            AiRecommendations = ActionPlanContent.Strings(doc.AiRecommendations),
            Tags = ActionPlanContent.Strings(doc.Tags),
            TemplateId = NullableRef(
                ActionPlanTemplateMapper.Collection, doc.TemplateId, context.ActionPlanTemplates,
                legacyId, "template_id", report),

            // Neither source column is a foreign key, but a Guid derived from a
            // reference that never resolved is unreachable garbage wearing a valid key,
            // so both are classified like every other reference and NULLed when they miss.
            SourceSurveyId = NullableRef(
                SurveyMapper.Collection, doc.SourceSurveyId, context.Surveys,
                legacyId, "source_survey_id", report),
            SourceInsightId = NullableRef(
                AiInsightMapper.Collection, doc.SourceInsightId, context.AiInsights,
                legacyId, "source_insight_id", report),
            CreatedAt = MapperHelpers.Timestamp(doc.CreatedAt, doc.Id, Collection, "created_at", report),
            UpdatedAt = MapperHelpers.Timestamp(doc.UpdatedAt, doc.Id, Collection, "updated_at", report),
        };

        var (kpis, kpiIds) = MapKpis(doc, plan.Id, context);
        var (objectives, objectiveIds) = MapObjectives(doc, plan.Id, context);
        var (updates, kpiUpdates, objectiveUpdates) = MapProgressUpdates(doc, plan, kpiIds, objectiveIds, context);

        return new MappedActionPlan(plan, kpis, objectives, updates, kpiUpdates, objectiveUpdates);
    }

    private static (List<ActionPlanKpi> Kpis, Dictionary<string, Guid> ByLegacyId) MapKpis(
        LegacyActionPlan doc, Guid planId, MappingContext context)
    {
        var report = context.Report;
        var legacyId = doc.Id.ToString();
        var kpis = new List<ActionPlanKpi>();
        var byLegacyId = new Dictionary<string, Guid>(StringComparer.Ordinal);
        var used = new HashSet<string>(StringComparer.Ordinal);

        for (var index = 0; index < (doc.Kpis?.Count ?? 0); index++)
        {
            var legacy = doc.Kpis![index];
            var field = $"kpis[{index}]";
            MapperHelpers.ReportExtras(report, Collection, doc.Id, (field, legacy.Extra));

            if (ChildKey(legacy.Id, index, "KPI", used, legacyId, field, report) is not { } key)
            {
                continue;
            }

            var name = MapperHelpers.Truncated(legacy.Name, 200, Collection, legacyId, $"{field}.name", report);
            var unit = MapperHelpers.Truncated(legacy.Unit, 50, Collection, legacyId, $"{field}.unit", report);
            var target = ActionPlanContent.Numeric(
                legacy.TargetValue, Collection, legacyId, $"{field}.target_value", report);
            if (name is null || unit is null || target is null)
            {
                report.Normalisation(MigrationRules.ActionPlanKpiIncomplete, Collection, legacyId, field,
                    "KPI is missing its name, unit or target value, all NOT NULL; not migrated");
                continue;
            }

            var frequency = MapperHelpers.Trimmed(legacy.MeasurementFrequency);
            if (!ActionPlanContent.IsKnownFrequency(frequency))
            {
                report.Normalisation(MigrationRules.ActionPlanKpiFrequencyUnknown, Collection, legacyId, field,
                    $"measurement_frequency '{legacy.MeasurementFrequency}' is not one of "
                    + $"{string.Join(", ", ActionPlanValidation.ValidMeasurementFrequencies)}; the column is NOT NULL "
                    + "and every member asserts a cadence, so the KPI is not migrated rather than given one");
                continue;
            }

            var id = MigrationIds.ForChild(Collection, doc.Id, KpiScope, key);
            kpis.Add(new ActionPlanKpi
            {
                Id = id,
                ActionPlanId = planId,
                Name = name,
                TargetValue = target.Value,

                // current_value defaults to 0 in the legacy schema; a KPI never updated
                // sits at zero there and must sit at zero here.
                CurrentValue = ActionPlanContent.Numeric(
                    legacy.CurrentValue, Collection, legacyId, $"{field}.current_value", report) ?? 0m,
                Unit = unit,
                MeasurementFrequency = frequency!,
            });

            byLegacyId[key] = id;
        }

        return (kpis, byLegacyId);
    }

    private static (List<ActionPlanObjective> Objectives, Dictionary<string, Guid> ByLegacyId) MapObjectives(
        LegacyActionPlan doc, Guid planId, MappingContext context)
    {
        var report = context.Report;
        var legacyId = doc.Id.ToString();
        var objectives = new List<ActionPlanObjective>();
        var byLegacyId = new Dictionary<string, Guid>(StringComparer.Ordinal);
        var used = new HashSet<string>(StringComparer.Ordinal);

        for (var index = 0; index < (doc.QualitativeObjectives?.Count ?? 0); index++)
        {
            var legacy = doc.QualitativeObjectives![index];
            var field = $"qualitative_objectives[{index}]";
            MapperHelpers.ReportExtras(report, Collection, doc.Id, (field, legacy.Extra));

            if (ChildKey(legacy.Id, index, "objective", used, legacyId, field, report) is not { } key)
            {
                continue;
            }

            var description = MapperHelpers.Trimmed(legacy.Description);
            var successCriteria = MapperHelpers.Trimmed(legacy.SuccessCriteria);
            if (description is null || successCriteria is null)
            {
                report.Normalisation(MigrationRules.ActionPlanObjectiveIncomplete, Collection, legacyId, field,
                    "objective is missing its description or success criteria, both NOT NULL; "
                    + "an objective with no way to tell whether it was met is not one; not migrated");
                continue;
            }

            var id = MigrationIds.ForChild(Collection, doc.Id, ObjectiveScope, key);
            objectives.Add(new ActionPlanObjective
            {
                Id = id,
                ActionPlanId = planId,
                Description = description,
                SuccessCriteria = successCriteria,
                CurrentStatus = MapperHelpers.Trimmed(legacy.CurrentStatus) ?? "",
                CompletionPercentage = ActionPlanContent.Completion(
                    legacy.CompletionPercentage, Collection, legacyId, $"{field}.completion_percentage", report) ?? 0,
            });

            byLegacyId[key] = id;
        }

        return (objectives, byLegacyId);
    }

    private static (List<ActionPlanProgressUpdate> Updates,
        List<ActionPlanKpiUpdate> KpiUpdates,
        List<ActionPlanObjectiveUpdate> ObjectiveUpdates) MapProgressUpdates(
            LegacyActionPlan doc,
            ActionPlan plan,
            IReadOnlyDictionary<string, Guid> kpiIds,
            IReadOnlyDictionary<string, Guid> objectiveIds,
            MappingContext context)
    {
        var report = context.Report;
        var legacyId = doc.Id.ToString();
        var updates = new List<ActionPlanProgressUpdate>();
        var kpiUpdates = new List<ActionPlanKpiUpdate>();
        var objectiveUpdates = new List<ActionPlanObjectiveUpdate>();
        var used = new HashSet<string>(StringComparer.Ordinal);

        for (var index = 0; index < (doc.ProgressUpdates?.Count ?? 0); index++)
        {
            var legacy = doc.ProgressUpdates![index];
            var field = $"progress_updates[{index}]";
            MapperHelpers.ReportExtras(report, Collection, doc.Id, (field, legacy.Extra));

            if (ChildKey(legacy.Id, index, "progress update", used, legacyId, field, report) is not { } key)
            {
                continue;
            }

            var actorRef = ReferenceResolver.Classify(UserMapper.Collection, legacy.UpdatedBy, context.Users);
            if (actorRef.Kind != ReferenceKind.Resolved)
            {
                report.Normalisation(MigrationRules.ActionPlanProgressActorUnresolved, Collection, legacyId,
                    $"{field}.updated_by",
                    $"updated_by '{legacy.UpdatedBy}' is {actorRef.Kind}; the column is a non-nullable FK to the "
                    + "user who reported the progress, and an update nobody made is not a record; not migrated");
                continue;
            }

            DateTimeOffset updateDate;
            if (legacy.UpdateDate is { } present)
            {
                updateDate = new DateTimeOffset(DateTime.SpecifyKind(present, DateTimeKind.Utc));
            }
            else
            {
                // Never the wall clock: an undated update takes its own plan's creation
                // time, which is the earliest moment the update could have existed.
                updateDate = plan.CreatedAt;
                report.Normalisation(MigrationRules.ActionPlanProgressDateDerived, Collection, legacyId,
                    $"{field}.update_date",
                    "progress update carries no date; using the plan's created_at, the earliest moment "
                    + "the update could have existed");
            }

            var update = new ActionPlanProgressUpdate
            {
                Id = MigrationIds.ForChild(Collection, doc.Id, ProgressScope, key),
                ActionPlanId = plan.Id,
                UpdateDate = updateDate,
                OverallNotes = MapperHelpers.Trimmed(legacy.OverallNotes) ?? "",
                UpdatedBy = actorRef.TargetId!.Value,
            };
            updates.Add(update);

            for (var item = 0; item < (legacy.KpiUpdates?.Count ?? 0); item++)
            {
                var legacyItem = legacy.KpiUpdates![item];
                var itemField = $"{field}.kpi_updates[{item}]";
                MapperHelpers.ReportExtras(report, Collection, doc.Id, (itemField, legacyItem.Extra));

                var kpiKey = MapperHelpers.Trimmed(legacyItem.KpiId);
                var newValue = ActionPlanContent.Numeric(
                    legacyItem.NewValue, Collection, legacyId, $"{itemField}.new_value", report);
                if (kpiKey is null || newValue is null)
                {
                    report.Normalisation(MigrationRules.ActionPlanProgressItemIncomplete, Collection, legacyId,
                        itemField,
                        "KPI update is missing the KPI it moved or the value it moved to, both NOT NULL; "
                        + "not migrated");
                    continue;
                }

                if (!kpiIds.TryGetValue(kpiKey, out var kpiId))
                {
                    // kpi_id is a Cascade FK: a row pointing at a KPI this plan does not
                    // have would fail the insert, and one pointing at a KPI that was
                    // itself dropped would be a number attached to nothing.
                    report.Normalisation(MigrationRules.ActionPlanProgressItemUnresolved, Collection, legacyId,
                        itemField,
                        $"kpi_id '{kpiKey}' names no KPI migrated for this plan; the column is a foreign key, "
                        + "so the update is not migrated");
                    continue;
                }

                kpiUpdates.Add(new ActionPlanKpiUpdate
                {
                    // Positional within its progress update: these are the one shape in
                    // this collection that carries no id of its own.
                    Id = MigrationIds.ForChild(Collection, doc.Id, KpiUpdateScope, $"{key}#{item}"),
                    ProgressUpdateId = update.Id,
                    KpiId = kpiId,
                    NewValue = newValue.Value,
                    Notes = MapperHelpers.Trimmed(legacyItem.Notes),
                });
            }

            for (var item = 0; item < (legacy.QualitativeUpdates?.Count ?? 0); item++)
            {
                var legacyItem = legacy.QualitativeUpdates![item];
                var itemField = $"{field}.qualitative_updates[{item}]";
                MapperHelpers.ReportExtras(report, Collection, doc.Id, (itemField, legacyItem.Extra));

                var objectiveKey = MapperHelpers.Trimmed(legacyItem.ObjectiveId);
                var statusUpdate = MapperHelpers.Trimmed(legacyItem.StatusUpdate);
                if (objectiveKey is null || statusUpdate is null)
                {
                    report.Normalisation(MigrationRules.ActionPlanProgressItemIncomplete, Collection, legacyId,
                        itemField,
                        "objective update is missing the objective it moved or its status text, both NOT NULL; "
                        + "not migrated");
                    continue;
                }

                if (!objectiveIds.TryGetValue(objectiveKey, out var objectiveId))
                {
                    report.Normalisation(MigrationRules.ActionPlanProgressItemUnresolved, Collection, legacyId,
                        itemField,
                        $"objective_id '{objectiveKey}' names no objective migrated for this plan; the column is "
                        + "a foreign key, so the update is not migrated");
                    continue;
                }

                objectiveUpdates.Add(new ActionPlanObjectiveUpdate
                {
                    Id = MigrationIds.ForChild(Collection, doc.Id, ObjectiveUpdateScope, $"{key}#{item}"),
                    ProgressUpdateId = update.Id,
                    ObjectiveId = objectiveId,
                    StatusUpdate = statusUpdate,
                    CompletionPercentage = ActionPlanContent.Completion(
                        legacyItem.CompletionPercentage, Collection, legacyId,
                        $"{itemField}.completion_percentage", report),
                    Notes = MapperHelpers.Trimmed(legacyItem.Notes),
                });
            }
        }

        return (updates, kpiUpdates, objectiveUpdates);
    }

    /// <summary>
    /// The child key, which is the legacy child's own id where it has one. These arrays
    /// are the only embedded shapes in the migration whose ids are declared required, so
    /// a missing one is a finding, not the norm - and a duplicate is load-bearing,
    /// because two children sharing an id derive one row and the second would silently
    /// overwrite the first.
    /// </summary>
    private static string? ChildKey(
        string? legacyChildId, int index, string what, HashSet<string> used,
        string legacyId, string field, DataQualityReport report)
    {
        var key = MapperHelpers.Trimmed(legacyChildId);
        if (key is null)
        {
            key = $"#{index}";
            report.Normalisation(MigrationRules.ActionPlanChildIdFromPosition, Collection, legacyId, field,
                $"{what} carries no id though the legacy schema requires one; keyed by position as '{key}', "
                + "which no progress update can reference");
        }

        if (used.Add(key))
        {
            return key;
        }

        report.Normalisation(MigrationRules.ActionPlanChildDuplicateId, Collection, legacyId, field,
            $"{what} id '{key}' is already used in this plan; two children sharing an id derive one row, "
            + "so the second is not migrated");
        return null;
    }

    private static Guid? NullableRef(
        string referencedCollection, string? reference, IReadOnlySet<Guid> targets,
        string legacyId, string field, DataQualityReport report)
    {
        var classification = ReferenceResolver.Classify(referencedCollection, reference, targets);
        switch (classification.Kind)
        {
            case ReferenceKind.Resolved:
                return classification.TargetId;
            case ReferenceKind.Absent:
                return null;
            default:
                report.Degraded(
                    classification.Kind == ReferenceKind.Malformed
                        ? MigrationRules.MalformedReference
                        : MigrationRules.DanglingReference,
                    Collection, legacyId, field, $"'{reference}' is {classification.Kind}; loaded as NULL");
                return null;
        }
    }
}
