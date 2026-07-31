namespace ClimateProject.Domain.Entities;

public class SurveyDistribution
{
    public Guid Id { get; set; }
    public Guid SurveyId { get; set; }
    public string AccessType { get; set; } = "tokenized";
    public string? PublicUrl { get; set; }
    public required string QrCodeUrl { get; set; }
    public string? QrCodeSvgUrl { get; set; }
    public string? QrCodePngUrl { get; set; }
    public string? QrCodePdfUrl { get; set; }
    public int TokenizedLinksGenerated { get; set; }
    public int RegeneratedCount { get; set; }
    public DateTimeOffset? LastRegeneratedAt { get; set; }
    public Guid? LastRegeneratedBy { get; set; }
    public int TotalAccesses { get; set; }
    public int UniqueVisitors { get; set; }
    public DateTimeOffset? LastAccessedAt { get; set; }
    public AccessRules AccessRules { get; set; } = new();
    public QrCustomization QrCustomization { get; set; } = new();
    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset UpdatedAt { get; set; }
}

public class AccessRules
{
    public bool RequireLogin { get; set; } = true;
    public bool AllowAnonymous { get; set; }
    public bool SingleResponse { get; set; } = true;
    public bool ActiveOutsideSchedule { get; set; }
    public string[]? AllowedDomains { get; set; }
    public string[]? BlockedIps { get; set; }
    public int? MaxResponses { get; set; }
}

public class QrCustomization
{
    public string ForegroundColor { get; set; } = "#000000";
    public string BackgroundColor { get; set; } = "#FFFFFF";
    public string? LogoUrl { get; set; }
    public int Size { get; set; } = 300;
}
