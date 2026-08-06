using System.Text.Json;

namespace ClimateProject.Application.Analytics;

/// <summary>
/// The one place that knows how a person's demographics map onto a
/// <c>demographic_snapshot_entries</c> row, so the diff, the distributions and the
/// write path cannot drift apart.
///
/// The entry table predates the demographic normalisation of #193: it has six fixed
/// columns (department/role/tenure/location/team/level) plus a <c>custom_attributes</c>
/// jsonb. #193 made demographics arbitrary per-company fields, and the PRD's
/// "Reporting Integration: full demographic segmentation in analytics" (section 2,
/// Demographics Management) requires *every* configured field to be filterable -- not
/// just the six the original schema happened to name. Rather than add a
/// snapshot-entry-values table (which would need a migration, and migrations are
/// serialised across this migration effort), the six reserved keys keep their columns
/// and every other field key lands in <c>custom_attributes</c> as a flat
/// <c>{fieldKey: value}</c> object. <see cref="Flatten"/> re-joins the two halves so
/// consumers never have to care which side a key came from.
/// </summary>
public static class SnapshotEntryValues
{
    /// <summary>Field keys that live in dedicated entry columns rather than in custom_attributes.</summary>
    public static readonly string[] ReservedFields = ["department", "role", "tenure", "location", "team", "level"];

    /// <summary>
    /// What <c>department</c>/<c>role</c>/<c>tenure</c> become when nothing is known. Those
    /// three columns are NOT NULL, so they need a value; a stable locale-independent
    /// sentinel is used rather than an empty string for the same reason option values are
    /// locale-independent (#195) -- it must group and filter identically in every language.
    /// </summary>
    public const string Unspecified = "unspecified";

    private static readonly HashSet<string> Reserved = new(ReservedFields, StringComparer.Ordinal);

    public static bool IsReserved(string field) => Reserved.Contains(field);

    /// <summary>
    /// A snapshot entry as a single <c>{fieldKey: value}</c> map, reserved columns and
    /// custom attributes merged. Values are the stable locale-independent option values
    /// that user_demographics stores, never display labels -- a snapshot whose groups
    /// changed name when the reader switched language would make period-over-period
    /// comparison meaningless, which is the whole point of snapshotting.
    /// </summary>
    public static IReadOnlyDictionary<string, string> Flatten(
        string department,
        string role,
        string tenure,
        string? location,
        string? team,
        string? level,
        string? customAttributesJson)
    {
        var values = new Dictionary<string, string>(StringComparer.Ordinal)
        {
            ["department"] = department,
            ["role"] = role,
            ["tenure"] = tenure,
        };

        if (!string.IsNullOrWhiteSpace(location)) values["location"] = location;
        if (!string.IsNullOrWhiteSpace(team)) values["team"] = team;
        if (!string.IsNullOrWhiteSpace(level)) values["level"] = level;

        foreach (var (key, value) in ParseCustomAttributes(customAttributesJson))
        {
            // A reserved key must never be shadowed by a custom attribute: the column is
            // the source of truth and is what the indexes cover.
            if (!Reserved.Contains(key))
            {
                values[key] = value;
            }
        }

        return values;
    }

    /// <summary>
    /// Reads the custom_attributes jsonb. Anything that is not a flat object of scalar
    /// values is treated as absent rather than throwing: the column is jsonb, so a row
    /// written by an earlier tool (or by the ETL) can legitimately hold a shape this
    /// code does not model, and a read endpoint must not 500 over it.
    /// </summary>
    public static IReadOnlyDictionary<string, string> ParseCustomAttributes(string? json)
    {
        var result = new Dictionary<string, string>(StringComparer.Ordinal);
        if (string.IsNullOrWhiteSpace(json))
        {
            return result;
        }

        try
        {
            using var document = JsonDocument.Parse(json);
            if (document.RootElement.ValueKind != JsonValueKind.Object)
            {
                return result;
            }

            foreach (var property in document.RootElement.EnumerateObject())
            {
                var value = property.Value.ValueKind switch
                {
                    JsonValueKind.String => property.Value.GetString(),
                    JsonValueKind.Number => property.Value.GetRawText(),
                    JsonValueKind.True => "true",
                    JsonValueKind.False => "false",
                    _ => null,
                };

                if (value is not null)
                {
                    result[property.Name] = value;
                }
            }
        }
        catch (JsonException)
        {
            return new Dictionary<string, string>(StringComparer.Ordinal);
        }

        return result;
    }

    /// <summary>
    /// Serialises the non-reserved half of a resolved demographic map for the
    /// custom_attributes column. Returns null when there is nothing to store so the
    /// column stays NULL rather than holding an empty object.
    /// </summary>
    public static string? ToCustomAttributesJson(IReadOnlyDictionary<string, string> demographics)
    {
        ArgumentNullException.ThrowIfNull(demographics);

        var custom = demographics
            .Where(pair => !Reserved.Contains(pair.Key))
            .OrderBy(pair => pair.Key, StringComparer.Ordinal)
            .ToDictionary(pair => pair.Key, pair => pair.Value, StringComparer.Ordinal);

        return custom.Count == 0 ? null : JsonSerializer.Serialize(custom);
    }
}
