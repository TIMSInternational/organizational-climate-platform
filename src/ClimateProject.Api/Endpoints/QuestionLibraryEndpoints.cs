using System.Security.Claims;
using ClimateProject.Api.Infrastructure;
using ClimateProject.Application.Auth;
using ClimateProject.Application.Questions;
using ClimateProject.Domain.Entities;
using ClimateProject.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace ClimateProject.Api.Endpoints;

/// <summary>
/// The question LIBRARY and its category hierarchy (#112, under #58) — the authoring repository the
/// picker reads in both the survey and microclimate wizards.
/// </summary>
/// <remarks>
/// <para>
/// <strong>Deliberately separate from the question bank</strong> (#110). #58 states it outright:
/// "They do not overlap in purpose and must not be merged." This is the authoring surface — a real
/// category hierarchy, a dimension, version chaining. The bank is the curation surface: cross-corpus
/// metrics, industry targeting, a flat string category.
/// </para>
/// <para>
/// <strong>Global rows.</strong> A row with <c>CompanyId == null</c> is visible to every tenant, so
/// it is SuperAdmin-only to write — read access and write access are separate checks, the same split
/// <c>BenchmarkEndpoints</c> enforces and for the same reason: letting one tenant edit a row every
/// other tenant sees is a cross-tenant write wearing a read's clothing.
/// </para>
/// <para>
/// <strong>Instantiation is not here.</strong> Picking an item into a survey copies it into
/// <c>questions</c> (or <c>microclimate_questions</c>) and records the source id; the wizards already
/// own question authoring, and a second write path into the same tables would be two ways to build a
/// survey question that could disagree. This API's job ends at making an item readable.
/// </para>
/// </remarks>
public static class QuestionLibraryEndpoints
{
    public static void MapQuestionLibraryEndpoints(this WebApplication app)
    {
        var categories = app.MapGroup("/admin/question-categories").RequireAuthorization();
        categories.MapGet("", ListCategoriesAsync);
        categories.MapPost("", CreateCategoryAsync);
        categories.MapPut("/{id:guid}", UpdateCategoryAsync);

        var library = app.MapGroup("/admin/question-library").RequireAuthorization();
        library.MapGet("", ListItemsAsync);
        library.MapPost("", CreateItemAsync);
        library.MapGet("/{id:guid}", GetItemAsync);
        library.MapPut("/{id:guid}", UpdateItemAsync);
    }

    /// <summary>A global row is readable by any admin; a company row only by its own tenant.</summary>
    private static bool CanRead(CurrentUser currentUser, Guid? rowCompanyId)
    {
        if (currentUser.Role == Roles.SuperAdmin) return true;
        if (currentUser.Role != Roles.CompanyAdmin) return false;
        return rowCompanyId is null || currentUser.CompanyId == rowCompanyId.Value.ToString();
    }

    /// <summary>
    /// Writing a global row is SuperAdmin-only. A CompanyAdmin may only write rows owned by their own
    /// company — note the <c>is not null</c>, which is the whole difference from <see cref="CanRead"/>.
    /// </summary>
    private static bool CanWrite(CurrentUser currentUser, Guid? rowCompanyId)
    {
        if (currentUser.Role == Roles.SuperAdmin) return true;
        if (currentUser.Role != Roles.CompanyAdmin) return false;
        return rowCompanyId is not null && currentUser.CompanyId == rowCompanyId.Value.ToString();
    }

    private static async Task<IResult> ListCategoriesAsync(
        Guid? companyId, ClaimsPrincipal principal, ClimateProjectDbContext db, CancellationToken cancellationToken)
    {
        var currentUser = principal.GetCurrentUser();
        if (!Roles.Admin.Contains(currentUser.Role)) return Results.Forbid();

        var query = db.QuestionCategories.AsQueryable();
        if (currentUser.Role != Roles.SuperAdmin)
        {
            var own = Guid.Parse(currentUser.CompanyId);
            query = query.Where(c => c.CompanyId == null || c.CompanyId == own);
        }
        else if (companyId.HasValue)
        {
            query = query.Where(c => c.CompanyId == companyId.Value);
        }

        // Counted rather than stored. The legacy model kept question_count and subcategory_count as
        // denormalised columns maintained by an updateCounts() method; a COUNT is correct by
        // construction and cannot go stale.
        var categories = await query
            .OrderBy(c => c.Order).ThenBy(c => c.NameEn)
            .Select(c => new QuestionCategoryListItem(
                c.Id, c.CompanyId, c.ParentCategoryId, c.NameEn, c.NameEs,
                c.DescriptionEn, c.DescriptionEs, c.Order, c.Icon, c.Color, c.IsActive,
                db.QuestionLibraryItems.Count(i => i.QuestionCategoryId == c.Id)))
            .ToListAsync(cancellationToken);

        return Results.Ok(new QuestionCategoryListResponse(categories));
    }

