using ClimateProject.Application.Email;
using ClimateProject.Application.OrgStructure;
using ClimateProject.Application.RespondentContent;

namespace ClimateProject.UnitTests.OrgStructure;

/// <summary>
/// The credentials and reminder mails under a client's own subject and paragraph
/// (<c>email.credentials.*</c>, <c>email.reminder.*</c>; ruled 2026-11-19,
/// <c>docs/decisions/editable-respondent-content.md</c>).
///
/// <para>The rule these pin: an override replaces the SUBJECT and the OPENING PARAGRAPH, and
/// nothing a person needs to get in. The username, the password, the sign-in button and its
/// link, the line naming the survey and what to do with the message stay code -- a client's
/// words cannot remove them, because there is nowhere in <see cref="SurveyEmailText"/> to put a
/// replacement for any of them.</para>
/// </summary>
public class SurveyEmailOverrideTests
{
    private const string LoginUrl = "https://app.example.com/login";
    private const string Username = "esph-k7m2q9xa";
    private const string Password = "Qp7-Rm2-Tx9";
    private const string Survey = "Clima Organizacional 2026";
    private static readonly EmailBrand Brand = new(null, "ESPH", null);
    private static readonly DateOnly ClosesOn = new(2026, 11, 30);

    private static EmailMessage Credentials(string? language, SurveyEmailText? text) =>
        CredentialsEmailComposer.Compose(
            "person@example.com", "Ana", Username, Password, LoginUrl, language, CredentialsEmailPurpose.Invitation,
            Brand, Survey, ClosesOn, text);

    private static EmailMessage Reminder(string? language, SurveyEmailText? text) =>
        SurveyReminderEmailComposer.Compose("person@example.com", "Ana", Username, LoginUrl, language, Brand, Survey, text);

    private static readonly SurveyEmailText SpanishOnly = new(
        SubjectEs: "Sus datos para {survey} — {company}",
        SubjectEn: null,
        MessageEs: "Muy buenas tardes, gracias por participar.\n\nEsta encuesta es de {company}.",
        MessageEn: null);

    // ------------------------------------------------------------------ credentials

    [Fact]
    public void The_clients_subject_and_paragraph_replace_the_defaults_with_placeholders_filled()
    {
        var message = Credentials("es", SpanishOnly);

        Assert.Equal($"Sus datos para {Survey} — ESPH", message.Subject);
        Assert.StartsWith($"Sus datos para {Survey} — ESPH\n\nMuy buenas tardes, gracias por participar.\n\nEsta encuesta es de ESPH.\n\n", message.TextBody, StringComparison.Ordinal);
        Assert.Contains("<h1 style=\"margin:0 0 16px;font-size:20px;line-height:1.3;color:#0b1524;\">Sus datos para", message.HtmlBody, StringComparison.Ordinal);
        // Each paragraph the client wrote is its own paragraph.
        Assert.Contains(">Muy buenas tardes, gracias por participar.</p>", message.HtmlBody, StringComparison.Ordinal);
        Assert.Contains(">Esta encuesta es de ESPH.</p>", message.HtmlBody, StringComparison.Ordinal);
        // The default paragraph and subject are gone.
        Assert.DoesNotContain("Su organización le invita", message.TextBody, StringComparison.Ordinal);
        Assert.DoesNotContain("Su acceso a", message.Subject, StringComparison.Ordinal);
    }

    [Fact]
    public void A_clients_paragraph_never_removes_the_credentials_the_button_or_the_survey_line()
    {
        // The worst a client can write: a paragraph that tries to say everything itself.
        var text = new SurveyEmailText("Asunto", "Subject", "Solo este párrafo.", "Only this paragraph.");

        foreach (var language in new[] { "es", "en", "both" })
        {
            var message = Credentials(language, text);
            var spanish = language != "en";
            var english = language != "es";

            if (spanish)
            {
                Assert.Contains($"Usuario: {Username}\nContraseña: {Password}\n", message.TextBody, StringComparison.Ordinal);
                Assert.Contains($"Iniciar sesión: {LoginUrl}?u={Username}", message.TextBody, StringComparison.Ordinal);
                Assert.Contains($"Estos datos son para la encuesta «{Survey}». La encuesta cierra el", message.TextBody, StringComparison.Ordinal);
                Assert.Contains("Guarde este mensaje: este usuario y esta contraseña abren solo esta encuesta.", message.TextBody, StringComparison.Ordinal);
            }

            if (english)
            {
                Assert.Contains($"Username: {Username}\nPassword: {Password}\n", message.TextBody, StringComparison.Ordinal);
                Assert.Contains($"Sign in: {LoginUrl}?u={Username}", message.TextBody, StringComparison.Ordinal);
                Assert.Contains($"These details are for the survey “{Survey}”. The survey closes on", message.TextBody, StringComparison.Ordinal);
            }

            // The HTML carries the pair and the button, once per language block.
            Assert.Equal(spanish && english ? 2 : 1, Count(message.HtmlBody, Password));
            Assert.Equal(spanish && english ? 2 : 1, Count(message.HtmlBody, $"href=\"{LoginUrl}?u={Username}\""));
        }
    }

    [Fact]
    public void A_language_the_client_did_not_write_keeps_its_default_and_never_borrows_the_other()
    {
        var message = Credentials("both", SpanishOnly);

        // Spanish block: the client's. English block: today's English, untouched.
        Assert.Equal($"Your access to {Survey} — ESPH / Sus datos para {Survey} — ESPH", message.Subject);
        Assert.Contains("Your organisation has invited you to answer the survey", message.TextBody, StringComparison.Ordinal);
        var english = message.TextBody[..message.TextBody.IndexOf("\n--\n", StringComparison.Ordinal)];
        Assert.DoesNotContain("Muy buenas tardes", english, StringComparison.Ordinal);
        // And the line naming the survey is added only after the client's paragraph.
        Assert.DoesNotContain("These details are for the survey", message.TextBody, StringComparison.Ordinal);
    }

