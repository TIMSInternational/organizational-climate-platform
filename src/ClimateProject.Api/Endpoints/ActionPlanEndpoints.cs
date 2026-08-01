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
    }

    private static bool CanAccessCompany(CurrentUser currentUser, Guid companyId)
        => currentUser.Role == Roles.SuperAdmin
           || currentUser.CompanyId == companyId.ToString();

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

        if (!CanAccessCompany(currentUser, plan.CompanyId))
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
}