    private static async Task<IResult> CreateCategoryAsync(
        CreateQuestionCategoryRequest request, ClaimsPrincipal principal, ClimateProjectDbContext db, CancellationToken cancellationToken)
    {
        var currentUser = principal.GetCurrentUser();
        if (!CanWrite(currentUser, request.CompanyId)) return Results.Forbid();

        var nameEn = request.NameEn?.Trim();
        var nameEs = request.NameEs?.Trim();
        // Both languages are required, unlike the bank: the legacy category model required both and
        // a half-translated tree is a tree that renders blank for one audience.
        if (string.IsNullOrWhiteSpace(nameEn) || string.IsNullOrWhiteSpace(nameEs))
        {
            return Results.Json(new { message = "NameEn and NameEs are both required" }, statusCode: 400);
        }

        if (request.ParentCategoryId.HasValue)
        {
            var parent = await db.QuestionCategories
                .FirstOrDefaultAsync(c => c.Id == request.ParentCategoryId.Value, cancellationToken);
            if (parent is null)
            {
                return Results.Json(new { message = "ParentCategoryId does not reference an existing category" }, statusCode: 400);
            }
            // A company category may hang under a global one, but not under another tenant's.
            if (!CanRead(currentUser, parent.CompanyId))
            {
                return Results.Json(new { message = "ParentCategoryId does not reference an existing category" }, statusCode: 400);
            }
        }

        var now = DateTimeOffset.UtcNow;
        var category = new QuestionCategory
        {
            Id = Guid.NewGuid(),
            CompanyId = request.CompanyId,
            ParentCategoryId = request.ParentCategoryId,
            NameEn = nameEn,
            NameEs = nameEs,
            DescriptionEn = request.DescriptionEn?.Trim(),
            DescriptionEs = request.DescriptionEs?.Trim(),
            Order = request.Order ?? 0,
            Icon = request.Icon?.Trim(),
            Color = request.Color?.Trim(),
            IsActive = true,
            CreatedBy = await ActingUserResolver.ResolveIdAsync(currentUser, db, cancellationToken) ?? Guid.Empty,
            CreatedAt = now,
            UpdatedAt = now,
        };
        db.QuestionCategories.Add(category);
        await db.SaveChangesAsync(cancellationToken);

        return Results.Ok(await LoadCategoryAsync(db, category.Id, cancellationToken));
    }

    private static async Task<IResult> UpdateCategoryAsync(
        Guid id, UpdateQuestionCategoryRequest request, ClaimsPrincipal principal, ClimateProjectDbContext db, CancellationToken cancellationToken)
    {
        var currentUser = principal.GetCurrentUser();
        var category = await db.QuestionCategories.FirstOrDefaultAsync(c => c.Id == id, cancellationToken);
        if (category is null) return Results.NotFound();
        if (!CanWrite(currentUser, category.CompanyId)) return Results.Forbid();

        var nameEn = request.NameEn?.Trim();
        var nameEs = request.NameEs?.Trim();
        if (string.IsNullOrWhiteSpace(nameEn) || string.IsNullOrWhiteSpace(nameEs))
        {
            return Results.Json(new { message = "NameEn and NameEs are both required" }, statusCode: 400);
        }

        if (request.ParentCategoryId == id)
        {
            return Results.Json(new { message = "A category cannot be its own parent" }, statusCode: 400);
        }

        if (request.ParentCategoryId.HasValue)
        {
            var parent = await db.QuestionCategories
                .FirstOrDefaultAsync(c => c.Id == request.ParentCategoryId.Value, cancellationToken);
            if (parent is null || !CanRead(currentUser, parent.CompanyId))
            {
                return Results.Json(new { message = "ParentCategoryId does not reference an existing category" }, statusCode: 400);
            }

            // Walk to the root and refuse a cycle. Without this, a category reparented under its own
            // descendant disappears from every tree render -- the rows survive but nothing can reach
            // them, and the FK cannot catch it because each individual edge is valid.
            var cursor = parent.ParentCategoryId;
            var guard = 0;
            while (cursor.HasValue && guard++ < 64)
            {
                if (cursor.Value == id)
                {
                    return Results.Json(new { message = "That parent would create a cycle" }, statusCode: 400);
                }
                cursor = await db.QuestionCategories.Where(c => c.Id == cursor.Value)
                    .Select(c => c.ParentCategoryId).FirstOrDefaultAsync(cancellationToken);
            }
        }

        category.NameEn = nameEn;
        category.NameEs = nameEs;
        category.DescriptionEn = request.DescriptionEn?.Trim();
        category.DescriptionEs = request.DescriptionEs?.Trim();
        category.ParentCategoryId = request.ParentCategoryId;
        if (request.Order.HasValue) category.Order = request.Order.Value;
        category.Icon = request.Icon?.Trim();
        category.Color = request.Color?.Trim();
        if (request.IsActive.HasValue) category.IsActive = request.IsActive.Value;
        category.UpdatedAt = DateTimeOffset.UtcNow;
        await db.SaveChangesAsync(cancellationToken);

        return Results.Ok(await LoadCategoryAsync(db, id, cancellationToken));
    }

