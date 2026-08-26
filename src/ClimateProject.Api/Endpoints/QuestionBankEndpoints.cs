using System.Security.Claims;
using ClimateProject.Api.Infrastructure;
using ClimateProject.Application.Auth;
using ClimateProject.Application.Localization;
using ClimateProject.Application.Questions;
using ClimateProject.Domain.Entities;
using ClimateProject.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace ClimateProject.Api.Endpoints;

/// <summary>
/// The question BANK — the curation repository behind the admin <c>/question-bank</c> page
/// and the AI features (#110, under #58).
/// </summary>
/// <remarks>
/// <para>
/// <strong>Deliberately separate from the question library</strong> (#112), which lives in
/// <see cref="QuestionLibraryEndpoints"/>. #58 settles it: "They do not overlap in purpose
/// and must not be merged." The library is the AUTHORING surface — a real category
/// hierarchy, a dimension, bilingual by construction, read by the picker inside both
/// wizards. The bank is the CURATION surface — cross-corpus usage and effectiveness,
/// industry and company-size targeting, alternate phrasings under one lineage, and a flat
/// string category with a subcategory beside it. Nothing here reaches
/// <c>/admin/question-library</c> and nothing there reaches these tables.
/// </para>
/// <para>
/// <strong>Monolingual, and that is inherited rather than chosen.</strong> Legacy
/// <c>QuestionBank.text</c> was one string, so #195 attribution applies here and only here:
/// the text routes into <c>text_en</c> or <c>text_es</c> by the owning company's language
/// and <c>language</c> records which. Never <c>both</c> — a second phrasing is a variation,
/// not a translation, and <c>/{id}/variations</c> is where it goes.
/// </para>
/// <para>
/// <strong>Nothing a respondent does writes a row in this file's tables.</strong> That is
/// the load-bearing design decision of #110 and it is argued in full on
/// <see cref="QuestionBankMetrics"/>: usage and effectiveness are COUNTs over
/// <c>questions</c>/<c>responses</c>/<c>question_responses</c>, taken when an admin asks,
/// not counters incremented inside the submission transaction. A counter on a popular
/// question is one tuple taking a row lock once per respondent, which turns a statistic
/// nobody reads in real time into the thing every respondent queues behind.
/// </para>
/// <para>
/// <strong>Global rows.</strong> A row with <c>CompanyId == null</c> is visible to every
/// tenant, so it is SuperAdmin-only to write — read access and write access are separate
/// checks, the same split <c>BenchmarkEndpoints</c> enforces. This applies to every write
/// route including <c>/bulk</c> and <c>/import</c>, where it matters most: a batch is the
/// natural place to slip one global row past a per-row check that only ever looked at the
/// first element.
/// </para>
/// </remarks>
public static class QuestionBankEndpoints
{
    public static void MapQuestionBankEndpoints(this WebApplication app)
    {
        ArgumentNullException.ThrowIfNull(app);

        var group = app.MapGroup("/admin/question-bank").RequireAuthorization();

        // Literal segments before the {id:guid} routes purely for readability -- the guid
        // constraint already keeps "analytics" from matching the parameterised route.
        group.MapGet("", ListAsync);
        group.MapPost("", CreateAsync);
        group.MapGet("/categories", CategoriesAsync);
        group.MapGet("/analytics", AnalyticsAsync);
        group.MapGet("/effectiveness", EffectivenessAsync);
        group.MapPost("/effectiveness-measurement", MeasureEffectivenessAsync);
        group.MapGet("/usage-tracking", UsageTrackingAsync);
        group.MapPost("/bulk", BulkCreateAsync);
        group.MapPost("/import", ImportAsync);

        group.MapGet("/{id:guid}", GetAsync);
        group.MapPut("/{id:guid}", UpdateAsync);
        group.MapDelete("/{id:guid}", DeleteAsync);
        group.MapGet("/{id:guid}/metrics", MetricsAsync);
        group.MapGet("/{id:guid}/variations", ListVariationsAsync);
        group.MapPost("/{id:guid}/variations", CreateVariationAsync);
        group.MapPut("/{id:guid}/lifecycle", SetLifecycleAsync);
    }

    // ------------------------------------------------------------------
    // Authorization — two checks, never one
    // ------------------------------------------------------------------

    /// <summary>A global row is readable by any admin; a company row only by its own tenant.</summary>
    private static bool CanRead(CurrentUser currentUser, Guid? rowCompanyId)
    {
        if (currentUser.Role == Roles.SuperAdmin) return true;
        if (currentUser.Role != Roles.CompanyAdmin) return false;
        return rowCompanyId is null || currentUser.CompanyId == rowCompanyId.Value.ToString();
    }

    /// <summary>
    /// Writing a global row is SuperAdmin-only. Note the <c>is not null</c>, which is the
    /// whole difference from <see cref="CanRead"/>: a global row is visible to every tenant,
    /// so letting one tenant write it is a cross-tenant write wearing a read's clothing.
    /// </summary>
    private static bool CanWrite(CurrentUser currentUser, Guid? rowCompanyId)
    {
        if (currentUser.Role == Roles.SuperAdmin) return true;
        if (currentUser.Role != Roles.CompanyAdmin) return false;
        return rowCompanyId is not null && currentUser.CompanyId == rowCompanyId.Value.ToString();
    }

    /// <summary>Everything the caller may READ, optionally narrowed to one tenant by a SuperAdmin.</summary>
    private static IQueryable<QuestionBankItem> ReadableScope(
        ClimateProjectDbContext db, CurrentUser currentUser, Guid? companyId)
    {
        var query = db.QuestionBankItems.AsQueryable();
        if (currentUser.Role != Roles.SuperAdmin)
        {
            var own = Guid.Parse(currentUser.CompanyId);
            return query.Where(i => i.CompanyId == null || i.CompanyId == own);
        }

        return companyId.HasValue ? query.Where(i => i.CompanyId == companyId.Value) : query;
    }

    /// <summary>
    /// Everything the caller may WRITE. Strictly narrower than <see cref="ReadableScope"/>
    /// for a CompanyAdmin: the global rows drop out.
    /// </summary>
    private static IQueryable<QuestionBankItem> WritableScope(
        ClimateProjectDbContext db, CurrentUser currentUser, Guid? companyId)
    {
        var query = db.QuestionBankItems.AsQueryable();
        if (currentUser.Role != Roles.SuperAdmin)
        {
            var own = Guid.Parse(currentUser.CompanyId);
            return query.Where(i => i.CompanyId == own);
        }

        return companyId.HasValue ? query.Where(i => i.CompanyId == companyId.Value) : query;
    }

