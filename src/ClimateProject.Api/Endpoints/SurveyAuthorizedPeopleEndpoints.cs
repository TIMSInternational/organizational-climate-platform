namespace ClimateProject.Api.Endpoints;

/// <summary>
/// «Lista autorizada del cliente» (ruled 2026-11-19, <c>docs/decisions/editable-respondent-content.md</c>):
/// the routes over <c>survey_authorized_people</c>.
/// </summary>
/// <remarks>
/// Mapped by <c>Program.cs</c> already, and empty until its lane fills it, so the lanes that build
/// on the foundation in parallel never edit <c>Program.cs</c> (each owns one of these classes).
/// </remarks>
public static class SurveyAuthorizedPeopleEndpoints
{
    public static void MapSurveyAuthorizedPeopleEndpoints(this WebApplication app)
    {
        ArgumentNullException.ThrowIfNull(app);
    }
}
