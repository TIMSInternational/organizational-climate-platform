using System.Globalization;
using System.Text;
using ClimateProject.Application.Email;
using ClimateProject.Application.Localization;
using ClimateProject.Domain.Entities;

namespace ClimateProject.Application.Surveys;

/// <summary>
/// The survey's own invitation words, as the four columns on <see cref="SurveySettings"/> hold
/// them. Blank means "not written", and the composer then uses its own short default for that
/// language rather than the other language's text.
/// </summary>
public sealed record PersonalLinkText(string? SubjectEs, string? SubjectEn, string? MessageEs, string? MessageEn)
{
    public static readonly PersonalLinkText None = new(null, null, null, null);

    public static PersonalLinkText From(SurveySettings settings)
    {
        ArgumentNullException.ThrowIfNull(settings);
        return new PersonalLinkText(
            settings.InvitationCustomSubjectEs,
            settings.InvitationCustomSubjectEn,
            settings.InvitationCustomMessageEs,
            settings.InvitationCustomMessageEn);
    }
}

/// <summary>
/// Everything about ONE survey's personal-link email that does not depend on the person:
/// the company's language and brand, the survey's title in each language, the day it closes
/// in the company's zone, and the survey's own invitation words.
/// </summary>
/// <param name="CompanyLanguage">Decides which language(s) the message is written in -- see <see cref="PersonalLinkEmailComposer"/>.</param>
public sealed record SurveyPersonalLinkMail(
    string? CompanyLanguage,
    EmailBrand Brand,
    string? SurveyTitleEs,
    string? SurveyTitleEn,
    DateOnly SurveyClosesOn,
    PersonalLinkText Text);

/// <summary>
/// The personal-link invitation: one person's own <c>/survey-invitations/{token}</c> link, under
/// the subject and message the survey's author wrote. Ruled 2026-11-18 by Federico for
/// PROCOMER (<c>docs/decisions/personal-link-invitations.md</c>).
///
/// <para><b>It carries no username and no password, and has nowhere to put one.</b> There is no
/// parameter for either. In <c>personal_link</c> mode the link is the key: it opens this one
/// survey as this person, so it is the only thing the message needs to hand over, and a second
/// set of access details beside it is exactly the "¿Ingreso con los accesos de arriba o los de
/// abajo?" confusion ESPH's rehearsal returned on 2026-10-17.</para>
///
/// <para><b>One language when the company has declared one; both only when it has not</b> --
/// the rule <see cref="ClimateProject.Application.OrgStructure.CredentialsEmailComposer"/>
/// follows, for the reason it gives. The recipient's own <c>UserPreferences.Language</c> is NOT
/// consulted: it defaults to <c>en</c> and the roster import never sets it, so it would have
/// made a Spanish-speaking company's whole roster English readers (2026-10-16).</para>
///
/// <para><b>The survey's words, then the product's.</b> In each language the subject and the
/// message are the survey's <c>InvitationCustomSubject*</c> / <c>InvitationCustomMessage*</c>
/// for that language when written, and a short neutral default otherwise. The other language's
/// text is never borrowed: a Spanish block showing English words is the silent substitution
/// #195 forbids.</para>
///
/// <para><b>The link appears twice</b> -- as the button and as plain text under it -- because
/// a button is an image-like construct some clients and some corporate filters strip, and a
/// person who cannot press it must still be able to get in. It is never logged by the sender.</para>
/// </summary>
public static class PersonalLinkEmailComposer
{
    /// <param name="toEmail">The invitee's address, the message's only recipient.</param>
    /// <param name="link">Absolute: the sender resolves <see cref="SurveyAccessTokens.InvitationLinkPath"/> against the app's base URL.</param>
    /// <param name="mail">The person-independent half, resolved once per request.</param>
    public static EmailMessage Compose(string toEmail, string link, SurveyPersonalLinkMail mail)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(toEmail);
        ArgumentException.ThrowIfNullOrWhiteSpace(link);
        ArgumentNullException.ThrowIfNull(mail);

        // Exactly the credentials mail's rule: a single company locale is that locale alone;
        // `both`, none, or anything unrecognised is both blocks, Spanish first only when the
        // company's single locale is Spanish -- i.e. English first, as that mail orders it.
        var single = ContentLanguages.SingleLocaleOf(mail.CompanyLanguage);
        var spanishFirst = single == ContentLanguages.Spanish;
        var first = Block(mail, spanish: spanishFirst);
        var second = single is null ? Block(mail, spanish: !spanishFirst) : null;
        var brand = mail.Brand;

        var html = new StringBuilder();
        AppendHtml(html, first, link, brand);
        if (second is not null)
        {
            html.Append("""<hr style="border:none;border-top:1px solid #e4e7eb;margin:28px 0;">""");
            AppendHtml(html, second, link, brand);
        }

        html.Append(EmailBranding.Footer(EmailBranding.Escape(
            second is null ? first.Copy.Ignore : $"{first.Copy.Ignore} / {second.Copy.Ignore}")));

