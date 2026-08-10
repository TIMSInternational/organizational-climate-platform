using System.Security.Claims;
using ClimateProject.Application.Auth;
using ClimateProject.Application.Localization;
using ClimateProject.Application.Search;
using ClimateProject.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace ClimateProject.Api.Endpoints;

/// <summary>
/// Cross-entity global search (#145), replacing legacy <c>api/search</c> and
/// <c>api/search/suggestions</c>.
///
/// Legacy's third route, <c>api/navigation/suggestions</c>, is deliberately not here. It
/// suggested *pages*, not rows, and the page list is already in the client
/// (<c>navSections.ts</c>, and the Cmd+K palette that reads it) where it is role-filtered
/// without a round trip. Serving it from the API would put a second copy of the navigation
/// tree behind a network hop, and the copy that drifts is the one that offers a link the
/// caller's role will 403 on. #135 owns that half.
///
/// The permission model in one sentence: <b>search shows you what its entity's own listing
/// endpoint would already show you, and nothing else.</b> Every searchable entity is an
/// admin-only read today, so a leader, supervisor or employee gets exactly one surface --
/// the surveys they are expected to answer, the same set <c>/surveys/my</c> returns. That
/// is a narrow result set on purpose. Widening it is a change to those listing endpoints
/// first and to this one second, never the other way round.
/// </summary>
public static class SearchEndpoints
{
    /// <summary>Results per entity kind on the results page, when the caller does not say.</summary>
    private const int DefaultLimit = 10;

    /// <summary>Rows a type-ahead round trip returns in total, when the caller does not say.</summary>
    private const int DefaultSuggestionLimit = 8;

    /// <summary>
    /// The ceiling on both. A cap rather than paging: this is a jump-to navigation surface,
    /// and someone who needs the 26th match needs the entity's own filtered listing.
    /// </summary>
    private const int MaxLimit = 25;

    public static void MapSearchEndpoints(this WebApplication app)
    {
        var group = app.MapGroup("/search").RequireAuthorization();

        group.MapGet("", SearchAsync);

        // Cannot shadow anything: the group has no {id} route, and type-ahead wants a
        // separate shape (flat and title-only) rather than a mode flag on the one above.
        group.MapGet("/suggestions", SuggestionsAsync);
    }

    private static async Task<IResult> SearchAsync(
        string? q,
        string? types,
        int? limit,
        string? lang,
        Guid? companyId,
        ClaimsPrincipal principal,
        ClimateProjectDbContext db,
        CancellationToken cancellationToken)
    {
        var requestedTypes = SearchEntityTypes.Parse(types);
        if (requestedTypes is null)
        {
            return Results.Json(new { message = "types must be a comma-separated list of searchable entity kinds" }, statusCode: 400);
        }

        var perType = Clamp(limit, DefaultLimit);
        var tsQuery = SearchQueryText.ToPrefixQuery(q);

        // Access first, always -- see ResolveAccessAsync. A caller naming a company that is
        // not theirs has asserted something they had no right to assert, and that is a 403
        // whether or not they also typed a search term. Short-circuiting the blank term
        // first would answer "no results" to a probe for a foreign tenant, which is the one
        // answer that doc comment says must never be given.
        //
        // The cost is real and accepted: a cleared search box now resolves access before it
        // returns nothing, which for a non-admin means one indexed read of the caller's own
        // user row per blank keystroke. Cheap, and not something to optimise back by
        // reordering these two -- the ordering is the fix.
        var access = await ResolveAccessAsync(principal.GetCurrentUser(), companyId, db, cancellationToken);
        if (access is DeniedAccess denied)
        {
            return denied.Result;
        }

        // A blank or punctuation-only term is what every type-ahead sends on its first
        // keystroke and again when the box is cleared. It is not a client error, and it is
        // certainly not "match everything" -- it is an empty result.
        if (tsQuery is null)
        {
            return Results.Ok(EmptyResponse(q, requestedTypes));
        }

        var groups = new List<SearchResultGroup>(requestedTypes.Count);
        var total = 0;
        foreach (var type in requestedTypes)
        {
            var items = await RunAsync(access, type, tsQuery, perType, lang, db, cancellationToken);
            groups.Add(new SearchResultGroup(type, items));
            total += items.Count;
        }

        // TotalCount is the number of rows in this response, not the number of rows that
        // matched. An unfiltered match count is precisely the sort of oracle this issue
        // warns about -- "42 results you may not see" tells a tenant how much its
        // neighbours have.
        return Results.Ok(new SearchResponse(q ?? string.Empty, groups, total));
    }