    [Fact]
    public void The_clients_words_are_escaped_after_they_are_filled()
    {
        var hostile = new SurveyEmailText("<b>{company}</b>", null, "<a href=\"https://evil.example\">Entre aqui</a>", null);
        var message = Credentials("es", hostile);

        Assert.DoesNotContain("<a href=\"https://evil.example\"", message.HtmlBody, StringComparison.Ordinal);
        Assert.Contains("&lt;a href=&quot;https://evil.example&quot;&gt;Entre aqui&lt;/a&gt;", message.HtmlBody, StringComparison.Ordinal);
        Assert.Contains("&lt;b&gt;ESPH&lt;/b&gt;", message.HtmlBody, StringComparison.Ordinal);
    }

    [Theory]
    [InlineData("es")]
    [InlineData("en")]
    [InlineData("both")]
    public void Blank_words_are_todays_mail_byte_for_byte(string language)
    {
        var blank = new SurveyEmailText("  ", "", "\n\n", null);

        Assert.Equal(SurveyEmailDefaultsPinTests.Hash(Credentials(language, null)), SurveyEmailDefaultsPinTests.Hash(Credentials(language, blank)));
        Assert.Equal(SurveyEmailDefaultsPinTests.Hash(Credentials(language, null)), SurveyEmailDefaultsPinTests.Hash(Credentials(language, SurveyEmailText.None)));
        Assert.Equal(SurveyEmailDefaultsPinTests.Hash(Reminder(language, null)), SurveyEmailDefaultsPinTests.Hash(Reminder(language, blank)));
        Assert.Equal(SurveyEmailDefaultsPinTests.Hash(Reminder(language, null)), SurveyEmailDefaultsPinTests.Hash(Reminder(language, SurveyEmailText.None)));
    }

    // ------------------------------------------------------------------ reminder

    [Fact]
    public void The_reminder_takes_the_clients_subject_heading_and_paragraph()
    {
        var text = new SurveyEmailText("Le falta {survey}", null, "Por favor termine la encuesta de {company}.", null);
        var message = Reminder("es", text);

        Assert.Equal($"Le falta {Survey}", message.Subject);
        Assert.StartsWith($"Le falta {Survey}\n\nPor favor termine la encuesta de ESPH.\n\n", message.TextBody, StringComparison.Ordinal);
        Assert.DoesNotContain("Aún no hemos recibido su respuesta", message.TextBody, StringComparison.Ordinal);
    }

    [Fact]
    public void A_reminder_override_never_removes_the_survey_line_the_username_or_the_button_and_adds_no_password()
    {
        var text = new SurveyEmailText("Asunto", "Subject", "Solo este párrafo.", "Only this paragraph.");
        var message = Reminder("both", text);

        Assert.Contains($"Es la encuesta «{Survey}».", message.TextBody, StringComparison.Ordinal);
        Assert.Contains($"This is the “{Survey}” survey.", message.TextBody, StringComparison.Ordinal);
        Assert.Contains($"Usuario: {Username}", message.TextBody, StringComparison.Ordinal);
        Assert.Contains($"Username: {Username}", message.TextBody, StringComparison.Ordinal);
        Assert.Contains($"Entrar y terminar: {LoginUrl}?u={Username}", message.TextBody, StringComparison.Ordinal);
        Assert.Contains($"Sign in and finish: {LoginUrl}?u={Username}", message.TextBody, StringComparison.Ordinal);
        Assert.Contains("pida a su administrador que le envíe datos nuevos", message.TextBody, StringComparison.Ordinal);
        foreach (var rendered in new[] { message.TextBody, message.HtmlBody, message.Subject })
        {
            Assert.DoesNotContain("Contraseña: ", rendered, StringComparison.Ordinal);
            Assert.DoesNotContain("Password: ", rendered, StringComparison.Ordinal);
        }
    }

    // ------------------------------------------------------------------ the chain

    [Fact]
    public void The_survey_wins_over_the_company_per_part_and_per_language_and_never_crosses_languages()
    {
        var sources = new RespondentContentSources(
            CompanyValues:
            [
                new(RespondentContentRegistry.EmailCredentialsSubject, "es", "Empresa asunto"),
                new(RespondentContentRegistry.EmailCredentialsMessage, "es", "Empresa mensaje"),
                new(RespondentContentRegistry.EmailReminderMessage, "en", "Company reminder"),
            ],
            SurveyValues:
            [
                new(RespondentContentRegistry.EmailCredentialsSubject, "es", "Encuesta asunto"),
            ],
            SurveySettings: null);

        Assert.Equal(new SurveyEmailText("Encuesta asunto", null, "Empresa mensaje", null), SurveyEmailText.Credentials(sources));
        Assert.Equal(new SurveyEmailText(null, null, null, "Company reminder"), SurveyEmailText.Reminder(sources));
        Assert.Equal(SurveyEmailText.None, SurveyEmailText.Credentials(RespondentContentSources.Empty));
    }

    private static int Count(string haystack, string needle)
    {
        var count = 0;
        for (var i = haystack.IndexOf(needle, StringComparison.Ordinal); i >= 0; i = haystack.IndexOf(needle, i + needle.Length, StringComparison.Ordinal))
        {
            count++;
        }

        return count;
    }
}
