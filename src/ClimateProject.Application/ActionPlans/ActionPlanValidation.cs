namespace ClimateProject.Application.ActionPlans;

public static class ActionPlanValidation
{
    public static readonly string[] ValidStatuses = ["not_started", "in_progress", "completed", "overdue", "cancelled"];
    public static readonly string[] ValidPriorities = ["low", "medium", "high", "critical"];
    public static readonly string[] ValidMeasurementFrequencies = ["daily", "weekly", "monthly", "quarterly"];
}
