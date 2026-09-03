using System.Text.RegularExpressions;
using ClimateProject.Application.Scheduling;

namespace ClimateProject.UnitTests.Scheduling;

/// <summary>
/// Pins the scheduler's log templates to the CloudWatch metric filters in
/// <c>infra/aws/climate-project-observability.yml</c> (alerting.md §6.4).
///
/// Every job-absence alarm there is a quoted-substring filter over production logs. If the
/// template in <see cref="WorkerLogLines"/> is reworded and the YAML is not — or a job is
/// added to <see cref="WorkerJobs.All"/> without a filter — the alarm goes silent with no
/// error anywhere. Both sides are read here and rendered against each other.
/// </summary>
public class HeartbeatAlarmLiteralsTests
{
    private static readonly string Template = File.ReadAllText(Path.Combine(RepoRoot(), "infra", "aws", "climate-project-observability.yml"));

    /// <summary>Every quoted term of every FilterPattern, keyed by the pattern line.</summary>
    private static IReadOnlyList<(string Pattern, string[] Terms)> FilterPatterns() =>
        Regex.Matches(Template, @"FilterPattern:\s*'(?<p>[^']*)'")
            .Select(m => m.Groups["p"].Value)
            .Select(p => (p, Regex.Matches(p, "\"(?<t>[^\"]*)\"").Select(t => t.Groups["t"].Value).ToArray()))
            .ToList();

    private static string Render(string template, string jobName) =>
        Regex.Replace(template, @"\{[A-Za-z]+(:[^}]*)?\}", m => m.Value.StartsWith("{JobName") ? jobName : "x");

    [Fact]
    public void Every_job_has_a_heartbeat_filter_whose_literal_the_completed_line_contains()
    {
        var heartbeatPatterns = FilterPatterns().Where(f => f.Terms.Any(t => t.StartsWith("Heartbeat: scheduled job "))).ToList();
        foreach (var job in WorkerJobs.All)
        {
            var rendered = Render(WorkerLogLines.HeartbeatCompleted, job);
            var matching = heartbeatPatterns.Where(f => f.Terms.All(rendered.Contains)).ToList();
            Assert.True(matching.Count == 1, $"job '{job}' should have exactly one heartbeat filter matching '{rendered}', found {matching.Count}");
        }
    }

    [Fact]
    public void Every_heartbeat_filter_names_a_real_job_and_not_the_skipped_tick()
    {
        var heartbeatPatterns = FilterPatterns().Where(f => f.Terms.Any(t => t.StartsWith("Heartbeat: scheduled job "))).ToList();
        Assert.Equal(WorkerJobs.All.Length, heartbeatPatterns.Count);
        foreach (var (pattern, terms) in heartbeatPatterns)
        {
            var job = WorkerJobs.All.SingleOrDefault(j => terms.All(t => Render(WorkerLogLines.HeartbeatCompleted, j).Contains(t)));
            Assert.False(job is null, $"filter '{pattern}' matches no job's completed line");
            // The skipped-tick line ("ticked at ... but another instance holds the lease") must
            // NOT satisfy the filter: an instance that never wins the lease is not a heartbeat.
            Assert.False(terms.All(t => Render(WorkerLogLines.HeartbeatSkipped, job!).Contains(t)), $"filter '{pattern}' also matches the skipped-tick line");
        }
    }

    [Fact]
    public void The_stale_and_threw_filters_match_their_lines()
    {
        var patterns = FilterPatterns();
        var stale = Assert.Single(patterns, f => f.Terms.Contains("has not completed a run since"));
        Assert.True(stale.Terms.All(Render(WorkerLogLines.JobStale, WorkerJobs.Digests).Contains));

        var threw = Assert.Single(patterns, f => f.Terms.Contains("threw at"));
        Assert.True(threw.Terms.All(Render(WorkerLogLines.JobThrew, WorkerJobs.Digests).Contains));
        Assert.False(threw.Terms.All(Render(WorkerLogLines.HeartbeatCompleted, WorkerJobs.Digests).Contains));
    }

    private static string RepoRoot()
    {
        var dir = new DirectoryInfo(AppContext.BaseDirectory);
        while (dir is not null && !File.Exists(Path.Combine(dir.FullName, "ClimateProject.slnx"))) dir = dir.Parent;
        return dir?.FullName ?? throw new InvalidOperationException("ClimateProject.slnx not found above " + AppContext.BaseDirectory);
    }
}
