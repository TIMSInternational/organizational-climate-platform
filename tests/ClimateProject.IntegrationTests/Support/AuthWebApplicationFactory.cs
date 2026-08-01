using ClimateProject.Application.Auth;
using ClimateProject.Infrastructure.Persistence;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;

namespace ClimateProject.IntegrationTests.Support;

public class AuthWebApplicationFactory(string connectionString) : WebApplicationFactory<Program>
{
    public const string TestJwtSecret = "integration-test-tracking-jwt-secret-32-bytes-min";
    public const string TestInternalApiKey = "integration-test-internal-api-key";

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
        });
    }

    public async Task ApplyMigrationsAsync()
    {
        using var scope = Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>();
        await db.Database.MigrateAsync();
    }
}
