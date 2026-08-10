using ClimateProject.Application.Auth;
using ClimateProject.Infrastructure.Persistence;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;

namespace ClimateProject.IntegrationTests.Support;

public class AuthWebApplicationFactory(string connectionString) : WebApplicationFactory<Program>
{
    public const string TestJwtSecret = "integration-test-tracking-jwt-secret-32-bytes-min";
    public const string TestInternalApiKey = "integration-test-internal-api-key";

    /// <summary>
    /// Counts the database commands this application sends. Reset it immediately before the
    /// request under measurement — signup, login and every other setup call go through the
    /// same counter. See <see cref="CommandCountingInterceptor"/> for why round trips are
    /// counted here rather than inferred from generated SQL.
    /// </summary>
    public CommandCountingInterceptor CommandCounter { get; } = new();

    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        builder.ConfigureAppConfiguration((_, config) =>
        {
            config.AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["ConnectionStrings:ClimateProject"] = connectionString,
                ["TrackingJwtSecret"] = TestJwtSecret,
                ["InternalApiKey"] = TestInternalApiKey,
                ["GoogleClientId"] = "test-google-client-id",
            });
        });

        builder.ConfigureTestServices(services =>
        {
            services.RemoveAll<IGoogleTokenVerifier>();
            services.AddScoped<IGoogleTokenVerifier, FakeGoogleTokenVerifier>();

            // ConfigureDbContext, not a second AddDbContext and not AddSingleton<IInterceptor>.
            // The first would be ignored (AddDbContext TryAdds its options) and the second
            // does nothing at all — EF has no convention that discovers loose IInterceptor
            // registrations, which was measured here: the counter read 0 on every route.
            // ConfigureDbContext appends to the options Program.cs already built, so the
            // connection string and everything else stays exactly as the app configured it.
            services.ConfigureDbContext<ClimateProjectDbContext>(
                options => options.AddInterceptors(CommandCounter));
        });
    }

    public async Task ApplyMigrationsAsync()
    {
        using var scope = Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>();
        await db.Database.MigrateAsync();
    }
}