    // ------------------------------------------------------------------
    // question-bank : list and create
    // ------------------------------------------------------------------

    /// <param name="includeRetired">
    /// Retired items are hidden by default. They are still in the corpus and still
    /// resolvable by id — retirement withdraws a question from the picker, it does not
    /// remove it, because questions already asked have to stay resolvable (#106).
    /// </param>
    private static async Task<IResult> ListAsync(
        string? category,
        string? subcategory,
        string? type,
        string? industry,
        string? companySize,
        string? tag,
        string? search,
        bool? includeRetired,
        Guid? companyId,
        ClaimsPrincipal principal,
        ClimateProjectDbContext db,
        CancellationToken cancellationToken)
    {
        var currentUser = principal.GetCurrentUser();
        if (!Roles.Admin.Contains(currentUser.Role)) return Results.Forbid();

        var query = ReadableScope(db, currentUser, companyId);

        if (includeRetired != true) query = query.Where(i => i.IsActive);
        if (!string.IsNullOrWhiteSpace(category)) query = query.Where(i => i.Category == category);
        if (!string.IsNullOrWhiteSpace(subcategory)) query = query.Where(i => i.Subcategory == subcategory);
        if (!string.IsNullOrWhiteSpace(type)) query = query.Where(i => i.Type == type);
        if (!string.IsNullOrWhiteSpace(industry)) query = query.Where(i => i.Industry == industry);
        if (!string.IsNullOrWhiteSpace(companySize)) query = query.Where(i => i.CompanySize == companySize);
        if (!string.IsNullOrWhiteSpace(tag))
        {
            // An indexed join, which is why tags are rows and not an array column.
            query = query.Where(i => db.QuestionBankItemTags.Any(t => t.QuestionBankItemId == i.Id && t.Tag == tag));
        }

        if (!string.IsNullOrWhiteSpace(search))
        {
            // Both columns, because which one holds the text depends on the row's own
            // language -- searching only text_en would silently never match a Spanish corpus.
            var pattern = $"%{search.Trim()}%";
            query = query.Where(i =>
                (i.TextEn != null && EF.Functions.ILike(i.TextEn, pattern))
                || (i.TextEs != null && EF.Functions.ILike(i.TextEs, pattern)));
        }

        var items = await ProjectListAsync(db, query.OrderBy(i => i.Category).ThenBy(i => i.Subcategory), cancellationToken);
        return Results.Ok(new QuestionBankListResponse(items, items.Count));
    }

    private static async Task<IResult> CreateAsync(
        CreateQuestionBankItemRequest request,
        ClaimsPrincipal principal,
        ClimateProjectDbContext db,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(request);

        var currentUser = principal.GetCurrentUser();
        if (!CanWrite(currentUser, request.CompanyId)) return Results.Forbid();

        var actingUserId = await ActingUserResolver.ResolveIdAsync(currentUser, db, cancellationToken);
        if (actingUserId is null) return ActingUserRequired();

        var (prepared, error) = await PrepareAsync(db, request, parent: null, cancellationToken);
        if (error is not null) return BadRequest(error);

        var id = Write(db, prepared!, actingUserId.Value, parentId: null);
        await db.SaveChangesAsync(cancellationToken);

        return Results.Json(await LoadDetailAsync(db, id, cancellationToken), statusCode: 201);
    }

    // ------------------------------------------------------------------
    // question-bank/[id]
    // ------------------------------------------------------------------

    /// <remarks>
    /// Deliberately answers for a RETIRED item too. A question copied into a survey records
    /// where it came from, and "where did this question come from" has to stay answerable
    /// for as long as the answers to it do — treating retired as gone is exactly the bug
    /// that makes a historical response uninterpretable (#106).
    /// </remarks>
    private static async Task<IResult> GetAsync(
        Guid id, ClaimsPrincipal principal, ClimateProjectDbContext db, CancellationToken cancellationToken)
    {
        var currentUser = principal.GetCurrentUser();
        var item = await db.QuestionBankItems.AsNoTracking().FirstOrDefaultAsync(i => i.Id == id, cancellationToken);
        if (item is null) return NotFound();
        if (!CanRead(currentUser, item.CompanyId)) return Results.Forbid();

        return Results.Ok(await LoadDetailAsync(db, id, cancellationToken));
    }

    private static async Task<IResult> UpdateAsync(
        Guid id,
        UpdateQuestionBankItemRequest request,
        ClaimsPrincipal principal,
        ClimateProjectDbContext db,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(request);

        var currentUser = principal.GetCurrentUser();
        var item = await db.QuestionBankItems.FirstOrDefaultAsync(i => i.Id == id, cancellationToken);
        if (item is null) return NotFound();
        if (!CanWrite(currentUser, item.CompanyId)) return Results.Forbid();

        var text = request.Text?.Trim();
        if (string.IsNullOrWhiteSpace(text))
        {
            return BadRequest("Text is required");
        }

        var category = request.Category?.Trim();
        if (string.IsNullOrWhiteSpace(category))
        {
            return BadRequest("Category is required");
        }

        var (options, optionError) = NormaliseOptions(request.Options, item.Type);
        if (optionError is not null) return BadRequest(optionError);

        if (request.ScaleMin.HasValue && request.ScaleMax.HasValue && request.ScaleMin.Value >= request.ScaleMax.Value)
        {
            return BadRequest("ScaleMin must be less than ScaleMax");
        }

        // The text goes back into the column the row's own language names. Language is not
        // in the update shape at all -- moving text between columns without changing the
        // label on it is how a row comes to claim a translation it does not have.
        SetText(item, item.Language, text);
        item.Category = category;
        item.Subcategory = request.Subcategory?.Trim();
        item.ScaleMin = request.ScaleMin;
        item.ScaleMax = request.ScaleMax;
        SetScaleLabels(item, item.Language, request.ScaleLabelMin?.Trim(), request.ScaleLabelMax?.Trim());
        item.Industry = request.Industry?.Trim();
        item.CompanySize = request.CompanySize?.Trim();
        if (request.IsActive.HasValue) item.IsActive = request.IsActive.Value;
        item.Version += 1;
        item.UpdatedAt = DateTimeOffset.UtcNow;

        // Replaced wholesale rather than diffed: the option set is one value, and a partial
        // update would let a caller silently keep an option they had removed from their own
        // payload.
        db.QuestionBankItemOptions.RemoveRange(db.QuestionBankItemOptions.Where(o => o.QuestionBankItemId == id));
        db.QuestionBankItemTags.RemoveRange(db.QuestionBankItemTags.Where(t => t.QuestionBankItemId == id));
        await db.SaveChangesAsync(cancellationToken);

        WriteChildren(db, id, options, request.Tags, item.Language);
        await db.SaveChangesAsync(cancellationToken);

        return Results.Ok(await LoadDetailAsync(db, id, cancellationToken));
    }

