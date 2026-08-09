namespace ClimateProject.Application.Analytics;

/// <summary>A create request's fields after trimming and normalisation, once they are valid.</summary>
public sealed record NormalizedAIInsightFields(
    string Type,
    string Category,
    string Title,
    string Description,
    string Priority,
    List<string> AffectedSegments,
    List<string> RecommendedActions);

/// <summary>Either an error message for the caller, or the normalized fields -- never both.</summary>
public sealed record AIInsightValidationResult(string? Error, NormalizedAIInsightFields? Fields)
{
    public static AIInsightValidationResult Invalid(string error) => new(error, null);

    public static AIInsightValidationResult Valid(NormalizedAIInsightFields fields) => new(null, fields);
}

/// <summary>
/// Shape checks for <c>POST /admin/ai-insights</c>, as a pure function.
/// </summary>
/// <remarks>
/// <para>
/// The lengths are the ones <c>AIInsightConfiguration</c> puts on the columns. Postgres answers
/// an over-long value with a <c>22001</c> that surfaces as an unhandled 500, so without these a
/// caller posting a long LLM description gets "something went wrong" instead of a 400 naming the
/// field. Same reasoning as <see cref="AnalyticsInsightValidation"/>.
/// </para>
/// <para>
/// <c>ConfidenceScore</c> is bounded to 0-100 because the column is a plain <c>integer</c> with
/// no CHECK, and the one historical bug in this area (#152) was a 0-1 fraction being written
/// where a percentage was expected. A stored <c>1</c> that meant "certain" is indistinguishable
/// from a stored <c>1</c> that means "1% confident" once it is in the table; rejecting the
/// out-of-range half of that mistake is the only part that can be caught mechanically.
/// </para>
/// <para>
/// The two arrays are <c>text[] NOT NULL</c> with no element constraint, so a JSON body
/// containing <c>[null, "", "Sales"]</c> would otherwise store a NULL element -- which reads
/// back as a null inside a <c>List&lt;string&gt;</c> and NREs whoever renders it. Blank and null
/// entries are dropped and the survivors trimmed rather than rejected: this is machine-generated
/// input (#92), and a stray empty string is not worth failing a whole insight over.
/// </para>
/// <para>
/// Lives in Application rather than beside the endpoint so it is unit-testable without a
/// database or a WebApplicationFactory.
/// </para>
/// </remarks>
public static class AIInsightValidation
{
    public const int MaxTypeLength = 20;
    public const int MaxCategoryLength = 100;
    public const int MaxTitleLength = 200;
    public const int MaxDescriptionLength = 1000;
    public const int MaxPriorityLength = 20;
    public const int MinConfidenceScore = 0;
    public const int MaxConfidenceScore = 100;

    public static AIInsightValidationResult ValidateCreate(CreateAIInsightRequest request)
    {
        // The record declares these non-nullable, but the value arrives from JSON: a body that
        // omits "title" binds null, so `?.` is load-bearing rather than defensive noise.
        var type = request.Type?.Trim();
        var category = request.Category?.Trim();
        var title = request.Title?.Trim();
        var description = request.Description?.Trim();
        var priority = request.Priority?.Trim();

        var required = RequiredError("Type", type, MaxTypeLength)
            ?? RequiredError("Category", category, MaxCategoryLength)
            ?? RequiredError("Title", title, MaxTitleLength)
            ?? RequiredError("Description", description, MaxDescriptionLength)
            ?? RequiredError("Priority", priority, MaxPriorityLength);
        if (required is not null) return AIInsightValidationResult.Invalid(required);

        if (request.ConfidenceScore is < MinConfidenceScore or > MaxConfidenceScore)
        {
            return AIInsightValidationResult.Invalid(
                $"ConfidenceScore must be between {MinConfidenceScore} and {MaxConfidenceScore}");
        }

        return AIInsightValidationResult.Valid(new NormalizedAIInsightFields(
            type!,
            category!,
            title!,
            description!,
            priority!,
            NormalizeList(request.AffectedSegments),
            NormalizeList(request.RecommendedActions)));
    }

    /// <summary>Trims entries and drops the null/blank ones; a null list becomes an empty one.</summary>
    public static List<string> NormalizeList(IReadOnlyList<string>? values)
        => values is null
            ? []
            : values.Where(v => !string.IsNullOrWhiteSpace(v)).Select(v => v.Trim()).ToList();

    private static string? RequiredError(string field, string? value, int maxLength)
    {
        if (string.IsNullOrWhiteSpace(value)) return $"{field} is required";
        return value.Length > maxLength ? $"{field} exceeds {maxLength} characters" : null;
    }
}
