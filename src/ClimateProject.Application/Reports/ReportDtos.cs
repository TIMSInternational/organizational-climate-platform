namespace ClimateProject.Application.Reports;

public sealed record ReportListItem(Guid Id, string Title, string Type, Guid CompanyId, string Status, string Format, DateTimeOffset CreatedAt);

public sealed record ReportDetail(
    Guid Id, string Title, string? Description, string Type, Guid CompanyId, Guid CreatedBy,
    string? TemplateId, string Status, string Format, string? ReportOutput, int DownloadCount,
    DateTimeOffset? GenerationStartedAt, DateTimeOffset? GenerationCompletedAt, DateTimeOffset CreatedAt);

public sealed record CreateReportRequest(string Title, string? Description, string Type, Guid CompanyId, string Format, string? TemplateId);