    /// <summary>
    /// Removes a bank item that nothing has ever used.
    /// </summary>
    /// <remarks>
    /// <para>
    /// A hard delete exists only for the mistake case — a row typed in wrongly this morning.
    /// The moment a question has been copied into a survey it is refused with 409 and
    /// retirement is the answer, because an answer belongs to the question as it was ASKED
    /// and severing the provenance would make an item that had been asked ten thousand times
    /// report zero, with no error anywhere (#106, #110).
    /// </para>
    /// <para>
    /// The foreign key says the same thing underneath (<c>Restrict</c> on
    /// <c>questions.source_question_bank_item_id</c>), so this check is the readable half of
    /// a rule the database also enforces — not the only thing standing between a caller and
    /// a severed link.
    /// </para>
    /// </remarks>
    private static async Task<IResult> DeleteAsync(
        Guid id, ClaimsPrincipal principal, ClimateProjectDbContext db, CancellationToken cancellationToken)
    {
        var currentUser = principal.GetCurrentUser();
        var item = await db.QuestionBankItems.FirstOrDefaultAsync(i => i.Id == id, cancellationToken);
        if (item is null) return NotFound();
        if (!CanWrite(currentUser, item.CompanyId)) return Results.Forbid();

        var instantiated = await db.Questions.CountAsync(q => q.SourceQuestionBankItemId == id, cancellationToken);
        if (instantiated > 0)
        {
            return Results.Json(
                new
                {
                    message = $"This question has been used in {instantiated} survey question(s) and cannot be deleted. "
                              + "Retire it instead, through PUT /admin/question-bank/{id}/lifecycle.",
                },
                statusCode: 409);
        }

        var variations = await db.QuestionBankItems.CountAsync(i => i.ParentQuestionBankItemId == id, cancellationToken);
        if (variations > 0)
        {
            return Results.Json(
                new { message = $"This question has {variations} variation(s) hanging off it. Delete or re-parent them first." },
                statusCode: 409);
        }

        db.QuestionBankItemOptions.RemoveRange(db.QuestionBankItemOptions.Where(o => o.QuestionBankItemId == id));
        db.QuestionBankItemTags.RemoveRange(db.QuestionBankItemTags.Where(t => t.QuestionBankItemId == id));
        db.QuestionBankItems.Remove(item);
        await db.SaveChangesAsync(cancellationToken);

        return Results.NoContent();
    }

    // ------------------------------------------------------------------
    // question-bank/[id]/metrics
    // ------------------------------------------------------------------

    private static async Task<IResult> MetricsAsync(
        Guid id, ClaimsPrincipal principal, ClimateProjectDbContext db, CancellationToken cancellationToken)
    {
        var currentUser = principal.GetCurrentUser();
        var item = await db.QuestionBankItems.AsNoTracking().FirstOrDefaultAsync(i => i.Id == id, cancellationToken);
        if (item is null) return NotFound();
        if (!CanRead(currentUser, item.CompanyId)) return Results.Forbid();

        var metrics = await QuestionBankMetrics.ComputeAsync(db, [id], cancellationToken);
        return Results.Ok(metrics[id]);
    }

    // ------------------------------------------------------------------
    // question-bank/[id]/variations
    // ------------------------------------------------------------------

    private static async Task<IResult> ListVariationsAsync(
        Guid id, ClaimsPrincipal principal, ClimateProjectDbContext db, CancellationToken cancellationToken)
    {
        var currentUser = principal.GetCurrentUser();
        var item = await db.QuestionBankItems.AsNoTracking().FirstOrDefaultAsync(i => i.Id == id, cancellationToken);
        if (item is null) return NotFound();
        if (!CanRead(currentUser, item.CompanyId)) return Results.Forbid();

        var variations = await ProjectListAsync(
            db,
            db.QuestionBankItems.Where(i => i.ParentQuestionBankItemId == id).OrderBy(i => i.CreatedAt),
            cancellationToken);

        return Results.Ok(new QuestionBankVariationsResponse(id, variations));
    }

    /// <remarks>
    /// One level deep. A variation OF a variation is refused because the lineage is what
    /// "alternate phrasings of the same question" means — allow the chain and a corpus
    /// acquires trees whose root nobody can find, and the AI features in #111 have no
    /// well-defined set to choose between.
    /// </remarks>
    private static async Task<IResult> CreateVariationAsync(
        Guid id,
        CreateQuestionBankVariationRequest request,
        ClaimsPrincipal principal,
        ClimateProjectDbContext db,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(request);

        var currentUser = principal.GetCurrentUser();
        var parent = await db.QuestionBankItems.AsNoTracking().FirstOrDefaultAsync(i => i.Id == id, cancellationToken);
        if (parent is null) return NotFound();

        // The variation inherits the parent's tenant, so writing it is writing the parent's
        // scope -- a CompanyAdmin may not hang a variation off a global question.
        if (!CanWrite(currentUser, parent.CompanyId)) return Results.Forbid();

        if (parent.ParentQuestionBankItemId is not null)
        {
            return BadRequest("That question is already a variation. Add the new phrasing to its parent instead.");
        }

        var actingUserId = await ActingUserResolver.ResolveIdAsync(currentUser, db, cancellationToken);
        if (actingUserId is null) return ActingUserRequired();

        var asCreate = new CreateQuestionBankItemRequest(
            Text: request.Text,
            Type: parent.Type,
            Category: parent.Category,
            CompanyId: parent.CompanyId,
            Subcategory: request.Subcategory ?? parent.Subcategory,
            Language: request.Language,
            ScaleMin: parent.ScaleMin,
            ScaleMax: parent.ScaleMax,
            ScaleLabelMin: null,
            ScaleLabelMax: null,
            Industry: parent.Industry,
            CompanySize: parent.CompanySize,
            Tags: request.Tags,
            Options: request.Options);

        var (prepared, error) = await PrepareAsync(db, asCreate, parent, cancellationToken);
        if (error is not null) return BadRequest(error);

        var newId = Write(db, prepared!, actingUserId.Value, parentId: parent.Id);
        await db.SaveChangesAsync(cancellationToken);

        return Results.Json(await LoadDetailAsync(db, newId, cancellationToken), statusCode: 201);
    }

