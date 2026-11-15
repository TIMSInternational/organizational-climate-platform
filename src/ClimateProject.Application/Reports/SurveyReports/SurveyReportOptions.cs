using System.Globalization;
using ClimateProject.Application.Surveys;

namespace ClimateProject.Application.Reports.SurveyReports;

/// <summary>The sections a survey report can carry, as the wizard's «Contenido» step names them.</summary>
public static class SurveyReportSections
{
    /// <summary>The cover: overall mean, participation, strengths and opportunities, the three highest and lowest questions.</summary>
    public const string Summary = "summary";

    /// <summary>The climate bar of every dimension, from its lowest department to its highest.</summary>
    public const string Dimensions = "dimensions";

    /// <summary>Departments by dimensions, each cell coloured by its area.</summary>
    public const string Map = "map";

    /// <summary>One table per cross the wizard chose.</summary>
    public const string Crosses = "crosses";

    /// <summary>How every question's answers were spread.</summary>
    public const string Questions = "questions";

    /// <summary>The five highest and five lowest questions.</summary>
    public const string Highlights = "highlights";

    /// <summary>The change per dimension against an earlier survey.</summary>
    public const string Comparison = "comparison";

    /// <summary>The most frequent words of the open questions -- never anyone's text.</summary>
    public const string Comments = "comments";

    /// <summary>
    /// Every section, in the order the document prints them. The comparison follows the map,
    /// as in the design: both read dimension by dimension, so they sit together.
    /// </summary>
    public static readonly IReadOnlyList<string> All =
        [Summary, Dimensions, Map, Comparison, Crosses, Questions, Highlights, Comments];

    /// <summary>What a report carries when the request names no sections: everything but the comments page, which the wizard leaves off by default.</summary>
    public static readonly IReadOnlyList<string> Default =
        [Summary, Dimensions, Map, Comparison, Crosses, Questions, Highlights];
}

/// <summary>One cross the report draws: a row variable, crossed with a column variable or alone.</summary>
/// <param name="RowField">A demographic field key, or <see cref="SurveySegmentSelector.DepartmentField"/>.</param>
/// <param name="ColumnField">The second variable; null draws the first one alone.</param>
public sealed record SurveyReportCrossRequest(string RowField, string? ColumnField)
{
    /// <summary>The query-string form: <c>field</c> or <c>row*column</c>.</summary>
    public override string ToString() => ColumnField is null ? RowField : $"{RowField}*{ColumnField}";
}

/// <summary>What the report wizard asked for.</summary>
/// <param name="Sections">The sections to print (<see cref="SurveyReportSections"/>).</param>
/// <param name="DepartmentIds">
/// The departments that get rows in the map and the department crosses; null for every
/// department. A presentation choice, not a new cohort: the survey's own numbers stay the whole
/// survey's, because a mean "of six departments" is a cohort nobody's privacy rule was written
/// for and, compared with the whole survey, would let the other two be subtracted out.
/// </param>
/// <param name="Crosses">The crosses, in the order the wizard listed them.</param>
/// <param name="CompareSurveyId">An earlier survey of the same company to compare against.</param>
public sealed record SurveyReportOptions(
    IReadOnlySet<string> Sections,
    IReadOnlyList<Guid>? DepartmentIds,
    IReadOnlyList<SurveyReportCrossRequest> Crosses,
    Guid? CompareSurveyId)
{
    /// <summary>
    /// The most crosses one report may carry. Each is a page or two and a computation per cell;
    /// four already covers the combinations the design suggests, and a cap says plainly this is
    /// a report, not a query language over small groups.
    /// </summary>
    public const int MaxCrosses = 4;

    /// <summary>Everything, every department, no crosses, no comparison.</summary>
    public static readonly SurveyReportOptions Everything = new(
        new HashSet<string>(SurveyReportSections.Default, StringComparer.Ordinal), null, [], null);

    /// <summary>True when the report prints <paramref name="section"/>.</summary>
    public bool Has(string section) => Sections.Contains(section);

    /// <summary>
    /// Reads the query string. Reports the first problem in words a caller can act on; the
    /// fields' existence is checked later, against the survey's own variables.
    /// </summary>
    public static bool TryParse(
        string? sections,
        IEnumerable<string>? departments,
        IEnumerable<string>? crosses,
        string? compare,
        out SurveyReportOptions options,
        out string? error)
    {
        options = Everything;
        error = null;

        var sectionSet = new HashSet<string>(StringComparer.Ordinal);
        if (string.IsNullOrWhiteSpace(sections))
        {
            sectionSet.UnionWith(SurveyReportSections.Default);
        }
        else
        {
            foreach (var raw in sections.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries))
            {
                if (!SurveyReportSections.All.Contains(raw, StringComparer.Ordinal))
                {
                    error = $"Unknown report section '{raw}'. Use any of: {string.Join(", ", SurveyReportSections.All)}.";
                    return false;
                }

                sectionSet.Add(raw);
            }

            if (sectionSet.Count == 0)
            {
                error = "Name at least one report section.";
                return false;
            }
        }

        List<Guid>? departmentIds = null;
        var departmentList = (departments ?? []).Where(d => !string.IsNullOrWhiteSpace(d)).ToList();
        if (departmentList.Count > 0)
        {
            departmentIds = [];
            foreach (var raw in departmentList)
            {
                if (!Guid.TryParse(raw.Trim(), CultureInfo.InvariantCulture, out var id))
                {
                    error = $"Department '{raw}' must be a department id.";
                    return false;
                }

                if (!departmentIds.Contains(id))
                {
                    departmentIds.Add(id);
                }
            }
        }

        var crossList = new List<SurveyReportCrossRequest>();
        foreach (var raw in (crosses ?? []).Where(c => !string.IsNullOrWhiteSpace(c)).Select(c => c.Trim()))
        {
            var parts = raw.Split('*', StringSplitOptions.TrimEntries);
            if (parts.Length > 2 || parts.Any(p => p.Length == 0))
            {
                error = $"Cross '{raw}' must read 'field' or 'field*field'.";
                return false;
            }

            if (parts.Length == 2 && string.Equals(parts[0], parts[1], StringComparison.Ordinal))
            {
                error = $"Cross '{raw}' crosses a variable with itself.";
                return false;
            }

            var cross = new SurveyReportCrossRequest(parts[0], parts.Length == 2 ? parts[1] : null);
            if (crossList.Any(c => SameCross(c, cross)))
            {
                error = $"Cross '{raw}' is listed twice.";
                return false;
            }

            crossList.Add(cross);
        }

        if (crossList.Count > MaxCrosses)
        {
            error = $"A report carries at most {MaxCrosses} crosses; {crossList.Count} were requested.";
            return false;
        }

        Guid? compareId = null;
        if (!string.IsNullOrWhiteSpace(compare))
        {
            if (!Guid.TryParse(compare.Trim(), CultureInfo.InvariantCulture, out var parsed))
            {
                error = "compare must be a survey id.";
                return false;
            }

            compareId = parsed;
        }

        options = new SurveyReportOptions(sectionSet, departmentIds, crossList, compareId);
        return true;
    }

    // department*gender and gender*department are the same groups, transposed.
    private static bool SameCross(SurveyReportCrossRequest a, SurveyReportCrossRequest b)
        => (string.Equals(a.RowField, b.RowField, StringComparison.Ordinal)
            && string.Equals(a.ColumnField, b.ColumnField, StringComparison.Ordinal))
           || (a.ColumnField is not null
               && string.Equals(a.RowField, b.ColumnField, StringComparison.Ordinal)
               && string.Equals(a.ColumnField, b.RowField, StringComparison.Ordinal));
}
