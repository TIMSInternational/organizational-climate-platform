namespace ClimateTracking.Application.Auth;

public static class Roles
{
    /// <summary>
    /// Named rather than spelled out at each use: <see cref="MatchingTenantHandler"/> admits
    /// this role and ONLY this role past the tenant gate, and the difference between it and
    /// <see cref="Admin"/> there is the difference between "the platform operator" and "any
    /// company administrator, including another tenant's".
    /// </summary>
    public const string SuperAdmin = "super_admin";

    public const string CompanyAdmin = "company_admin";

    public static readonly string[] Admin = [CompanyAdmin, SuperAdmin];
    public static readonly string[] PlanCreator = ["leader", CompanyAdmin, SuperAdmin];
}