    // ------------------------------------------------------------------
    // question-bank/categories
    // ------------------------------------------------------------------

    /// <remarks>
    /// Counted from the rows, never stored. The bank's category is a plain string with a
    /// subcategory beside it — flat by design, and it needs no hierarchy, which is one of
    /// the concrete ways it differs from the library's tree.
    /// </remarks>
    private static async Task<IResult> CategoriesAsync(
        Guid? companyId, ClaimsPrincipal principal, ClimateProjectDbContext db, CancellationToken cancellationToken)
    {
        var currentUser = principal.GetCurrentUser();
        if (!Roles.Admin.Contains(currentUser.Role)) return Results.Forbid();

        var categories = await CategoryCountsAsync(ReadableScope(db, currentUser, companyId), cancellationToken);
        return Results.Ok(new QuestionBankCategoriesResponse(categories));
    }

    private static Task<List<QuestionBankCategoryCount>> CategoryCountsAsync(
        IQueryable<QuestionBankItem> scope, CancellationToken cancellationToken)
        => scope
            .GroupBy(i => new { i.Category, i.Subcategory })
            .Select(g => new QuestionBankCategoryCount(
                g.Key.Category,
                g.Key.Subcategory,
                g.Count(),
                g.Count(i => i.IsActive)))
            .OrderBy(c => c.Category)
            .ThenBy(c => c.Subcategory)
            .ToListAsync(cancellationToken);

    // ------------------------------------------------------------------
    // question-bank/analytics
    // ------------------------------------------------------------------

    private static async Task<IResult> AnalyticsAsync(
        Guid? companyId, ClaimsPrincipal principal, ClimateProjectDbContext db, CancellationToken cancellationToken)
    {
        var currentUser = principal.GetCurrentUser();
        if (!Roles.Admin.Contains(currentUser.Role)) return Results.Forbid();

        var scope = ReadableScope(db, currentUser, companyId);

        var totals = await scope
            .GroupBy(_ => 1)
            .Select(g => new
            {
                Total = g.Count(),
                Active = g.Count(i => i.IsActive),
                Global = g.Count(i => i.CompanyId == null),
                Ai = g.Count(i => i.IsAiGenerated),
            })
            .FirstOrDefaultAsync(cancellationToken);

        var byType = await scope
            .GroupBy(i => i.Type)
            .Select(g => new QuestionBankTypeCount(g.Key, g.Count()))
            .OrderByDescending(t => t.ItemCount).ThenBy(t => t.Type)
            .ToListAsync(cancellationToken);

        var byCategory = await CategoryCountsAsync(scope, cancellationToken);

        var scopedIds = await scope.Select(i => i.Id).ToListAsync(cancellationToken);
        var withVariations = await db.QuestionBankItems
            .Where(i => i.ParentQuestionBankItemId != null && scopedIds.Contains(i.ParentQuestionBankItemId.Value))
            .Select(i => i.ParentQuestionBankItemId!.Value)
            .Distinct()
            .CountAsync(cancellationToken);

        // Derived, like every other number on this surface. The stored response_rate column
        // is a published snapshot; reporting it here would let the corpus average drift away
        // from the per-item numbers the same page shows.
        var metrics = await QuestionBankMetrics.ComputeAsync(db, scopedIds, cancellationToken);
        var used = metrics.Values.Where(m => m.TimesAsked > 0).ToList();

        return Results.Ok(new QuestionBankAnalyticsResponse(
            TotalItems: totals?.Total ?? 0,
            ActiveItems: totals?.Active ?? 0,
            RetiredItems: (totals?.Total ?? 0) - (totals?.Active ?? 0),
            GlobalItems: totals?.Global ?? 0,
            AiGeneratedItems: totals?.Ai ?? 0,
            ItemsWithVariations: withVariations,
            ItemsEverUsed: metrics.Values.Count(m => m.QuestionsCreated > 0),
            // Averaged over the questions that were actually asked. Including the never-asked
            // ones as zeroes would report a healthy corpus as a failing one the day somebody
            // imports a thousand candidates.
            AverageResponseRate: used.Count == 0 ? 0d : Math.Round(used.Average(m => m.ResponseRate), 2),
            ByType: byType,
            ByCategory: byCategory));
    }

    // ------------------------------------------------------------------
    // question-bank/effectiveness and effectiveness-measurement
    // ------------------------------------------------------------------

    /// <param name="minimumTimesAsked">
    /// Floor on the denominator. A question asked twice and answered twice is not the most
    /// effective question in the corpus, and ranking it first is how a curation surface
    /// recommends noise.
    /// </param>
    private static async Task<IResult> EffectivenessAsync(
        Guid? companyId,
        string? category,
        int? minimumTimesAsked,
        bool? includeRetired,
        ClaimsPrincipal principal,
        ClimateProjectDbContext db,
        CancellationToken cancellationToken)
    {
        var currentUser = principal.GetCurrentUser();
        if (!Roles.Admin.Contains(currentUser.Role)) return Results.Forbid();

        var scope = ReadableScope(db, currentUser, companyId);
        if (includeRetired != true) scope = scope.Where(i => i.IsActive);
        if (!string.IsNullOrWhiteSpace(category)) scope = scope.Where(i => i.Category == category);

        var items = await ProjectEffectivenessAsync(db, scope, cancellationToken);
        var floor = Math.Max(0, minimumTimesAsked ?? 0);

        var ranked = items
            .Where(i => i.Metrics.TimesAsked >= floor)
            .OrderByDescending(i => i.Metrics.ResponseRate)
            .ThenByDescending(i => i.Metrics.TimesAsked)
            .ToList();

        return Results.Ok(new QuestionBankEffectivenessResponse(ranked));
    }

