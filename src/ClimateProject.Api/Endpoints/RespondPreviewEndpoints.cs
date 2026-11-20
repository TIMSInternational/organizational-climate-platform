using System.Security.Claims;
using ClimateProject.Application.Auth;
using ClimateProject.Application.Surveys;
using ClimateProject.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace ClimateProject.Api.Endpoints;

/// <summary>
/// What «Ver como quien responde» draws: the respond view a visitor to the survey's link would
/// get, and the company strip above it.
/// </summary>
/// <param name="View">
/// Byte for byte the payload <c>GET /surveys/{id}/respond</c> returns to a link visitor
/// (<see cref="SurveyResponseEndpoints.BuildRespondViewAsync"/> with
/// <c>RespondReader.LinkVisitor</c>), with no in-progress answers: a preview resumes nothing.
/// </param>
/// <param name="CompanyName">The company the survey belongs to, for the strip above every screen.</param>
/// <param name="CompanyLogoUrl">Its logo, as company settings stores it; null when none is set.</param>
/// <param name="Status">The survey's status, so the page can say a draft is a draft.</param>
public sealed record RespondPreviewView(
    SurveyRespondView View,
    string? CompanyName,
    string? CompanyLogoUrl,
    string Status);

/// <summary>
/// «Ver como quien responde» (ruled 2026-11-19, <c>docs/decisions/editable-respondent-content.md</c>):
/// an administrator's preview of the real respond flow, built with
/// <see cref="SurveyResponseEndpoints.BuildRespondViewAsync"/> and saving nothing.
/// </summary>
/// <remarks>
/// <para><b>Saves nothing, by construction.</b> The one route here is a GET that reads the survey,
/// its company and the builder's own reads; it mints no session, looks up no response, calls
/// <c>SaveChangesAsync</c> nowhere and is not audited (it changes nothing, and the respond GET it
/// mirrors is not audited either). A preview's answers never leave the browser: the web routes
/// the form's session, autosave, submit, receipt and lock to no-ops
/// (<c>web/src/features/surveys/respondPreview.ts</c>).
/// <c>RespondPreviewEndpointTests</c> counts the rows that a respondent's visit would touch,
/// before and after repeated previews.</para>
/// <para><b>Who.</b> <see cref="SurveyEndpoints.CanAdminister"/>, the rule every survey admin
/// route uses: a super admin for any survey, a company admin for their own company's. Any status
/// but archived -- a draft included, which is the point: the check is made before the link goes
/// out. Archived is refused with <see cref="AdminRefusals.RespondPreviewArchived"/>.</para>
/// <para><b>The reader is a link visitor.</b> <c>RespondReader.LinkVisitor</c>: anonymous storage
/// and no account, so the screens are the ones the person handed the link sees -- the company's
/// self-declared demographics when the survey asks them, the identity screen when it asks who is
/// answering. Mapped by <c>Program.cs</c> already; this lane fills only this file.</para>
/// </remarks>
public static class RespondPreviewEndpoints
{
    public static void MapRespondPreviewEndpoints(this WebApplication app)
    {
        ArgumentNullException.ThrowIfNull(app);

        app.MapGroup("/surveys").RequireAuthorization()
            .MapGet("/{id:guid}/respond-preview", GetPreviewAsync);
    }

    private static async Task<IResult> GetPreviewAsync(
        Guid id,
        string? lang,
        ClaimsPrincipal principal,
        ClimateProjectDbContext db,
        CancellationToken cancellationToken)
    {
        var currentUser = principal.GetCurrentUser();

        // AsNoTracking: nothing loaded here can be written back, even by a SaveChanges some later
        // edit adds to this handler by mistake.
        var survey = await db.Surveys.AsNoTracking().FirstOrDefaultAsync(s => s.Id == id, cancellationToken);
        if (survey is null)
        {
            return Results.Json(new { message = "Survey not found" }, statusCode: 404);
        }

        if (!SurveyEndpoints.CanAdminister(currentUser, survey.CompanyId))
        {
            return Results.Forbid();
        }

        if (survey.Status == SurveyStatuses.Archived)
        {
            return Results.Json(
                new { message = "An archived survey cannot be previewed.", code = AdminRefusals.RespondPreviewArchived },
                statusCode: 409);
        }

        var view = await SurveyResponseEndpoints.BuildRespondViewAsync(
            db, survey, lang, RespondReader.LinkVisitor, inProgress: null, cancellationToken);

        var company = await db.Companies.AsNoTracking()
            .Where(c => c.Id == survey.CompanyId)
            .Select(c => new { c.Name, c.Branding.LogoUrl })
            .FirstOrDefaultAsync(cancellationToken);

        return Results.Ok(new RespondPreviewView(view, company?.Name, company?.LogoUrl, survey.Status));
    }
}
