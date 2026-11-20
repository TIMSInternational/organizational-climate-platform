using ClimateProject.Application.OrgStructure;
using ClimateProject.Application.RespondentContent;
using ClimateProject.Application.Surveys;
using ClimateProject.Domain.Entities;
using ClimateProject.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace ClimateProject.Api.Endpoints;

/// <summary>
/// The two facts about a reader that a respond view depends on -- everything else in it is the
/// survey's.
/// </summary>
/// <param name="IsAnonymous">
/// What is stored for THIS reader, not the survey's setting: an unauthenticated visitor to an
/// identified survey answers anonymously, and the promise on their screen has to say so.
/// </param>
/// <param name="HasAccount">
/// Whether the reader answers as an account (signed in, or holding a personal link). A reader with
/// none is asked the company's self-declared demographics; one with an account never is
/// (<c>AsksSelfDeclaredDemographics</c>).
/// </param>
internal readonly record struct RespondReader(bool IsAnonymous, bool HasAccount)
{
    /// <summary>
    /// A visitor who opened the survey's link or QR with no account -- the reader
    /// <c>ResolveRespondentAsync</c> serves an unauthenticated request as.
    /// </summary>
    public static RespondReader LinkVisitor => new(IsAnonymous: true, HasAccount: false);
}

public static partial class SurveyResponseEndpoints
{
    /// <summary>
    /// The respond view of <paramref name="survey"/> for <paramref name="reader"/>: exactly what
    /// <c>GET /surveys/{id}/respond</c> returns once it has admitted a respondent, built without a
    /// respondent, a session or a write.
    /// </summary>
    /// <remarks>
    /// <para><b>Read only.</b> Nothing here mints a session, looks up a response or writes a row;
    /// the caller passes what it found as <paramref name="inProgress"/> (the respond GET: the
    /// reader's own resumable response; a preview: null). It does not check the survey's status
    /// or who may read it either -- the respond GET has done both by the time it calls this, and
    /// any other caller must do its own (a preview is an administrator's, on any status).</para>
    /// <para><b>One answer per text.</b> <see cref="SurveyRespondView.RespondentIntro"/> and
    /// <see cref="SurveyRespondView.ClosingMessage"/> are the same values as
    /// <c>Content["anonymousBody"]</c> and <c>Content["thankYouTitle"]</c>, from the same chain
    /// (survey column → company row, in <see cref="SurveyRespondView.ResolvedLocale"/> and no
    /// other locale). They are kept for the screens that read them today and are superseded by
    /// <see cref="SurveyRespondView.Content"/>; they never fall back to another language and are
    /// never listed in <see cref="SurveyRespondView.FallbackFields"/>.</para>
    /// </remarks>
    /// <param name="lang">The locale asked for, as the respond GET's <c>?lang=</c>.</param>
    internal static async Task<SurveyRespondView> BuildRespondViewAsync(
        ClimateProjectDbContext db,
        Survey survey,
        string? lang,
        RespondReader reader,
        SurveyResponseState? inProgress,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(db);
        ArgumentNullException.ThrowIfNull(survey);

        var locale = SurveyContent.ResolveRequestLocale(lang, survey.Language);
        var resolvedLocale = ResolvedLocaleOf(survey, locale);
        var fallbackFields = new List<string>();
        var questions = await LoadQuestionDtosAsync(survey, db, locale, fallbackFields, cancellationToken);

        // The company's «Aviso de privacidad», and nothing else of the company: this view is
        // served to anonymous link visitors too, so what it may carry is chosen here.
        var privacyNotice = await db.Companies.AsNoTracking()
            .Where(c => c.Id == survey.CompanyId)
            .Select(c => new { c.Branding.PrivacyNoticeEs, c.Branding.PrivacyNoticeEn })
            .FirstOrDefaultAsync(cancellationToken);

        // The client's words, in the locale this payload is actually in -- never the one
        // merely asked for, so a Spanish-only survey read with ?lang=en carries Spanish words
        // beside its Spanish title, and never an English reader's Spanish override.
        var content = await RespondentContentStore.ResolveAsync(
            db, survey, resolvedLocale, RespondentContentKinds.RespondentPayload, cancellationToken);

        return new SurveyRespondView(
            survey.Id,
            SurveyContent.Resolve(survey.TitleEn, survey.TitleEs, locale, survey.Language, "title", fallbackFields),
            SurveyContent.Resolve(survey.DescriptionEn, survey.DescriptionEs, locale, survey.Language, "description", fallbackFields),
            survey.Type,
            survey.Language,
            resolvedLocale,
            fallbackFields,
            survey.StartDate,
            survey.EndDate,
            reader.IsAnonymous,
            survey.Settings.AllowPartialResponses,
            survey.Settings.AutoSave,
            survey.Settings.RandomizeQuestions,
            survey.Settings.ShowProgress,
            survey.Settings.TimeLimitMinutes,
            questions,
            AsksSelfDeclaredDemographics(survey, reader)
                ? ToDemographicDtos(
                    await LoadSelfDeclaredFieldsAsync(survey.CompanyId, db, cancellationToken),
                    locale,
                    survey.Language,
                    fallbackFields)
                : [],
            inProgress,
            AsksParticipantIdentity(survey, reader),
            // The same answer as Content, from the same chain -- see the remarks.
            content.GetValueOrDefault(RespondentContentRegistry.AnonymousBody),
            content.GetValueOrDefault(RespondentContentRegistry.ThankYouTitle),
            BrandingValidation.NormalisePrivacyNotice(privacyNotice?.PrivacyNoticeEs),
            BrandingValidation.NormalisePrivacyNotice(privacyNotice?.PrivacyNoticeEn),
            survey.Settings.EstimatedMinutes,
            content);
    }
}
