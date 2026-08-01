using System.Security.Claims;
using ClimateProject.Application.Auth;
using ClimateProject.Application.Microclimates;
using ClimateProject.Domain.Entities;
using ClimateProject.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace ClimateProject.Api.Endpoints;

public static class MicroclimateEndpoints
{
    public static void MapMicroclimateEndpoints(this WebApplication app)
    {
        var group = app.MapGroup("/microclimates").RequireAuthorization();

        group.MapGet("", ListAsync);
        group.MapPost("", CreateAsync);
        group.MapGet("/{id:guid}", GetAsync);
        group.MapPut("/{id:guid}", UpdateAsync);
        group.MapGet("/{id:guid}/live-results", GetLiveResultsAsync);

        app.MapPost("/microclimates/{id:guid}/responses", SubmitResponseAsync);
    }

    internal static bool CanAccessCompany(CurrentUser currentUser, Guid companyId)
        => currentUser.Role == Roles.SuperAdmin
           || currentUser.CompanyId == companyId.ToString();

    internal static async Task<MicroclimateDetail> ToDetailAsync(Microclimate m, ClimateProjectDbContext db, CancellationToken cancellationToken)
    {
        var questions = await db.MicroclimateQuestions.Where(q => q.MicroclimateId == m.Id)
            .OrderBy(q => q.Order)
            .Select(q => new QuestionDto(q.Id, q.Text, q.Type, q.Options, q.Required, q.Order))
            .ToListAsync(cancellationToken);

        return new MicroclimateDetail(m.Id, m.Title, m.Description, m.CompanyId, m.CreatedBy, m.Status,
            m.ResponseCount, m.TargetParticipantCount, m.Scheduling.StartTime, m.Scheduling.EndTime,
            m.RealtimeSettings.AnonymousResponses, m.RealtimeSettings.ShowLiveResults, questions);
    }

    private static async Task<IResult> ListAsync(
        Guid companyId,
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

        var query = db.Microclimates.Where(m => m.CompanyId == companyId);
        if (!string.IsNullOrWhiteSpace(status)) query = query.Where(m => m.Status == status);

        var microclimates = await query
            .OrderByDescending(m => m.CreatedAt)
            .Select(m => new MicroclimateListItem(m.Id, m.Title, m.CompanyId, m.Status, m.ResponseCount, m.TargetParticipantCount, m.CreatedAt))
            .ToListAsync(cancellationToken);

        return Results.Ok(new MicroclimateListResponse(microclimates));
    }

    private static async Task<IResult> CreateAsync(
        CreateMicroclimateRequest request,
        ClaimsPrincipal principal,
        ClimateProjectDbContext db,
        CancellationToken cancellationToken)
    {
        var currentUser = principal.GetCurrentUser();
        if (!Roles.Admin.Contains(currentUser.Role) || !CanAccessCompany(currentUser, request.CompanyId))
        {
            return Results.Forbid();
        }

        if (string.IsNullOrWhiteSpace(request.Title))
        {
            return Results.Json(new { message = "Title is required" }, statusCode: 400);
        }

        foreach (var question in request.Questions ?? [])
        {
            if (!MicroclimateValidation.ValidQuestionTypes.Contains(question.Type))
            {
                return Results.Json(new { message = $"Invalid question type: {question.Type}" }, statusCode: 400);
            }
        }

        var actingUser = await db.Users.FirstOrDefaultAsync(u => u.Email == currentUser.Email, cancellationToken);
        var now = DateTimeOffset.UtcNow;
        var microclimate = new Microclimate
        {
            Id = Guid.NewGuid(),
            Title = request.Title.Trim(),
            Description = request.Description,
            CompanyId = request.CompanyId,
            CreatedBy = actingUser?.Id ?? Guid.Empty,
            TemplateId = request.TemplateId,
            Status = "draft",
            TargetParticipantCount = request.TargetParticipantCount,
            CreatedAt = now,
            UpdatedAt = now,
        };
        microclimate.Scheduling.StartTime = request.StartTime;
        microclimate.Scheduling.EndTime = request.EndTime;
        microclimate.RealtimeSettings.AnonymousResponses = request.AnonymousResponses;

        db.Microclimates.Add(microclimate);

        foreach (var questionInput in request.Questions ?? [])
        {
            db.MicroclimateQuestions.Add(new MicroclimateQuestion
            {
                Id = Guid.NewGuid(),
                MicroclimateId = microclimate.Id,
                Text = questionInput.Text,
                Type = questionInput.Type,
                Options = questionInput.Options,
                Required = questionInput.Required,
                Order = questionInput.Order,
            });
        }

        await db.SaveChangesAsync(cancellationToken);

        return Results.Json(await ToDetailAsync(microclimate, db, cancellationToken), statusCode: 201);
    }

    private static async Task<IResult> GetAsync(
        Guid id,
        ClaimsPrincipal principal,
        ClimateProjectDbContext db,
        CancellationToken cancellationToken)
    {
        var currentUser = principal.GetCurrentUser();
        var microclimate = await db.Microclimates.FirstOrDefaultAsync(m => m.Id == id, cancellationToken);
        if (microclimate is null)
        {
            return Results.Json(new { message = "Microclimate not found" }, statusCode: 404);
        }

        if (!CanAccessCompany(currentUser, microclimate.CompanyId))
        {
            return Results.Forbid();
        }

        return Results.Ok(await ToDetailAsync(microclimate, db, cancellationToken));
    }

