using ClimateProject.Infrastructure.Auth;
using Microsoft.Extensions.Configuration;

namespace ClimateProject.UnitTests.Auth;

public class GoogleTokenVerifierTests
{
    [Fact]
    public void Constructor_throws_when_GoogleClientId_is_empty_string()
    {
        // appsettings.json ships "GoogleClientId": "" as a placeholder. An empty
        // string is not null, so a naive "?? throw" null-coalescing guard
        // silently lets it through. This proves the constructor rejects that
        // case explicitly.
        var configuration = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?> { ["GoogleClientId"] = "" })
            .Build();

        var exception = Assert.Throws<InvalidOperationException>(() => new GoogleTokenVerifier(configuration));
        Assert.Equal("Missing GoogleClientId configuration.", exception.Message);
    }

    [Fact]
    public void Constructor_throws_when_GoogleClientId_is_missing()
    {
        var configuration = new ConfigurationBuilder().Build();

        var exception = Assert.Throws<InvalidOperationException>(() => new GoogleTokenVerifier(configuration));
        Assert.Equal("Missing GoogleClientId configuration.", exception.Message);
    }
}
