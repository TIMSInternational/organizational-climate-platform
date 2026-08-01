using ClimateProject.Domain.Entities;

namespace ClimateProject.Application.Tracking;

public static class TrackingIdentifiers
{
    public static string ExternalNodoId(Department department) => department.LegacyExternalId ?? department.Id.ToString();

    public static string ExternalPersonaId(User user) => user.PersonaExternalId ?? user.Id.ToString();
}