    private static async Task<IResult> SuggestionsAsync(
        string? q,
        int? limit,
        string? lang,
        Guid? companyId,
        ClaimsPrincipal principal,
        ClimateProjectDbContext db,
        CancellationToken cancellationToken)
    {
        var total = Clamp(limit, DefaultSuggestionLimit);
        var tsQuery = SearchQueryText.ToPrefixQuery(q);

        // Access before the blank-term short-circuit, for the reason SearchAsync gives.
        var access = await ResolveAccessAsync(principal.GetCurrentUser(), companyId, db, cancellationToken);
        if (access is DeniedAccess denied)
        {
            return denied.Result;
        }

        if (tsQuery is null)
        {
            return Results.Ok(new SearchSuggestionsResponse([]));
        }

        var byType = new List<IReadOnlyList<SearchResultItem>>(SearchEntityTypes.All.Length);
        foreach (var type in SearchEntityTypes.All)
        {
            byType.Add(await RunAsync(access, type, tsQuery, total, lang, db, cancellationToken));
        }

        // Round-robin rather than concatenate. Taking the first N of a concatenation means
        // surveys alone fill the palette and a department is never suggested at all, which
        // is the failure mode of every "why can't I find it" bug report about search.
        var suggestions = new List<SearchSuggestion>(total);
        for (var rank = 0; suggestions.Count < total; rank++)
        {
            var placed = false;
            foreach (var items in byType)
            {
                if (rank >= items.Count)
                {
                    continue;
                }

                placed = true;
                suggestions.Add(new SearchSuggestion(items[rank].Type, items[rank].Id, items[rank].Title, items[rank].ParentId));
                if (suggestions.Count == total)
                {
                    break;
                }
            }

            if (!placed)
            {
                break;
            }
        }

        return Results.Ok(new SearchSuggestionsResponse(suggestions));
    }

    // ------------------------------------------------------------------
    // Authorisation
    // ------------------------------------------------------------------

    private abstract record Access;

    /// <summary>Every searchable kind, inside one tenant or across all of them.</summary>
    private sealed record AdminAccess(SearchScope Scope) : Access;

    /// <summary>Surveys this person is expected to answer, and nothing else.</summary>
    private sealed record AssignedSurveysAccess(Guid CompanyId, Guid? DepartmentId, Guid UserId) : Access;

    /// <summary>Authenticated, but with nothing searchable. An empty result, not an error.</summary>
    private sealed record NoAccess : Access;

    private sealed record DeniedAccess(IResult Result) : Access;

    /// <summary>
    /// The one place that decides what a caller may search.
    ///
    /// Note the asymmetry between the two ways of getting nothing. Asking for a company
    /// that is not yours is a 403, because the caller asserted something they had no right
    /// to assert and telling them "no results" would be a lie that hides a bug. Having no
    /// searchable surface at all is an empty 200, because the search box is in the shell
    /// for every role and a 403 on every keystroke is noise, not information.
    /// </summary>
    private static async Task<Access> ResolveAccessAsync(
        CurrentUser currentUser,
        Guid? requestedCompanyId,
        ClimateProjectDbContext db,
        CancellationToken cancellationToken)
    {
        if (currentUser.Role == Roles.SuperAdmin)
        {
            return new AdminAccess(requestedCompanyId is Guid target
                ? SearchScope.ForCompany(target)
                : SearchScope.CrossTenant());
        }

        var ownCompanyId = CompanyScope.OwnCompanyId(currentUser);
        if (requestedCompanyId.HasValue && requestedCompanyId != ownCompanyId)
        {
            return new DeniedAccess(Results.Forbid());
        }

        if (currentUser.Role == Roles.CompanyAdmin)
        {
            // A company_admin whose token carries no usable company claim cannot be scoped
            // to anything, and an unscoped search is the one thing they must never get.
            return ownCompanyId is Guid own
                ? new AdminAccess(SearchScope.ForCompany(own))
                : new DeniedAccess(Results.Forbid());
        }

        // Read the user's own row rather than the JWT, for the reason
        // SurveyEndpoints.ListMineAsync gives: department membership moves, and a token
        // minted before a transfer would otherwise keep searching the old team's surveys.
        var actingUserId = await SurveyEndpoints.ResolveActingUserIdAsync(currentUser, db, cancellationToken);
        if (actingUserId is null)
        {
            return new NoAccess();
        }

        var me = await db.Users
            .Where(u => u.Id == actingUserId.Value)
            .Select(u => new { u.Id, u.CompanyId, u.DepartmentId })
            .FirstOrDefaultAsync(cancellationToken);

        return me?.CompanyId is Guid myCompanyId
            ? new AssignedSurveysAccess(myCompanyId, me.DepartmentId, me.Id)
            : new NoAccess();
    }