    /// <summary>
    /// Recomputes the derived numbers and publishes them onto the rows.
    /// </summary>
    /// <remarks>
    /// <para>
    /// <b>The only writer of <c>usage_count</c>, <c>response_rate</c> and
    /// <c>last_used_at</c>.</b> It exists so consumers that read <c>question_bank_items</c>
    /// directly — exports today, #111's AI features when the provider decision lands — see
    /// something rather than three zeroes. Every read route on this surface reports the
    /// DERIVED value instead, so a snapshot that has gone stale can never be served as a
    /// live number.
    /// </para>
    /// <para>
    /// This is what makes it safe: it is an admin action over an admin-sized batch, run when
    /// somebody asks, and it touches each row at most once. The thing #110 forbids is not
    /// writing these columns — it is writing them on the RESPONDENT's transaction, where a
    /// popular question becomes one tuple that every submission has to queue behind.
    /// </para>
    /// <para>
    /// Scoped to what the caller may WRITE, which for a CompanyAdmin excludes the global
    /// rows they can read: publishing a snapshot onto a row every other tenant reads is a
    /// cross-tenant write, whatever the number happens to be.
    /// </para>
    /// </remarks>
    private static async Task<IResult> MeasureEffectivenessAsync(
        QuestionBankEffectivenessMeasurementRequest? request,
        ClaimsPrincipal principal,
        ClimateProjectDbContext db,
        CancellationToken cancellationToken)
    {
        var currentUser = principal.GetCurrentUser();
        if (!Roles.Admin.Contains(currentUser.Role)) return Results.Forbid();

        var scope = WritableScope(db, currentUser, request?.CompanyId);
        if (request?.ItemIds is { Count: > 0 } requested)
        {
            var ids = requested.Distinct().ToList();
            var writable = await scope.Where(i => ids.Contains(i.Id)).Select(i => i.Id).ToListAsync(cancellationToken);
            var refused = ids.Except(writable).ToList();
            if (refused.Count > 0)
            {
                // Refused whole, not silently narrowed. A measurement that quietly skipped
                // the rows it could not write would report "Examined: 40" for a caller who
                // named fifty.
                return Results.Forbid();
            }

            scope = scope.Where(i => ids.Contains(i.Id));
        }

        var items = await scope.ToListAsync(cancellationToken);
        var metrics = await QuestionBankMetrics.ComputeAsync(db, items.Select(i => i.Id).ToList(), cancellationToken);

        var measuredAt = DateTimeOffset.UtcNow;
        var refreshed = 0;
        foreach (var item in items)
        {
            var m = metrics[item.Id];
            if (item.UsageCount == m.QuestionsCreated
                && Math.Abs(item.ResponseRate - m.ResponseRate) < 0.005
                && item.LastUsedAt == m.LastUsedAt)
            {
                continue;
            }

            item.UsageCount = m.QuestionsCreated;
            item.ResponseRate = m.ResponseRate;
            item.LastUsedAt = m.LastUsedAt;
            item.UpdatedAt = measuredAt;
            refreshed++;
        }

        await db.SaveChangesAsync(cancellationToken);

        var projected = items
            .Select(i => new QuestionBankEffectivenessItem(
                i.Id, TextOf(i), i.Language, i.Category, i.Subcategory, i.IsActive, metrics[i.Id]))
            .OrderByDescending(i => i.Metrics.ResponseRate)
            .ToList();

        return Results.Ok(new QuestionBankEffectivenessMeasurementResponse(
            items.Count, refreshed, measuredAt, projected));
    }

    // ------------------------------------------------------------------
    // question-bank/usage-tracking
    // ------------------------------------------------------------------

    /// <remarks>
    /// "Where is this question used", answered from the provenance column rather than from a
    /// log somebody has to remember to append to. Retired items are included on purpose:
    /// the surveys that used them still exist and their answers still need explaining.
    /// </remarks>
    private static async Task<IResult> UsageTrackingAsync(
        Guid? itemId,
        Guid? companyId,
        ClaimsPrincipal principal,
        ClimateProjectDbContext db,
        CancellationToken cancellationToken)
    {
        var currentUser = principal.GetCurrentUser();
        if (!Roles.Admin.Contains(currentUser.Role)) return Results.Forbid();

        var scope = ReadableScope(db, currentUser, companyId);
        if (itemId.HasValue) scope = scope.Where(i => i.Id == itemId.Value);

        var items = await scope
            .OrderBy(i => i.Category)
            .Select(i => new { i.Id, i.TextEn, i.TextEs, i.Language, i.IsActive })
            .ToListAsync(cancellationToken);

        if (items.Count == 0) return Results.Ok(new QuestionBankUsageResponse([]));

        var ids = items.Select(i => i.Id).ToList();
        var usages = await db.Questions
            .Where(q => q.SourceQuestionBankItemId != null && ids.Contains(q.SourceQuestionBankItemId.Value))
            .Join(db.Surveys, q => q.SurveyId, s => s.Id, (q, s) => new
            {
                ItemId = q.SourceQuestionBankItemId!.Value,
                QuestionId = q.Id,
                SurveyId = s.Id,
                Title = s.TitleEn ?? s.TitleEs,
                s.Status,
                s.CreatedAt,
            })
            .ToListAsync(cancellationToken);

        var bySource = usages.GroupBy(u => u.ItemId).ToDictionary(g => g.Key, g => g.ToList());

        var result = items
            .Select(i =>
            {
                var rows = bySource.TryGetValue(i.Id, out var found) ? found : [];
                return new QuestionBankUsageItem(
                    i.Id,
                    i.Language == ContentLanguages.Spanish ? i.TextEs : i.TextEn,
                    i.IsActive,
                    rows.Count,
                    rows.Count == 0 ? null : rows.Max(r => r.CreatedAt),
                    rows.OrderByDescending(r => r.CreatedAt)
                        .Select(r => new QuestionBankUsageSurvey(r.SurveyId, r.Title, r.Status, r.QuestionId, r.CreatedAt))
                        .ToList());
            })
            .ToList();

        return Results.Ok(new QuestionBankUsageResponse(result));
    }

    // ------------------------------------------------------------------
    // question-bank/bulk and question-bank/import
    // ------------------------------------------------------------------

    /// <summary>
    /// Creates a whole batch, or none of it.
    /// </summary>
    /// <remarks>
    /// <b>Authorization is checked for EVERY row before ANY row is written</b>, and that
    /// ordering is the point rather than a detail. A batch is the natural place to hide one
    /// global row behind forty-nine legitimate ones: a check that ran per row as it inserted
    /// would leave the legitimate ones committed and report a failure, which is a partial
    /// success on a privilege boundary — the caller keeps whatever landed before the refusal
    /// and learns exactly which position the guard sits at.
    /// </remarks>
    private static async Task<IResult> BulkCreateAsync(
        BulkCreateQuestionBankItemsRequest request,
        ClaimsPrincipal principal,
        ClimateProjectDbContext db,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(request);
        return await WriteBatchAsync(db, principal, request.Items, deduplicate: false, cancellationToken);
    }

