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

    // ---------------------------------------------------------------------------
    // Project-scoped preview patterns (#211).
    //
    // The pattern below is a DELIBERATELY FICTIONAL placeholder that has the right
    // *shape* -- `<project>-<branch-ish>-<team>.vercel.app`. It is NOT the value
    // deployed as `CorsAllowedWildcardOrigin`, and it is not a guess at it: the
    // real preview pattern has to be read out of the Vercel project settings,
    // which is the part of #211 that is still open. These tests pin the matcher's
    // *behaviour* for project-scoped patterns so that whoever fills in the real
    // value has the security properties already covered.
    // ---------------------------------------------------------------------------

    private const string ProjectScopedPreviewPattern = "https://example-app-*-example-team.vercel.app";

    [Fact]
    public void IsAllowed_returns_true_for_project_scoped_preview_origin()
    {
        var matcher = new CorsOriginMatcher(
            exactOrigins: [],
            wildcardOrigins: [ProjectScopedPreviewPattern]);

        // A preview origin from the project's own namespace: the wildcard covers
        // the branch/commit segment in the middle.
        Assert.True(matcher.IsAllowed("https://example-app-git-main-example-team.vercel.app"));
    }

    [Fact]
    public void IsAllowed_returns_false_for_bare_vercel_origin_against_project_scoped_pattern()
    {
        var matcher = new CorsOriginMatcher(
            exactOrigins: [],
            wildcardOrigins: [ProjectScopedPreviewPattern]);

        // THE POINT OF SCOPING THE PATTERN. Anyone can deploy to vercel.app, so an
        // arbitrary vercel.app origin must not be a permitted CORS origin against
        // production. It fails the prefix test, and would also fail the suffix test.
        Assert.False(matcher.IsAllowed("https://evil.vercel.app"));
    }

    [Fact]
    public void IsAllowed_returns_false_when_project_matches_but_team_does_not()
    {
        var matcher = new CorsOriginMatcher(
            exactOrigins: [],
            wildcardOrigins: [ProjectScopedPreviewPattern]);

        // Satisfies the prefix (same project name) but not the suffix (different
        // team namespace). Both halves are required, so this must not match.
        Assert.False(matcher.IsAllowed("https://example-app-git-main-attacker-team.vercel.app"));
    }

    [Fact]
    public void IsAllowed_returns_false_when_a_rename_invalidates_both_halves_of_the_pattern()
    {
        // Regression shape for #211: a pattern left over from before a project or
        // team rename matches nothing, because the rename changes the prefix AND
        // the suffix. This is why preview deployments silently stopped being able
        // to call the API -- there is no partial-credit in a prefix/suffix match.
        var matcher = new CorsOriginMatcher(
            exactOrigins: [],
            wildcardOrigins: ["https://old-name-*-old-team.vercel.app"]);

        Assert.False(matcher.IsAllowed("https://new-name-git-main-new-team.vercel.app"));
    }

    [Fact]
    public void IsAllowed_broad_vercel_wildcard_admits_an_attacker_origin()
    {
        // Documents the hazard rather than endorsing it: `https://*.vercel.app`
        // reduces to "ends with .vercel.app" under this matcher, so it admits any
        // Vercel deployment by anyone. This test exists so that "fixing" #211 by
        // widening the pattern is a visible, deliberate act and not a quiet one.
        // Keep the deployed pattern scoped to the project's own namespace.
        var matcher = new CorsOriginMatcher(
            exactOrigins: [],
            wildcardOrigins: ["https://*.vercel.app"]);

        Assert.True(matcher.IsAllowed("https://evil.vercel.app"));
    }
}