    private static async Task<QuestionCategoryListItem> LoadCategoryAsync(ClimateProjectDbContext db, Guid id, CancellationToken cancellationToken)
        => await db.QuestionCategories.Where(c => c.Id == id)
            .Select(c => new QuestionCategoryListItem(
                c.Id, c.CompanyId, c.ParentCategoryId, c.NameEn, c.NameEs,
                c.DescriptionEn, c.DescriptionEs, c.Order, c.Icon, c.Color, c.IsActive,
                db.QuestionLibraryItems.Count(i => i.QuestionCategoryId == c.Id)))
            .FirstAsync(cancellationToken);

    private static async Task<IResult> ListItemsAsync(
        Guid? categoryId, string? type, string? dimension, string? tag, Guid? companyId,
        ClaimsPrincipal principal, ClimateProjectDbContext db, CancellationToken cancellationToken)
    {
        var currentUser = principal.GetCurrentUser();
        if (!Roles.Admin.Contains(currentUser.Role)) return Results.Forbid();

        var query = db.QuestionLibraryItems.AsQueryable();
        if (currentUser.Role != Roles.SuperAdmin)
        {
            var own = Guid.Parse(currentUser.CompanyId);
            query = query.Where(i => i.CompanyId == null || i.CompanyId == own);
        }
        else if (companyId.HasValue)
        {
            query = query.Where(i => i.CompanyId == companyId.Value);
        }

        if (categoryId.HasValue) query = query.Where(i => i.QuestionCategoryId == categoryId.Value);
        if (!string.IsNullOrWhiteSpace(type)) query = query.Where(i => i.Type == type);
        if (!string.IsNullOrWhiteSpace(dimension)) query = query.Where(i => i.Dimension == dimension);
        // An indexed join, which is why tags are rows rather than an array column.
        if (!string.IsNullOrWhiteSpace(tag))
        {
            query = query.Where(i => db.QuestionLibraryItemTags.Any(t => t.QuestionLibraryItemId == i.Id && t.Tag == tag));
        }

        var items = await query
            .OrderBy(i => i.TextEn)
            .Select(i => new QuestionLibraryItemListItem(
                i.Id, i.CompanyId, i.QuestionCategoryId, i.TextEn, i.TextEs, i.Type,
                i.Dimension, i.UsageCount, i.LastUsedAt, i.IsActive, i.Version,
                db.QuestionLibraryItemTags.Where(t => t.QuestionLibraryItemId == i.Id)
                    .OrderBy(t => t.Tag).Select(t => t.Tag).ToList()))
            .ToListAsync(cancellationToken);

        return Results.Ok(new QuestionLibraryItemListResponse(items));
    }

    private static async Task<IResult> GetItemAsync(
        Guid id, ClaimsPrincipal principal, ClimateProjectDbContext db, CancellationToken cancellationToken)
    {
        var currentUser = principal.GetCurrentUser();
        var item = await db.QuestionLibraryItems.FirstOrDefaultAsync(i => i.Id == id, cancellationToken);
        if (item is null) return Results.NotFound();
        if (!CanRead(currentUser, item.CompanyId)) return Results.Forbid();

        return Results.Ok(await LoadDetailAsync(db, id, cancellationToken));
    }

