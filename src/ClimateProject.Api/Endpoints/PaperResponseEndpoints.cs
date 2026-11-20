namespace ClimateProject.Api.Endpoints;

/// <summary>
/// Paper questionnaires entered by a TIMS operator from a roster row, and wording-only
/// corrections of a question on a survey with answers (both ruled 2026-11-19,
/// <c>docs/decisions/editable-respondent-content.md</c>).
/// </summary>
/// <remarks>
/// Mapped by <c>Program.cs</c> already, and empty until its lane fills it, so the lanes that build
/// on the foundation in parallel never edit <c>Program.cs</c> (each owns one of these classes).
/// </remarks>
public static class PaperResponseEndpoints
{
    public static void MapPaperResponseEndpoints(this WebApplication app)
    {
        ArgumentNullException.ThrowIfNull(app);
    }
}
