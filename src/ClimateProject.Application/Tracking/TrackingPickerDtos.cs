namespace ClimateProject.Application.Tracking;

public sealed record NodoPickerItem(string Id, string Name);

public sealed record NodoPickerResponse(IReadOnlyList<NodoPickerItem> Nodos);

public sealed record PersonaPickerItem(string Id, string Name, string Email);

public sealed record PersonaPickerResponse(IReadOnlyList<PersonaPickerItem> Personas);

/// <summary>
/// One finding a plan can be written against: a (survey x department x dimension) cell, named
/// by the survey it came from and the dimension it measures.
/// </summary>
/// <remarks>
/// **No score, deliberately.** The internal feed carries <c>resultado_pct</c>, under the
/// tracking module's own floor; a picker needs only enough to recognise the finding, and a
/// number that does not have to be in a response cannot leak from it. <c>Id</c> is
/// <see cref="TrackingIdentifiers.ExternalHallazgoId"/>, exactly what climate-tracking stores in
/// <c>HallazgoExternalId</c> and resolves through <c>/api/internal/hallazgos</c>.
/// </remarks>
public sealed record HallazgoPickerItem(
    string Id,
    string SurveyId,
    string SurveyTitle,
    DateTimeOffset SurveyClosedOn,
    string Dimension);

public sealed record HallazgoPickerResponse(IReadOnlyList<HallazgoPickerItem> Hallazgos);
