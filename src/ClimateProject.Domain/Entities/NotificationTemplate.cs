namespace ClimateProject.Domain.Entities;

public class NotificationTemplate
{
    public Guid Id { get; set; }
    public required string Name { get; set; }
    public required string Type { get; set; }
    public required string Channel { get; set; }
    public string? Subject { get; set; }
    public required string Title { get; set; }
    public required string Content { get; set; }
    public string? HtmlContent { get; set; }
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
