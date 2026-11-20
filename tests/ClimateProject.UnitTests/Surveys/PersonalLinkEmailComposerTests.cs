using ClimateProject.Application.Email;
using ClimateProject.Application.RespondentContent;
using ClimateProject.Application.Surveys;
using ClimateProject.Domain.Entities;

namespace ClimateProject.UnitTests.Surveys;

/// <summary>
/// The personal-link invitation (ruled 2026-11-18 for PROCOMER), read off the message the
/// composer actually renders: the survey's own subject and body in the company's language, the
/// person's own link as a button AND as plain text, the company's brand, a neutral default when
/// nothing was written -- and no username, no password and no sign-in page anywhere in it.
/// </summary>
public class PersonalLinkEmailComposerTests
{
    private const string Link = "https://climate.example.com/survey-invitations/AbCdEfGhIjKlMnOpQrStUvWxYz0123456789-_abcd";

    // PROCOMER's text, verbatim, as the operator will paste it.
    private const string ProcomerSubject = "Encuesta de Clima Organizacional 2026: ¡Tu participación es importante!";

    private const string ProcomerBody =
        "¡Tu opinión cuenta! Te invitamos a participar en la Encuesta de Clima Organizacional, cuyo objetivo es conocer tu percepción sobre el ambiente de trabajo, la comunicación, el liderazgo, la colaboración y otros aspectos que forman parte de la experiencia laboral en la organización.\n\n"
        + "Tu participación es fundamental para identificar oportunidades de mejora y continuar fortaleciendo un entorno de trabajo positivo para todas las personas. Te agradecemos responder con sinceridad y confianza. La encuesta es anónima y confidencial. Los resultados serán procesados por TIMS International y presentados de forma consolidada para apoyar la toma de decisiones y la mejora continua.";

    private static SurveyPersonalLinkMail Mail(
        string? companyLanguage = "es",
        PersonalLinkText? text = null,
        string? titleEs = "Clima PROCOMER 2026",
        string? titleEn = "PROCOMER Climate 2026")
        => new(
            companyLanguage,
            new EmailBrand("https://climate.example.com/brand/procomer.png", "PROCOMER", "#003b71"),
            titleEs,
            titleEn,
            new DateOnly(2026, 12, 12),
            text ?? new PersonalLinkText(ProcomerSubject, null, ProcomerBody, null));

    private static EmailMessage Compose(SurveyPersonalLinkMail mail) => PersonalLinkEmailComposer.Compose("persona@example.com", Link, mail);

    [Fact]
    public void The_subject_and_body_are_the_surveys_own_words()
    {
        var message = Compose(Mail());

        Assert.Equal(ProcomerSubject, message.Subject);
        Assert.Contains("¡Tu opinión cuenta! Te invitamos a participar", message.TextBody, StringComparison.Ordinal);
        Assert.Contains("Los resultados serán procesados por TIMS International", message.TextBody, StringComparison.Ordinal);

        // Each paragraph the author wrote is its own paragraph in the HTML. Read DECODED: the
        // HTML escapes every accented letter (&#243;), which is what keeps authored text inert.
        var html = System.Net.WebUtility.HtmlDecode(message.HtmlBody);
        Assert.Equal(2, CountOf(html, "line-height:1.55;\">¡Tu opinión", "line-height:1.55;\">Tu participación"));
    }

    /// <summary>
    /// The two placeholders the registry allows an email override are filled with this survey's
    /// title and this company's name -- never mailed as written, the #586 class -- and any other
    /// `{name}` stays exactly as the author typed it.
    /// </summary>
    [Fact]
    public void The_survey_and_company_placeholders_are_filled_and_an_unknown_one_stays_as_written()
    {
        var message = Compose(Mail(text: new PersonalLinkText("Su encuesta de {company}", null, "Le invitamos a «{survey}». {nombre}", null)));

        Assert.Equal("Su encuesta de PROCOMER", message.Subject);
        Assert.Contains("Le invitamos a «Clima PROCOMER 2026». {nombre}", message.TextBody, StringComparison.Ordinal);
        var html = System.Net.WebUtility.HtmlDecode(message.HtmlBody);
        Assert.Contains("Su encuesta de PROCOMER", html, StringComparison.Ordinal);
        Assert.DoesNotContain("{company}", html, StringComparison.Ordinal);
        Assert.DoesNotContain("{survey}", message.TextBody, StringComparison.Ordinal);
    }

