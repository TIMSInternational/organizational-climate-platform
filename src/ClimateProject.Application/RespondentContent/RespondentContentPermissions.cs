using ClimateProject.Application.Auth;
using ClimateProject.Application.Surveys;

namespace ClimateProject.Application.RespondentContent;

/// <summary>What stops a caller who may administer a survey from changing its respondent texts.</summary>
public enum RespondentContentSurveyLock
{
    /// <summary>Nothing: the write may go ahead.</summary>
    None,

    /// <summary>The survey is archived. Nobody writes; 409.</summary>
    Archived,

    /// <summary>A company admin, and the survey has left «active». 409.</summary>
    Locked,
}

/// <summary>
/// Who edits what a client reads (ruled 2026-11-19, <c>docs/decisions/editable-respondent-content.md</c>):
/// <list type="bullet">
/// <item>Company level: a super admin for any company, a company admin for their own.</item>
/// <item>Survey level: a company admin of the survey's company while it is draft, scheduled or
/// active; a super admin in ANY status but archived -- the ruling's "although it's already
/// published, it can still be edited by the super admin".</item>
/// </list>
/// Who may administer the survey at all (the 403) is <c>SurveyEndpoints.CanAdminister</c>'s,
/// checked first; this is only the status half.
/// </summary>
public static class RespondentContentPermissions
{
    /// <summary>Whether <paramref name="role"/> with <paramref name="callerCompanyId"/> may read and write <paramref name="companyId"/>'s own wording.</summary>
    public static bool CanEditCompany(string? role, string? callerCompanyId, Guid companyId)
        => role == Roles.SuperAdmin
           || (role == Roles.CompanyAdmin && string.Equals(callerCompanyId, companyId.ToString(), StringComparison.OrdinalIgnoreCase));

    /// <summary>What, if anything, stops <paramref name="role"/> writing a survey in <paramref name="status"/>.</summary>
    public static RespondentContentSurveyLock SurveyLock(string? role, string? status)
    {
        if (string.Equals(status, SurveyStatuses.Archived, StringComparison.Ordinal))
        {
            return RespondentContentSurveyLock.Archived;
        }

        if (role == Roles.SuperAdmin)
        {
            return RespondentContentSurveyLock.None;
        }

        return SurveyStatuses.AllowsScheduleEdit(status)
            ? RespondentContentSurveyLock.None
            : RespondentContentSurveyLock.Locked;
    }

    /// <summary>The survey's or company's language as the locales an editor should offer.</summary>
    public static IReadOnlyList<string> RequiredLocales(string? language)
        => language switch
        {
            RespondentContentLocales.Spanish => [RespondentContentLocales.Spanish],
            RespondentContentLocales.English => [RespondentContentLocales.English],
            _ => [RespondentContentLocales.Spanish, RespondentContentLocales.English],
        };
}
