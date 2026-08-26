using System.Reflection;

namespace ClimateTracking.Api;

/// <summary>
/// Build provenance baked into the assembly at compile time and surfaced by
/// <c>GET /version</c>.
///
/// This is the tracking service's copy of <c>src/ClimateProject.Api/BuildInfo.cs</c>,
/// deliberately identical rather than reinvented -- the two services are read by the
/// same tool. <c>scripts/read-deployed-commit.sh</c> is what both
/// <c>deploy-prod.yml</c> and <c>deploy-tracking-prod.yml</c> use to answer "did the
/// rollout I just performed take effect?", and it requires a <c>.commit</c> matching
/// <c>^[0-9a-f]{40}$</c>. Until this existed, <c>/version</c> on this service reported
/// <c>{service, runtime, environment}</c> -- three values that do not change when the
/// code does -- so a deploy that silently no-op'd and a deploy that worked produced
/// byte-identical output. That is the failure that let climate-project's production
/// sit 156 commits behind <c>main</c> with every signal green.
///
/// The values are supplied as MSBuild properties (<c>/p:CommitSha=</c>,
/// <c>/p:BuildTimestamp=</c>) which the SDK emits as
/// <see cref="AssemblyMetadataAttribute"/> entries -- see ClimateTracking.Api.csproj.
/// <c>services/tracking-api/Dockerfile</c> threads them in as build args and
/// <c>deploy-tracking-prod.yml</c> passes the real commit and build time. A local
/// <c>dotnet build</c> that passes neither yields <see cref="Unknown"/>, which is
/// deliberately a *distinguishable* value rather than an empty string: the reader
/// script treats <c>unknown</c> in production as a finding -- an image built outside
/// the CI/Docker path is serving traffic -- not as a parse error.
/// </summary>
internal static class BuildInfo
{
    /// <summary>
    /// Reported when a build did not supply provenance -- i.e. any build that did not
    /// go through the Docker/CI path. Asserted against in the integration tests, so it
    /// is part of the contract rather than an incidental default.
    /// </summary>
    public const string Unknown = "unknown";

    /// <summary>Full git commit SHA the assembly was built from, or <see cref="Unknown"/>.</summary>
    public static string CommitSha { get; } = ReadMetadata(nameof(CommitSha));

    /// <summary>UTC ISO-8601 instant the assembly was built, or <see cref="Unknown"/>.</summary>
    public static string BuildTimestamp { get; } = ReadMetadata(nameof(BuildTimestamp));

    private static string ReadMetadata(string key)
    {
        var value = typeof(BuildInfo).Assembly
            .GetCustomAttributes<AssemblyMetadataAttribute>()
            .FirstOrDefault(attribute => string.Equals(attribute.Key, key, StringComparison.Ordinal))
            ?.Value;

        // Treat whitespace as absent too: `--build-arg COMMIT_SHA=` in a workflow yields
        // an empty property, which would otherwise be reported as a blank commit and read
        // as legitimate provenance by anything parsing this.
        return string.IsNullOrWhiteSpace(value) ? Unknown : value;
    }
}
