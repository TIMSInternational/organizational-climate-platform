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

    private static async Task<ActionPlanDetail> ToDetailAsync(ActionPlan plan, ClimateProjectDbContext db, CancellationToken cancellationToken)
    {
        var kpis = await db.ActionPlanKpis.Where(k => k.ActionPlanId == plan.Id)
            .Select(k => new KpiDto(k.Id, k.Name, k.TargetValue, k.CurrentValue, k.Unit, k.MeasurementFrequency))
            .ToListAsync(cancellationToken);
        var objectives = await db.ActionPlanObjectives.Where(o => o.ActionPlanId == plan.Id)
            .Select(o => new ObjectiveDto(o.Id, o.Description, o.SuccessCriteria, o.CurrentStatus, o.CompletionPercentage))
            .ToListAsync(cancellationToken);

        return new ActionPlanDetail(plan.Id, plan.Title, plan.Description, plan.CompanyId, plan.DepartmentId, plan.CreatedBy,
            plan.DueDate, plan.Status, plan.Priority, plan.Tags, plan.TemplateId, kpis, objectives);
    }

    private static async Task<IResult> ListAsync(
        Guid companyId,
        Guid? departmentId,
        string? status,
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

        var plans = await query
            .OrderBy(p => p.DueDate)
            .Select(p => new ActionPlanListItem(p.Id, p.Title, p.CompanyId, p.DepartmentId, p.DueDate, p.Status, p.Priority, p.CreatedAt))
            .ToListAsync(cancellationToken);

        return Results.Ok(new ActionPlanListResponse(plans));
    }

    private static async Task<IResult> CreateAsync(
        CreateActionPlanRequest request,
        ClaimsPrincipal principal,
        ClimateProjectDbContext db,
        CancellationToken cancellationToken)
    {
        var currentUser = principal.GetCurrentUser();
        if (!Roles.Admin.Contains(currentUser.Role) || !CanAccessCompany(currentUser, request.CompanyId))
        {
            return Results.Forbid();
        }

        if (string.IsNullOrWhiteSpace(request.Title) || string.IsNullOrWhiteSpace(request.Description))
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

        var actingUser = await db.Users.FirstOrDefaultAsync(u => u.Email == currentUser.Email, cancellationToken);
        var now = DateTimeOffset.UtcNow;
        var plan = new ActionPlan
        {
            Id = Guid.NewGuid(),
            Title = request.Title.Trim(),
            Description = request.Description.Trim(),
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

        foreach (var kpiInput in request.Kpis ?? [])
        {
            db.ActionPlanKpis.Add(new ActionPlanKpi
            {
                Id = Guid.NewGuid(),
                ActionPlanId = plan.Id,
                Name = kpiInput.Name,
                TargetValue = kpiInput.TargetValue,
                CurrentValue = 0,
                Unit = kpiInput.Unit,
                MeasurementFrequency = kpiInput.MeasurementFrequency,
            });
        }

        foreach (var objectiveInput in request.Objectives ?? [])
        {
            db.ActionPlanObjectives.Add(new ActionPlanObjective
            {
                Id = Guid.NewGuid(),
                ActionPlanId = plan.Id,
                Description = objectiveInput.Description,
                SuccessCriteria = objectiveInput.SuccessCriteria,
                CurrentStatus = "not_started",
                CompletionPercentage = 0,
            });
        }

        await db.SaveChangesAsync(cancellationToken);

        return Results.Json(await ToDetailAsync(plan, db, cancellationToken), statusCode: 201);
    }

    private static async Task<IResult> GetAsync(
        Guid id,
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

        return Results.Ok(await ToDetailAsync(plan, db, cancellationToken));
    }

    private static async Task<IResult> UpdateAsync(
        Guid id,
        UpdateActionPlanRequest request,
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

        if (!string.IsNullOrWhiteSpace(request.Title)) plan.Title = request.Title.Trim();
        if (!string.IsNullOrWhiteSpace(request.Description)) plan.Description = request.Description.Trim();
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

        return Results.Ok(await ToDetailAsync(plan, db, cancellationToken));
    }

    private static async Task<IResult> RecordProgressAsync(
        Guid id,
        RecordProgressRequest request,
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
