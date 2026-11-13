using ClimateProject.Application.Email;
using ClimateProject.Application.OrgStructure;

namespace ClimateProject.UnitTests.OrgStructure;

/// <summary>
/// The no-password reminder, asked for by ESPH on 2026-10-30: *"hay forma de enviar
/// recordatorio? no otro usuario o contraseña solo recordatorio?"*.
///
/// <para>
/// The defining property is a NEGATIVE one -- this message carries no password -- and a negative
/// property is exactly the kind a passing suite hides. <see cref="CredentialsEmailComposer"/>
/// renders a password into both of its purposes, and this composer was written beside it by
/// copying its shape, so "a password crept back in" is the realistic regression rather than a
/// theoretical one. <c>No_password_reaches_any_part_of_the_message</c> is what stops it.
/// </para>
/// </summary>
public class SurveyReminderEmailComposerTests
{
    private const string LoginUrl = "https://app.example.com/login";
    private const string Username = "esph-k7m2q9xa";
    private const string Person = "María José Rodríguez Vargas";

    private static EmailMessage Spanish(string? surveyName = null, EmailBrand? brand = null) =>
        SurveyReminderEmailComposer.Compose(
            "person@example.com", Person, Username, LoginUrl, "es", brand, surveyName);

    private static EmailMessage English() =>
        SurveyReminderEmailComposer.Compose("person@example.com", Person, Username, LoginUrl, "en");

    [Fact]
    public void It_says_in_as_many_words_that_no_new_details_are_coming()
    {
        // The client's own sentence is the acceptance criterion: "no otro usuario o contraseña
        // solo recordatorio". A reminder that leaves the reader wondering whether to wait for a
        // new password has not answered it.
        Assert.Contains("no hay usuario ni contraseña nuevos", Spanish().TextBody, StringComparison.Ordinal);
        Assert.Contains("there is no new username or password", English().TextBody, StringComparison.Ordinal);
    }

    [Fact]
    public void It_tells_a_reader_who_already_started_to_carry_on()
    {
        // The people this route exists for are mid-survey: reissue refuses them precisely
        // because they are holding working details. The copy has to speak to that.
        Assert.Contains("continúa donde la dejaste", Spanish().TextBody, StringComparison.Ordinal);
        Assert.Contains("carry on where you left off", English().TextBody, StringComparison.Ordinal);
    }

    [Fact]
    public void No_password_FIELD_is_rendered_although_the_copy_mentions_the_word()
    {
        // The word belongs in the body -- "no hay usuario ni contraseña nuevos" IS the sentence
        // the client asked for -- so asserting its absence would fail on correct copy. What must
        // never appear is a password as a FIELD, which both composers render as "<label>: ".
        // That is the exact shape CredentialsEmailComposer.AppendText/AppendHtml produce, so it
        // is what a copy-paste from next door would bring with it.
        var message = Spanish("Clima Organizacional ESPH 2026", new EmailBrand(null, "ESPH", null));

        foreach (var rendered in new[] { message.TextBody, message.HtmlBody, message.Subject })
        {
            Assert.DoesNotContain("Contraseña: ", rendered, StringComparison.Ordinal);
            Assert.DoesNotContain("Password: ", rendered, StringComparison.Ordinal);
        }

        // And the one credential field that IS rendered is the username, so the assertion above
        // is passing because a password field is absent, not because no fields render at all.
        Assert.Contains($"Usuario: {Username}", message.TextBody, StringComparison.Ordinal);
    }

    [Fact]
    public void No_part_of_the_message_carries_the_recipients_name()
    {
        // Ruled 2026-10-16 and guarded identically on the credentials path: every respondent has
        // been told their company will never see their name beside their answers, and the mail
        // chasing them for those answers must not be the counter-example.
        var message = Spanish("Clima Organizacional ESPH 2026", new EmailBrand(null, "ESPH", null));

        Assert.Null(message.ToName);
        foreach (var rendered in new[] { message.TextBody, message.HtmlBody, message.Subject })
        {
            Assert.DoesNotContain("María", rendered, StringComparison.Ordinal);
            Assert.DoesNotContain("Rodríguez", rendered, StringComparison.Ordinal);
        }
    }

