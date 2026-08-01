using ClimateTracking.Domain.Entities;

namespace ClimateTracking.Application.PlanesAccion;

public sealed record CreatePlanRequest(
    string NodoExternalId,
    string? HallazgoExternalId,
    string DescripcionQue,
    string MetodologiaComo,
    string ResponsableEjecucionExternalId,
    DateOnly FechaCompromiso,
    IReadOnlyList<string>? Involucrados);

public sealed record RegistrarAvanceRequest(decimal PorcentajeAvance, string? Comentario, DateOnly Fecha);

public sealed record MarcarCumplidoRequest(DateOnly Fecha);

public sealed record AgregarInvolucradoRequest(string PersonaExternalId);

public sealed record PlanResponse(
    Guid Id,
    string PlanCode,
    string NodoExternalId,
    string LiderExternalId,
    string? HallazgoExternalId,
    string DescripcionQue,
    string MetodologiaComo,
    string ResponsableEjecucionExternalId,
    DateOnly FechaCreacion,
    DateOnly FechaCompromiso,
    decimal PorcentajeAvance,
    string EstadoSemaforo,
    string? CicloEncuestaExternalId,
    DateOnly FechaUltimaActualizacion,
    bool Cumplido,
    IReadOnlyList<string> InvolucradosExternalIds)
{
    public static PlanResponse From(PlanDeAccion plan) => new(
        Id: plan.Id,
        PlanCode: plan.PlanCode,
        NodoExternalId: plan.NodoExternalId,
        LiderExternalId: plan.LiderExternalId,
        HallazgoExternalId: plan.HallazgoExternalId,
        DescripcionQue: plan.DescripcionQue,
        MetodologiaComo: plan.MetodologiaComo,
        ResponsableEjecucionExternalId: plan.ResponsableEjecucionExternalId,
        FechaCreacion: plan.FechaCreacion,
        FechaCompromiso: plan.FechaCompromiso,
        PorcentajeAvance: plan.PorcentajeAvance,
        EstadoSemaforo: plan.EstadoSemaforo.ToString(),
        CicloEncuestaExternalId: plan.CicloEncuestaExternalId,
        FechaUltimaActualizacion: plan.FechaUltimaActualizacion,
        Cumplido: plan.Cumplido,
        InvolucradosExternalIds: plan.InvolucradosExternalIds);
}
