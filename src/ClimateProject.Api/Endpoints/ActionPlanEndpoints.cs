using ClimateProject.Application.Localization;
using System.Security.Claims;
using ClimateProject.Application.ActionPlans;
using ClimateProject.Application.Auth;
using ClimateProject.Domain.Entities;
using ClimateProject.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace ClimateProject.Api.Endpoints;

public static class ActionPlanEndpoints
{
    public static void MapActionPlanEndpoints(this WebApplication app)
    {
        var group = app.MapGroup("/action-plans").RequireAuthorization();

        group.MapGet("", ListAsync);
        group.MapPost("", CreateAsync);
        group.MapGet("/{id:guid}", GetAsync);
        group.MapPut("/{id:guid}", UpdateAsync);
        group.MapPost("/{id:guid}/progress", RecordProgressAsync);
    }

    private static bool CanAccessCompany(CurrentUser currentUser, Guid companyId)
        => currentUser.Role == Roles.SuperAdmin
           || (currentUser.Role == Roles.CompanyAdmin && currentUser.CompanyId == companyId.ToString());

    private static async Task<ActionPlanDetail> ToDetailAsync(ActionPlan plan, ClimateProjectDbContext db, string? lang, CancellationToken cancellationToken)
    {
        // #210: every authored field arrives resolved for the reader, never en/es-shaped,
        // and FallbackFields names the ones that had to reach for the other language. The
        // content language is inferred from each pair, so a plan written in Spanish reads
        // in Spanish from an English session rather than as a blank.
        var locale = ContentLanguages.NormaliseLocale(lang) ?? ContentLanguages.FallbackLocale;
        var fallbackFields = new List<string>();
        var title = AuthoredContent.Resolve(plan.TitleEn, plan.TitleEs, locale, "title", fallbackFields) ?? string.Empty;
        var description = AuthoredContent.Resolve(plan.DescriptionEn, plan.DescriptionEs, locale, "description", fallbackFields) ?? string.Empty;

        var kpiRows = await db.ActionPlanKpis.Where(k => k.ActionPlanId == plan.Id).ToListAsync(cancellationToken);
        var kpis = kpiRows.Select((k, i) => new KpiDto(
                k.Id,
                AuthoredContent.Resolve(k.NameEn, k.NameEs, locale, $"kpis[{i}].name", fallbackFields) ?? string.Empty,
                k.TargetValue,
                k.CurrentValue,
                AuthoredContent.Resolve(k.UnitEn, k.UnitEs, locale, $"kpis[{i}].unit", fallbackFields) ?? string.Empty,
                k.MeasurementFrequency))
            .ToList();

        var objectiveRows = await db.ActionPlanObjectives.Where(o => o.ActionPlanId == plan.Id).ToListAsync(cancellationToken);
        var objectives = objectiveRows.Select((o, i) => new ObjectiveDto(
                o.Id,
                AuthoredContent.Resolve(o.DescriptionEn, o.DescriptionEs, locale, $"objectives[{i}].description", fallbackFields) ?? string.Empty,
                AuthoredContent.Resolve(o.SuccessCriteriaEn, o.SuccessCriteriaEs, locale, $"objectives[{i}].successCriteria", fallbackFields) ?? string.Empty,
                o.CurrentStatus,
                o.CompletionPercentage))
            .ToList();

        return new ActionPlanDetail(plan.Id, title, description, plan.CompanyId, plan.DepartmentId, plan.CreatedBy,
            plan.DueDate, plan.Status, plan.Priority, plan.Tags, plan.TemplateId, kpis, objectives, fallbackFields);
    }

