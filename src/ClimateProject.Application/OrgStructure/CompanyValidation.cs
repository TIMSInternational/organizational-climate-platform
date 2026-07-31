using System.Text.RegularExpressions;

namespace ClimateProject.Application.OrgStructure;

public static class CompanyValidation
{
    // Same pattern the legacy climate-project app used for company domain validation.
    private static readonly Regex DomainPattern = new(
        @"^[a-zA-Z0-9][a-zA-Z0-9-]{1,61}[a-zA-Z0-9]\.[a-zA-Z]{2,}$",
        RegexOptions.Compiled);

    public static readonly string[] ValidSizes = ["startup", "small", "medium", "large", "enterprise"];
    public static readonly string[] ValidSubscriptionTiers = ["basic", "professional", "enterprise"];

    public static bool IsValidDomain(string domain) => DomainPattern.IsMatch(domain);
}
