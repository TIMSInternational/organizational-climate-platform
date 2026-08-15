namespace ClimateProject.IntegrationTests.Support;

/// <summary>
/// Serialises the test classes that boot <c>WebApplicationFactory&lt;Program&gt;</c>
/// outside the "Postgres" collection.
///
/// Every other integration test class carries [Collection("Postgres")], so xUnit
/// already runs them one at a time. Three did not -- StartupValidationTests,
/// CorsPolicyTests and HealthEndpointTests -- which made them the only classes in
/// the assembly guaranteed to boot application hosts *concurrently*, both with each
/// other and with the Postgres collection.
///
/// That concurrency is the suspected cause of a CI-only flake in
/// StartupValidationTests (recorded on #68): the test asserts the startup exception
/// chain mentions TrackingJwtSecret, but roughly one CI run in four surfaced
/// "ObjectDisposedException: Cannot access a disposed object" instead, alongside a
/// logged "CORS policy execution failed" -- a message that belongs to
/// CorsPolicyTests, i.e. a *different* class's application. Concurrent
/// WebApplicationFactory&lt;Program&gt; boots share process-global state (the hosting
/// DiagnosticListener handshake that WebApplicationFactory uses to capture the host
/// built by top-level-statement entry points), which is a plausible route for one
/// factory to observe another's torn-down host.
///
/// This collection has no fixture on purpose: these three classes need no database,
/// and attaching PostgresContainerFixture would make them require Docker to run
/// standalone. The trade-off is that it serialises them against each other but not
/// against the Postgres collection.
///
/// Original caveat, now resolved: the flake could not be reproduced locally, so this
/// collection was a targeted mitigation of an identified hazard rather than a verified
/// fix, and the next step recorded here was "fold the host-booting Postgres classes
/// into one collection too, so that *no* two host boots ever overlap."
///
/// <para>
/// <b>2026-08-06 -- reproduced, and that next step was only half right.</b> The
/// reproduction condition is machine <i>load</i>, which is why an idle dev machine never
/// showed it and a 2-core CI runner did: with an unrelated Testcontainers suite saturating
/// the box, these three classes failed <b>2 runs in 5</b>; idle, <b>0 in 15</b>. Crucially
/// that failing run had <i>only this collection</i> executing -- three classes that xUnit
/// already runs one after another. So a second host boot is not necessary to trigger it,
/// and folding collections together could never have been sufficient on its own.
/// </para>
/// <para>
/// There are two independent triggers, and both are now addressed:
/// </para>
/// <para>
/// 1. <b>Concurrent host boots</b> -- what the CORS-log evidence above shows. This
///    collection stops the three classes overlapping each other, and
///    <c>Support/AssemblyParallelism.cs</c> now stops them overlapping the seventy
///    host-booting classes in the "Postgres" collection, which was the remaining gap this
///    file named. Cost measured at roughly five seconds.<br/>
/// 2. <b>The capture handshake itself</b>, which races under load even with a single boot
///    in flight -- handled in <c>StartupValidationTests.IsHostCaptureRace</c>, where the
///    mechanism and the reason a retry cannot mask a real regression are written down.
/// </para>
/// <para>
/// Keep this collection even though (1) now also holds at assembly level: it is the thing
/// that keeps these three serial if anyone ever re-enables parallelization.
/// </para>
/// <para>
/// <b>2026-08-14 -- the third trigger, and the one that was costing whole runs.</b> Neither of
/// the two above is about how MANY hosts a run boots, and that turned out to be the dominant
/// term: because xUnit constructs a test class once per <c>[Fact]</c>, the "Postgres"
/// collection was booting a host per test case and disposing almost none of them, which is
/// #279. That is fixed on <see cref="PostgresContainerFixture"/>, not here -- the collection
/// now shares one host -- but it is recorded next to these two because all three are the same
/// hazard seen from different angles, and a reader who only finds the first two will conclude
/// the boot count does not matter.
/// </para>
/// </summary>
[CollectionDefinition("AppHost")]
public class AppHostCollection;
