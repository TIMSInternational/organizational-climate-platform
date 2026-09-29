namespace ClimateProject.Application.OrgStructure;

public sealed record BulkImportRowResult(
    int RowNumber,
    string Name,
    string Email,
    string Role,
    string? Department,
    string Status,
    IReadOnlyList<string> Errors,
    IReadOnlyList<BulkImportIssue> Issues);

/// <summary>
/// One reason a row cannot go in, as a stable code the screen translates, beside the English
/// sentence in <see cref="BulkImportRowResult.Errors"/> that the CSV path has always returned.
/// <see cref="Value"/> is what the reason is about when it is about something (the role or the
/// department the row named).
/// </summary>
public sealed record BulkImportIssue(string Code, string? Value = null);

public sealed record BulkImportResponse(
    IReadOnlyList<BulkImportRowResult> Rows,
    int SuccessCount,
    int ErrorCount);

public sealed record ParsedImportRow(int RowNumber, string Name, string Email, string Role, string? Department);

/// <summary>
/// One row as the wizard hands it back after the admin has reviewed and possibly edited it.
///
/// <para>Every field is nullable because this is what a half-filled form posts, and a null here
/// must reach the same "Name is required" the CSV path produces rather than a 400 that names no
/// row. <see cref="RowNumber"/> is the row in the admin's own spreadsheet, carried through
/// untouched so the errors the screen shows can be found in the file they came from.</para>
/// </summary>
public sealed record BulkImportRowInput(
    int RowNumber,
    string? Name,
    string? Email,
    string? Role,
    string? Department);

public sealed record BulkImportRowsRequest(
    Guid CompanyId,
    bool Preview,
    IReadOnlyList<BulkImportRowInput>? Rows);
