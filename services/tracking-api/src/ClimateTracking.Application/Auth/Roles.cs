namespace ClimateTracking.Application.Auth;

public static class Roles
{
    public static readonly string[] Admin = ["company_admin", "super_admin"];
    public static readonly string[] PlanCreator = ["leader", "company_admin", "super_admin"];
}