        var text = new StringBuilder();
        AppendText(text, first, link);
        if (second is not null)
        {
            text.Append("\n--\n\n");
            AppendText(text, second, link);
        }

        var documentLanguage = single ?? ContentLanguages.FallbackLocale;
        return new EmailMessage(
            toEmail,
            // Null, so the mail is addressed to the bare address, as the credentials mail is.
            ToName: null,
            EmailMessage.ToHeaderValue(second is null ? first.Subject : $"{first.Subject} / {second.Subject}"),
            text.Append("\n\n").Append(EmailBranding.Credit(documentLanguage)).ToString(),
            EmailBranding.Document(documentLanguage, html.ToString(), brand));
    }

    /// <summary>
    /// One language's subject and message: the survey's own words for that language when
    /// written, the default otherwise. Public so a screen or a test can show exactly what a
    /// block will read without composing a message.
    /// </summary>
    public static (string Subject, string Message) WordsFor(SurveyPersonalLinkMail mail, bool spanish)
    {
        ArgumentNullException.ThrowIfNull(mail);
        var block = Block(mail, spanish);
        return (block.Subject, block.Message);
    }

    private static BlockContent Block(SurveyPersonalLinkMail mail, bool spanish)
    {
        var copy = spanish ? Spanish : English;
        var survey = Clean(spanish ? mail.SurveyTitleEs : mail.SurveyTitleEn)
                     ?? Clean(spanish ? mail.SurveyTitleEn : mail.SurveyTitleEs);
        var company = Clean(mail.Brand.CompanyName);
        var closes = string.Format(CultureInfo.InvariantCulture, copy.ClosesOn, EmailDays.Long(mail.SurveyClosesOn, spanish));

        var subject = Clean(spanish ? mail.Text.SubjectEs : mail.Text.SubjectEn)
                      ?? DefaultSubject(copy, survey, company);
        var message = Clean(spanish ? mail.Text.MessageEs : mail.Text.MessageEn)
                      ?? (survey is null
                          ? string.Format(CultureInfo.InvariantCulture, copy.DefaultMessage, closes)
                          : string.Format(CultureInfo.InvariantCulture, copy.DefaultSurveyMessage, survey, closes));

        // The note under the button always names the survey and its close, because the
        // author's message may do neither -- PROCOMER's does not -- and "this link opens your
        // survey" with no survey named says nothing to somebody holding two of these.
        var note = survey is null
            ? $"{copy.Personal} {closes}"
            : $"{copy.Personal} {string.Format(CultureInfo.InvariantCulture, copy.SurveyClosesOn, survey, EmailDays.Long(mail.SurveyClosesOn, spanish))}";

        return new BlockContent(copy, subject, message, note);
    }

    private static string DefaultSubject(LinkCopy copy, string? survey, string? company)
    {
        if (survey is null)
        {
            return copy.DefaultSubject;
        }

        var named = string.Format(CultureInfo.InvariantCulture, copy.DefaultSurveySubject, survey);
        return company is null ? named : $"{named} — {company}";
    }

    private static string? Clean(string? value) => string.IsNullOrWhiteSpace(value) ? null : value.Trim();

    private static void AppendHtml(StringBuilder html, BlockContent block, string link, EmailBrand brand)
    {
        html.Append(EmailBranding.Heading(block.Subject));
        foreach (var paragraph in ParagraphsOf(block.Message))
        {
            html.Append(EmailBranding.Paragraphs(paragraph));
        }

        html.Append(EmailBranding.Button(link, block.Copy.Cta, brand));
        html.Append("""<p style="margin:0 0 12px;font-size:13px;line-height:1.55;color:#52606d;">""")
            .Append(EmailBranding.Escape(block.Copy.Fallback))
            .Append("<br>")
            .Append("""<a href=""").Append('"').Append(EmailBranding.Escape(link)).Append('"')
            .Append(""" style="color:#1f4fd1;word-break:break-all;">""")
            .Append(EmailBranding.Escape(link))
            .Append("</a></p>");
        html.Append("""<p style="margin:0 0 4px;font-size:13px;line-height:1.55;color:#52606d;">""")
            .Append(EmailBranding.Escape(block.Note))
            .Append("</p>");
    }

    private static void AppendText(StringBuilder text, BlockContent block, string link)
    {
        text.Append(block.Subject).Append("\n\n");
        text.Append(block.Message.Replace("\r\n", "\n", StringComparison.Ordinal).Trim()).Append("\n\n");
        text.Append(block.Copy.Cta).Append(": ").Append(link).Append("\n\n");
        text.Append(block.Note).Append('\n');
        text.Append(block.Copy.Ignore).Append('\n');
    }

    /// <summary>
    /// The author's message split on blank lines, so each paragraph they wrote is its own
    /// paragraph in the mail rather than one block with an empty line inside it.
    /// </summary>
    private static IEnumerable<string> ParagraphsOf(string message)
        => message.Replace("\r\n", "\n", StringComparison.Ordinal)
            .Split("\n\n", StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
            .Where(p => p.Length > 0);

    private sealed record BlockContent(LinkCopy Copy, string Subject, string Message, string Note);

    /// <param name="DefaultSubject">The subject when nothing names the survey.</param>
    /// <param name="DefaultSurveySubject"><c>{0}</c> the survey.</param>
    /// <param name="DefaultMessage"><c>{0}</c> the closing sentence.</param>
    /// <param name="DefaultSurveyMessage"><c>{0}</c> the survey, <c>{1}</c> the closing sentence.</param>
    /// <param name="ClosesOn"><c>{0}</c> the day.</param>
    /// <param name="SurveyClosesOn"><c>{0}</c> the survey, <c>{1}</c> the day.</param>
    private sealed record LinkCopy(
        string DefaultSubject,
        string DefaultSurveySubject,
        string DefaultMessage,
        string DefaultSurveyMessage,
        string Cta,
        string Fallback,
        string Personal,
        string ClosesOn,
        string SurveyClosesOn,
        string Ignore);

    private static readonly LinkCopy Spanish = new(
        DefaultSubject: "Invitación a responder una encuesta",
        DefaultSurveySubject: "Invitación a la encuesta «{0}»",
        DefaultMessage: "Su organización le invita a responder una encuesta. Use el botón de abajo: el enlace es personal y le lleva directamente a la encuesta. {0} Gracias por participar.",
        DefaultSurveyMessage: "Su organización le invita a responder la encuesta «{0}». Use el botón de abajo: el enlace es personal y le lleva directamente a la encuesta. {1} Gracias por participar.",
        Cta: "Responder la encuesta",
        Fallback: "Si el botón no funciona, copie este enlace en su navegador:",
        Personal: "Este enlace es solo para usted: abre su propia encuesta, así que no lo reenvíe.",
        ClosesOn: "La encuesta cierra el {0}.",
        SurveyClosesOn: "La encuesta «{0}» cierra el {1}.",
        Ignore: "Si no esperaba este mensaje, puede ignorarlo.");

    private static readonly LinkCopy English = new(
        DefaultSubject: "Invitation to answer a survey",
        DefaultSurveySubject: "Invitation to the survey “{0}”",
        DefaultMessage: "Your organisation invites you to answer a survey. Use the button below: the link is personal and takes you straight to the survey. {0} Thank you for taking part.",
        DefaultSurveyMessage: "Your organisation invites you to answer the survey “{0}”. Use the button below: the link is personal and takes you straight to the survey. {1} Thank you for taking part.",
        Cta: "Answer the survey",
        Fallback: "If the button does not work, copy this link into your browser:",
        Personal: "This link is just for you: it opens your own survey, so please do not forward it.",
        ClosesOn: "The survey closes on {0}.",
        SurveyClosesOn: "The survey “{0}” closes on {1}.",
        Ignore: "If you were not expecting this message you can ignore it.");
}