    /// <summary>Filled first, escaped after: a company name is inert in the HTML whatever it holds.</summary>
    [Fact]
    public void A_filled_value_is_escaped_like_the_rest_of_the_authors_words()
    {
        var mail = Mail(text: new PersonalLinkText("Encuesta de {company}", null, null, null)) with
        {
            Brand = new EmailBrand("https://climate.example.com/brand/acme.png", "<b>Acme & Co</b>", "#003b71"),
        };

        var message = Compose(mail);

        Assert.Equal("Encuesta de <b>Acme & Co</b>", message.Subject);
        Assert.DoesNotContain("<b>Acme", message.HtmlBody, StringComparison.Ordinal);
        Assert.Contains("Encuesta de <b>Acme & Co</b>", System.Net.WebUtility.HtmlDecode(message.HtmlBody), StringComparison.Ordinal);
    }

    /// <summary>
    /// The chain reaches the mail: per language, the survey's column, else the company's
    /// <c>email.personalLink.*</c>, else the default -- and never the other language's words.
    /// </summary>
    [Fact]
    public void The_words_come_from_the_survey_then_the_company_and_never_from_the_other_language()
    {
        var settings = new SurveySettings { InvitationCustomSubjectEs = "De la encuesta" };
        var sources = new RespondentContentSources(
            [
                new RespondentContentValue(RespondentContentRegistry.EmailPersonalLinkSubject, "es", "De la empresa"),
                new RespondentContentValue(RespondentContentRegistry.EmailPersonalLinkMessage, "es", "Mensaje de la empresa"),
                new RespondentContentValue(RespondentContentRegistry.EmailPersonalLinkSubject, "en", "From the company"),
            ],
            [],
            settings);

        var text = PersonalLinkText.From(sources);

        Assert.Equal(new PersonalLinkText("De la encuesta", "From the company", "Mensaje de la empresa", null), text);
        var survey = new Survey { Type = "periodic", TitleEs = "Clima", Language = "es", EndDate = DateTimeOffset.UtcNow.AddDays(5), Settings = settings };
        Assert.Equal(text, SurveyPersonalLinks.MailFor(survey, company: null, sources).Text);
        Assert.Equal(PersonalLinkText.From(settings), SurveyPersonalLinks.MailFor(survey, company: null).Text);
    }

    [Fact]
    public void The_persons_own_link_is_the_button_and_the_plain_text_fallback()
    {
        var message = Compose(Mail());
        var html = System.Net.WebUtility.HtmlDecode(message.HtmlBody);

        // Three times in the HTML: the button's href, and the fallback anchor's href and text.
        Assert.Equal(3, CountOf(html, Link));
        Assert.Contains($"href=\"{Link}\" style=\"display:inline-block;", html, StringComparison.Ordinal);
        Assert.Contains("Responder la encuesta", html, StringComparison.Ordinal);
        Assert.Contains("Si el botón no funciona, copie este enlace en su navegador:", html, StringComparison.Ordinal);
        Assert.Contains($"Responder la encuesta: {Link}", message.TextBody, StringComparison.Ordinal);
    }

