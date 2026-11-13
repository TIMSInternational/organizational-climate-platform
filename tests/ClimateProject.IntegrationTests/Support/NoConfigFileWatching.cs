using System.Runtime.CompilerServices;

namespace ClimateProject.IntegrationTests.Support;

/// <summary>
/// Every test host in this assembly boots with configuration file-watching OFF.
/// </summary>
/// <remarks>
/// <para>
/// <c>WebApplication.CreateBuilder</c> loads <c>appsettings*.json</c> with <c>reloadOnChange</c>,
/// so each host it builds asks the operating system for a file watcher. On macOS that is an
/// FSEvents stream registered with <c>fseventsd</c>, which is shared by every process on the
/// machine. When <c>fseventsd</c> is saturated -- other sessions' dev servers, editors, a long
/// day -- registration fails, the watcher's change token fires at once, re-registers, and fails
/// again.
/// </para>
/// <para>
/// Measured 2026-11-02 on this repository's own branch: the full suite ran 598 of 2130
/// integration tests and stopped. The eight tests that build their own host each timed out
/// ("Timed out waiting for the entry point to build the IHost after 00:05:00"), and then the
/// test host died with a stack overflow whose innermost frames were
/// <c>FSEventStreamCreate</c> under <c>PhysicalFileProvider.Watch</c>, recursing through
/// <c>ChangeToken.OnChange</c>. The tracking suite, which that branch did not touch, failed 50
/// of 70 in the same state, and a fresh tracking run sampled while hung was looping in
/// <c>FSEventStreamStart</c>/<c>FSEventStreamInvalidate</c>. With the variable below set, the
/// same tracking run in the same machine state passed 70/70 in 9 s.
/// </para>
/// <para>
/// A test host never needs to notice an edited <c>appsettings.json</c>, so the watcher buys
/// nothing here. The variable is read by <c>WebApplication.CreateBuilder</c> through its
/// <c>DOTNET_</c>-prefixed environment configuration, which is why it is set in-process before
/// any host is built rather than in each factory: several classes use a bare
/// <c>WebApplicationFactory&lt;Program&gt;</c>. Linux CI uses inotify and was never affected;
/// this keeps the local run measuring the code instead of the machine.
/// </para>
/// </remarks>
internal static class NoConfigFileWatching
{
#pragma warning disable CA2255 // A test assembly is the one place a module initializer belongs: it must run before any host.
    [ModuleInitializer]
#pragma warning restore CA2255
    internal static void Apply()
        => Environment.SetEnvironmentVariable("DOTNET_hostBuilder__reloadConfigOnChange", "false");
}
