namespace ClimateProject.DataMigration.Tests;

public class MigrationRunnerTests
{
    [Fact]
    public async Task Running_the_scaffold_fails_loudly_and_points_at_the_sub_issues()
    {
        // The honesty rule: until the pipeline exists, running the tool must be an error.
        // An exit code 0 from a migration tool is read as "the data moved" - during a
        // cutover rehearsal that misreading is unrecoverable. The message must carry the
        // pointer to where the real work is tracked, because the person who hits this is
        // exactly the person about to implement or schedule it.
        var exception = await Assert.ThrowsAsync<NotImplementedException>(
            () => MigrationRunner.RunAsync(["--dry-run"]));

        Assert.Contains("docs/migration/sub-issues.md", exception.Message);
    }
}