    /// <remarks>
    /// The same authorization rule as <see cref="BulkCreateAsync"/> — an import is a bulk
    /// create with a duplicate check on top, and the one thing it must not be is a bulk
    /// create with a weaker guard.
    /// </remarks>
    private static async Task<IResult> ImportAsync(
        ImportQuestionBankItemsRequest request,
        ClaimsPrincipal principal,
        ClimateProjectDbContext db,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(request);
        return await WriteBatchAsync(db, principal, request.Items, request.DeduplicateOnText, cancellationToken);
    }

    private static async Task<IResult> WriteBatchAsync(
        ClimateProjectDbContext db,
        ClaimsPrincipal principal,
        IReadOnlyList<CreateQuestionBankItemRequest>? rows,
        bool deduplicate,
        CancellationToken cancellationToken)
    {
        var currentUser = principal.GetCurrentUser();
        if (!Roles.Admin.Contains(currentUser.Role)) return Results.Forbid();

        if (rows is null || rows.Count == 0)
        {
            return BadRequest("Items is required and must not be empty");
        }

        if (rows.Count > MaxBatchSize)
        {
            return BadRequest($"A batch may hold at most {MaxBatchSize} questions");
        }

        // EVERY row, before ANY row. See the remarks on BulkCreateAsync.
        foreach (var row in rows)
        {
            if (!CanWrite(currentUser, row?.CompanyId))
            {
                return Results.Forbid();
            }
        }

        var actingUserId = await ActingUserResolver.ResolveIdAsync(currentUser, db, cancellationToken);
        if (actingUserId is null) return ActingUserRequired();

        var prepared = new List<(int Index, PreparedItem Item)>();
        for (var index = 0; index < rows.Count; index++)
        {
            var (item, error) = await PrepareAsync(db, rows[index], parent: null, cancellationToken);
            if (error is not null)
            {
                // Named by position, because a batch of fifty with one bad row is otherwise
                // a message the caller cannot act on.
                return BadRequest($"Item {index}: {error}");
            }

            prepared.Add((index, item!));
        }

        var skipped = new List<int>();
        var written = new List<Guid>();
        var seenInBatch = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

        foreach (var (index, item) in prepared)
        {
            if (deduplicate)
            {
                var key = $"{item.CompanyId}|{item.Type}|{item.Category}|{item.Text}";
                var alreadyStored = await db.QuestionBankItems.AnyAsync(
                    i => i.CompanyId == item.CompanyId
                         && i.Type == item.Type
                         && i.Category == item.Category
                         && (i.TextEn == item.Text || i.TextEs == item.Text),
                    cancellationToken);

                // Within the batch as well as against the table: a file listing the same
                // question twice is the ordinary case, and inserting it twice on the first
                // run would leave a duplicate that the SECOND run then reports as clean.
                if (alreadyStored || !seenInBatch.Add(key))
                {
                    skipped.Add(index);
                    continue;
                }
            }

            written.Add(Write(db, item, actingUserId.Value, parentId: null));
        }

        await db.SaveChangesAsync(cancellationToken);

        var items = await ProjectListAsync(
            db, db.QuestionBankItems.Where(i => written.Contains(i.Id)).OrderBy(i => i.Category), cancellationToken);

        return Results.Json(
            new QuestionBankWriteResultResponse(written.Count, skipped, items),
            statusCode: written.Count > 0 ? 201 : 200);
    }

    // ------------------------------------------------------------------
    // question-bank/[id]/lifecycle
    // ------------------------------------------------------------------

    /// <summary>
    /// Retires a question, or brings a retired one back.
    /// </summary>
    /// <remarks>
    /// A state change on the row, never a deletion, and the response says how many survey
    /// questions were copied from it precisely so the caller can see why. A retired item
    /// stays readable by id, stays in <c>/usage-tracking</c>, and keeps every metric it had
    /// — what changes is that it stops being offered to authors. That is the whole
    /// difference between withdrawing a question and making the answers to it
    /// uninterpretable (#106).
    /// </remarks>
    private static async Task<IResult> SetLifecycleAsync(
        Guid id,
        QuestionBankLifecycleRequest request,
        ClaimsPrincipal principal,
        ClimateProjectDbContext db,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(request);

        var currentUser = principal.GetCurrentUser();
        var item = await db.QuestionBankItems.FirstOrDefaultAsync(i => i.Id == id, cancellationToken);
        if (item is null) return NotFound();
        if (!CanWrite(currentUser, item.CompanyId)) return Results.Forbid();

        var state = request.State?.Trim().ToLowerInvariant();
        if (!QuestionBankLifecycleStates.IsValid(state))
        {
            return BadRequest($"State must be one of: {string.Join(", ", QuestionBankLifecycleStates.All)}");
        }

        item.IsActive = state == QuestionBankLifecycleStates.Active;
        item.UpdatedAt = DateTimeOffset.UtcNow;
        await db.SaveChangesAsync(cancellationToken);

        var instantiated = await db.Questions.CountAsync(q => q.SourceQuestionBankItemId == id, cancellationToken);

        return Results.Ok(new QuestionBankLifecycleResponse(
            id, QuestionBankLifecycleStates.From(item.IsActive), instantiated, item.UpdatedAt));
    }

    // ------------------------------------------------------------------
    // Shared write plumbing
    // ------------------------------------------------------------------

    private const int MaxBatchSize = 500;

    private sealed record PreparedItem(
        Guid? CompanyId,
        string Text,
        string Language,
        string Type,
        string Category,
        string? Subcategory,
        int? ScaleMin,
        int? ScaleMax,
        string? ScaleLabelMin,
        string? ScaleLabelMax,
        string? Industry,
        string? CompanySize,
        IReadOnlyList<string>? Tags,
        List<QuestionBankOptionDto> Options);

