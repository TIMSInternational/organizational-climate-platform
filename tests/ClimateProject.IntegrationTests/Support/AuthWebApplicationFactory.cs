using ClimateProject.Infrastructure.Persistence;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;

namespace ClimateProject.IntegrationTests.Support;

public class AuthWebApplicationFactory(string connectionString) : WebApplicationFactory<Program>
{
    public const string TestJwtSecret = "integration-test-tracking-jwt-secret-32-bytes-min";

    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        builder.ConfigureAppConfiguration((_, config) =>
        {
            config.AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["ConnectionStrings:ClimateProject"] = connectionString,
                ["TrackingJwtSecret"] = TestJwtSecret,
            });
        });
    }

    public async Task ApplyMigrationsAsync()
    {
        using var scope = Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>();
        await db.Database.MigrateAsync();
    }
}
