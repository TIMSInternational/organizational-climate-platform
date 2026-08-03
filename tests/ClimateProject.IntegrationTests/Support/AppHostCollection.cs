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
/// Honest caveat: the flake could not be reproduced locally -- 15 runs of these
/// three classes and 8 runs including Postgres-collection host boots all passed, on
/// a machine much less contended than a 2-core CI runner. So this is a targeted
/// mitigation of an identified structural hazard, not a fix verified against a
/// reproduction. If the flake recurs, the next step is folding the host-booting
/// Postgres classes into one collection too, so that *no* two host boots ever
/// overlap.
/// </summary>
[CollectionDefinition("AppHost")]
public class AppHostCollection;
