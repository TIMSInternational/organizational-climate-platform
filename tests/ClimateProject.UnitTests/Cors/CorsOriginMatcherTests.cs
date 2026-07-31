using ClimateProject.Application.Cors;

namespace ClimateProject.UnitTests.Cors;

public class CorsOriginMatcherTests
{
    [Fact]
    public void IsAllowed_returns_true_for_exact_origin_match()
    {
        var matcher = new CorsOriginMatcher(
            exactOrigins: ["http://localhost:5173"],
            wildcardOrigins: []);

        Assert.True(matcher.IsAllowed("http://localhost:5173"));
    }

    [Fact]
    public void IsAllowed_returns_false_for_unlisted_origin()
    {
        var matcher = new CorsOriginMatcher(
            exactOrigins: ["http://localhost:5173"],
            wildcardOrigins: []);

        Assert.False(matcher.IsAllowed("https://evil.example.com"));
    }

    [Fact]
    public void IsAllowed_returns_true_for_wildcard_subdomain_match()
    {
        var matcher = new CorsOriginMatcher(
            exactOrigins: [],
            wildcardOrigins: ["https://*.vercel.app"]);

        Assert.True(matcher.IsAllowed("https://organizational-climate-platform-git-main-fedes-projects.vercel.app"));
    }

    [Fact]
    public void IsAllowed_returns_false_for_near_miss_wildcard_suffix()
    {
        var matcher = new CorsOriginMatcher(
            exactOrigins: [],
            wildcardOrigins: ["https://*.vercel.app"]);

        // "notvercel.app" ends with "vercel.app" but NOT ".vercel.app" -- must not match.
        Assert.False(matcher.IsAllowed("https://notvercel.app"));
    }
}
