namespace ClimateProject.Application.Questions;

/// <summary>An option on a repository item — the stable value plus its display labels.</summary>
public sealed record RepositoryOptionDto(int Order, string Value, string? LabelEn, string? LabelEs);

/// <summary>Option as supplied on write. <paramref name="Value"/> may be omitted and is then derived.</summary>
public sealed record RepositoryOptionInput(string? Value, string? LabelEn, string? LabelEs);

public sealed record QuestionCategoryListItem(
    Guid Id, Guid? CompanyId, Guid? ParentCategoryId, string NameEn, string NameEs,
    string? DescriptionEn, string? DescriptionEs, int Order, string? Icon, string? Color,
    bool IsActive, int ItemCount);

public sealed record QuestionCategoryListResponse(IReadOnlyList<QuestionCategoryListItem> Categories);

public sealed record CreateQuestionCategoryRequest(
    string NameEn, string NameEs, string? DescriptionEn, string? DescriptionEs,
    Guid? ParentCategoryId, Guid? CompanyId, int? Order, string? Icon, string? Color);

/// <summary>
/// Narrower than the create request on purpose: <c>CompanyId</c> is immutable after creation
/// (it decides who owns the row and who may write it), which is the same rule
/// <c>UpdateBenchmarkRequest</c> follows.
/// </summary>
public sealed record UpdateQuestionCategoryRequest(
    string NameEn, string NameEs, string? DescriptionEn, string? DescriptionEs,
    Guid? ParentCategoryId, int? Order, string? Icon, string? Color, bool? IsActive);

public sealed record QuestionLibraryItemListItem(
    Guid Id, Guid? CompanyId, Guid QuestionCategoryId, string TextEn, string TextEs, string Type,
    string? Dimension, int UsageCount, DateTimeOffset? LastUsedAt, bool IsActive, int Version,
    IReadOnlyList<string> Tags);

public sealed record QuestionLibraryItemListResponse(IReadOnlyList<QuestionLibraryItemListItem> Items);

public sealed record QuestionLibraryItemDetail(
    Guid Id, Guid? CompanyId, Guid QuestionCategoryId, string TextEn, string TextEs, string Language,
    string Type, int? ScaleMin, int? ScaleMax,
    string? ScaleLabelMinEn, string? ScaleLabelMinEs, string? ScaleLabelMaxEn, string? ScaleLabelMaxEs,
    string? Dimension, int UsageCount, DateTimeOffset? LastUsedAt, bool IsActive, int Version,
    Guid? PreviousVersionId, DateTimeOffset CreatedAt, DateTimeOffset UpdatedAt,
    IReadOnlyList<string> Tags, IReadOnlyList<RepositoryOptionDto> Options);

public sealed record CreateQuestionLibraryItemRequest(
    Guid QuestionCategoryId, string TextEn, string TextEs, string Type, Guid? CompanyId,
    int? ScaleMin, int? ScaleMax,
    string? ScaleLabelMinEn, string? ScaleLabelMinEs, string? ScaleLabelMaxEn, string? ScaleLabelMaxEs,
    string? Dimension, IReadOnlyList<string>? Tags, IReadOnlyList<RepositoryOptionInput>? Options);

/// <summary>
/// <c>CompanyId</c> and <c>Type</c> are immutable after creation. Type decides how every stored
/// answer to an instantiated copy is encoded, so changing it on the source would make the library
/// disagree with questions already asked from it.
/// </summary>
public sealed record UpdateQuestionLibraryItemRequest(
    Guid QuestionCategoryId, string TextEn, string TextEs,
    int? ScaleMin, int? ScaleMax,
    string? ScaleLabelMinEn, string? ScaleLabelMinEs, string? ScaleLabelMaxEn, string? ScaleLabelMaxEs,
    string? Dimension, bool? IsActive, IReadOnlyList<string>? Tags, IReadOnlyList<RepositoryOptionInput>? Options);
