namespace ClimateProject.Api.Endpoints;

/// <summary>
/// «Ver como quien responde» (ruled 2026-11-19, <c>docs/decisions/editable-respondent-content.md</c>):
/// an administrator's preview of the real respond flow, built with
/// <see cref="SurveyResponseEndpoints.BuildRespondViewAsync"/> and saving nothing.
/// </summary>
/// <remarks>
/// Mapped by <c>Program.cs</c> already, and empty until its lane fills it, so the lanes that build
/// on the foundation in parallel never edit <c>Program.cs</c> (each owns one of these classes).
/// </remarks>
public static class RespondPreviewEndpoints
{
    public static void MapRespondPreviewEndpoints(this WebApplication app)
    {
        ArgumentNullException.ThrowIfNull(app);
    }
}
