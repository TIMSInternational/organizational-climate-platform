namespace ClimateProject.Application.Questions;

/// <summary>
/// The types a repository item may carry.
/// </summary>
/// <remarks>
/// <para>
/// The <b>intersection</b> of <see cref="QuestionTypes.ForSurvey"/> and
/// <see cref="QuestionTypes.ForMicroclimate"/>, derived rather than written out, so it cannot drift
/// from either.
/// </para>
/// <para>
/// Why the intersection and not <see cref="QuestionTypes.All"/>: the library exists to be picked
/// into <em>both</em> wizards (#115 is #58's own acceptance criterion). An item typed from the wider
/// vocabulary — <c>ranking</c>, which only surveys accept, or <c>emoji_rating</c>, which neither
/// currently does — could be authored and then be <b>uninstantiable</b> into one of the two surfaces
/// it exists to serve. Refusing it at authoring time turns a confusing failure at pick time into a
/// clear one at create time.
/// </para>
/// </remarks>
public static class QuestionRepositoryTypes
{
    public static readonly string[] Supported =
        [.. QuestionTypes.ForSurvey.Intersect(QuestionTypes.ForMicroclimate, StringComparer.Ordinal).Order(StringComparer.Ordinal)];

    public static bool IsSupported(string? type)
        => type is not null && Supported.Contains(type, StringComparer.Ordinal);

    /// <summary>Types whose meaning depends on a caller-supplied option set.</summary>
    public static bool RequiresOptions(string? type)
        => type == QuestionTypes.MultipleChoice;
}
