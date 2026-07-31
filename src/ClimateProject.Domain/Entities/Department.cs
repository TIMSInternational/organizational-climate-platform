namespace ClimateProject.Domain.Entities;

public class Department
{
    public Guid Id { get; set; }
    public Guid CompanyId { get; set; }
    public required string Name { get; set; }
    public string? Description { get; set; }
    public Guid? ParentDepartmentId { get; set; }
    public Guid? ManagerId { get; set; }
    public int EmployeeCount { get; set; }
    public bool IsActive { get; set; } = true;
    public DepartmentSettings Settings { get; set; } = new();
    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset UpdatedAt { get; set; }
}

public class DepartmentSettings
{
    public bool SurveyParticipationRequired { get; set; } = true;
    public string MicroclimateFrequency { get; set; } = "monthly";
    public bool AutoActionPlans { get; set; } = true;
    public bool NotificationEmail { get; set; } = true;
    public bool NotificationSlack { get; set; }
    public bool NotificationTeams { get; set; }
}
