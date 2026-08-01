namespace ClimateProject.Application.OrgStructure;

public sealed record BulkImportRowResult(
    int RowNumber,
    string Name,
    string Email,
    string Role,
    string? Department,
    string Status,
    IReadOnlyList<string> Errors);

public sealed record BulkImportResponse(
    IReadOnlyList<BulkImportRowResult> Rows,
    int SuccessCount,
    int ErrorCount);

public sealed record ParsedImportRow(int RowNumber, string Name, string Email, string Role, string? Department);
