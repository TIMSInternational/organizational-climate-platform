namespace ClimateProject.Application.Auth;

public static class Roles
{
    public const string SuperAdmin = "super_admin";
    public const string CompanyAdmin = "company_admin";
    public const string Leader = "leader";
    public const string Supervisor = "supervisor";
    public const string Employee = "employee";

    public static readonly string[] All = [SuperAdmin, CompanyAdmin, Leader, Supervisor, Employee];
    public static readonly string[] Admin = [SuperAdmin, CompanyAdmin];
}
