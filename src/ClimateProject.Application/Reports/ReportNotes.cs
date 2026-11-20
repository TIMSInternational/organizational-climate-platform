namespace ClimateProject.Application.Reports;

/// <summary>
/// «Notas de TIMS» on a report: introduction, conclusions and recommendations, in Spanish and
/// in English (ruled 2026-11-19, <c>docs/decisions/editable-respondent-content.md</c>). The six
/// columns are <c>reports.notes_{intro,conclusions,recommendations}_{en,es}</c>.
/// </summary>
public static class ReportNotes
{
    /// <summary>The width of each of the six columns.</summary>
    public const int MaxLength = 4000;
}
