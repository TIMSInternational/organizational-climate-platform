namespace ClimateProject.DataMigration.Tests;

/// <summary>
/// The scaffold's honesty rule survives the pipeline becoming real, in two narrower
/// forms: a run without its connections is an error before anything connects, and a
/// run naming an unmapped collection is refused by name (PipelineTests covers that
/// half). Exit code 0 from a migration tool is read as "the data moved" - during a
/// cutover rehearsal that misreading is unrecoverable.
/// </summary>
public class MigrationRunnerTests
{
    [Fact]
    public void Missing_connection_environment_fails_loudly_before_connecting()
    {
        var exception = Assert.Throws<InvalidOperationException>(
            () => MigrationOptions.Parse(["--dry-run"], new Dictionary<string, string?>()));

        Assert.Contains("LEGACY_MONGO_URI", exception.Message);
    }

    [Fact]
    public void Unknown_argument_is_an_error_not_a_shrug()
    {
        var exception = Assert.Throws<ArgumentException>(
            () => MigrationOptions.Parse(["--yolo"], new Dictionary<string, string?>()));

        Assert.Contains("--yolo", exception.Message);
    }

    [Fact]
    public void Resume_is_the_documented_alias_for_running_again()
    {
        var environment = new Dictionary<string, string?>
        {
            ["LEGACY_MONGO_URI"] = "mongodb://localhost",
            ["LEGACY_MONGO_DB"] = "legacy",
            ["TARGET_POSTGRES_CONNECTION"] = "Host=localhost;Port=5432;Database=t",
        };

        var options = MigrationOptions.Parse(
            ["--resume", "--collections=companies,users", "--report-path=r.json"], environment);

        Assert.False(options.DryRun);
        Assert.Equal(["companies", "users"], options.Collections);
        Assert.Equal("r.json", options.ReportPath);
    }
}