    /// <summary>
    /// The whole point of the mode. Read off every rendered part of the message, in both
    /// languages, so a credentials block pasted in by a later change cannot pass unseen.
    /// </summary>
    [Theory]
    [InlineData("es")]
    [InlineData("en")]
    [InlineData("both")]
    [InlineData(null)]
    public void No_username_no_password_and_no_sign_in_page_anywhere(string? language)
    {
        foreach (var text in new[] { PersonalLinkText.None, new PersonalLinkText(ProcomerSubject, "Climate 2026", ProcomerBody, "Your voice counts.") })
        {
            var message = Compose(Mail(language, text));
            // The HTML decoded, or "Contrase&#241;a" would slip past a search for "Contraseña".
            foreach (var part in new[] { message.Subject, message.TextBody, System.Net.WebUtility.HtmlDecode(message.HtmlBody) })
            {
                foreach (var forbidden in new[] { "Usuario", "usuario", "Contraseña", "contraseña", "Username", "username", "Password", "password", "/login", "Iniciar sesión", "Sign in" })
                {
                    Assert.DoesNotContain(forbidden, part, StringComparison.Ordinal);
                }
            }
        }
    }

    [Fact]
    public void A_spanish_company_gets_spanish_only()
    {
        var message = Compose(Mail("es", new PersonalLinkText(ProcomerSubject, "English subject", ProcomerBody, "English body.")));

        Assert.Equal(ProcomerSubject, message.Subject);
        Assert.DoesNotContain("English", message.TextBody, StringComparison.Ordinal);
        Assert.DoesNotContain("Answer the survey", message.HtmlBody, StringComparison.Ordinal);
        Assert.Contains("<html lang=\"es\">", message.HtmlBody, StringComparison.Ordinal);
        Assert.Contains("Desarrollado por Nexadev", message.TextBody, StringComparison.Ordinal);
    }

    [Fact]
    public void An_english_company_gets_english_only()
    {
        var message = Compose(Mail("en", new PersonalLinkText(ProcomerSubject, "Climate survey 2026", ProcomerBody, "Your voice counts.")));

        Assert.Equal("Climate survey 2026", message.Subject);
        Assert.Contains("Your voice counts.", message.TextBody, StringComparison.Ordinal);
        Assert.Contains("Answer the survey", message.HtmlBody, StringComparison.Ordinal);
        Assert.DoesNotContain("Tu opinión", message.TextBody, StringComparison.Ordinal);
        Assert.Contains("<html lang=\"en\">", message.HtmlBody, StringComparison.Ordinal);
    }

    /// <summary>
    /// `both` (or no company language) is the credentials mail's rule too: both blocks, English
    /// first, and a block with no words of its own gets its own language's default -- never the
    /// other language's text.
    /// </summary>
    [Fact]
    public void A_bilingual_company_gets_both_and_never_borrows_the_other_languages_words()
    {
        var message = Compose(Mail("both", new PersonalLinkText(ProcomerSubject, null, ProcomerBody, null)));

        Assert.Equal($"Invitation to the survey “PROCOMER Climate 2026” — PROCOMER / {ProcomerSubject}", message.Subject);
        var english = message.TextBody.IndexOf("Your organisation invites you", StringComparison.Ordinal);
        var spanish = message.TextBody.IndexOf("¡Tu opinión cuenta!", StringComparison.Ordinal);
        Assert.True(english >= 0 && spanish > english, "English block first, then the Spanish author's words");
        Assert.Equal(1, CountOf(message.TextBody, "¡Tu opinión cuenta!"));
    }

    [Theory]
    [InlineData(null, null)]
    [InlineData("", "   ")]
    public void Empty_custom_text_reads_a_short_neutral_default(string? subject, string? body)
    {
        var spanish = Compose(Mail("es", new PersonalLinkText(subject, subject, body, body)));
        Assert.Equal("Invitación a la encuesta «Clima PROCOMER 2026» — PROCOMER", spanish.Subject);
        Assert.Contains(
            "Su organización le invita a responder la encuesta «Clima PROCOMER 2026». Use el botón de abajo: el enlace es personal y le lleva directamente a la encuesta. La encuesta cierra el 12 de diciembre de 2026. Gracias por participar.",
            spanish.TextBody,
            StringComparison.Ordinal);

        var english = Compose(Mail("en", new PersonalLinkText(subject, subject, body, body)));
        Assert.Equal("Invitation to the survey “PROCOMER Climate 2026” — PROCOMER", english.Subject);
        Assert.Contains("The survey closes on December 12, 2026.", english.TextBody, StringComparison.Ordinal);
    }

