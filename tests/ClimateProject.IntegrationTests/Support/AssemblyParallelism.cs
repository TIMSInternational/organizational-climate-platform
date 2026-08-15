using Xunit;

// No two application hosts may boot at the same time in this process.
//
// This assembly has two named collections -- "Postgres" (96 classes) and "AppHost" (8) -- and
// xUnit runs *collections* in parallel by default while running the classes inside one
// collection serially. So before this attribute, the only concurrency in the assembly was
// precisely the dangerous one: the host-booting AppHost classes overlapping with the
// host-booting Postgres classes. (A couple of classes carry no [Collection] at all and so sit
// in an implicit collection each -- ClientIpResolverTests, CallerAddressTests -- but they are
// pure functions over an HttpContext or an int and boot nothing.)
//
// Concurrent WebApplicationFactory<Program> boots are unsafe here because Program.cs uses
// top-level statements. WebApplicationFactory therefore reaches the host through
// HostFactoryResolver, which runs the entry point on a background thread and captures the
// resulting IHost off a *process-global* DiagnosticListener. Two boots in flight means one
// factory can capture the other's host -- which is exactly what the original CI evidence
// showed: a "CORS policy execution failed" log, belonging to CorsPolicyTests, surfacing
// inside a StartupValidationTests failure (recorded on #68).
//
// COST: seconds, and that is a bound rather than an estimate. Running two collections
// concurrently can save no more than the shorter one takes, so the ceiling on what this gives up
// is the AppHost collection's own wall time -- 5s when this was written (13 tests); 10s and 16s
// in two measurements on 2026-08-15 (57 tests, no database required), and the spread between
// those two is contention on a shared machine, not variance in the work. The Postgres collection
// is the other ~18 minutes and was already serial within itself, so nothing else in the assembly
// loses anything. A hard guarantee for well under a percent of the run.
//
// This does NOT replace the "AppHost" collection, which stays as defence in depth: if anyone
// re-enables parallelization here, those eight classes must still not overlap each other.
//
// #279 CHANGED THE NUMBERS BUT NOT THE ARGUMENT. The Postgres collection no longer boots a
// host per test case -- it shares one, hung off PostgresContainerFixture, and only two classes
// in it still build their own (AuditPoolPressureTests, for a constrained pool, and the three
// customised-host tests in NotificationEndpointsTests). Five host boots in that collection
// where there were on the order of 830, and now bounded: AuthWebApplicationFactory.HostBudget
// refuses the sixth.
//
// THE OTHER COLLECTION WAS NOT TOUCHED, and saying so is the difference between a real
// number and a flattering one. "AppHost" still builds roughly one host per test case, because
// varying the host configuration IS what those classes test. Measured 2026-08-15, twice and
// independently, by counting DiagnosticListener("Microsoft.Extensions.Hosting") constructions
// across a run of just that collection (HostBuilder.Build constructs exactly one per host):
// 48 hosts for 57 test cases, both times, on a machine quiet enough that
// StartupValidationTests never had to retry a lost capture -- it retries up to 5x per test, so
// under load the 48 rises. So a full run went from ~880 application hosts to 53 -- about 17x,
// not the 150x a Postgres-only reading would suggest. Every one of the 53 is still a capture
// handshake that must not overlap another, so this attribute is exactly as load-bearing as it
// was; what changed is that there are now few enough of them that the handshake is not racing
// under its own weight.
//
// It is also NOT the whole fix. Serialising boots removes the *concurrency* trigger; a second,
// independent trigger lives in the host-capture handshake itself and is addressed in
// StartupValidationTests.CaptureStartupException. Both were measured -- see that method.
[assembly: CollectionBehavior(DisableTestParallelization = true)]