    [Fact]
    public void The_sign_in_link_arrives_with_the_username_on_it()
    {
        // The fix for ESPH's 2026-10-18 reviewer who retyped `y` as `j` from a phone. The
        // username is not a secret; the password is, and this message has none to leak.
        Assert.Contains($"{LoginUrl}?u={Username}", Spanish().TextBody, StringComparison.Ordinal);
    }

    [Fact]
    public void A_company_that_speaks_one_language_gets_that_language_alone()
    {
        // ESPH's first rehearsal finding: a doubled message reads as two sets of details.
        var spanish = Spanish().TextBody;

        Assert.Contains("Aún no hemos recibido tu respuesta", spanish, StringComparison.Ordinal);
        Assert.DoesNotContain("We have not received your response", spanish, StringComparison.Ordinal);
    }

    [Fact]
    public void A_company_that_has_declared_no_language_gets_both()
    {
        var both = SurveyReminderEmailComposer.Compose(
            "person@example.com", Person, Username, LoginUrl, companyLanguage: null).TextBody;

        Assert.Contains("Aún no hemos recibido tu respuesta", both, StringComparison.Ordinal);
        Assert.Contains("We have not received your response", both, StringComparison.Ordinal);
    }

    [Fact]
    public void The_BODY_names_the_survey_and_says_it_is_a_different_one()
    {
        // The whole point of the message. Three ESPH respondents completed Clima in October and
        // left Teletrabajo untouched for nine days each, certain they had finished -- "la
        // encuesta" to such a reader means the one they already did. The subject names it too,
        // but a subject truncates on a phone, so the body has to carry it.
        // BOTH bodies. Asserting only the text half left the HTML half -- the one almost every
        // reader actually sees -- unverified, and a browser cache nearly sold me the idea that
        // it was missing when it was not. Either could regress without the other.
        var message = Spanish("Teletrabajo ESPH 2026");

        // Asserted on what survives ESCAPING, in both halves. The HTML runs through
        // WebUtility.HtmlEncode, which turns the guillemets into &#171;/&#187; -- so a literal
        // «...» assertion fails on correct output, which is how this test first read as a defect
        // in the email rather than in itself. The survey's NAME is the requirement; the
        // punctuation around it is not.
        foreach (var body in new[] { message.TextBody, message.HtmlBody })
        {
            Assert.Contains("Es la encuesta", body, StringComparison.Ordinal);
            Assert.Contains("Teletrabajo ESPH 2026", body, StringComparison.Ordinal);
            Assert.Contains("esta es distinta", body, StringComparison.Ordinal);
        }

        // The quoting itself, where it is not re-encoded.
        Assert.Contains("«Teletrabajo ESPH 2026»", message.TextBody, StringComparison.Ordinal);
    }

    [Fact]
    public void With_no_survey_name_the_body_says_nothing_about_which_one()
    {
        // `shared` mode opens every survey the holder is targeted by, so naming one would be a
        // lie -- and a half-rendered sentence with an empty gap would be worse than silence.
        var message = Spanish(surveyName: null);

        foreach (var body in new[] { message.TextBody, message.HtmlBody })
        {
            Assert.DoesNotContain("Es la encuesta", body, StringComparison.Ordinal);
            Assert.DoesNotContain("{0}", body, StringComparison.Ordinal);
            Assert.DoesNotContain("«»", body, StringComparison.Ordinal);
        }
    }

    [Fact]
    public void The_subject_names_the_survey_and_the_employer()
    {
        // Ruled 2026-10-19: somebody in Clima and Teletrabajo receives two of these, and the
        // subject is the only thing in an inbox that tells them apart.
        var subject = Spanish("Clima Organizacional ESPH 2026", new EmailBrand(null, "ESPH", null)).Subject;

        Assert.Contains("Clima Organizacional ESPH 2026", subject, StringComparison.Ordinal);
        Assert.Contains("ESPH", subject, StringComparison.Ordinal);
    }

    [Fact]
    public void A_username_is_required_because_the_link_cannot_be_built_without_one()
        => Assert.Throws<ArgumentException>(() => SurveyReminderEmailComposer.Compose(
            "person@example.com", Person, "   ", LoginUrl, "es"));
}
