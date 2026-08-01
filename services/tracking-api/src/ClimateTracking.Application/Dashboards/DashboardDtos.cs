using ClimateTracking.Application.PlanesAccion;

namespace ClimateTracking.Application.Dashboards;

public sealed record SemaforoCounts(int Rojo, int Amarillo, int Verde);

public sealed record TableroResponse(string NodoExternalId, SemaforoCounts Conteos, IReadOnlyList<PlanResponse> Planes);

public sealed record NodoConsolidado(string NodoExternalId, SemaforoCounts Conteos, int TotalPlanes);

public sealed record ConsolidadoResponse(SemaforoCounts Conteos, IReadOnlyList<NodoConsolidado> PorNodo);
