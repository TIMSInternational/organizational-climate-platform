using System.Security.Claims;
using ClimateProject.Application.Auth;
using ClimateProject.Application.Email;
using ClimateProject.Application.Localization;
using ClimateProject.Application.OrgStructure;
using ClimateProject.Application.RespondentContent;
using ClimateProject.Application.Surveys;
using ClimateProject.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace ClimateProject.Api.Endpoints;

/// <summary>
/// One survey email as the recipient would receive it, from the SAVED words -- so an editor of
/// <c>email.*</c> (ruled 2026-11-19, <c>docs/decisions/editable-respondent-content.md</c>) can
/// show what the client's subject and paragraph turn into, and what a blank field falls back to,
/// without a second copy of the default text anywhere in the web.
/// </summary>
/// <remarks>
/// <para><b>Composed by the composers that send.</b> The same
/// <see cref="CredentialsEmailComposer"/>, <see cref="SurveyReminderEmailComposer"/> and
/// <see cref="PersonalLinkEmailComposer"/>, over the same chain read the send sites make
/// (<see cref="RespondentContentStore.LoadAsync(ClimateProjectDbContext, Domain.Entities.Survey, CancellationToken)"/>),
/// so a preview cannot drift from a mail. The person's half is a sample: a username minted the
/// way a real one is but never stored, a masked password, and a link that opens nothing.</para>
/// <para><b>A read.</b> It writes nothing and mails nothing; it is a GET, so the audit middleware
/// does not record it. Whoever may edit the words may see them: a survey's administrators, and a
/// company's (a super admin for any).</para>
/// </remarks>
public static class RespondentEmailPreviewEndpoints
{
    /// <summary>The three survey mails, as the route names them.</summary>
    public const string PersonalLink = "personalLink";

    public const string Credentials = "credentials";

    public const string Reminder = "reminder";

    /// <summary>Printed where the real mail prints a password: never one, and plainly not one.</summary>
    public const string SamplePassword = "••••••••";

    private const string SampleRecipient = "persona@ejemplo.invalid";
    private const string SampleToken = "ejemplo";
    private const string MailConstraint = "regex(^(personalLink|credentials|reminder)$)";

    public static void MapRespondentEmailPreviewEndpoints(this WebApplication app)
    {
        app.MapGet($"/surveys/{{surveyId:guid}}/respondent-content/email-preview/{{mail:{MailConstraint}}}", SurveyAsync)
            .RequireAuthorization();
        app.MapGet($"/admin/companies/{{companyId:guid}}/respondent-content/email-preview/{{mail:{MailConstraint}}}", CompanyAsync)
            .RequireAuthorization();
    }

    private static async Task<IResult> SurveyAsync(
        Guid surveyId,
        string mail,
        ClaimsPrincipal principal,
        ClimateProjectDbContext db,
        EmailOptions options,
        CancellationToken cancellationToken)
    {
        var currentUser = principal.GetCurrentUser();
        var survey = await db.Surveys.AsNoTracking().FirstOrDefaultAsync(s => s.Id == surveyId, cancellationToken);
        if (survey is null)
        {
            return Results.Json(new { message = "Survey not found" }, statusCode: 404);
        }

        if (!SurveyEndpoints.CanAdminister(currentUser, survey.CompanyId))
        {
            return Results.Forbid();
        }

        var company = await LoadCompanyAsync(db, survey.CompanyId, cancellationToken);
        var content = await RespondentContentStore.LoadAsync(db, survey, cancellationToken);

        EmailMessage message;
        if (mail == PersonalLink)
        {
            var link = SurveyPersonalLinks.MailFor(survey, company, content);
            message = PersonalLinkEmailComposer.Compose(
                SampleRecipient, SampleLink(options), link with { Brand = link.Brand.ResolvedAgainst(options) });
        }
        else
        {
            var credentials = SurveyCredentialIssuance.MailFor(survey, company, content);
            var username = MassInviteCredentials.Username(credentials.UsernamePrefix);
            var brand = credentials.Brand.ResolvedAgainst(options);
            message = mail == Credentials
                ? CredentialsEmailComposer.Compose(
                    SampleRecipient, null, username, SamplePassword, options.LinkTo(CredentialsEmailComposer.LoginPath),
                    credentials.CompanyLanguage, CredentialsEmailPurpose.Invitation, brand,
                    credentials.SurveyTitle, credentials.SurveyClosesOn, credentials.CredentialsText)
                : SurveyReminderEmailComposer.Compose(
                    SampleRecipient, null, username, options.LinkTo(SurveyReminderEmailComposer.LoginPath),
                    credentials.CompanyLanguage, brand, credentials.SurveyTitle, credentials.ReminderText);
        }

        return Results.Ok(RespondentEmailPreview.Of(mail, message));
    }