    /// <summary>
    /// Validates one incoming question and resolves its language. Hands back a bare message
    /// rather than a composed <c>IResult</c> so the batch handlers can prefix it with the
    /// row's position -- a batch of fifty with one bad row is otherwise a message the caller
    /// cannot act on.
    /// </summary>
    private static async Task<(PreparedItem? Item, string? Error)> PrepareAsync(
        ClimateProjectDbContext db,
        CreateQuestionBankItemRequest request,
        QuestionBankItem? parent,
        CancellationToken cancellationToken)
    {
        if (request is null) return (null, "A question is required");

        var text = request.Text?.Trim();
        if (string.IsNullOrWhiteSpace(text)) return (null, "Text is required");

        var category = request.Category?.Trim();
        if (string.IsNullOrWhiteSpace(category)) return (null, "Category is required");

        // ForSurvey, not the platform's whole vocabulary and not the library's intersection.
        // Legacy QuestionBank allowed exactly these six, and a bank item is instantiated into
        // a SURVEY -- the library is what the microclimate picker reads. Accepting a type
        // surveys reject would let a curator build a question that cannot be asked.
        if (!QuestionTypes.ForSurvey.Contains(request.Type, StringComparer.Ordinal))
        {
            return (null, $"Type must be one of: {string.Join(", ", QuestionTypes.ForSurvey)}");
        }

        if (request.Language is not null && ContentLanguages.NormaliseLocale(request.Language) is null)
        {
            return (null,
                $"Language must be one of: {string.Join(", ", ContentLanguages.Locales)}. "
                + "A bank question holds one string, so 'both' is not a language it can be in.");
        }

        if (request.ScaleMin.HasValue && request.ScaleMax.HasValue && request.ScaleMin.Value >= request.ScaleMax.Value)
        {
            return (null, "ScaleMin must be less than ScaleMax");
        }

        var language = parent is not null && request.Language is null
            ? parent.Language
            : await ResolveLanguageAsync(db, request.Language, request.CompanyId, cancellationToken);

        var (options, optionError) = NormaliseOptions(request.Options, request.Type);
        if (optionError is not null) return (null, optionError);

        return (new PreparedItem(
            request.CompanyId,
            text,
            language,
            request.Type,
            category,
            request.Subcategory?.Trim(),
            request.ScaleMin,
            request.ScaleMax,
            request.ScaleLabelMin?.Trim(),
            request.ScaleLabelMax?.Trim(),
            request.Industry?.Trim(),
            request.CompanySize?.Trim(),
            request.Tags,
            options), null);
    }

    private static Guid Write(ClimateProjectDbContext db, PreparedItem prepared, Guid actingUserId, Guid? parentId)
    {
        var now = DateTimeOffset.UtcNow;
        var id = Guid.NewGuid();

        var item = new QuestionBankItem
        {
            Id = id,
            CompanyId = prepared.CompanyId,
            Language = prepared.Language,
            Type = prepared.Type,
            Category = prepared.Category,
            Subcategory = prepared.Subcategory,
            ScaleMin = prepared.ScaleMin,
            ScaleMax = prepared.ScaleMax,
            Industry = prepared.Industry,
            CompanySize = prepared.CompanySize,
            IsActive = true,
            // Zeroes, and they stay zeroes until somebody runs a measurement. Nothing on the
            // respondent path will ever move them; see QuestionBankMetrics.
            UsageCount = 0,
            ResponseRate = 0,
            InsightScore = 0,
            IsAiGenerated = false,
            Version = 1,
            ParentQuestionBankItemId = parentId,
            CreatedBy = actingUserId,
            CreatedAt = now,
            UpdatedAt = now,
        };
        SetText(item, prepared.Language, prepared.Text);
        SetScaleLabels(item, prepared.Language, prepared.ScaleLabelMin, prepared.ScaleLabelMax);

        db.QuestionBankItems.Add(item);
        WriteChildren(db, id, prepared.Options, prepared.Tags, prepared.Language);
        return id;
    }

    /// <summary>
    /// Writes the option rows and the tag rows.
    /// </summary>
    /// <remarks>
    /// The option label goes into the column the ITEM's language names, and nowhere else.
    /// Carried on the DTO as one <c>Label</c> rather than an En/Es pair, so a caller cannot
    /// half-translate an option set the way legacy's index-aligned
    /// <c>options_en</c>/<c>options_es</c> arrays let them.
    /// </remarks>
    private static void WriteChildren(
        ClimateProjectDbContext db,
        Guid id,
        List<QuestionBankOptionDto> options,
        IReadOnlyList<string>? tags,
        string language)
    {
        var isSpanish = language == ContentLanguages.Spanish;
        foreach (var option in options)
        {
            db.QuestionBankItemOptions.Add(new QuestionBankItemOption
            {
                QuestionBankItemId = id,
                Order = option.Order,
                Value = option.Value,
                LabelEn = isSpanish ? null : option.Label,
                LabelEs = isSpanish ? option.Label : null,
            });
        }

        foreach (var tag in (tags ?? []).Select(t => t?.Trim()).Where(t => !string.IsNullOrWhiteSpace(t))
                     .Distinct(StringComparer.OrdinalIgnoreCase))
        {
            db.QuestionBankItemTags.Add(new QuestionBankItemTag { QuestionBankItemId = id, Tag = tag! });
        }
    }

    /// <summary>
    /// Trims, drops blanks, derives a stable value where the caller gave none, and refuses
    /// the two shapes that make a stored answer meaningless.
    /// </summary>
    /// <remarks>
    /// The value is what an answer is STORED as, never a display string — two respondents
    /// picking the same option in different locales must store the same string, which is the
    /// whole reason options are rows with a value rather than a text array (#195).
    /// </remarks>
    private static (List<QuestionBankOptionDto> Options, string? Error) NormaliseOptions(
        IReadOnlyList<QuestionBankOptionInput>? inputs, string type)
    {
        var result = new List<QuestionBankOptionDto>();
        var order = 0;
        foreach (var input in inputs ?? [])
        {
            var label = input?.Label?.Trim();
            var value = input?.Value?.Trim();
            if (string.IsNullOrWhiteSpace(value)) value = label;
            if (string.IsNullOrWhiteSpace(value)) continue;
            result.Add(new QuestionBankOptionDto(order++, value, label));
        }

        if (result.Select(o => o.Value).Distinct(StringComparer.Ordinal).Count() != result.Count)
        {
            return ([], "Option values must be unique within a question");
        }

        // Two, not one, matching the survey write path exactly: an instantiated copy with a
        // single option is not a choice, and the bank must not be able to author a question
        // the survey endpoint would refuse.
        if (type == QuestionTypes.MultipleChoice && result.Count < 2)
        {
            return ([], "multiple_choice questions require at least 2 options");
        }

        return (result, null);
    }