    [Fact]
    public void A_survey_with_no_title_still_reads_as_a_sentence()
    {
        var message = Compose(Mail("es", PersonalLinkText.None, titleEs: null, titleEn: null));

        Assert.Equal("Invitación a responder una encuesta", message.Subject);
        Assert.Contains("Su organización le invita a responder una encuesta.", message.TextBody, StringComparison.Ordinal);
        Assert.DoesNotContain("«»", message.TextBody, StringComparison.Ordinal);
    }

    /// <summary>
    /// The note under the button names the survey and its close even when the author's message
    /// does neither -- PROCOMER's does not -- and says the link is personal.
    /// </summary>
    [Fact]
    public void The_note_names_the_survey_its_close_and_that_the_link_is_personal()
    {
        var message = Compose(Mail());

        Assert.Contains(
            "Este enlace es solo para usted: abre su propia encuesta, así que no lo reenvíe. La encuesta «Clima PROCOMER 2026» cierra el 12 de diciembre de 2026.",
            message.TextBody,
            StringComparison.Ordinal);
    }

    [Fact]
    public void The_company_logo_and_accent_brand_the_message()
    {
        var message = Compose(Mail());

        Assert.Contains("src=\"https://climate.example.com/brand/procomer.png\" alt=\"PROCOMER\"", message.HtmlBody, StringComparison.Ordinal);
        Assert.Contains("background:#003b71", message.HtmlBody, StringComparison.Ordinal);
        Assert.Null(message.ToName);
    }

    [Fact]
    public void Authored_markup_is_escaped_and_a_multi_line_subject_is_one_header_line()
    {
        var message = Compose(Mail("es", new PersonalLinkText("Línea uno\nBcc: intruso@example.com", null, "<a href=\"https://evil.example\">clic</a>", null)));

        Assert.DoesNotContain('\n', message.Subject);
        Assert.DoesNotContain("<a href=\"https://evil.example\">", message.HtmlBody, StringComparison.Ordinal);
        Assert.Contains("&lt;a href=", message.HtmlBody, StringComparison.Ordinal);
    }

    [Fact]
    public void The_mail_is_built_from_the_surveys_settings()
    {
        var survey = new Survey
        {
            Id = Guid.NewGuid(),
            TitleEs = "Clima",
            Type = "periodic",
            Language = "es",
            EndDate = new DateTimeOffset(2026, 12, 13, 5, 59, 0, TimeSpan.Zero),
            Settings = new SurveySettings
            {
                CredentialMode = CredentialModes.PersonalLink,
                InvitationCustomSubjectEs = ProcomerSubject,
                InvitationCustomMessageEs = ProcomerBody,
            },
        };

        var mail = SurveyPersonalLinks.MailFor(
            survey, new SurveyCredentialCompany("PROCOMER", "es", "/brand/procomer.png", "#003b71", "America/Costa_Rica"));

        Assert.Equal(ProcomerSubject, mail.Text.SubjectEs);
        Assert.Equal(ProcomerBody, mail.Text.MessageEs);
        Assert.Equal("Clima", mail.SurveyTitleEs);
        // 05:59 UTC on the 13th is 23:59 on the 12th in Costa Rica: the company's day, not UTC's.
        Assert.Equal(new DateOnly(2026, 12, 12), mail.SurveyClosesOn);
        Assert.Equal("PROCOMER", mail.Brand.CompanyName);
    }

    private static int CountOf(string haystack, params string[] needles)
        => needles.Sum(needle =>
        {
            var count = 0;
            for (var at = haystack.IndexOf(needle, StringComparison.Ordinal); at >= 0; at = haystack.IndexOf(needle, at + needle.Length, StringComparison.Ordinal))
            {
                count++;
            }

            return count;
        });
}