    private static async Task<IResult> ListAsync(
        Guid companyId,
        Guid? departmentId,
        string? status,
        string? lang,
        ClaimsPrincipal principal,
        ClimateProjectDbContext db,
        CancellationToken cancellationToken)
    {
        var currentUser = principal.GetCurrentUser();
        if (!CanAccessCompany(currentUser, companyId))
        {
            return Results.Forbid();
        }

        var query = db.ActionPlans.Where(p => p.CompanyId == companyId);
        if (departmentId.HasValue) query = query.Where(p => p.DepartmentId == departmentId.Value);
        if (!string.IsNullOrWhiteSpace(status)) query = query.Where(p => p.Status == status);

        var locale = ContentLanguages.NormaliseLocale(lang) ?? ContentLanguages.FallbackLocale;
        var plans = (await query
                .OrderBy(p => p.DueDate)
                .Select(p => new { p.Id, p.TitleEn, p.TitleEs, p.CompanyId, p.DepartmentId, p.DueDate, p.Status, p.Priority, p.CreatedAt })
                .ToListAsync(cancellationToken))
            .Select(p => new ActionPlanListItem(
                p.Id,
                AuthoredContent.ResolveRequired(p.TitleEn, p.TitleEs, locale),
                p.CompanyId, p.DepartmentId, p.DueDate, p.Status, p.Priority, p.CreatedAt))
            .ToList();

        return Results.Ok(new ActionPlanListResponse(plans));
    }

