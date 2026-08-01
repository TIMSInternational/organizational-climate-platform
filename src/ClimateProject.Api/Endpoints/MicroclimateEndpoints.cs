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
        // AllowAnonymous so the public MicroclimateRespondPage (Task 7) can load a microclimate's
        // title/questions without a JWT -- GetAsync still enforces its own access rule below
        // (authenticated requests get the usual CanAccessCompany check; unauthenticated requests
        // are only served when the microclimate is configured for AnonymousResponses, mirroring
        // the policy SubmitResponseAsync already enforces for the actual submission).
        group.MapGet("/{id:guid}", GetAsync).AllowAnonymous();
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
        var microclimate = await db.Microclimates.FirstOrDefaultAsync(m => m.Id == id, cancellationToken);
        if (microclimate is null)
        {
            return Results.Json(new { message = "Microclimate not found" }, statusCode: 404);
        }

        var isAuthenticated = principal.Identity?.IsAuthenticated ?? false;
        if (isAuthenticated)
        {
            var currentUser = principal.GetCurrentUser();
            if (!CanAccessCompany(currentUser, microclimate.CompanyId))
            {
                return Results.Forbid();
            }
        }
        else if (!microclimate.RealtimeSettings.AnonymousResponses)
        {
            // Unauthenticated visitors may only view microclimates that are actually configured
            // for anonymous responses -- the same policy SubmitResponseAsync enforces below.
            // Anything else still requires a token, same as every other route in this group.
            return Results.Json(new { message = "Authentication required to view this microclimate" }, statusCode: 401);
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

        var isAuthenticated = httpContext.User.Identity?.IsAuthenticated ?? false;

        if (!microclimate.RealtimeSettings.AnonymousResponses)
        {
            if (!isAuthenticated)
            {
                return Results.Json(new { message = "This microclimate requires authentication to respond" }, statusCode: 401);
            }

            // Non-anonymous microclimates require the submitter to belong to the same
            // company -- otherwise any authenticated user from any company could inflate
            // another company's ResponseCount/word cloud.
            if (!CanAccessCompany(httpContext.User.GetCurrentUser(), microclimate.CompanyId))
            {
                return Results.Forbid();
            }
        }

        if (microclimate.Status != "active")
        {
            return Results.Json(new { message = "This microclimate is not currently accepting responses" }, statusCode: 400);
        }

        var questions = await db.MicroclimateQuestions
            .Where(q => q.MicroclimateId == id)
            .Select(q => new { q.Id, q.Type, q.Options })
            .ToListAsync(cancellationToken);
        var questionsById = questions.ToDictionary(q => q.Id);

        // Constrained question types (multiple_choice, rating, yes_no) must not accept arbitrary
        // freeform text -- validate each submitted answer against the question's own allowed
        // values so an invalid choice/rating never gets counted as a "real" response.
        foreach (var (questionId, answer) in request.Answers)
        {
            if (!questionsById.TryGetValue(questionId, out var question))
            {
                continue;
            }

            var validationError = question.Type switch
            {
                "yes_no" => answer.Equals("yes", StringComparison.OrdinalIgnoreCase)
                    || answer.Equals("no", StringComparison.OrdinalIgnoreCase)
                    ? null
                    : "must be 'yes' or 'no'",
                "rating" when question.Options is { Length: > 0 } => question.Options.Contains(answer)
                    ? null
                    : $"must be one of: {string.Join(", ", question.Options)}",
                "rating" => int.TryParse(answer, out var rating) && rating is >= 1 and <= 5
                    ? null
                    : "must be a rating between 1 and 5",
                "multiple_choice" when question.Options is { Length: > 0 } => question.Options.Contains(answer)
                    ? null
                    : $"must be one of: {string.Join(", ", question.Options)}",
                _ => null,
            };

            if (validationError is not null)
            {
                return Results.Json(new { message = $"Invalid answer for question {questionId}: {validationError}" }, statusCode: 400);
            }
        }

        // Word cloud is built from open-text responses only -- ratings, yes/no, and
        // multiple-choice option text must not be fed into word-frequency counting.
        var openTextQuestionIds = questions
            .Where(q => q.Type == "open_text")
            .Select(q => q.Id)
            .ToHashSet();

        var openTextAnswers = request.Answers
            .Where(kv => openTextQuestionIds.Contains(kv.Key))
            .Select(kv => kv.Value)
            .ToList();

        // ResponseCount and LiveResults.WordCloudData are a read-modify-write aggregate with
        // no natural per-response row to insert into, so concurrent submissions (the normal
        // case for a live microclimate) can race. Retry on optimistic-concurrency conflict
        // (backed by the "xmin" token configured in MicroclimateConfiguration.cs) instead of
        // silently losing one submission's increment/word counts.
        const int maxAttempts = 20;
        for (var attempt = 1; ; attempt++)
        {
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

            try
            {
                await db.SaveChangesAsync(cancellationToken);
                break;
            }
            catch (DbUpdateConcurrencyException) when (attempt < maxAttempts)
            {
                // Another submission won the race and committed first. Discard our stale
                // tracked state entirely and re-read the now-current row, then reapply this
                // submission's word counts/increment on top of it.
                db.ChangeTracker.Clear();
                microclimate = await db.Microclimates.FirstAsync(m => m.Id == id, cancellationToken);
            }
        }

        return Results.StatusCode(201);
    }
}
