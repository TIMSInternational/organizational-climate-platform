namespace ClimateProject.Application.OrgStructure.Intake;

/// <summary>
/// What <c>POST /admin/users/bulk-import/understand</c> returns: how the file was read, the
/// mapping the admin can correct, the rows it produced for the review table, and what deserves
/// a look before approving. Nothing has been written when this is returned.
/// </summary>
/// <param name="Source">
/// <c>template</c> (our own workbook, read without a model), <c>ai</c>, <c>heuristic</c> (header
/// words, because the model was unavailable or failed — see <paramref name="FailureCode"/>) or
/// <c>manual</c> (the admin's corrected mapping, applied without a model).
/// </param>
/// <param name="Targets">What the mapping may point at, so the editor offers exactly those.</param>
public sealed record IntakeUnderstandResponse(
    string Source,
    string? FailureCode,
    IntakeMapping Mapping,
    IReadOnlyList<ParsedImportRow> Rows,
    IReadOnlyList<string> NewDepartments,
    IReadOnlyList<IntakeParseProblem> Problems,
    IReadOnlyList<IntakeInsight> Insights,
    IntakeFileFacts File,
    IntakeAiFacts? Ai,
    IntakeTargets Targets);

/// <param name="Sheets">Every sheet read, with its size.</param>
/// <param name="NamesNormalised">Names re-cased from all-capitals or all-lower-case.</param>
/// <param name="SkippedRows">Rows under the header that held no person (totals, subtotals).</param>
public sealed record IntakeFileFacts(
    string FileName,
    IReadOnlyList<IntakeSheetFacts> Sheets,
    int NamesNormalised,
    IReadOnlyList<int> SkippedRows);

public sealed record IntakeSheetFacts(string Name, int Rows, int Columns);

/// <summary>
/// The model's part, stated plainly — including exactly what it was shown, so "the AI never saw
/// your people" is something the admin can check on screen rather than take on trust.
/// </summary>
/// <param name="CategoryColumns">Columns whose distinct values were shared (areas, job titles, sites).</param>
/// <param name="MaskedColumns">Columns shared only as masked samples (names, emails, identity numbers).</param>
/// <param name="Cached">True when an identical file for this company was mapped moments ago and the answer reused.</param>
public sealed record IntakeAiFacts(
    string Model,
    long? InputTokens,
    long? OutputTokens,
    long DurationMs,
    bool Cached,
    IReadOnlyList<string> CategoryColumns,
    IReadOnlyList<string> MaskedColumns);