    private static async Task<IResult> CreateAsync(
        CreateActionPlanRequest request,
        string? lang,
        ClaimsPrincipal principal,
        ClimateProjectDbContext db,
        CancellationToken cancellationToken)
    {
        var currentUser = principal.GetCurrentUser();
        if (!Roles.Admin.Contains(currentUser.Role) || !CanAccessCompany(currentUser, request.CompanyId))
        {
            return Results.Forbid();
        }

        if (request.Title is null || request.Description is null)
        {
            return Results.Json(new { message = "Title and description are required" }, statusCode: 400);
        }

        if (!ActionPlanValidation.ValidPriorities.Contains(request.Priority))
        {
            return Results.Json(new { message = $"Invalid priority: {request.Priority}" }, statusCode: 400);
        }

        foreach (var kpi in request.Kpis ?? [])
        {
            if (!ActionPlanValidation.ValidMeasurementFrequencies.Contains(kpi.MeasurementFrequency))
            {
                return Results.Json(new { message = $"Invalid measurement frequency: {kpi.MeasurementFrequency}" }, statusCode: 400);
            }
        }

        // TemplateId has a real FK to action_plan_templates (see ActionPlanConfiguration).
        // An unknown id would otherwise surface as an opaque 500 from the DbUpdateException
        // handler in Program.cs, and an unscoped id would let a CompanyAdmin reference
        // another tenant's template. Scope the lookup the same way the templates List
        // endpoint scopes visibility: the caller's own company, or a system-wide template.
        ActionPlanTemplate? template = null;
        if (request.TemplateId.HasValue)
        {
            template = await db.ActionPlanTemplates.FirstOrDefaultAsync(
                t => t.Id == request.TemplateId.Value
                     && (t.CompanyId == request.CompanyId || t.CompanyId == null)
                     && t.IsActive,
                cancellationToken);
            if (template is null)
            {
                return Results.Json(new { message = $"Template {request.TemplateId} not found" }, statusCode: 400);
            }
        }

        if (request.SourceSurveyId.HasValue)
        {
            // #168 added an FK on action_plans.source_survey_id. An FK turns an unknown id into a
            // DbUpdateException at SaveChanges, which surfaces as an opaque 500 -- where the same
            // request used to return 201. A 500 is not the message this refusal should send, and
            // "the status code is the message" has bitten this repo three times now.
            //
            // Existence alone is not enough either: an FK checks that the row exists, not whose it
            // is. Without the tenancy half a CompanyAdmin could file a plan against another
            // tenant's survey id and read it back out of the detail payload -- the identical hole
            // #87 closed on demographic snapshots and #207's follow-up closed on analytics
            // insights. This is deliberately the same shape as AIInsightEndpoints.cs:107-126.
            var sourceCompanyId = await db.Surveys
                .Where(s => s.Id == request.SourceSurveyId.Value)
                .Select(s => (Guid?)s.CompanyId)
                .FirstOrDefaultAsync(cancellationToken);

            if (sourceCompanyId is null)
            {
                return Results.Json(new { message = "SourceSurveyId does not reference an existing survey" }, statusCode: 400);
            }

            if (sourceCompanyId.Value != request.CompanyId)
            {
                return Results.Json(new { message = "SourceSurveyId belongs to a different company" }, statusCode: 400);
            }
        }

        // #210: every authored field on the plan lands in the company's language unless
        // the caller sends { "en": ..., "es": ... }. A bare string is never refused here.
        var attribution = await AuthoredWrites.AttributionLocaleAsync(db, currentUser, request.CompanyId, null, cancellationToken);
        var title = AuthoredWrites.Apply(request.Title, attribution, "title", "Title and description are required", required: true, null, null);
        if (title.Error is not null) return title.Error;
        var description = AuthoredWrites.Apply(request.Description, attribution, "description", "Title and description are required", required: true, null, null);
        if (description.Error is not null) return description.Error;

        var actingUser = await db.Users.FirstOrDefaultAsync(u => u.Email == currentUser.Email, cancellationToken);
        var now = DateTimeOffset.UtcNow;
        var plan = new ActionPlan
        {
            Id = Guid.NewGuid(),
            TitleEn = title.En,
            TitleEs = title.Es,
            DescriptionEn = description.En,
            DescriptionEs = description.Es,
            CompanyId = request.CompanyId,
            DepartmentId = request.DepartmentId,
            CreatedBy = actingUser?.Id ?? Guid.Empty,
            DueDate = request.DueDate,
            Status = "not_started",
            Priority = request.Priority,
            Tags = request.Tags ?? [],
            TemplateId = request.TemplateId,
            SourceSurveyId = request.SourceSurveyId,
            SourceInsightId = request.SourceInsightId,
            CreatedAt = now,
            UpdatedAt = now,
        };
        db.ActionPlans.Add(plan);

        if (template is not null)
        {
            template.UsageCount += 1;
            template.UpdatedAt = now;
        }

        var kpiIndex = 0;
        foreach (var kpiInput in request.Kpis ?? [])
        {
            // A KPI with no name used to reach Postgres as a NULL in a NOT NULL column and
            // surface as a 500; the 400 names the row instead.
            var kpiName = AuthoredWrites.Apply(kpiInput.Name, attribution, $"kpis[{kpiIndex}].name", $"kpis[{kpiIndex}] requires a name", required: true, null, null);
            if (kpiName.Error is not null) return kpiName.Error;
            var kpiUnit = AuthoredWrites.Apply(kpiInput.Unit, attribution, $"kpis[{kpiIndex}].unit", $"kpis[{kpiIndex}] requires a unit", required: true, null, null);
            if (kpiUnit.Error is not null) return kpiUnit.Error;
            kpiIndex++;

            db.ActionPlanKpis.Add(new ActionPlanKpi
            {
                Id = Guid.NewGuid(),
                ActionPlanId = plan.Id,
                NameEn = kpiName.En,
                NameEs = kpiName.Es,
                TargetValue = kpiInput.TargetValue,
                CurrentValue = 0,
                UnitEn = kpiUnit.En,
                UnitEs = kpiUnit.Es,
                MeasurementFrequency = kpiInput.MeasurementFrequency,
            });
        }

        var objectiveIndex = 0;
        foreach (var objectiveInput in request.Objectives ?? [])
        {
            var objectiveDescription = AuthoredWrites.Apply(objectiveInput.Description, attribution, $"objectives[{objectiveIndex}].description", $"objectives[{objectiveIndex}] requires a description", required: true, null, null);
            if (objectiveDescription.Error is not null) return objectiveDescription.Error;
            var successCriteria = AuthoredWrites.Apply(objectiveInput.SuccessCriteria, attribution, $"objectives[{objectiveIndex}].successCriteria", $"objectives[{objectiveIndex}] requires success criteria", required: true, null, null);
            if (successCriteria.Error is not null) return successCriteria.Error;
            objectiveIndex++;

            db.ActionPlanObjectives.Add(new ActionPlanObjective
            {
                Id = Guid.NewGuid(),
                ActionPlanId = plan.Id,
                DescriptionEn = objectiveDescription.En,
                DescriptionEs = objectiveDescription.Es,
                SuccessCriteriaEn = successCriteria.En,
                SuccessCriteriaEs = successCriteria.Es,
                CurrentStatus = "not_started",
                CompletionPercentage = 0,
            });
        }

        await db.SaveChangesAsync(cancellationToken);

        return Results.Json(await ToDetailAsync(plan, db, lang, cancellationToken), statusCode: 201);
    }

