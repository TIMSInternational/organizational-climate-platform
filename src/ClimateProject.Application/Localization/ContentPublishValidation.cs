namespace ClimateProject.Application.Localization;

/// <summary>One field/locale pair that is required but empty.</summary>
/// <param name="Field">
/// A caller-facing path, e.g. <c>title</c> or <c>questions[2].options[0].label</c>,
/// so the wizard's ValidationPanel can point at the offending input rather than
/// rendering "something is missing".
/// </param>
public sealed record MissingTranslation(string Field, string Locale);

/// <summary>
/// One authored field, reduced to what the gate needs. Application-layer record
/// rather than the Domain entity so the gate stays a pure function testable without
/// a database -- same shape of decision as DemographicValueDefinition on #193.
/// </summary>
/// <param name="Required">
/// True for fields that must exist regardless (a title, a question's text). False for
/// optional fields (a description, a scale label): those are only demanded in every
/// required locale once the author has written *one* of them. Demanding an empty
/// optional field in both languages would block publishing a survey that simply has
/// no description.
/// </param>
public sealed record LocalizedFieldValue(string Field, string? En, string? Es, bool Required);

/// <summary>
/// The write-time gate. This -- not read-time patching -- is what makes the binding
/// test case deterministically true:
///
/// > Export/show the survey in ES and EN without "untranslated" strings.
/// > -- docs/requirements/notes/functional-req.md:98
///
/// A read-time fallback can only ever make that *usually* true, which is not what a
/// test case means. So a survey or microclimate cannot leave <c>draft</c> unless
/// every Tier 1 field required by its own <c>Language</c> is non-empty.
///
/// Deliberately **not** enforced on save: microclimate-req.md requires autosave every
/// 5-10 seconds, and a blocking validator would fight it -- and "side-by-side
/// editable view" presupposes you can save a half-translated question in order to
/// translate the other half. Draft-time behaviour is a warning; publish-time is a
/// gate. Same precedent as #104, where publishing is the irreversible checkpoint.
/// </summary>
public static class ContentPublishValidation
{
    /// <summary>Statuses that mean "no longer a draft", i.e. the transitions the gate guards.</summary>
    public static bool IsPublishTransition(string? fromStatus, string? toStatus)
        => string.Equals(fromStatus, "draft", StringComparison.Ordinal)
           && !string.IsNullOrWhiteSpace(toStatus)
           && !string.Equals(toStatus, "draft", StringComparison.Ordinal);

    public static IReadOnlyList<MissingTranslation> FindMissing(
        string? language,
        IEnumerable<LocalizedFieldValue> fields)
    {
        ArgumentNullException.ThrowIfNull(fields);

        var requiredLocales = ContentLanguages.RequiredLocales(language);
        var missing = new List<MissingTranslation>();

        foreach (var field in fields)
        {
            var hasAny = !string.IsNullOrWhiteSpace(field.En) || !string.IsNullOrWhiteSpace(field.Es);
            if (!field.Required && !hasAny)
            {
                // An optional field nobody filled in is not a missing translation.
                continue;
            }

            foreach (var locale in requiredLocales)
            {
                var value = locale == ContentLanguages.Spanish ? field.Es : field.En;
                if (string.IsNullOrWhiteSpace(value))
                {
                    missing.Add(new MissingTranslation(field.Field, locale));
                }
            }
        }

        return missing;
    }

    /// <summary>
    /// Renders the gate's 400 body. The list is explicit rather than a count because
    /// #108's acceptance criteria require validation to "be honest about what
    /// publishing does" -- an admin has to know which question in which language.
    /// </summary>
    public static string Describe(IReadOnlyList<MissingTranslation> missing)
        => $"Cannot publish: {missing.Count} translation(s) missing -- "
           + string.Join(", ", missing.Select(m => $"{m.Field} ({m.Locale})"));
}
