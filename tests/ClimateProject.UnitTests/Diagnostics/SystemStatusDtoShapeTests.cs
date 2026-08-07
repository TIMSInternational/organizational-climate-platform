using System.Reflection;
using ClimateProject.Application.Diagnostics;

namespace ClimateProject.UnitTests.Diagnostics;

/// <summary>
/// Structural guards on the <c>GET /admin/system/status</c> payload.
///
/// A diagnostics endpoint is the single most likely place in a codebase for a credential to
/// leak, because every useful field on it is one field away from a useless-but-tempting one:
/// the port is fine, the host is not; the pool bound is fine, the connection string it came
/// from is not; a status word is fine, the Npgsql exception text behind it is not. Reviewing
/// that by eye works once. These tests make it hold.
/// </summary>
public class SystemStatusDtoShapeTests
{
    /// <summary>Substrings that must never appear in a property name on this payload.</summary>
    private static readonly string[] ForbiddenNameFragments =
    [
        "connectionstring",
        "password",
        "secret",
        "credential",
        "apikey",
        "token",
        "username",
        "host",
    ];

    /// <summary>
    /// Every record reachable from <see cref="SystemStatusResponse"/>, walked rather than
    /// listed so a component added later is covered without anyone remembering to add it here.
    /// </summary>
    private static IEnumerable<Type> PayloadTypes()
    {
        var seen = new HashSet<Type>();
        var pending = new Stack<Type>();
        pending.Push(typeof(SystemStatusResponse));

        while (pending.Count > 0)
        {
            var type = pending.Pop();
            if (!seen.Add(type)) continue;

            foreach (var property in type.GetProperties(BindingFlags.Public | BindingFlags.Instance))
            {
                var propertyType = Nullable.GetUnderlyingType(property.PropertyType) ?? property.PropertyType;
                if (propertyType.Namespace?.StartsWith("ClimateProject", StringComparison.Ordinal) == true)
                {
                    pending.Push(propertyType);
                }
            }
        }

        return seen;
    }

    [Fact]
    public void No_property_on_the_status_payload_is_named_like_a_secret()
    {
        var offenders = PayloadTypes()
            .SelectMany(type => type
                .GetProperties(BindingFlags.Public | BindingFlags.Instance)
                .Select(property => (Type: type, Property: property)))
            .Where(entry => ForbiddenNameFragments.Any(fragment =>
                entry.Property.Name.Contains(fragment, StringComparison.OrdinalIgnoreCase)))
            .Select(entry => $"{entry.Type.Name}.{entry.Property.Name}")
            .ToList();

        Assert.Empty(offenders);
    }

    [Fact]
    public void The_payload_walk_actually_reaches_every_component()
    {
        // Without this, the test above could pass by walking nothing at all -- a reflection
        // guard that silently stops traversing is indistinguishable from one that finds
        // nothing wrong.
        var types = PayloadTypes().ToList();

        Assert.Contains(typeof(SystemStatusResponse), types);
        Assert.Contains(typeof(SystemBuildStatus), types);
        Assert.Contains(typeof(SystemDatabaseStatus), types);
        Assert.Contains(typeof(SystemNotificationQueueStatus), types);
        Assert.Contains(typeof(SystemDispatcherStatus), types);
    }

    [Fact]
    public void No_property_on_the_status_payload_is_language_shaped()
    {
        // #195's constraint: a read DTO that exposes <field>_en / <field>_es pairs turns a
        // third language from a migration into a frontend rewrite. Status values here are
        // machine tokens precisely so this endpoint never acquires such a pair.
        var offenders = PayloadTypes()
            .SelectMany(type => type
                .GetProperties(BindingFlags.Public | BindingFlags.Instance)
                .Select(property => (Type: type, Property: property)))
            .Where(entry =>
                entry.Property.Name.EndsWith("En", StringComparison.Ordinal)
                || entry.Property.Name.EndsWith("Es", StringComparison.Ordinal))
            .Select(entry => $"{entry.Type.Name}.{entry.Property.Name}")
            .ToList();

        Assert.Empty(offenders);
    }

    [Fact]
    public void Every_component_status_token_is_locale_independent_lowercase()
    {
        // The frontend renders these; if one of them ever becomes a sentence, it becomes an
        // untranslated user-facing string in the API. Tokens stay lowercase and hyphenated.
        var tokens = new[]
        {
            SystemStatuses.Ok,
            SystemStatuses.Degraded,
            SystemStatuses.Unhealthy,
            SystemComponentStatuses.Ok,
            SystemComponentStatuses.Slow,
            SystemComponentStatuses.Timeout,
            SystemComponentStatuses.Unreachable,
            SystemComponentStatuses.Backlog,
            SystemComponentStatuses.NeverRun,
            SystemComponentStatuses.Stale,
            SystemComponentStatuses.Unknown,
        };

        Assert.All(tokens, token =>
        {
            Assert.False(string.IsNullOrWhiteSpace(token));
            Assert.DoesNotContain(' ', token);
            Assert.Equal(token.ToLowerInvariant(), token);
        });
    }
}