    private static async Task<IResult> GetAsync(
        Guid id,
        string? lang,
        ClaimsPrincipal principal,
        ClimateProjectDbContext db,
        CancellationToken cancellationToken)
    {
        var currentUser = principal.GetCurrentUser();
        var plan = await db.ActionPlans.FirstOrDefaultAsync(p => p.Id == id, cancellationToken);
        if (plan is null)
        {
            return Results.Json(new { message = "Action plan not found" }, statusCode: 404);
        }

        if (!CanAccessCompany(currentUser, plan.CompanyId))
        {
            return Results.Forbid();
        }

        return Results.Ok(await ToDetailAsync(plan, db, lang, cancellationToken));
    }

    private static async Task<IResult> UpdateAsync(
        Guid id,
        UpdateActionPlanRequest request,
        string? lang,
        ClaimsPrincipal principal,
        ClimateProjectDbContext db,
        CancellationToken cancellationToken)
    {
        var currentUser = principal.GetCurrentUser();
        var plan = await db.ActionPlans.FirstOrDefaultAsync(p => p.Id == id, cancellationToken);
        if (plan is null)
        {
            return Results.Json(new { message = "Action plan not found" }, statusCode: 404);
        }

        if (!Roles.Admin.Contains(currentUser.Role) || !CanAccessCompany(currentUser, plan.CompanyId))
        {
            return Results.Forbid();
        }

        // #210: a blank bare string is still ignored, as it always was here; anything else
        // is applied over the pair, in the language the plan is already written in.
        if (request.Title is not null || request.Description is not null)
        {
            var attribution = await AuthoredWrites.AttributionLocaleAsync(
                db, currentUser, plan.CompanyId, AuthoredContent.LanguageOf(plan.TitleEn, plan.TitleEs), cancellationToken);

            if (!AuthoredWrites.IsBlankBare(request.Title))
            {
                var title = AuthoredWrites.Apply(request.Title, attribution, "title", "Title is required", required: true, plan.TitleEn, plan.TitleEs);
                if (title.Error is not null) return title.Error;
                plan.TitleEn = title.En;
                plan.TitleEs = title.Es;
            }

            if (!AuthoredWrites.IsBlankBare(request.Description))
            {
                var description = AuthoredWrites.Apply(request.Description, attribution, "description", "Description is required", required: true, plan.DescriptionEn, plan.DescriptionEs);
                if (description.Error is not null) return description.Error;
                plan.DescriptionEn = description.En;
                plan.DescriptionEs = description.Es;
            }
        }
        if (request.DueDate.HasValue) plan.DueDate = request.DueDate.Value;

        if (!string.IsNullOrWhiteSpace(request.Status))
        {
            if (!ActionPlanValidation.ValidStatuses.Contains(request.Status))
            {
                return Results.Json(new { message = $"Invalid status: {request.Status}" }, statusCode: 400);
            }

            plan.Status = request.Status;
        }

        if (!string.IsNullOrWhiteSpace(request.Priority))
        {
            if (!ActionPlanValidation.ValidPriorities.Contains(request.Priority))
            {
                return Results.Json(new { message = $"Invalid priority: {request.Priority}" }, statusCode: 400);
            }

            plan.Priority = request.Priority;
        }

        if (request.Tags is not null) plan.Tags = request.Tags;

        plan.UpdatedAt = DateTimeOffset.UtcNow;
        await db.SaveChangesAsync(cancellationToken);

        return Results.Ok(await ToDetailAsync(plan, db, lang, cancellationToken));
    }

