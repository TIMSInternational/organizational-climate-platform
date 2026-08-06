using System.Net;
using System.Text.Json;
using System.Text.RegularExpressions;

namespace ClimateProject.Application.Notifications;

/// <summary>
/// Substitutes <c>{{variable}}</c> placeholders in a notification template body.
///
/// Two things this deliberately does *not* do, both of which the legacy implementation
/// did:
///
/// 1. It never treats the template or a substituted value as code. There is no
///    expression language here -- a placeholder names a declared variable and nothing
///    else. Conditions are the separate, non-executing
///    <see cref="NotificationConditionParser"/> (#73).
/// 2. It never interpolates an untrusted value into HTML unescaped. The template body
///    is authored by an admin and may legitimately contain markup; the *values* come
///    from user rows (a display name, a department, a survey title) and are HTML-encoded
///    when they land in an HTML body. Encoding the whole body instead would render the
///    admin's own markup as literal text, so the split is per-substitution, not
///    per-document.
/// </summary>
public static partial class NotificationTemplateRenderer
{
    // Anchored to a whole placeholder and restricted to identifier characters, so
    // "{{ user.name }}" resolves and "{{ 1+1 }}" simply is not a placeholder -- it is
    // left in the output verbatim rather than being evaluated or silently eaten.
    [GeneratedRegex(
        @"\{\{\s*(?<name>[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*)\s*\}\}",
        RegexOptions.ExplicitCapture | RegexOptions.CultureInvariant)]
    private static partial Regex PlaceholderPattern();

    /// <summary>
    /// Renders <paramref name="template"/> against <paramref name="variables"/>.
    /// </summary>
    /// <param name="escapeHtml">
    /// True when the result is an HTML body. Applies to substituted values only.
    /// </param>
    /// <remarks>
    /// A placeholder naming a variable with no value renders as the empty string.
    /// Leaving the raw "{{userName}}" in an outgoing email is a worse failure than an
    /// empty gap, and the caller is told which required variables were missing via
    /// <see cref="FindMissingRequired"/> rather than by inspecting the output.
    /// </remarks>
    public static string? Render(
        string? template,
        IReadOnlyDictionary<string, string?> variables,
        bool escapeHtml)
    {
        ArgumentNullException.ThrowIfNull(variables);

        if (string.IsNullOrEmpty(template))
        {
            return template;
        }

        return PlaceholderPattern().Replace(template, match =>
        {
            if (!variables.TryGetValue(match.Groups["name"].Value, out var value) || value is null)
            {
                return string.Empty;
            }

            return escapeHtml ? WebUtility.HtmlEncode(value) : value;
        });
    }

    /// <summary>
    /// The effective substitution map: caller-supplied values, with a declared
    /// variable's default filling any gap.
    /// </summary>
    /// <param name="declared">The template's declared variables, name to JSON default value.</param>
    public static Dictionary<string, string?> BuildValues(
        IReadOnlyDictionary<string, string?> declared,
        IReadOnlyDictionary<string, string?>? supplied)
    {
        ArgumentNullException.ThrowIfNull(declared);

        var values = new Dictionary<string, string?>(StringComparer.Ordinal);

        foreach (var (name, jsonDefault) in declared)
        {
            values[name] = UnwrapJsonDefault(jsonDefault);
        }

        foreach (var (name, value) in supplied ?? new Dictionary<string, string?>(StringComparer.Ordinal))
        {
            if (value is not null)
            {
                values[name] = value;
            }
        }

        return values;
    }

    /// <summary>
    /// Names of required variables that ended up with no value at all.
    /// </summary>
    public static IReadOnlyList<string> FindMissingRequired(
        IEnumerable<string> requiredNames,
        IReadOnlyDictionary<string, string?> values)
    {
        ArgumentNullException.ThrowIfNull(requiredNames);
        ArgumentNullException.ThrowIfNull(values);

        return [.. requiredNames.Where(name =>
            !values.TryGetValue(name, out var value) || string.IsNullOrEmpty(value))];
    }

    /// <summary>
    /// <c>notification_template_variables.default_value</c> is <c>jsonb</c>, so a default
    /// of the word "Team" is stored as the JSON document <c>"Team"</c>. Rendering that
    /// document verbatim would put the quotes in the email, so a JSON string is unwrapped
    /// to its value. Any other JSON shape (a number, an object) renders as its text.
    /// </summary>
    public static string? UnwrapJsonDefault(string? json)
    {
        if (string.IsNullOrWhiteSpace(json))
        {
            return null;
        }

        try
        {
            using var document = JsonDocument.Parse(json);
            return document.RootElement.ValueKind == JsonValueKind.String
                ? document.RootElement.GetString()
                : json;
        }
        catch (JsonException)
        {
            // Rows predating write-time validation. Render what is there rather than
            // failing the whole preview.
            return json;
        }
    }

    /// <summary>
    /// True when <paramref name="json"/> is a document Postgres will accept into a
    /// <c>jsonb</c> column. Checked on write so an invalid default or modifications blob
    /// is a 400 naming the field, not a 500 out of the driver.
    /// </summary>
    public static bool IsValidJson(string? json)
    {
        if (json is null)
        {
            return true;
        }

        if (string.IsNullOrWhiteSpace(json))
        {
            return false;
        }

        try
        {
            using var _ = JsonDocument.Parse(json);
            return true;
        }
        catch (JsonException)
        {
            return false;
        }
    }
}
