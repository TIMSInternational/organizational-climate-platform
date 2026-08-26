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

    /// <summary>
    /// The tenant whose SURVEYS the caller may be told about, which is a different question
    /// from which bank rows they may read.
    /// </summary>
    /// <remarks>
    /// A global row is readable by every tenant, so scoping only the item leaves the usage of
    /// that item unscoped — and its usage is another tenant's surveys, their titles and the
    /// count of the responses they collected. Every derived number on this surface is
    /// therefore computed inside one tenant's surveys; only a SuperAdmin, who may read every
    /// tenant already, gets the cross-tenant total.
    /// </remarks>
    private static Guid? MetricsScope(CurrentUser currentUser)
        => currentUser.Role == Roles.SuperAdmin ? null : Guid.Parse(currentUser.CompanyId);

    /// <summary>
    /// True when a non-SuperAdmin named a <c>companyId</c> that is not their own.
    /// </summary>
    /// <remarks>
    /// Refused rather than ignored. Silently answering a filter for somebody else's tenant
    /// with the caller's OWN rows is worse than either a 403 or an empty set: the caller reads
    /// the response as another company's corpus, and every count on the page is then attributed
    /// to the wrong tenant.
    /// </remarks>
    private static bool ForeignCompanyFilter(CurrentUser currentUser, Guid? companyId)
        => companyId.HasValue
           && currentUser.Role != Roles.SuperAdmin
           && !string.Equals(currentUser.CompanyId, companyId.Value.ToString(), StringComparison.OrdinalIgnoreCase);

    /// <summary>Everything the caller may READ, optionally narrowed to one tenant.</summary>
    /// <remarks>
    /// For a CompanyAdmin the default scope is "mine plus the global corpus"; naming their own
    /// <c>companyId</c> narrows it to "mine only", which is the only other set they can mean.
    /// Any other <c>companyId</c> never reaches here — <see cref="ForeignCompanyFilter"/>
    /// refuses it at the route.
    /// </remarks>
    private static IQueryable<QuestionBankItem> ReadableScope(
        ClimateProjectDbContext db, CurrentUser currentUser, Guid? companyId)
    {
        var query = db.QuestionBankItems.AsQueryable();
        if (currentUser.Role != Roles.SuperAdmin)
        {
            var own = Guid.Parse(currentUser.CompanyId);
            return companyId.HasValue
                ? query.Where(i => i.CompanyId == own)
                : query.Where(i => i.CompanyId == null || i.CompanyId == own);
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
        if (ForeignCompanyFilter(currentUser, companyId)) return Results.Forbid();

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

        var items = await ProjectListAsync(
            db, query.OrderBy(i => i.Category).ThenBy(i => i.Subcategory), MetricsScope(currentUser), cancellationToken);
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

        var unknownCompany = await UnknownCompanyAsync(db, [request.CompanyId], cancellationToken);
        if (unknownCompany is not null) return unknownCompany;

        var actingUserId = await ActingUserResolver.ResolveIdAsync(currentUser, db, cancellationToken);
        if (actingUserId is null) return ActingUserRequired();

        var (prepared, error) = await PrepareAsync(db, request, parent: null, cancellationToken);
        if (error is not null) return BadRequest(error);

        var id = Write(db, prepared!, actingUserId.Value, parentId: null);
        await db.SaveChangesAsync(cancellationToken);

        return Results.Json(await LoadDetailAsync(db, id, MetricsScope(currentUser), cancellationToken), statusCode: 201);
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

        return Results.Ok(await LoadDetailAsync(db, id, MetricsScope(currentUser), cancellationToken));
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

        var lengthError = LengthError(
            text,
            category,
            request.Subcategory?.Trim(),
            request.Industry?.Trim(),
            request.CompanySize?.Trim(),
            request.ScaleLabelMin?.Trim(),
            request.ScaleLabelMax?.Trim(),
            request.Tags,
            options);
        if (lengthError is not null) return BadRequest(lengthError);

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
        //
        // TWO SaveChanges, so ONE transaction. The delete and the insert cannot share a
        // SaveChanges -- the option key is (item, order), so re-adding order 0 while order 0
        // is still tracked as deleted is a tracking conflict -- and without the transaction
        // the delete COMMITS on its own. Any failure of the second save then leaves the item
        // stripped of the options and tags it had: an update that was refused, and destroyed
        // the row's children on its way out. A multiple_choice item with zero options is a
        // state NormaliseOptions refuses to create, and it was reachable by failing an update.
        await using var transaction = await db.Database.BeginTransactionAsync(cancellationToken);

        db.QuestionBankItemOptions.RemoveRange(db.QuestionBankItemOptions.Where(o => o.QuestionBankItemId == id));
        db.QuestionBankItemTags.RemoveRange(db.QuestionBankItemTags.Where(t => t.QuestionBankItemId == id));
        await db.SaveChangesAsync(cancellationToken);

        WriteChildren(db, id, options, request.Tags, item.Language);
        await db.SaveChangesAsync(cancellationToken);

        await transaction.CommitAsync(cancellationToken);

        return Results.Ok(await LoadDetailAsync(db, id, MetricsScope(currentUser), cancellationToken));
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

        var metrics = await QuestionBankMetrics.ComputeAsync(db, [id], MetricsScope(currentUser), cancellationToken);
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
            MetricsScope(currentUser),
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

        return Results.Json(
            await LoadDetailAsync(db, newId, MetricsScope(currentUser), cancellationToken), statusCode: 201);
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
        if (ForeignCompanyFilter(currentUser, companyId)) return Results.Forbid();

        var categories = await CategoryCountsAsync(ReadableScope(db, currentUser, companyId), cancellationToken);
        return Results.Ok(new QuestionBankCategoriesResponse(categories));
    }

    /// <remarks>
    /// Grouped and counted in SQL; ordered in memory. Sorting a projection whose elements are
    /// a record rather than an anonymous type is not something the provider can translate, and
    /// the row count here is the number of distinct (category, subcategory) pairs in one
    /// tenant's corpus -- tens, not a page that has to be ordered server-side.
    /// </remarks>
    private static async Task<List<QuestionBankCategoryCount>> CategoryCountsAsync(
        IQueryable<QuestionBankItem> scope, CancellationToken cancellationToken)
    {
        var rows = await scope
            .GroupBy(i => new { i.Category, i.Subcategory })
            .Select(g => new
            {
                g.Key.Category,
                g.Key.Subcategory,
                Total = g.Count(),
                Active = g.Sum(i => i.IsActive ? 1 : 0),
            })
            .ToListAsync(cancellationToken);

        return rows
            .OrderBy(r => r.Category, StringComparer.Ordinal)
            .ThenBy(r => r.Subcategory, StringComparer.Ordinal)
            .Select(r => new QuestionBankCategoryCount(r.Category, r.Subcategory, r.Total, r.Active))
            .ToList();
    }

    // ------------------------------------------------------------------
    // question-bank/analytics
    // ------------------------------------------------------------------

    private static async Task<IResult> AnalyticsAsync(
        Guid? companyId, ClaimsPrincipal principal, ClimateProjectDbContext db, CancellationToken cancellationToken)
    {
        var currentUser = principal.GetCurrentUser();
        if (!Roles.Admin.Contains(currentUser.Role)) return Results.Forbid();
        if (ForeignCompanyFilter(currentUser, companyId)) return Results.Forbid();

        var scope = ReadableScope(db, currentUser, companyId);

        // Four counts rather than one grouped projection: a GroupBy(_ => 1) over the whole
        // corpus is a scan either way, and this form is translatable without depending on the
        // provider's support for a conditional aggregate.
        var total = await scope.CountAsync(cancellationToken);
        var active = await scope.CountAsync(i => i.IsActive, cancellationToken);
        var global = await scope.CountAsync(i => i.CompanyId == null, cancellationToken);
        var aiGenerated = await scope.CountAsync(i => i.IsAiGenerated, cancellationToken);

        var typeRows = await scope
            .GroupBy(i => i.Type)
            .Select(g => new { Type = g.Key, Count = g.Count() })
            .ToListAsync(cancellationToken);
        var byType = typeRows
            .OrderByDescending(t => t.Count).ThenBy(t => t.Type, StringComparer.Ordinal)
            .Select(t => new QuestionBankTypeCount(t.Type, t.Count))
            .ToList();

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
        var metrics = await QuestionBankMetrics.ComputeAsync(db, scopedIds, MetricsScope(currentUser), cancellationToken);
        var used = metrics.Values.Where(m => m.TimesAsked > 0).ToList();

        return Results.Ok(new QuestionBankAnalyticsResponse(
            TotalItems: total,
            ActiveItems: active,
            RetiredItems: total - active,
            GlobalItems: global,
            AiGeneratedItems: aiGenerated,
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
        if (ForeignCompanyFilter(currentUser, companyId)) return Results.Forbid();

        var scope = ReadableScope(db, currentUser, companyId);
        if (includeRetired != true) scope = scope.Where(i => i.IsActive);
        if (!string.IsNullOrWhiteSpace(category)) scope = scope.Where(i => i.Category == category);

        var items = await ProjectEffectivenessAsync(db, scope, MetricsScope(currentUser), cancellationToken);
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
        if (ForeignCompanyFilter(currentUser, request?.CompanyId)) return Results.Forbid();

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
        var metrics = await QuestionBankMetrics.ComputeAsync(
            db, items.Select(i => i.Id).ToList(), MetricsScope(currentUser), cancellationToken);

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
        if (ForeignCompanyFilter(currentUser, companyId)) return Results.Forbid();

        var scope = ReadableScope(db, currentUser, companyId);
        if (itemId.HasValue) scope = scope.Where(i => i.Id == itemId.Value);

        var items = await scope
            .OrderBy(i => i.Category)
            .Select(i => new { i.Id, i.TextEn, i.TextEs, i.Language, i.IsActive })
            .ToListAsync(cancellationToken);

        if (items.Count == 0) return Results.Ok(new QuestionBankUsageResponse([]));

        var ids = items.Select(i => i.Id).ToList();
        var metricsScope = MetricsScope(currentUser);

        // The tenant predicate goes on the SURVEY, and it is the whole difference between
        // this route and a cross-tenant disclosure. Scoping only the bank item is not enough:
        // a global item is readable by every tenant on purpose, so without this a caller asks
        // "where is this global question used" and is answered with another company's survey
        // titles, statuses and dates -- for every global item at once when no itemId is given.
        var usages = await db.Questions
            .Where(q => q.SourceQuestionBankItemId != null && ids.Contains(q.SourceQuestionBankItemId.Value))
            .Join(db.Surveys, q => q.SurveyId, s => s.Id, (q, s) => new { Question = q, Survey = s })
            .Where(x => metricsScope == null || x.Survey.CompanyId == metricsScope)
            .Select(x => new
            {
                ItemId = x.Question.SourceQuestionBankItemId!.Value,
                QuestionId = x.Question.Id,
                SurveyId = x.Survey.Id,
                Title = x.Survey.TitleEn ?? x.Survey.TitleEs,
                x.Survey.Status,
                x.Survey.CreatedAt,
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

        var unknownCompany = await UnknownCompanyAsync(db, rows.Select(r => r?.CompanyId), cancellationToken);
        if (unknownCompany is not null) return unknownCompany;

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
        var seenInBatch = new HashSet<string>(StringComparer.Ordinal);

        foreach (var (index, item) in prepared)
        {
            if (deduplicate)
            {
                // The two halves of the duplicate check have to agree about case, or the same
                // file behaves differently depending on how it is split: "Trust" and "trust"
                // in ONE file collapsed to a single row while the same two texts imported in
                // separate runs both landed. The text is compared case-insensitively in both
                // halves -- it is a sentence a human typed -- and the scope keys (company,
                // type, category) case-sensitively in both, matching how they are stored and
                // how every filter on this surface matches them.
                var lowered = item.Text.ToLowerInvariant();
                var key = $"{item.CompanyId}|{item.Type}|{item.Category}|{lowered}";
                var alreadyStored = await db.QuestionBankItems.AnyAsync(
                    i => i.CompanyId == item.CompanyId
                         && i.Type == item.Type
                         && i.Category == item.Category
                         && ((i.TextEn != null && i.TextEn.ToLower() == lowered)
                             || (i.TextEs != null && i.TextEs.ToLower() == lowered)),
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
            db,
            db.QuestionBankItems.Where(i => written.Contains(i.Id)).OrderBy(i => i.Category),
            MetricsScope(currentUser),
            cancellationToken);

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

        var lengthError = LengthError(
            text,
            category,
            request.Subcategory?.Trim(),
            request.Industry?.Trim(),
            request.CompanySize?.Trim(),
            request.ScaleLabelMin?.Trim(),
            request.ScaleLabelMax?.Trim(),
            request.Tags,
            options);
        if (lengthError is not null) return (null, lengthError);

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
    /// The column widths, checked before the insert rather than discovered by it.
    /// </summary>
    /// <remarks>
    /// <para>
    /// Every string below lands in a <c>varchar</c>, so without this a caller who pastes a
    /// paragraph into a 500-character column gets a 500 with an opaque message. That is bad
    /// on a create and destructive on an update: the option and tag rows are deleted before
    /// the replacements are written, so the failure used to leave the item with neither.
    /// </para>
    /// <para>
    /// The numbers are the configurations' own (<c>QuestionBankItemConfiguration</c>,
    /// <c>...TagConfiguration</c>, <c>...OptionConfiguration</c>) and must move with them.
    /// Type is absent on purpose — it is already validated against
    /// <see cref="QuestionTypes.ForSurvey"/>, whose longest member is far inside its column.
    /// </para>
    /// </remarks>
    private static string? LengthError(
        string text,
        string category,
        string? subcategory,
        string? industry,
        string? companySize,
        string? scaleLabelMin,
        string? scaleLabelMax,
        IReadOnlyList<string>? tags,
        IReadOnlyList<QuestionBankOptionDto> options)
    {
        (string Field, string? Value, int Max)[] fields =
        [
            ("Text", text, 500),
            ("Category", category, 100),
            ("Subcategory", subcategory, 100),
            ("Industry", industry, 100),
            ("CompanySize", companySize, 50),
            ("ScaleLabelMin", scaleLabelMin, 200),
            ("ScaleLabelMax", scaleLabelMax, 200),
        ];

        foreach (var (field, value, max) in fields)
        {
            if (value is not null && value.Length > max)
            {
                return $"{field} must be at most {max} characters";
            }
        }

        foreach (var tag in tags ?? [])
        {
            if (tag?.Trim().Length > 50) return "Each tag must be at most 50 characters";
        }

        foreach (var option in options)
        {
            if (option.Value.Length > 500) return "Each option value must be at most 500 characters";
            if (option.Label?.Length > 500) return "Each option label must be at most 500 characters";
        }

        return null;
    }

    /// <summary>
    /// Refuses a <c>CompanyId</c> that names no company, with a 400 instead of the 500 the
    /// foreign key would produce.
    /// </summary>
    /// <remarks>
    /// The same reason <c>SurveyEndpoints</c> pre-loads the company on its own create path:
    /// an unknown CompanyId would otherwise surface as an opaque 500 from the foreign key
    /// instead of a message naming the id. One query for the whole batch, and it runs after
    /// the authorization loop so an unauthorised caller learns nothing about which company
    /// ids exist.
    /// </remarks>
    private static async Task<IResult?> UnknownCompanyAsync(
        ClimateProjectDbContext db, IEnumerable<Guid?> companyIds, CancellationToken cancellationToken)
    {
        var ids = companyIds.Where(c => c.HasValue).Select(c => c!.Value).Distinct().ToList();
        if (ids.Count == 0) return null;

        var known = await db.Companies.Where(c => ids.Contains(c.Id)).Select(c => c.Id).ToListAsync(cancellationToken);
        var unknown = ids.Except(known).ToList();

        return unknown.Count == 0
            ? null
            : BadRequest($"CompanyId does not name a company: {string.Join(", ", unknown)}");
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

    /// <summary>
    /// The list shape, with <c>UsageCount</c>, <c>ResponseRate</c> and <c>LastUsedAt</c>
    /// DERIVED rather than read from the row.
    /// </summary>
    /// <remarks>
    /// <para>
    /// This is the route the admin <c>/question-bank</c> page is built on, and it used to
    /// project the stored snapshot columns — so the one surface that claimed never to serve a
    /// stale number served it on its main list and its detail, reporting zero for a question
    /// three people had just answered while <c>/{id}/metrics</c> reported three. The stored
    /// columns keep their job (a published snapshot for consumers reading the table directly)
    /// and no read route reports them.
    /// </para>
    /// <para>
    /// <c>InsightScore</c> is the exception and stays the stored value: nothing derives it
    /// yet. It is the AI-scored number #111 will produce, so there is no COUNT to replace it
    /// with, and reporting a zero it does not have would be its own lie.
    /// </para>
    /// </remarks>
    private static async Task<List<QuestionBankListItem>> ProjectListAsync(
        ClimateProjectDbContext db,
        IQueryable<QuestionBankItem> query,
        Guid? metricsScope,
        CancellationToken cancellationToken)
    {
        var rows = await query
            .Select(i => new
            {
                i.Id,
                i.CompanyId,
                Text = i.Language == ContentLanguages.Spanish ? i.TextEs : i.TextEn,
                i.Language,
                i.Type,
                i.Category,
                i.Subcategory,
                i.Industry,
                i.CompanySize,
                i.InsightScore,
                i.IsActive,
                i.IsAiGenerated,
                i.Version,
                i.ParentQuestionBankItemId,
                Tags = db.QuestionBankItemTags.Where(t => t.QuestionBankItemId == i.Id)
                    .OrderBy(t => t.Tag).Select(t => t.Tag).ToList(),
            })
            .ToListAsync(cancellationToken);

        var metrics = await QuestionBankMetrics.ComputeAsync(
            db, rows.Select(r => r.Id).ToList(), metricsScope, cancellationToken);

        return rows
            .Select(r => new QuestionBankListItem(
                r.Id,
                r.CompanyId,
                r.Text,
                r.Language,
                r.Type,
                r.Category,
                r.Subcategory,
                r.Industry,
                r.CompanySize,
                metrics[r.Id].QuestionsCreated,
                metrics[r.Id].ResponseRate,
                r.InsightScore,
                metrics[r.Id].LastUsedAt,
                r.IsActive,
                r.IsAiGenerated,
                r.Version,
                r.ParentQuestionBankItemId,
                r.Tags))
            .ToList();
    }

    private static async Task<List<QuestionBankEffectivenessItem>> ProjectEffectivenessAsync(
        ClimateProjectDbContext db,
        IQueryable<QuestionBankItem> query,
        Guid? metricsScope,
        CancellationToken cancellationToken)
    {
        var rows = await query
            .Select(i => new { i.Id, i.TextEn, i.TextEs, i.Language, i.Category, i.Subcategory, i.IsActive })
            .ToListAsync(cancellationToken);

        var metrics = await QuestionBankMetrics.ComputeAsync(
            db, rows.Select(r => r.Id).ToList(), metricsScope, cancellationToken);

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

    /// <summary>
    /// The detail shape. Derived numbers for the same reason <see cref="ProjectListAsync"/>
    /// serves them: these two routes are the admin page.
    /// </summary>
    private static async Task<QuestionBankItemDetail> LoadDetailAsync(
        ClimateProjectDbContext db, Guid id, Guid? metricsScope, CancellationToken cancellationToken)
    {
        var i = await db.QuestionBankItems.AsNoTracking().FirstAsync(x => x.Id == id, cancellationToken);
        var isSpanish = i.Language == ContentLanguages.Spanish;
        var metrics = (await QuestionBankMetrics.ComputeAsync(db, [id], metricsScope, cancellationToken))[id];

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
            metrics.QuestionsCreated,
            metrics.ResponseRate,
            i.InsightScore,
            metrics.LastUsedAt,
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
