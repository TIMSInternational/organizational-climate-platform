namespace ClimateProject.Application.Tracking;

public sealed record NodoPickerItem(string Id, string Name);

public sealed record NodoPickerResponse(IReadOnlyList<NodoPickerItem> Nodos);

public sealed record PersonaPickerItem(string Id, string Name, string Email);

public sealed record PersonaPickerResponse(IReadOnlyList<PersonaPickerItem> Personas);