    /// <summary>
    /// The item's single language: explicit if given, otherwise the owning company's own,
    /// otherwise the platform fallback for a global row that has no company to inherit from.
    /// </summary>
    private static async Task<string> ResolveLanguageAsync(
        ClimateProjectDbContext db, string? requested, Guid? companyId, CancellationToken cancellationToken)
    {
        var normalised = ContentLanguages.NormaliseLocale(requested);
        if (normalised is not null) return normalised;

        if (companyId is null) return ContentLanguages.FallbackLocale;

        var companyLanguage = await db.Companies
            .Where(c => c.Id == companyId.Value)
            .Select(c => c.Settings.Language)
            .FirstOrDefaultAsync(cancellationToken);

        // A company authored in 'both' still gives a bank item one language: the fallback.
        // The alternative would be storing the same string in both columns and calling the
        // second one a translation.
        return ContentLanguages.NormaliseLocale(companyLanguage) ?? ContentLanguages.FallbackLocale;
    }

    private static void SetText(QuestionBankItem item, string language, string text)
    {
        if (language == ContentLanguages.Spanish)
        {
            item.TextEs = text;
            item.TextEn = null;
        }
        else
        {
            item.TextEn = text;
            item.TextEs = null;
        }
    }

    private static void SetScaleLabels(QuestionBankItem item, string language, string? min, string? max)
    {
        if (language == ContentLanguages.Spanish)
        {
            item.ScaleLabelMinEs = min;
            item.ScaleLabelMaxEs = max;
            item.ScaleLabelMinEn = null;
            item.ScaleLabelMaxEn = null;
        }
        else
        {
            item.ScaleLabelMinEn = min;
            item.ScaleLabelMaxEn = max;
            item.ScaleLabelMinEs = null;
            item.ScaleLabelMaxEs = null;
        }
    }

    private static string? TextOf(QuestionBankItem item)
        => item.Language == ContentLanguages.Spanish ? item.TextEs : item.TextEn;

    // ------------------------------------------------------------------
    // Shared read plumbing
    // ------------------------------------------------------------------

    private static async Task<List<QuestionBankListItem>> ProjectListAsync(
        ClimateProjectDbContext db, IQueryable<QuestionBankItem> query, CancellationToken cancellationToken)
        => await query
            .Select(i => new QuestionBankListItem(
                i.Id,
                i.CompanyId,
                i.Language == ContentLanguages.Spanish ? i.TextEs : i.TextEn,
                i.Language,
                i.Type,
                i.Category,
                i.Subcategory,
                i.Industry,
                i.CompanySize,
                i.UsageCount,
                i.ResponseRate,
                i.InsightScore,
                i.LastUsedAt,
                i.IsActive,
                i.IsAiGenerated,
                i.Version,
                i.ParentQuestionBankItemId,
                db.QuestionBankItemTags.Where(t => t.QuestionBankItemId == i.Id)
                    .OrderBy(t => t.Tag).Select(t => t.Tag).ToList()))
            .ToListAsync(cancellationToken);

    private static async Task<List<QuestionBankEffectivenessItem>> ProjectEffectivenessAsync(
        ClimateProjectDbContext db, IQueryable<QuestionBankItem> query, CancellationToken cancellationToken)
    {
        var rows = await query
            .Select(i => new { i.Id, i.TextEn, i.TextEs, i.Language, i.Category, i.Subcategory, i.IsActive })
            .ToListAsync(cancellationToken);

        var metrics = await QuestionBankMetrics.ComputeAsync(db, rows.Select(r => r.Id).ToList(), cancellationToken);

        return rows
            .Select(r => new QuestionBankEffectivenessItem(
                r.Id,
                r.Language == ContentLanguages.Spanish ? r.TextEs : r.TextEn,
                r.Language,
                r.Category,
                r.Subcategory,
                r.IsActive,
                metrics[r.Id]))
            .ToList();
    }

    private static async Task<QuestionBankItemDetail> LoadDetailAsync(
        ClimateProjectDbContext db, Guid id, CancellationToken cancellationToken)
    {
        var i = await db.QuestionBankItems.AsNoTracking().FirstAsync(x => x.Id == id, cancellationToken);
        var isSpanish = i.Language == ContentLanguages.Spanish;

        var options = await db.QuestionBankItemOptions.Where(o => o.QuestionBankItemId == id)
            .OrderBy(o => o.Order)
            .Select(o => new QuestionBankOptionDto(o.Order, o.Value, isSpanish ? o.LabelEs : o.LabelEn))
            .ToListAsync(cancellationToken);
        var tags = await db.QuestionBankItemTags.Where(t => t.QuestionBankItemId == id)
            .OrderBy(t => t.Tag).Select(t => t.Tag).ToListAsync(cancellationToken);
        var variationCount = await db.QuestionBankItems.CountAsync(v => v.ParentQuestionBankItemId == id, cancellationToken);

        return new QuestionBankItemDetail(
            i.Id,
            i.CompanyId,
            isSpanish ? i.TextEs : i.TextEn,
            i.Language,
            i.Type,
            i.Category,
            i.Subcategory,
            i.ScaleMin,
            i.ScaleMax,
            isSpanish ? i.ScaleLabelMinEs : i.ScaleLabelMinEn,
            isSpanish ? i.ScaleLabelMaxEs : i.ScaleLabelMaxEn,
            i.Industry,
            i.CompanySize,
            i.UsageCount,
            i.ResponseRate,
            i.InsightScore,
            i.LastUsedAt,
            i.IsActive,
            i.IsAiGenerated,
            i.Version,
            i.ParentQuestionBankItemId,
            variationCount,
            i.CreatedAt,
            i.UpdatedAt,
            tags,
            options);
    }

    // ------------------------------------------------------------------
    // Responses
    // ------------------------------------------------------------------

    private static IResult NotFound() => Results.Json(new { message = "Question bank item not found" }, statusCode: 404);

    private static IResult BadRequest(string message) => Results.Json(new { message }, statusCode: 400);

    /// <summary>
    /// Deviates from <c>BenchmarkEndpoints.ResolveCurrentUserIdAsync</c>, which falls back to
    /// <c>Guid.Empty</c>. <c>question_bank_items.created_by</c> is a Restrict foreign key to
    /// <c>users</c>, so the all-zeroes id is not a neutral default — it is a row the database
    /// will refuse, turning an unresolvable caller into a 500 instead of an answer.
    /// </summary>
    private static IResult ActingUserRequired()
        => Results.Json(new { message = "The acting user could not be resolved from the token" }, statusCode: 403);

}
