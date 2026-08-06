using System.Globalization;

namespace ClimateProject.Application.OrgStructure;

// A company's DemographicField row, reduced to what validating a submitted value
// needs. Kept as an Application-layer record (rather than taking the Domain
// entity) so the validator stays a pure function with no EF/materialisation
// assumptions and can be unit-tested without a database.
/// <param name="Options">
/// The allowed answers, which are the options' stable locale-independent VALUES, never
/// their display labels (#195). Validating against a label would make the same answer
/// store two different strings depending on the admin's browser language, and every
/// dashboard filter, group-by and export would split accordingly and silently.
/// </param>
public sealed record DemographicFieldDefinition(
    Guid Id,
    string Field,
    string Type,
    IReadOnlyList<string>? Options,
    bool Required,
    bool IsActive);

public sealed record ResolvedDemographicValue(Guid FieldId, string Field, string Value);

public sealed record DemographicValueValidationResult(
    IReadOnlyList<ResolvedDemographicValue> Values,
    IReadOnlyList<string> Errors)
{
    public bool IsValid => Errors.Count == 0;
}

// Validates a submitted {fieldKey: value} map against the company's configured
// demographic fields and resolves each key to its DemographicField.Id.
//
// This is the check that the old jsonb blob could not do at all: users.demographics
// and user_invitations.demographics accepted any shape, so a typo'd key, a value
// outside a select field's option list, or a non-numeric "number" answer all
// persisted happily and only surfaced as a hole in a dashboard filter months later.
public static class DemographicValueValidation
{
    // Matches UserDemographicConfiguration/UserInvitationDemographicConfiguration's
    // value column length; rejecting here gives a 400 instead of a truncation/500.
    public const int MaxValueLength = 500;

    private const string IsoDateFormat = "yyyy-MM-dd";

    /// <param name="enforceRequired">
    /// True when the submission is the complete set of a person's demographics (a
    /// profile update), so a missing Required field is an error. False when the
    /// submission is a partial pre-assignment (invitation time, where the admin
    /// fills in only what the roster/CSV already knows and the member completes
    /// the rest on acceptance).
    /// </param>
    public static DemographicValueValidationResult Validate(
        IReadOnlyDictionary<string, string?>? submitted,
        IReadOnlyList<DemographicFieldDefinition> definitions,
        bool enforceRequired)
    {
        ArgumentNullException.ThrowIfNull(definitions);

        var values = new List<ResolvedDemographicValue>();
        var errors = new List<string>();
        var provided = new HashSet<string>(StringComparer.Ordinal);

        foreach (var (key, rawValue) in submitted ?? new Dictionary<string, string?>())
        {
            var fieldKey = key?.Trim() ?? string.Empty;
            if (fieldKey.Length == 0)
            {
                errors.Add("Demographic field key cannot be blank");
                continue;
            }

            var definition = definitions.FirstOrDefault(d => string.Equals(d.Field, fieldKey, StringComparison.Ordinal));
            if (definition is null)
            {
                errors.Add($"Unknown demographic field: '{fieldKey}'");
                continue;
            }

            if (!definition.IsActive)
            {
                errors.Add($"Demographic field '{fieldKey}' is not active");
                continue;
            }

            var value = rawValue?.Trim() ?? string.Empty;
            if (value.Length == 0)
            {
                // An explicit blank clears the answer rather than storing an empty
                // string; a required field then fails the sweep below.
                continue;
            }

            provided.Add(definition.Field);

            if (value.Length > MaxValueLength)
            {
                errors.Add($"Demographic field '{fieldKey}' value exceeds {MaxValueLength} characters");
                continue;
            }

            if (!IsValueValidForType(definition, value, out var typeError))
            {
                errors.Add(typeError!);
                continue;
            }

            values.Add(new ResolvedDemographicValue(definition.Id, definition.Field, value));
        }

        if (enforceRequired)
        {
            foreach (var definition in definitions)
            {
                if (definition.Required && definition.IsActive && !provided.Contains(definition.Field))
                {
                    errors.Add($"Demographic field '{definition.Field}' is required");
                }
            }
        }

        return new DemographicValueValidationResult(values, errors);
    }

    private static bool IsValueValidForType(DemographicFieldDefinition definition, string value, out string? error)
    {
        switch (definition.Type)
        {
            case "select":
                if (definition.Options is null || definition.Options.Count == 0)
                {
                    error = $"Demographic field '{definition.Field}' has no configured options";
                    return false;
                }

                if (!definition.Options.Contains(value, StringComparer.Ordinal))
                {
                    error = $"Value '{value}' is not an allowed option for demographic field '{definition.Field}'";
                    return false;
                }

                break;

            case "number":
                if (!double.TryParse(value, NumberStyles.Float, CultureInfo.InvariantCulture, out _))
                {
                    error = $"Demographic field '{definition.Field}' expects a number";
                    return false;
                }

                break;

            case "date":
                if (!DateOnly.TryParseExact(value, IsoDateFormat, CultureInfo.InvariantCulture, DateTimeStyles.None, out _))
                {
                    error = $"Demographic field '{definition.Field}' expects a date in {IsoDateFormat} format";
                    return false;
                }

                break;

            case "text":
                break;

            default:
                // DemographicFieldValidation.ValidTypes gates creation, so this is
                // only reachable for a row written before a type was retired.
                error = $"Demographic field '{definition.Field}' has an unsupported type '{definition.Type}'";
                return false;
        }

        error = null;
        return true;
    }
}
