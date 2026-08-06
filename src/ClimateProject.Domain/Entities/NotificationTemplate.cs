namespace ClimateProject.Domain.Entities;

public class NotificationTemplate
{
    public Guid Id { get; set; }
    public required string Name { get; set; }
    public required string Type { get; set; }
    public required string Channel { get; set; }
    // These are the emails a bilingual workforce receives, which puts them in Tier 1
    // alongside survey content. In scope for the schema, deferred for the UI --
    // #97 defines the notification surface and owns the editor.
    public string? SubjectEn { get; set; }
    public string? SubjectEs { get; set; }
    public string? TitleEn { get; set; }
    public string? TitleEs { get; set; }
    public string? ContentEn { get; set; }
    public string? ContentEs { get; set; }
    public string? HtmlContentEn { get; set; }
    public string? HtmlContentEs { get; set; }
    public Guid? CompanyId { get; set; }
    public bool IsActive { get; set; } = true;
    public bool IsDefault { get; set; }
    public Guid CreatedBy { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset UpdatedAt { get; set; }
}

public class NotificationTemplateVariable
{
    public Guid Id { get; set; }
    public Guid NotificationTemplateId { get; set; }
    public required string Name { get; set; }
    public required string Type { get; set; }
    public bool Required { get; set; }
    public required string Description { get; set; }
    public string? DefaultValue { get; set; }
}

public class NotificationPersonalizationRule
{
    public Guid Id { get; set; }
    public Guid NotificationTemplateId { get; set; }
    public required string Condition { get; set; }
    public string? Modifications { get; set; }
}