    private static async Task<IResult> CreateItemAsync(
        CreateQuestionLibraryItemRequest request, ClaimsPrincipal principal, ClimateProjectDbContext db, CancellationToken cancellationToken)
    {
        var currentUser = principal.GetCurrentUser();
        if (!CanWrite(currentUser, request.CompanyId)) return Results.Forbid();

        var textEn = request.TextEn?.Trim();
        var textEs = request.TextEs?.Trim();
        if (string.IsNullOrWhiteSpace(textEn) || string.IsNullOrWhiteSpace(textEs))
        {
            return Results.Json(new { message = "TextEn and TextEs are both required" }, statusCode: 400);
        }

        if (!QuestionRepositoryTypes.IsSupported(request.Type))
        {
            return Results.Json(
                new { message = $"Type must be one of: {string.Join(", ", QuestionRepositoryTypes.Supported)}" },
                statusCode: 400);
        }

        var category = await db.QuestionCategories.FirstOrDefaultAsync(c => c.Id == request.QuestionCategoryId, cancellationToken);
        if (category is null || !CanRead(currentUser, category.CompanyId))
        {
            return Results.Json(new { message = "QuestionCategoryId does not reference an existing category" }, statusCode: 400);
        }

        var options = NormaliseOptions(request.Options);
        if (QuestionRepositoryTypes.RequiresOptions(request.Type) && options.Count == 0)
        {
            return Results.Json(new { message = $"{request.Type} requires at least one option" }, statusCode: 400);
        }
        if (options.Select(o => o.Value).Distinct(StringComparer.Ordinal).Count() != options.Count)
        {
            return Results.Json(new { message = "Option values must be unique within a question" }, statusCode: 400);
        }

        var now = DateTimeOffset.UtcNow;
        var id = Guid.NewGuid();
        db.QuestionLibraryItems.Add(new QuestionLibraryItem
        {
            Id = id,
            CompanyId = request.CompanyId,
            QuestionCategoryId = request.QuestionCategoryId,
            TextEn = textEn,
            TextEs = textEs,
            Language = "both",
            Type = request.Type,
            ScaleMin = request.ScaleMin,
            ScaleMax = request.ScaleMax,
            ScaleLabelMinEn = request.ScaleLabelMinEn?.Trim(),
            ScaleLabelMinEs = request.ScaleLabelMinEs?.Trim(),
            ScaleLabelMaxEn = request.ScaleLabelMaxEn?.Trim(),
            ScaleLabelMaxEs = request.ScaleLabelMaxEs?.Trim(),
            Dimension = request.Dimension?.Trim(),
            IsActive = true,
            Version = 1,
            CreatedBy = await ActingUserResolver.ResolveIdAsync(currentUser, db, cancellationToken) ?? Guid.Empty,
            CreatedAt = now,
            UpdatedAt = now,
        });
        WriteChildren(db, id, options, request.Tags);
        await db.SaveChangesAsync(cancellationToken);

        return Results.Ok(await LoadDetailAsync(db, id, cancellationToken));
    }

    private static async Task<IResult> UpdateItemAsync(
        Guid id, UpdateQuestionLibraryItemRequest request, ClaimsPrincipal principal, ClimateProjectDbContext db, CancellationToken cancellationToken)
    {
        var currentUser = principal.GetCurrentUser();
        var item = await db.QuestionLibraryItems.FirstOrDefaultAsync(i => i.Id == id, cancellationToken);
        if (item is null) return Results.NotFound();
        if (!CanWrite(currentUser, item.CompanyId)) return Results.Forbid();

        var textEn = request.TextEn?.Trim();
        var textEs = request.TextEs?.Trim();
        if (string.IsNullOrWhiteSpace(textEn) || string.IsNullOrWhiteSpace(textEs))
        {
            return Results.Json(new { message = "TextEn and TextEs are both required" }, statusCode: 400);
        }

        var category = await db.QuestionCategories.FirstOrDefaultAsync(c => c.Id == request.QuestionCategoryId, cancellationToken);
        if (category is null || !CanRead(currentUser, category.CompanyId))
        {
            return Results.Json(new { message = "QuestionCategoryId does not reference an existing category" }, statusCode: 400);
        }

        var options = NormaliseOptions(request.Options);
        if (QuestionRepositoryTypes.RequiresOptions(item.Type) && options.Count == 0)
        {
            return Results.Json(new { message = $"{item.Type} requires at least one option" }, statusCode: 400);
        }
        if (options.Select(o => o.Value).Distinct(StringComparer.Ordinal).Count() != options.Count)
        {
            return Results.Json(new { message = "Option values must be unique within a question" }, statusCode: 400);
        }

        item.QuestionCategoryId = request.QuestionCategoryId;
        item.TextEn = textEn;
        item.TextEs = textEs;
        item.ScaleMin = request.ScaleMin;
        item.ScaleMax = request.ScaleMax;
        item.ScaleLabelMinEn = request.ScaleLabelMinEn?.Trim();
        item.ScaleLabelMinEs = request.ScaleLabelMinEs?.Trim();
        item.ScaleLabelMaxEn = request.ScaleLabelMaxEn?.Trim();
        item.ScaleLabelMaxEs = request.ScaleLabelMaxEs?.Trim();
        item.Dimension = request.Dimension?.Trim();
        if (request.IsActive.HasValue) item.IsActive = request.IsActive.Value;
        item.LastModifiedBy = await ActingUserResolver.ResolveIdAsync(currentUser, db, cancellationToken);
        item.UpdatedAt = DateTimeOffset.UtcNow;

        // Replaced wholesale rather than diffed: the option set is one value, and a partial update
        // would let a caller silently keep an option they had removed from their own payload.
        db.QuestionLibraryItemOptions.RemoveRange(db.QuestionLibraryItemOptions.Where(o => o.QuestionLibraryItemId == id));
        db.QuestionLibraryItemTags.RemoveRange(db.QuestionLibraryItemTags.Where(t => t.QuestionLibraryItemId == id));
        await db.SaveChangesAsync(cancellationToken);

        WriteChildren(db, id, options, request.Tags);
        await db.SaveChangesAsync(cancellationToken);

        return Results.Ok(await LoadDetailAsync(db, id, cancellationToken));
    }

