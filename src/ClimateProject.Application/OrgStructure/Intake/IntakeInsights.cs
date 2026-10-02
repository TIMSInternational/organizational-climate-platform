using System.Text.RegularExpressions;

namespace ClimateProject.Application.OrgStructure.Intake;

/// <summary>
/// One thing worth the admin's attention before approving, found by code — never by the model,
/// because these are per-person facts and the model is only ever shown a masked profile.
/// </summary>
/// <param name="Code">Stable, translated by the screen: see <see cref="IntakeInsights"/>.</param>
/// <param name="Rows">The spreadsheet rows it concerns.</param>
/// <param name="Value">What it is about (the misspelt domain, the unknown department).</param>
/// <param name="Suggestion">The proposed correction, when there is one (the right domain).</param>
public sealed record IntakeInsight(string Code, IReadOnlyList<int> Rows, string? Value, string? Suggestion);

public static partial class IntakeInsights
{
    /// <summary>
    /// Misspellings of the public providers people actually mistype. A typo of the company's own
    /// domain is found by edit distance instead, since no list could know it.
    /// </summary>
    private static readonly Dictionary<string, string> KnownTypos = new(StringComparer.OrdinalIgnoreCase)
    {
        ["gmial.com"] = "gmail.com", ["gmai.com"] = "gmail.com", ["gmail.co"] = "gmail.com", ["gamil.com"] = "gmail.com",
        ["gmail.con"] = "gmail.com", ["gnail.com"] = "gmail.com", ["hotmial.com"] = "hotmail.com", ["hotmai.com"] = "hotmail.com",
        ["hotmail.con"] = "hotmail.com", ["hotmal.com"] = "hotmail.com", ["outlok.com"] = "outlook.com", ["outloo.com"] = "outlook.com",
        ["yaho.com"] = "yahoo.com", ["yahoo.con"] = "yahoo.com",
    };

    [GeneratedRegex(@"^[^@\s]+@[^@\s]+\.[^@\s]+$")]
    private static partial Regex EmailPattern();

    public static IReadOnlyList<IntakeInsight> Compute(
        IReadOnlyList<ParsedImportRow> rows,
        string? companyDomain,
        IReadOnlyList<string> newDepartments)
    {
        ArgumentNullException.ThrowIfNull(rows);
        var insights = new List<IntakeInsight>();
        var domain = companyDomain?.Trim().TrimStart('@').ToLowerInvariant();

        var typos = new Dictionary<(string Bad, string Good), List<int>>();
        var outside = new Dictionary<string, List<int>>();
        var invalid = new List<int>();
        var missingEmail = new List<int>();
        var missingName = new List<int>();
        var noDepartment = new List<int>();

        foreach (var row in rows)
        {
            if (row.Name.Length == 0)
            {
                missingName.Add(row.RowNumber);
            }

            if (row.Department is null)
            {
                noDepartment.Add(row.RowNumber);
            }

            if (row.Email.Length == 0)
            {
                missingEmail.Add(row.RowNumber);
                continue;
            }

            if (!EmailPattern().IsMatch(row.Email))
            {
                invalid.Add(row.RowNumber);
                continue;
            }

            var emailDomain = row.Email[(row.Email.IndexOf('@') + 1)..];
            var fix = KnownTypos.GetValueOrDefault(emailDomain)
                ?? (domain is not null && emailDomain != domain && Distance(emailDomain, domain) <= 2 ? domain : null);
            if (fix is not null)
            {
                Add(typos, (emailDomain, fix), row.RowNumber);
            }
            else if (domain is not null && emailDomain != domain && !emailDomain.EndsWith("." + domain, StringComparison.Ordinal))
            {
                Add(outside, emailDomain, row.RowNumber);
            }
        }

        foreach (var ((bad, good), found) in typos.OrderByDescending(t => t.Value.Count))
        {
            insights.Add(new IntakeInsight("email_typo", found, bad, good));
        }

        if (invalid.Count > 0)
        {
            insights.Add(new IntakeInsight("invalid_email", invalid, null, null));
        }

        if (missingEmail.Count > 0)
        {
            insights.Add(new IntakeInsight("missing_email", missingEmail, null, null));
        }

        if (missingName.Count > 0)
        {
            insights.Add(new IntakeInsight("missing_name", missingName, null, null));
        }

        var duplicates = rows.Where(r => r.Email.Length > 0)
            .GroupBy(r => r.Email, StringComparer.OrdinalIgnoreCase)
            .Where(g => g.Count() > 1)
            .SelectMany(g => g.Skip(1))
            .Select(r => r.RowNumber)
            .ToList();
        if (duplicates.Count > 0)
        {
            insights.Add(new IntakeInsight("duplicate_in_file", duplicates, null, null));
        }

        foreach (var (other, found) in outside.OrderByDescending(o => o.Value.Count))
        {
            insights.Add(new IntakeInsight("outside_domain", found, other, domain));
        }

        if (noDepartment.Count > 0)
        {
            insights.Add(new IntakeInsight("no_department", noDepartment, null, null));
        }

        foreach (var name in newDepartments)
        {
            var rowsUsing = rows.Where(r => r.Department == name).Select(r => r.RowNumber).ToList();
            insights.Add(new IntakeInsight("new_department", rowsUsing, name, null));
        }

        return insights;
    }

    private static void Add<TKey>(Dictionary<TKey, List<int>> map, TKey key, int row)
        where TKey : notnull
    {
        if (!map.TryGetValue(key, out var list))
        {
            map[key] = list = [];
        }

        list.Add(row);
    }

    /// <summary>Levenshtein, bounded to short strings (domains).</summary>
    public static int Distance(string a, string b)
    {
        var previous = Enumerable.Range(0, b.Length + 1).ToArray();
        for (var i = 1; i <= a.Length; i++)
        {
            var current = new int[b.Length + 1];
            current[0] = i;
            for (var j = 1; j <= b.Length; j++)
            {
                var cost = a[i - 1] == b[j - 1] ? 0 : 1;
                current[j] = Math.Min(Math.Min(current[j - 1] + 1, previous[j] + 1), previous[j - 1] + cost);
            }

            previous = current;
        }

        return previous[b.Length];
    }
}