    private static async Task<IResult> CompanyAsync(
        Guid companyId,
        string mail,
        ClaimsPrincipal principal,
        ClimateProjectDbContext db,
        EmailOptions options,
        CancellationToken cancellationToken)
    {
        var currentUser = principal.GetCurrentUser();
        if (!RespondentContentPermissions.CanEditCompany(currentUser.Role, currentUser.CompanyId, companyId))
        {
            return Results.Forbid();
        }

        var company = await LoadCompanyAsync(db, companyId, cancellationToken);
        if (company is null)
        {
            return Results.Json(new { message = "Company not found" }, statusCode: 404);
        }

        // No survey here: the company's words are shown over a sample one, named in the company's
        // language, closing two weeks from today -- what any of its surveys would read.
        var content = await RespondentContentStore.LoadAsync(db, companyId, cancellationToken);
        var brand = new EmailBrand(company.LogoUrl, company.Name, company.PrimaryColor).ResolvedAgainst(options);
        var english = ContentLanguages.SingleLocaleOf(company.Language) == ContentLanguages.English;
        var sampleName = english ? SampleSurveyEn : SampleSurveyEs;
        var closesOn = DateOnly.FromDateTime(DateTime.UtcNow).AddDays(14);
        var username = MassInviteCredentials.Username(MassInviteCredentials.PrefixFor(company.Name));

        var message = mail switch
        {
            PersonalLink => PersonalLinkEmailComposer.Compose(
                SampleRecipient,
                SampleLink(options),
                new SurveyPersonalLinkMail(company.Language, brand, SampleSurveyEs, SampleSurveyEn, closesOn, PersonalLinkText.From(content))),
            Credentials => CredentialsEmailComposer.Compose(
                SampleRecipient, null, username, SamplePassword, options.LinkTo(CredentialsEmailComposer.LoginPath),
                company.Language, CredentialsEmailPurpose.Invitation, brand, sampleName, closesOn,
                SurveyEmailText.Credentials(content)),
            _ => SurveyReminderEmailComposer.Compose(
                SampleRecipient, null, username, options.LinkTo(SurveyReminderEmailComposer.LoginPath),
                company.Language, brand, sampleName, SurveyEmailText.Reminder(content)),
        };

        return Results.Ok(RespondentEmailPreview.Of(mail, message));
    }

    /// <summary>The sample survey a company-level preview names, in each language.</summary>
    public const string SampleSurveyEs = "Encuesta de ejemplo";

    public const string SampleSurveyEn = "Sample survey";

    private static string SampleLink(EmailOptions options)
        => options.LinkTo(SurveyAccessTokens.InvitationLinkPath(SampleToken));

    private static Task<SurveyCredentialCompany?> LoadCompanyAsync(ClimateProjectDbContext db, Guid companyId, CancellationToken cancellationToken)
        => db.Companies
            .AsNoTracking()
            .Where(c => c.Id == companyId)
            .Select(c => new SurveyCredentialCompany(
                c.Name, c.Settings.Language, c.Branding.LogoUrl, c.Branding.PrimaryColor, c.Settings.Timezone))
            .FirstOrDefaultAsync(cancellationToken);
}

/// <summary>
/// <c>GET …/respondent-content/email-preview/{mail}</c>: the composed mail. <c>Html</c> is the
/// composer's own document, every authored value already escaped by <c>EmailBranding</c>; a
/// screen shows it in a sandboxed frame.
/// </summary>
public sealed record RespondentEmailPreview(string Mail, string Subject, string Text, string Html)
{
    public static RespondentEmailPreview Of(string mail, EmailMessage message)
    {
        ArgumentNullException.ThrowIfNull(message);
        return new RespondentEmailPreview(mail, message.Subject, message.TextBody, message.HtmlBody);
    }
}