/// <summary>
/// Delivers ONE personal-link invitation (<see cref="PersonalLinkEmailComposer"/>) and says
/// what the attempt did, so the route can tell the operator who did not get their link.
///
/// <para>
/// Takes the TOKEN, not a URL: only the implementation knows the app's base URL, and building
/// the link there is what stops a staging deployment from mailing somebody a production link.
/// No implementation may log the token, the link or the address -- the link signs its holder
/// in to their survey.
/// </para>
/// </summary>
public interface IPersonalLinkEmailSender
{
    Task<EmailSendOutcome> SendAsync(
        string toEmail, string invitationToken, SurveyPersonalLinkMail mail, CancellationToken cancellationToken);
}

/// <summary>
/// The person-independent half of a personal-link invitation, built once per request from the
/// same five company columns the per-survey credentials mail reads
/// (<see cref="SurveyCredentialCompany"/>) -- so the two messages a company's people can receive
/// wear one brand and print one close date.
/// </summary>
public static class SurveyPersonalLinks
{
    public static SurveyPersonalLinkMail MailFor(Survey survey, SurveyCredentialCompany? company)
    {
        ArgumentNullException.ThrowIfNull(survey);

        return new SurveyPersonalLinkMail(
            company?.Language,
            company is null ? EmailBrand.None : new EmailBrand(company.LogoUrl, company.Name, company.PrimaryColor),
            LocalizedContent.ResolveText(survey.TitleEn, survey.TitleEs, ContentLanguages.Spanish, survey.Language),
            LocalizedContent.ResolveText(survey.TitleEn, survey.TitleEs, ContentLanguages.English, survey.Language),
            // The DAY it closes on the company's clock, never the UTC date -- the reason
            // `SurveyCredentialIssuance.MailFor` gives, which this mail must not reintroduce.
            DateOnly.FromDateTime(Scheduling.SchedulingTimeZone.ToLocal(
                survey.EndDate, Scheduling.SchedulingTimeZone.Resolve(company?.Timezone))),
            PersonalLinkText.From(survey.Settings));
    }
}
