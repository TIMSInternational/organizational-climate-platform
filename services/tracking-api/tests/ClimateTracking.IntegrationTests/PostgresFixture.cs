using Microsoft.EntityFrameworkCore;
using Testcontainers.PostgreSql;

namespace ClimateTracking.IntegrationTests;

public class PostgresFixture : IAsyncLifetime
{
    // Image through the constructor, not .WithImage(): Testcontainers 4.14.0 obsoletes the
    // parameterless builder, and this solution builds with TreatWarningsAsErrors. Same shape
    // ClimateProject.IntegrationTests' PostgresContainerFixture uses.
    private readonly PostgreSqlContainer _container = new PostgreSqlBuilder("postgres:16-alpine")
        .WithDatabase("climate_tracking_test")
        .WithUsername("test")
        .WithPassword("test")
        .Build();

    public string ConnectionString => _container.GetConnectionString();

    public async Task InitializeAsync() => await _container.StartAsync();

    public async Task DisposeAsync() => await _container.DisposeAsync();
}
