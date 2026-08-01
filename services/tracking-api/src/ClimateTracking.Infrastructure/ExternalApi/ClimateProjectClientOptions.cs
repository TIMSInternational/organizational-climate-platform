namespace ClimateTracking.Infrastructure.ExternalApi;

public sealed class ClimateProjectClientOptions
{
    public required string BaseUrl { get; init; }
    public required string InternalApiKey { get; init; }
    public required string ProcomerCompanyId { get; init; }
}
