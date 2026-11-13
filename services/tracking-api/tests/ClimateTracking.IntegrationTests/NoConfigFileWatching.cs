using System.Runtime.CompilerServices;

namespace ClimateTracking.IntegrationTests;

/// <summary>
/// Every test host in this assembly boots with configuration file-watching OFF.
/// </summary>
/// <remarks>
/// Each <c>WebApplication.CreateBuilder</c> host loads <c>appsettings*.json</c> with
/// <c>reloadOnChange</c>, which on macOS registers an FSEvents stream with the machine-wide
/// <c>fseventsd</c>. When that daemon is saturated, registration fails and retries in a loop:
/// on 2026-11-02 this suite failed 50 of 70 over an hour, and a hung run sampled live was spinning
/// in <c>FSEventStreamStart</c>/<c>FSEventStreamInvalidate</c>. With this variable set, the same
/// run in the same machine state passed 70/70 in 9 s. A test host never needs to reload its
/// settings file. The full account is on <c>NoConfigFileWatching</c> in
/// <c>tests/ClimateProject.IntegrationTests/Support</c>.
/// </remarks>
internal static class NoConfigFileWatching
{
#pragma warning disable CA2255 // A test assembly is the one place a module initializer belongs: it must run before any host.
    [ModuleInitializer]
#pragma warning restore CA2255
    internal static void Apply()
        => Environment.SetEnvironmentVariable("DOTNET_hostBuilder__reloadConfigOnChange", "false");
}
