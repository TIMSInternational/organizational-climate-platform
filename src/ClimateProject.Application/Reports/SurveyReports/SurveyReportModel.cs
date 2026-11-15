using ClimateProject.Application.Exports;
using ClimateProject.Application.Surveys;

namespace ClimateProject.Application.Reports.SurveyReports;

/// <summary>Which of the company's three result areas a reading falls in.</summary>
public enum SurveyReportBand
{
    /// <summary>Below the opportunity boundary.</summary>
    Critical,

    /// <summary>From the opportunity boundary to just below the strength boundary.</summary>
    Opportunity,

    /// <summary>From the strength boundary up.</summary>
    Strength,
}

/// <summary>The company's result areas: two boundaries on the 1-5 mean and the three names.</summary>
/// <remarks>
/// Always on the 1-5 mean, whatever the company prints readings as (<see cref="ScoreScale"/>):
/// the bands, like storage and the privacy floor, never convert (Company.cs).
/// </remarks>
public sealed record SurveyReportBands(
    decimal OpportunityMin,
    decimal StrengthMin,
    string CriticalName,
    string OpportunityName,
    string StrengthName)
{
    /// <summary>
    /// The area <paramref name="mean"/> falls in. Rounded to the two decimals it is printed
    /// with first, so a reading printed "4,00" is never coloured as an opportunity.
    /// </summary>
    /// <summary>
    /// The company's areas as «Resultados» configures them, each unnamed area falling back to the
    /// report's own word for it in <paramref name="locale"/>.
    /// </summary>
    public static SurveyReportBands From(ClimateProject.Domain.Entities.CompanySettings? settings, string? locale)
    {
        settings ??= new ClimateProject.Domain.Entities.CompanySettings();
        var (critical, opportunity, strength) = SurveyReportCopy.For(locale).DefaultBandNames;
        return new SurveyReportBands(
            settings.ResultBandOpportunityMin,
            settings.ResultBandStrengthMin,
            string.IsNullOrWhiteSpace(settings.ResultBandCriticalName) ? critical : settings.ResultBandCriticalName,
            string.IsNullOrWhiteSpace(settings.ResultBandOpportunityName) ? opportunity : settings.ResultBandOpportunityName,
            string.IsNullOrWhiteSpace(settings.ResultBandStrengthName) ? strength : settings.ResultBandStrengthName);
    }

    public SurveyReportBand Of(double mean)
    {
        var printed = (decimal)Math.Round(mean, 2, MidpointRounding.AwayFromZero);
        return printed >= StrengthMin
            ? SurveyReportBand.Strength
            : printed >= OpportunityMin ? SurveyReportBand.Opportunity : SurveyReportBand.Critical;
    }

    /// <summary>The company's name for an area.</summary>
    public string NameOf(SurveyReportBand band) => band switch
    {
        SurveyReportBand.Strength => StrengthName,
        SurveyReportBand.Opportunity => OpportunityName,
        _ => CriticalName,
    };
}

/// <summary>One dimension: its mean and the range its departments span.</summary>
/// <param name="Low">The lowest department mean among the departments the report shows; null with none.</param>
public sealed record SurveyReportDimension(string Key, string Name, double? Average, double? Low, double? High, int QuestionCount);

/// <summary>One department the report shows.</summary>
public sealed record SurveyReportDepartment(
    string Id,
    string Name,
    int RespondentCount,
    int? Headcount,
    double? Average,
    IReadOnlyDictionary<string, double?> DimensionAverages);

/// <summary>A cross table with its variables' and values' display names.</summary>
public sealed record SurveyReportCross(
    string RowName,
    string? ColumnName,
    CrossTab Table,
    IReadOnlyDictionary<string, string> RowValueNames,
    IReadOnlyDictionary<string, string> ColumnValueNames);

/// <summary>One closed question (scale or choice) and how its answers were spread.</summary>
public sealed record SurveyReportQuestion(
    string Code,
    string? Text,
    string? DimensionName,
    string Type,
    int AnsweredCount,
    double? Average,
    int? ScaleMin,
    int? ScaleMax,
    string? ScaleLabelMin,
    string? ScaleLabelMax,
    IReadOnlyList<SurveyDistributionBucket> Distribution)
{
    /// <summary>True for a 1-5 scale, the only kind the company's areas colour.</summary>
    public bool IsBandedScale => Average is not null && ScaleMin == 1 && ScaleMax == 5;
}

/// <summary>One open question: word counts only, never the text anyone wrote.</summary>
public sealed record SurveyReportOpenQuestion(
    string Code,
    string? Text,
    int AnsweredCount,
    IReadOnlyList<SurveyWordFrequency> Words,
    int SuppressedWordCount);

/// <summary>One dimension in both surveys.</summary>
public sealed record SurveyReportDimensionDelta(string Name, double Before, double Now);

/// <summary>The comparison with an earlier survey.</summary>
/// <param name="IsSuppressed">The earlier survey is under the floor, so it has no numbers to compare.</param>
public sealed record SurveyReportComparison(
    string? Title,
    bool IsSuppressed,
    double? OverallBefore,
    IReadOnlyList<SurveyReportDimensionDelta> Dimensions,
    int UnmatchedDimensionCount);

/// <summary>
/// Everything the survey report prints, computed. The renderer draws this and decides nothing:
/// every floor and every protected cell is already settled here, by the aggregation.
/// </summary>
public sealed record SurveyReportModel(
    string Locale,
    string? CompanyName,
    string? SurveyTitle,
    string SurveyStatus,
    DateTimeOffset GeneratedAt,
    ScoreScale Scale,
    SurveyReportBands Bands,
    IReadOnlySet<string> Sections,
    SurveyResultsSummary Participation,
    bool IsSuppressed,
    double? OverallAverage,
    IReadOnlyList<SurveyReportDimension> Dimensions,
    IReadOnlyList<SurveyReportDepartment> Departments,
    int OmittedDepartmentCount,
    IReadOnlyList<SurveyReportCross> Crosses,
    IReadOnlyList<SurveyReportQuestion> Questions,
    IReadOnlyList<SurveyReportOpenQuestion> OpenQuestions,
    SurveyReportComparison? Comparison)
{
    /// <summary>True when the report prints <paramref name="section"/>.</summary>
    public bool Has(string section) => Sections.Contains(section);

    /// <summary>Cross cells printed as protected, across every cross.</summary>
    public int ProtectedCellCount => Crosses.Sum(c => c.Table.ProtectedCount);

    /// <summary>Cross cells that print a number, across every cross.</summary>
    public int DisclosedCellCount => Crosses.Sum(c => c.Table.DisclosedCount);
}

/// <summary>What the builder reads.</summary>
/// <param name="Whole">The survey's unfiltered aggregate, computed from <paramref name="Inputs"/>.</param>
/// <param name="Compare">The earlier survey's unfiltered aggregate, when one was asked for.</param>
public sealed record SurveyReportSource(
    string Locale,
    string? CompanyName,
    string? SurveyTitle,
    string SurveyStatus,
    DateTimeOffset GeneratedAt,
    ScoreScale Scale,
    SurveyReportBands Bands,
    SurveyAggregationInputs Inputs,
    SurveyAggregate Whole,
    SurveyExportLabels Labels,
    SurveyReportOptions Options,
    string? CompareTitle,
    SurveyAggregate? Compare);
