using System.Reflection;

namespace ClimateProject.Api;

/// <summary>
/// Build provenance baked into the assembly at compile time and surfaced by
/// <c>GET /version</c>.
///
/// Why this exists: <c>/version</c> previously reported only the service name, the
/// .NET runtime version and the environment name -- none of which change when the
/// code does. There was therefore no way, from outside the box, to tell which
/// commit a running instance was built from. That is not a cosmetic gap: it is what
/// allowed production to drift 156 commits behind <c>main</c> without anyone
/// noticing, because a deploy that silently did nothing and a deploy that worked
/// produced byte-identical <c>/version</c> output.
///
/// The values are supplied as MSBuild properties (<c>/p:CommitSha=</c>,
/// <c>/p:BuildTimestamp=</c>) which the SDK emits as
/// <see cref="AssemblyMetadataAttribute"/> entries -- see
/// ClimateProject.Api.csproj. The Dockerfile threads them in as build args, and
/// deploy-prod.yml passes the real commit and build time. A local
/// <c>dotnet build</c> that passes neither yields <see cref="Unknown"/>, which is
/// deliberately a *distinguishable* value rather than an empty string: "this build
/// carries no provenance" and "this build was stamped with an empty commit" are
/// different states and only one of them indicates a broken deploy pipeline.
/// </summary>
internal static class BuildInfo
{
    /// <summary>
    /// Reported when a build did not supply provenance -- i.e. any build that did
    /// not go through the Docker/CI path. Asserted against in the integration
    /// tests, so it is part of the contract rather than an incidental default.
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

        // Treat whitespace as absent too: `--build-arg COMMIT_SHA=` in a workflow
        // yields an empty property, which would otherwise be reported as a blank
        // commit and read as legitimate provenance by anything parsing this.
        return string.IsNullOrWhiteSpace(value) ? Unknown : value;
    }
}