    // ------------------------------------------------------------------
    // Running one kind
    // ------------------------------------------------------------------

    private static async Task<IReadOnlyList<SearchResultItem>> RunAsync(
        Access access,
        string type,
        string tsQuery,
        int limit,
        string? lang,
        ClimateProjectDbContext db,
        CancellationToken cancellationToken)
    {
        var query = access switch
        {
            AdminAccess admin => ForAdmin(admin.Scope, type, tsQuery, limit, db),
            AssignedSurveysAccess assigned when type == SearchEntityTypes.Survey => SearchQueries.AssignedSurveys(
                db.Surveys, db.SurveyDepartmentTargets, db.Responses,
                assigned.CompanyId, assigned.DepartmentId, assigned.UserId, tsQuery, limit),
            _ => null,
        };

        if (query is null)
        {
            return [];
        }

        var rows = await query.ToListAsync(cancellationToken);
        return rows.Select(row => ToItem(row, lang)).OfType<SearchResultItem>().ToList();
    }

    private static IQueryable<SearchHitRow>? ForAdmin(SearchScope scope, string type, string tsQuery, int limit, ClimateProjectDbContext db)
        => type switch
        {
            SearchEntityTypes.Survey => SearchQueries.Surveys(db.Surveys, scope, tsQuery, limit),
            SearchEntityTypes.Question => SearchQueries.Questions(db.Questions, db.Surveys, scope, tsQuery, limit),
            SearchEntityTypes.Department => SearchQueries.Departments(db.Departments, scope, tsQuery, limit),
            SearchEntityTypes.User => SearchQueries.Users(db.Users, scope, tsQuery, limit),
            SearchEntityTypes.ActionPlan => SearchQueries.ActionPlans(db.ActionPlans, scope, tsQuery, limit),
            SearchEntityTypes.Report => SearchQueries.Reports(db.Reports, scope, tsQuery, limit),
            _ => null,
        };

    /// <summary>
    /// Resolves a row's text for the caller's locale, or drops it.
    ///
    /// A hit whose title resolves to nothing in any locale has no label to render and no
    /// way for the caller to tell what they would be navigating to, so it is not a result.
    /// Returning it with an empty string would put a blank row in the palette; returning
    /// the raw <c>_en</c> column would reintroduce exactly the untranslated-content leak
    /// #78 fixed.
    /// </summary>
    private static SearchResultItem? ToItem(SearchHitRow row, string? lang)
    {
        var title = LocalizedContent.ResolveText(row.TitleEn, row.TitleEs, lang, row.ContentLanguage);
        if (string.IsNullOrWhiteSpace(title))
        {
            return null;
        }

        var subtitle = LocalizedContent.ResolveText(row.SubtitleEn, row.SubtitleEs, lang, row.ContentLanguage);
        return new SearchResultItem(row.Type, row.Id, title, subtitle, row.CompanyId, row.ParentId);
    }

    private static SearchResponse EmptyResponse(string? q, IReadOnlyList<string> types)
        => new(q ?? string.Empty, types.Select(t => new SearchResultGroup(t, [])).ToList(), 0);

    private static int Clamp(int? requested, int fallback)
        => requested is int value ? Math.Clamp(value, 1, MaxLimit) : fallback;
}