    /// <summary>
    /// Trims, drops blanks, and derives a stable value where the caller supplied none.
    /// </summary>
    /// <remarks>
    /// A missing value falls back to the English label, matching how the survey wizard derives one.
    /// The value is what an answer is stored as, so it must never be a display string chosen per
    /// locale — deriving it from one fixed language is the point.
    /// </remarks>
    private static List<RepositoryOptionDto> NormaliseOptions(IReadOnlyList<RepositoryOptionInput>? inputs)
    {
        if (inputs is null) return [];
        var result = new List<RepositoryOptionDto>();
        var order = 0;
        foreach (var input in inputs)
        {
            var labelEn = input.LabelEn?.Trim();
            var labelEs = input.LabelEs?.Trim();
            var value = input.Value?.Trim();
            if (string.IsNullOrWhiteSpace(value)) value = labelEn;
            if (string.IsNullOrWhiteSpace(value)) continue;
            result.Add(new RepositoryOptionDto(order++, value, labelEn, labelEs));
        }
        return result;
    }

    private static void WriteChildren(ClimateProjectDbContext db, Guid id, List<RepositoryOptionDto> options, IReadOnlyList<string>? tags)
    {
        foreach (var option in options)
        {
            db.QuestionLibraryItemOptions.Add(new QuestionLibraryItemOption
            {
                QuestionLibraryItemId = id,
                Order = option.Order,
                Value = option.Value,
                LabelEn = option.LabelEn,
                LabelEs = option.LabelEs,
            });
        }

        foreach (var tag in (tags ?? []).Select(t => t?.Trim()).Where(t => !string.IsNullOrWhiteSpace(t))
                     .Distinct(StringComparer.OrdinalIgnoreCase))
        {
            db.QuestionLibraryItemTags.Add(new QuestionLibraryItemTag { QuestionLibraryItemId = id, Tag = tag! });
        }
    }

    private static async Task<QuestionLibraryItemDetail> LoadDetailAsync(ClimateProjectDbContext db, Guid id, CancellationToken cancellationToken)
    {
        var i = await db.QuestionLibraryItems.FirstAsync(x => x.Id == id, cancellationToken);
        var options = await db.QuestionLibraryItemOptions.Where(o => o.QuestionLibraryItemId == id)
            .OrderBy(o => o.Order)
            .Select(o => new RepositoryOptionDto(o.Order, o.Value, o.LabelEn, o.LabelEs))
            .ToListAsync(cancellationToken);
        var tags = await db.QuestionLibraryItemTags.Where(t => t.QuestionLibraryItemId == id)
            .OrderBy(t => t.Tag).Select(t => t.Tag).ToListAsync(cancellationToken);

        return new QuestionLibraryItemDetail(
            i.Id, i.CompanyId, i.QuestionCategoryId, i.TextEn, i.TextEs, i.Language, i.Type,
            i.ScaleMin, i.ScaleMax, i.ScaleLabelMinEn, i.ScaleLabelMinEs, i.ScaleLabelMaxEn, i.ScaleLabelMaxEs,
            i.Dimension, i.UsageCount, i.LastUsedAt, i.IsActive, i.Version, i.PreviousVersionId,
            i.CreatedAt, i.UpdatedAt, tags, options);
    }
}
