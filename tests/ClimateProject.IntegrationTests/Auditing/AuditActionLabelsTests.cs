using System.Runtime.CompilerServices;
using System.Text.Json;
using ClimateProject.Api.Endpoints;
using ClimateProject.Api.Infrastructure.Auditing;
using ClimateProject.Application.Profile;
using ClimateProject.Infrastructure.Scheduling;
using ClimateProject.IntegrationTests.Support;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using Microsoft.Extensions.DependencyInjection;

namespace ClimateProject.IntegrationTests.Auditing;

/// <summary>
/// G21: the audit-log screen (<c>web/src/features/audit</c>) names every action in Spanish and in
/// English, and THIS is what says "every". The trail's <c>action</c> is a code --
/// <c>surveys.status.update</c> -- derived from the route that wrote it, so the set grows each
/// time a mutating route is mapped, and a screen that prints the code is a screen an
/// administrator cannot read.
/// </summary>
/// <remarks>
/// <para>
/// The set is read the way <see cref="AuditCoverageTests"/> reads it: from the live
/// <see cref="EndpointDataSource"/>, through <see cref="AuditPolicy.Decide"/> -- the function the
/// middleware calls -- plus the actions written without the middleware, named by their own
/// constants. A route mapped next week is in this test the moment it is mapped, and fails it
/// until its label exists in both catalogues.
/// </para>
/// <para>
/// The screen ALSO has a safe generic label for an action it does not know (an older row, a
/// newer API than the web bundle), so a gap is never a raw code on screen. This test is what
/// keeps that fallback the exception rather than the rule.
/// </para>
/// <para>
/// Key shape: the action with every <c>.</c> turned into <c>__</c>, under <c>audit.actions</c> --
/// the catalogues are dot-path trees (<c>web/src/i18n/translate.ts</c>), so a dotted code cannot
/// be a key as it is, and a single <c>_</c> would not be reversible (<c>password_change</c>).
/// The screen turns a key back into its code to offer it as a filter, so reversibility is
/// asserted below. <c>web/src/features/audit/auditActions.ts</c> applies the same rule.
/// </para>
/// </remarks>
[Collection("Postgres")]
public class AuditActionLabelsTests(PostgresContainerFixture postgres)
{
    private AuthWebApplicationFactory Factory => postgres.App;

    /// <summary>
    /// The actions written straight to <c>audit_logs</c> rather than derived by the middleware,
    /// or renamed by <c>AuditEntry.Describe</c>. Each by its own constant where it has a public
    /// one, so a rename moves this list with it.
    /// </summary>
    private static readonly string[] ExplicitActions =
    [
        AuditEndpoints.ExportAction,
        ResponseExportEndpoints.ExportAction,
        ProfileAuditActions.Update,
        ProfileAuditActions.PasswordChange,
        ProfileAuditActions.PreferencesUpdate,
        GdprEndpoints.AccessAction,
        GdprEndpoints.ErasureAction,
        GdprEndpoints.ComplianceReportAction,
        GdprEndpoints.RetentionCleanupAction,
        SurveyLifecycleJob.OpenedAction,
        SurveyLifecycleJob.ClosedAction,
        MicroclimateLifecycleJob.ClosedAction,
        // `ReportShareEndpoints.SharedReadResource` + ".read"; the constant is private.
        "shared.reports.read",
    ];

    /// <summary>Every action the API can write to <c>audit_logs</c>, sorted.</summary>
    private List<string> EmittedActions()
    {
        var source = Factory.Services.GetRequiredService<EndpointDataSource>();
        var derived = new List<string>();
        foreach (var endpoint in source.Endpoints.OfType<RouteEndpoint>())
        {
            foreach (var method in endpoint.Metadata.GetMetadata<HttpMethodMetadata>()?.HttpMethods ?? [])
            {
                var decision = AuditPolicy.Decide(endpoint, method);
                if (decision.IsAudited)
                {
                    derived.Add(decision.Action);
                }
            }
        }

        return [.. derived.Concat(ExplicitActions).Distinct(StringComparer.Ordinal).Order(StringComparer.Ordinal)];
    }

    private static string LabelKey(string action) => action.Replace(".", "__", StringComparison.Ordinal);

    [Fact]
    public void The_set_this_test_reads_is_the_real_one()
    {
        var actions = EmittedActions();

        // Vacuous over an empty route table; these are routes that exist today.
        Assert.True(actions.Count >= 80, $"only {actions.Count} actions were found");
        Assert.Contains("surveys.status.update", actions);
        Assert.Contains("audit.export", actions);
    }

    [Fact]
    public void Every_label_key_turns_back_into_its_action()
    {
        // `__` inside an action would make its key ambiguous, and the screen's filter would
        // then ask the API for an action that was never written.
        var irreversible = EmittedActions()
            .Where(action => LabelKey(action).Replace("__", ".", StringComparison.Ordinal) != action)
            .ToList();

        Assert.Empty(irreversible);
    }

    [Theory]
    [InlineData("es")]
    [InlineData("en")]
    public void Every_action_the_api_writes_has_a_label_in_the_catalogue(string locale)
    {
        using var catalogue = JsonDocument.Parse(File.ReadAllText(
            Path.Combine(RepositoryRoot(), "web", "src", "i18n", $"{locale}.json")));
        var labels = catalogue.RootElement.GetProperty("audit").GetProperty("actions");

        var missing = EmittedActions()
            .Where(action => !labels.TryGetProperty(LabelKey(action), out var label)
                || label.ValueKind != JsonValueKind.String
                || string.IsNullOrWhiteSpace(label.GetString()))
            .Select(action => $"\"{LabelKey(action)}\"  ({action})")
            .ToList();

        Assert.True(
            missing.Count == 0,
            $"{missing.Count} audit action(s) have no label under audit.actions in web/src/i18n/{locale}.json -- "
            + "add one to BOTH en.json and es.json:\n" + string.Join("\n", missing));
    }

    private static string RepositoryRoot([CallerFilePath] string thisFile = "")
    {
        var dir = new DirectoryInfo(Path.GetDirectoryName(thisFile)!);
        while (dir is not null && !File.Exists(Path.Combine(dir.FullName, "ClimateProject.slnx")))
        {
            dir = dir.Parent;
        }

        return dir?.FullName ?? throw new InvalidOperationException("ClimateProject.slnx not found above " + thisFile);
    }
}
