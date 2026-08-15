namespace ClimateProject.DataMigration;

/// <summary>
/// Where the extract-transform-load pipeline will live. Today it is a scaffold: the typed
/// readers, the deterministic id scheme and the test harness exist; no pipeline does.
/// </summary>
public static class MigrationRunner
{
    /// <summary>
    /// Fails loudly, by design. A migration tool that silently no-ops is the worst version
    /// of itself: someone runs it during a cutover rehearsal, sees exit code 0, and
    /// concludes the data moved. Until sub-issues B-G land, running this tool is an error
    /// and it says so.
    /// </summary>
    public static Task RunAsync(string[] args)
        => throw new NotImplementedException(
            "ClimateProject.DataMigration is a scaffold, not an ETL: the 35 typed collection readers, " +
            "the deterministic-id scheme (MigrationIds) and the Testcontainer harness exist, but no " +
            "extract/load pipeline does. Implementation is tracked as sub-issues A-G in " +
            "docs/migration/sub-issues.md (under #154). This tool fails rather than pretending to migrate.");
}
