namespace ClimateProject.Application.Search;

/// <summary>
/// One hit, already resolved for the caller's locale.
/// </summary>
/// <param name="Type">One of <see cref="SearchEntityTypes"/>.</param>
/// <param name="Id">The entity's own id -- what the caller navigates to.</param>
/// <param name="Title">Never null and never empty: a hit with nothing to render is dropped rather than returned blank.</param>
/// <param name="Subtitle">Secondary line -- a description, an email, or the parent survey's title for a question.</param>
/// <param name="CompanyId">
/// The owning tenant, so a SuperAdmin searching across companies can tell two identically
/// named rows apart. Null only for a row that has no tenant (a company-less super_admin).
/// </param>
/// <param name="ParentId">The survey a question belongs to; null for every other kind.</param>
public sealed record SearchResultItem(
    string Type,
    Guid Id,
    string Title,
    string? Subtitle,
    Guid? CompanyId,
    Guid? ParentId);

/// <summary>Hits of one kind. Present with an empty <paramref name="Items"/> when the kind was searched and matched nothing.</summary>
public sealed record SearchResultGroup(string Type, IReadOnlyList<SearchResultItem> Items);

public sealed record SearchResponse(string Query, IReadOnlyList<SearchResultGroup> Groups, int TotalCount);

/// <summary>The type-ahead shape: flat, ordered, and carrying only what a palette row renders.</summary>
public sealed record SearchSuggestion(string Type, Guid Id, string Title, Guid? ParentId);

public sealed record SearchSuggestionsResponse(IReadOnlyList<SearchSuggestion> Suggestions);