    private static async Task<IResult> UpdateAsync(
        Guid id,
        UpdateMicroclimateRequest request,
        ClaimsPrincipal principal,
        ClimateProjectDbContext db,
        CancellationToken cancellationToken)
    {
        var currentUser = principal.GetCurrentUser();
        var microclimate = await db.Microclimates.FirstOrDefaultAsync(m => m.Id == id, cancellationToken);
        if (microclimate is null)
        {
            return Results.Json(new { message = "Microclimate not found" }, statusCode: 404);
        }

        if (!CanAccessCompany(currentUser, microclimate.CompanyId))
        {
            return Results.Forbid();
        }

        if (!string.IsNullOrWhiteSpace(request.Title)) microclimate.Title = request.Title.Trim();
        if (request.Description is not null) microclimate.Description = request.Description;
        if (request.EndTime.HasValue) microclimate.Scheduling.EndTime = request.EndTime.Value;

        if (!string.IsNullOrWhiteSpace(request.Status))
        {
            if (!MicroclimateValidation.ValidStatuses.Contains(request.Status))
            {
                return Results.Json(new { message = $"Invalid status: {request.Status}" }, statusCode: 400);
            }

            microclimate.Status = request.Status;
        }

        microclimate.UpdatedAt = DateTimeOffset.UtcNow;
        await db.SaveChangesAsync(cancellationToken);

        return Results.Ok(await ToDetailAsync(microclimate, db, cancellationToken));
    }

    private static Dictionary<string, int> CountWordFrequencies(IEnumerable<string> texts)
    {
        var counts = new Dictionary<string, int>();
        foreach (var text in texts)
        {
            var words = text.ToLowerInvariant()
                .Split([' ', '\t', '\n', '.', ',', '!', '?'], StringSplitOptions.RemoveEmptyEntries);
            foreach (var word in words)
            {
                counts[word] = counts.GetValueOrDefault(word) + 1;
            }
        }

        return counts;
    }

    private static string ComputeEngagementLevel(int responseCount, int targetParticipantCount)
    {
        if (targetParticipantCount <= 0)
        {
            return "medium";
        }

        var ratio = (double)responseCount / targetParticipantCount;
        return ratio switch
        {
            < 0.3 => "low",
            < 0.7 => "medium",
            _ => "high",
        };
    }

    private static async Task<IResult> GetLiveResultsAsync(
        Guid id,
        ClaimsPrincipal principal,
        ClimateProjectDbContext db,
        CancellationToken cancellationToken)
    {
        var currentUser = principal.GetCurrentUser();
        var microclimate = await db.Microclimates.FirstOrDefaultAsync(m => m.Id == id, cancellationToken);
        if (microclimate is null)
        {
            return Results.Json(new { message = "Microclimate not found" }, statusCode: 404);
        }

        if (!CanAccessCompany(currentUser, microclimate.CompanyId))
        {
            return Results.Forbid();
        }

        var wordCloud = string.IsNullOrWhiteSpace(microclimate.LiveResults.WordCloudData)
            ? []
            : System.Text.Json.JsonSerializer.Deserialize<List<WordCloudEntry>>(microclimate.LiveResults.WordCloudData) ?? [];

        return Results.Ok(new LiveResultsDetail(
            microclimate.LiveResults.SentimentScore,
            microclimate.LiveResults.EngagementLevel,
            wordCloud,
            microclimate.ResponseCount,
            microclimate.TargetParticipantCount));
    }

    private static async Task<IResult> SubmitResponseAsync(
        Guid id,
        SubmitResponseRequest request,
        HttpContext httpContext,
        ClimateProjectDbContext db,
        CancellationToken cancellationToken)
    {
        var microclimate = await db.Microclimates.FirstOrDefaultAsync(m => m.Id == id, cancellationToken);
        if (microclimate is null)
        {
            return Results.Json(new { message = "Microclimate not found" }, statusCode: 404);
        }

        if (!microclimate.RealtimeSettings.AnonymousResponses && !(httpContext.User.Identity?.IsAuthenticated ?? false))
        {
            return Results.Json(new { message = "This microclimate requires authentication to respond" }, statusCode: 401);
        }

        if (microclimate.Status != "active")
        {
            return Results.Json(new { message = "This microclimate is not currently accepting responses" }, statusCode: 400);
        }

        var openTextAnswers = request.Answers.Values;
        var existingCloud = string.IsNullOrWhiteSpace(microclimate.LiveResults.WordCloudData)
            ? new Dictionary<string, int>()
            : System.Text.Json.JsonSerializer.Deserialize<List<WordCloudEntry>>(microclimate.LiveResults.WordCloudData)!.ToDictionary(w => w.Text, w => w.Value);

        foreach (var (word, count) in CountWordFrequencies(openTextAnswers))
        {
            existingCloud[word] = existingCloud.GetValueOrDefault(word) + count;
        }

        var topWords = existingCloud
            .OrderByDescending(kv => kv.Value)
            .Take(20)
            .Select(kv => new WordCloudEntry(kv.Key, kv.Value))
            .ToList();

        microclimate.ResponseCount += 1;
        microclimate.LiveResults.WordCloudData = System.Text.Json.JsonSerializer.Serialize(topWords);
        microclimate.LiveResults.EngagementLevel = ComputeEngagementLevel(microclimate.ResponseCount, microclimate.TargetParticipantCount);
        microclimate.LiveResults.SentimentScore = 0;
        microclimate.UpdatedAt = DateTimeOffset.UtcNow;

        await db.SaveChangesAsync(cancellationToken);

        return Results.StatusCode(201);
    }
}
