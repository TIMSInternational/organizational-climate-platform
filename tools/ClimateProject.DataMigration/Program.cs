// Thin by design: everything, including the fail-loudly guard, lives in MigrationRunner
// so the tests can exercise it. See MigrationRunner.RunAsync for why this throws today.
await ClimateProject.DataMigration.MigrationRunner.RunAsync(args);
