using Xunit;

// No two application hosts may boot at the same time in this process.
//
// This assembly has exactly two collections -- "Postgres" (70 classes) and "AppHost" (3) --
// and xUnit runs *collections* in parallel by default while running the classes inside one
// collection serially. So before this attribute, the only concurrency in the assembly was
// precisely the dangerous one: the three host-booting AppHost classes overlapping with the
// seventy host-booting Postgres classes.
//
// Concurrent WebApplicationFactory<Program> boots are unsafe here because Program.cs uses
// top-level statements. WebApplicationFactory therefore reaches the host through
// HostFactoryResolver, which runs the entry point on a background thread and captures the
// resulting IHost off a *process-global* DiagnosticListener. Two boots in flight means one
// factory can capture the other's host -- which is exactly what the original CI evidence
// showed: a "CORS policy execution failed" log, belonging to CorsPolicyTests, surfacing
// inside a StartupValidationTests failure (recorded on #68).
//
// COST: at most 5 seconds, and that is a bound rather than an estimate. Running two collections
// concurrently can save no more than the shorter one takes, so the ceiling on what this gives up
// is the AppHost collection's own wall time -- measured three times at 5s (13 tests, no database
// required). The Postgres collection is the other ~18 minutes and was already serial within
// itself, so nothing else in the assembly loses anything. A hard guarantee for under half a
// percent of the run.
//
// This does NOT replace the "AppHost" collection, which stays as defence in depth: if anyone
// re-enables parallelization here, those three classes must still not overlap each other.
//
// It is also NOT the whole fix. Serialising boots removes the *concurrency* trigger; a second,
// independent trigger lives in the host-capture handshake itself and is addressed in
// StartupValidationTests.CaptureStartupException. Both were measured -- see that method.
[assembly: CollectionBehavior(DisableTestParallelization = true)]
