using System.Net.Http.Json;
using System.Text.Json;
using System.Text.Json.Serialization;
using ClimateTracking.Application.ExternalApi;
using Microsoft.Extensions.Options;

namespace ClimateTracking.Infrastructure.ExternalApi;

public sealed class ClimateProjectClient : IClimateProjectClient
{
    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.SnakeCaseLower,
    };

    private readonly HttpClient _httpClient;
    private readonly ClimateProjectClientOptions _options;

    public ClimateProjectClient(HttpClient httpClient, IOptions<ClimateProjectClientOptions> options)
    {
        _httpClient = httpClient;
        _options = options.Value;
        _httpClient.DefaultRequestHeaders.Authorization =
            new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", _options.InternalApiKey);
    }

    public async Task<IReadOnlyList<NodoDto>> GetNodosAsync(CancellationToken cancellationToken)
    {
        var envelope = await GetAsync<Envelope<NodosData>>(
            $"/api/internal/nodos?company_id={Uri.EscapeDataString(_options.ProcomerCompanyId)}", cancellationToken);
        return envelope.Data.Nodos;
    }

    public async Task<IReadOnlyList<PersonaDto>> GetPersonasAsync(CancellationToken cancellationToken)
    {
        var envelope = await GetAsync<Envelope<PersonasData>>(
            $"/api/internal/personas?company_id={Uri.EscapeDataString(_options.ProcomerCompanyId)}", cancellationToken);
        return envelope.Data.Personas;
    }

    public async Task<IReadOnlyList<CicloDto>> GetCiclosAsync(CancellationToken cancellationToken)
    {
        var envelope = await GetAsync<Envelope<CiclosData>>(
            $"/api/internal/ciclos-encuesta?company_id={Uri.EscapeDataString(_options.ProcomerCompanyId)}", cancellationToken);
        return envelope.Data.Ciclos;
    }

    public async Task<IReadOnlyList<HallazgoDto>> GetHallazgosAsync(string cicloId, CancellationToken cancellationToken)
    {
        var query = $"/api/internal/hallazgos?ciclo_id={Uri.EscapeDataString(cicloId)}" +
            $"&company_id={Uri.EscapeDataString(_options.ProcomerCompanyId)}";
        var envelope = await GetAsync<Envelope<HallazgosData>>(query, cancellationToken);
        return envelope.Data.Hallazgos;
    }

    public async Task<HallazgoDto?> GetHallazgoByIdAsync(string hallazgoId, CancellationToken cancellationToken)
    {
        var query = $"/api/internal/hallazgos?hallazgo_id={Uri.EscapeDataString(hallazgoId)}" +
            $"&company_id={Uri.EscapeDataString(_options.ProcomerCompanyId)}";
        var envelope = await GetAsync<Envelope<HallazgosData>>(query, cancellationToken);
        return envelope.Data.Hallazgos.FirstOrDefault();
    }

    public async Task SendNotificationAsync(SendNotificationRequest request, CancellationToken cancellationToken)
    {
        var response = await _httpClient.PostAsJsonAsync(
            "/api/internal/send-notification",
            new
            {
                destinatarios_ids = request.DestinatariosIds,
                tipo_disparador = request.TipoDisparador,
                contenido = request.Contenido,
                plan_id = request.PlanId,
            },
            cancellationToken);
        response.EnsureSuccessStatusCode();
    }

    private async Task<T> GetAsync<T>(string requestUri, CancellationToken cancellationToken)
    {
        var response = await _httpClient.GetAsync(requestUri, cancellationToken);
        response.EnsureSuccessStatusCode();
        return (await response.Content.ReadFromJsonAsync<T>(JsonOptions, cancellationToken))!;
    }

    private sealed record Envelope<TData>(bool Success, TData Data);

    private sealed record NodosData(IReadOnlyList<NodoDto> Nodos);
    private sealed record PersonasData(IReadOnlyList<PersonaDto> Personas);
    private sealed record CiclosData(IReadOnlyList<CicloDto> Ciclos);
    private sealed record HallazgosData(IReadOnlyList<HallazgoDto> Hallazgos);
}
