using ClimateTracking.Application.ExternalApi;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Options;
using Polly;

namespace ClimateTracking.Infrastructure.ExternalApi;

public static class ServiceCollectionExtensions
{
    /// <summary>
    /// Wires the typed HttpClient for climate-project's /internal/* endpoints, wrapped in
    /// Polly retry + circuit breaker so a briefly-unreachable Node app degrades gracefully
    /// instead of taking down every caller (design doc §6).
    /// </summary>
    public static IHttpClientBuilder AddClimateProjectClient(
        this IServiceCollection services,
        ClimateProjectClientOptions options,
        Action<IHttpClientBuilder>? configureBuilder = null,
        Func<int, TimeSpan>? retryDelay = null)
    {
        services.AddSingleton(Options.Create(options));
        var delay = retryDelay ?? (retryAttempt => TimeSpan.FromSeconds(Math.Pow(2, retryAttempt)));

        var builder = services
            .AddHttpClient<IClimateProjectClient, ClimateProjectClient>(client =>
            {
                client.BaseAddress = new Uri(options.BaseUrl);
            })
            .AddTransientHttpErrorPolicy(policy => policy.WaitAndRetryAsync(3, delay))
            .AddTransientHttpErrorPolicy(policy => policy.CircuitBreakerAsync(
                handledEventsAllowedBeforeBreaking: 5,
                durationOfBreak: TimeSpan.FromSeconds(30)));

        configureBuilder?.Invoke(builder);

        return builder;
    }
}