    private static async Task<IResult> RecordProgressAsync(
        Guid id,
        RecordProgressRequest request,
        string? lang,
        ClaimsPrincipal principal,
        ClimateProjectDbContext db,
        CancellationToken cancellationToken)
    {
        var currentUser = principal.GetCurrentUser();
        var plan = await db.ActionPlans.FirstOrDefaultAsync(p => p.Id == id, cancellationToken);
        if (plan is null)
        {
            return Results.Json(new { message = "Action plan not found" }, statusCode: 404);
        }

        if (!Roles.Admin.Contains(currentUser.Role) || !CanAccessCompany(currentUser, plan.CompanyId))
        {
            return Results.Forbid();
        }

        if (string.IsNullOrWhiteSpace(request.OverallNotes))
        {
            return Results.Json(new { message = "Overall notes are required" }, statusCode: 400);
        }

        var kpis = await db.ActionPlanKpis.Where(k => k.ActionPlanId == id).ToListAsync(cancellationToken);
        var objectives = await db.ActionPlanObjectives.Where(o => o.ActionPlanId == id).ToListAsync(cancellationToken);

        foreach (var kpiUpdate in request.KpiUpdates ?? [])
        {
            if (kpis.All(k => k.Id != kpiUpdate.KpiId))
            {
                return Results.Json(new { message = $"KPI {kpiUpdate.KpiId} does not belong to this action plan" }, statusCode: 400);
            }
        }

        foreach (var objectiveUpdate in request.ObjectiveUpdates ?? [])
        {
            if (objectives.All(o => o.Id != objectiveUpdate.ObjectiveId))
            {
                return Results.Json(new { message = $"Objective {objectiveUpdate.ObjectiveId} does not belong to this action plan" }, statusCode: 400);
            }
        }

        var actingUser = await db.Users.FirstOrDefaultAsync(u => u.Email == currentUser.Email, cancellationToken);
        var now = DateTimeOffset.UtcNow;
        var progressUpdate = new ActionPlanProgressUpdate
        {
            Id = Guid.NewGuid(),
            ActionPlanId = id,
            UpdateDate = now,
            OverallNotes = request.OverallNotes,
            UpdatedBy = actingUser?.Id ?? Guid.Empty,
        };
        db.ActionPlanProgressUpdates.Add(progressUpdate);

        foreach (var kpiUpdate in request.KpiUpdates ?? [])
        {
            var kpi = kpis.First(k => k.Id == kpiUpdate.KpiId);
            kpi.CurrentValue = kpiUpdate.NewValue;
            db.ActionPlanKpiUpdates.Add(new ActionPlanKpiUpdate
            {
                Id = Guid.NewGuid(),
                ProgressUpdateId = progressUpdate.Id,
                KpiId = kpiUpdate.KpiId,
                NewValue = kpiUpdate.NewValue,
                Notes = kpiUpdate.Notes,
            });
        }

        foreach (var objectiveUpdate in request.ObjectiveUpdates ?? [])
        {
            var objective = objectives.First(o => o.Id == objectiveUpdate.ObjectiveId);
            objective.CurrentStatus = objectiveUpdate.StatusUpdate;
            if (objectiveUpdate.CompletionPercentage.HasValue)
            {
                objective.CompletionPercentage = objectiveUpdate.CompletionPercentage.Value;
            }

            db.ActionPlanObjectiveUpdates.Add(new ActionPlanObjectiveUpdate
            {
                Id = Guid.NewGuid(),
                ProgressUpdateId = progressUpdate.Id,
                ObjectiveId = objectiveUpdate.ObjectiveId,
                StatusUpdate = objectiveUpdate.StatusUpdate,
                CompletionPercentage = objectiveUpdate.CompletionPercentage,
                Notes = objectiveUpdate.Notes,
            });
        }

        plan.UpdatedAt = now;
        await db.SaveChangesAsync(cancellationToken);

        return Results.Json(new ProgressUpdateDetail(progressUpdate.Id, progressUpdate.UpdateDate, progressUpdate.OverallNotes, progressUpdate.UpdatedBy), statusCode: 201);
    }
}
