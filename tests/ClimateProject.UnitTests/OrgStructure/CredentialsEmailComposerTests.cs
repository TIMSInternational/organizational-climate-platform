using ClimateProject.Application.Email;
using ClimateProject.Application.OrgStructure;

namespace ClimateProject.UnitTests.OrgStructure;

/// <summary>
/// The mass-invite credentials email, in both of its purposes.
///
/// <para>
/// Nothing pinned this copy before. The bulk resend behind the *Quién ya respondió* roster
/// re-sent the INVITATION message -- *"Tu organización te invita a responder una encuesta"* --
/// to people who had already been invited and had already read exactly that sentence, while
/// the client had asked for *"un correo solicitándoles que por favor ingresen y lo hagan"*.
/// Every .NET and web test passed throughout, because the two messages carry an identical
/// username and password and differ only in their words.
/// </para>
/// </summary>
public class CredentialsEmailComposerTests
{
    private const string LoginUrl = "https://app.example.com/login";
    private const string Username = "esph-k7m2q9xa";
    private const string Password = "Qp7-Rm2-Tx9";
    private const string Person = "María José Rodríguez Vargas";

    private static string SpanishText(CredentialsEmailPurpose purpose) =>
        CredentialsEmailComposer.Compose("person@example.com", Person, Username, Password, LoginUrl, "es", purpose).TextBody;

    /// <summary>
    /// The same message for a company that speaks English. It exists because each copy
    /// assertion below used to read both languages out of ONE message, and a message now
    /// carries one -- so the English half of every such assertion has to come from here or it
    /// would be asserting the behaviour this change removed.
    /// </summary>
    private static string EnglishText(CredentialsEmailPurpose purpose) =>
        CredentialsEmailComposer.Compose("person@example.com", Person, Username, Password, LoginUrl, "en", purpose).TextBody;

    [Fact]
    public void The_reminder_asks_the_person_to_go_in_and_answer()
    {
        // The client's own sentence is the acceptance criterion: a reminder asks them to enter
        // and do it. The invitation cannot ask that -- its reader has never heard of the account.
        var reminder = SpanishText(CredentialsEmailPurpose.Reminder);

        Assert.Contains("por favor ingreses y respondas la encuesta", reminder, StringComparison.Ordinal);
        Assert.Contains("Please sign in and answer the survey", EnglishText(CredentialsEmailPurpose.Reminder), StringComparison.Ordinal);
        Assert.DoesNotContain("Please sign in and answer the survey", reminder, StringComparison.Ordinal);
    }

    [Fact]
    public void The_reminder_is_not_the_invitation()
    {
        // The defect, stated as an assertion: these two were the same message.
        var reminder = SpanishText(CredentialsEmailPurpose.Reminder);
        var invitation = SpanishText(CredentialsEmailPurpose.Invitation);

        Assert.DoesNotContain("te invita a responder una encuesta", reminder, StringComparison.Ordinal);
        Assert.Contains("te invita a responder una encuesta", invitation, StringComparison.Ordinal);
        Assert.DoesNotContain("por favor ingreses", invitation, StringComparison.Ordinal);
    }

    [Fact]
    public void The_reminder_carries_the_username_and_the_password_again()
    {
        // "En ese correo tienen que volver a recibir su usuario y contraseña otra vez."
        var message = CredentialsEmailComposer.Compose(
            "person@example.com", Person, Username, Password, LoginUrl, "es", CredentialsEmailPurpose.Reminder);

        Assert.Contains(Username, message.TextBody, StringComparison.Ordinal);
        Assert.Contains(Password, message.TextBody, StringComparison.Ordinal);
        Assert.Contains(Username, message.HtmlBody, StringComparison.Ordinal);
        Assert.Contains(Password, message.HtmlBody, StringComparison.Ordinal);
        Assert.Contains(LoginUrl, message.TextBody, StringComparison.Ordinal);
    }

    [Fact]
    public void The_reminder_says_the_password_below_replaces_the_one_they_hold()
    {
        // ResendManyAsync regenerates the password for everyone it mails, so somebody halfway
        // through is signed out by the very message chasing them. Saying so is the difference
        // between a reminder and a lock-out they cannot explain.
        var reminder = SpanishText(CredentialsEmailPurpose.Reminder);

        Assert.Contains("la anterior deja de funcionar", reminder, StringComparison.Ordinal);
        Assert.Contains("previous password stops working", EnglishText(CredentialsEmailPurpose.Reminder), StringComparison.Ordinal);
        Assert.DoesNotContain("previous password stops working", reminder, StringComparison.Ordinal);
    }

    [Fact]
    public void The_reminder_tells_them_a_half_finished_survey_is_still_there()
    {
        // Resume is real -- SurveyResponseEndpoints keeps it for a signed-in respondent -- and a
        // person who abandoned the survey has no way to know that unless the mail says it.
        var reminder = SpanishText(CredentialsEmailPurpose.Reminder);

        Assert.Contains("puedes continuar donde la dejaste", reminder, StringComparison.Ordinal);
        Assert.Contains("carry on where you left off", EnglishText(CredentialsEmailPurpose.Reminder), StringComparison.Ordinal);
        Assert.DoesNotContain("carry on where you left off", reminder, StringComparison.Ordinal);
    }

    [Theory]
    [InlineData(CredentialsEmailPurpose.Invitation)]
    [InlineData(CredentialsEmailPurpose.Reminder)]
    public void A_company_with_one_language_is_written_to_in_that_language_alone(CredentialsEmailPurpose purpose)
    {
        // This REPLACED `Both_purposes_send_both_languages_with_the_company_first`, which
        // asserted the behaviour ESPH's rehearsal returned as its first finding: every account
        // got one username and one password printed twice, under two headings, with two
        // buttons. The reviewer's own questions are the acceptance criteria -- "Ingreso con los
        // accesos de arriba o los de abajo?" cannot be asked of a message with one of each.
        var spanishCompany = CredentialsEmailComposer.Compose(
            "person@example.com", Person, Username, Password, LoginUrl, "es", purpose);
        var englishCompany = CredentialsEmailComposer.Compose(
            "person@example.com", Person, Username, Password, LoginUrl, "en", purpose);

        Assert.Contains("Usuario", spanishCompany.TextBody, StringComparison.Ordinal);
        Assert.DoesNotContain("Username", spanishCompany.TextBody, StringComparison.Ordinal);
        Assert.DoesNotContain("Username", spanishCompany.HtmlBody, StringComparison.Ordinal);
        Assert.DoesNotContain("Sign in", spanishCompany.HtmlBody, StringComparison.Ordinal);

        Assert.Contains("Username", englishCompany.TextBody, StringComparison.Ordinal);
        Assert.DoesNotContain("Usuario", englishCompany.TextBody, StringComparison.Ordinal);
        Assert.DoesNotContain("Usuario", englishCompany.HtmlBody, StringComparison.Ordinal);
        Assert.DoesNotContain("Iniciar", englishCompany.HtmlBody, StringComparison.Ordinal);
    }

    [Theory]
    [InlineData(CredentialsEmailPurpose.Invitation)]
    [InlineData(CredentialsEmailPurpose.Reminder)]
    public void The_credentials_and_the_button_appear_exactly_once(CredentialsEmailPurpose purpose)
    {
        // The literal complaint: "los accesos y link de ingreso venga doble". Counting is the
        // only form of it a future edit has to get past -- every assertion above would still
        // pass if a second Spanish block were appended, because `Contains` cannot see a
        // duplicate. The login URL is counted in the TEXT body alone: the HTML carries it twice
        // per block by construction (href and visible label), which is a property of
        // `EmailBranding.Button` and not of this composer.
        var message = CredentialsEmailComposer.Compose(
            "person@example.com", Person, Username, Password, LoginUrl, "es", purpose);

        // The PASSWORD is the clean counter now: it appears once per language block and
        // nowhere else, so a second block still doubles it. The username deliberately appears
        // twice per block -- as the credential and again on the sign-in link -- so counting it
        // at 1 would now fail for the right reason and hide the duplication it was watching.
        Assert.Equal(1, Occurrences(message.TextBody, Password));
        Assert.Equal(1, Occurrences(message.HtmlBody, Password));
        Assert.Equal(2, Occurrences(message.TextBody, Username));
        Assert.Equal(1, Occurrences(message.TextBody, LoginUrl));
        // "Iniciar sesi" rather than the whole label: `EmailBranding.Escape` is
        // `WebUtility.HtmlEncode`, which turns the accented o into a numeric entity, so the
        // literal does not survive into the HTML. The prefix is still unique to the button.
        Assert.Equal(1, Occurrences(message.HtmlBody, "Iniciar sesi"));
    }

    [Theory]
    [InlineData(null)]
    [InlineData("both")]
    [InlineData("klingon")]
    public void A_company_that_has_named_no_single_language_still_gets_both(string? language)
    {
        // The original reasoning survives exactly where it still applies: nothing has said
        // which language this reader wants, so a message they cannot read is the worse risk.
        // "both" and an unrecognised value land here together on purpose -- `SingleLocaleOf`
        // refuses to guess, and guessing is what would send a Spanish-only mail to a reader
        // the platform knows nothing about.
        var message = CredentialsEmailComposer.Compose(
            "person@example.com", Person, Username, Password, LoginUrl, language,
            CredentialsEmailPurpose.Invitation);

        Assert.Contains("Username", message.TextBody, StringComparison.Ordinal);
        Assert.Contains("Usuario", message.TextBody, StringComparison.Ordinal);
        Assert.True(
            message.TextBody.IndexOf("Username", StringComparison.Ordinal)
                < message.TextBody.IndexOf("Usuario", StringComparison.Ordinal),
            "With no company language to lead with, English comes first, as it did before.");
    }

    private static int Occurrences(string haystack, string needle)
    {
        var count = 0;
        for (var i = haystack.IndexOf(needle, StringComparison.Ordinal); i >= 0;
             i = haystack.IndexOf(needle, i + needle.Length, StringComparison.Ordinal))
        {
            count++;
        }

        return count;
    }

    [Fact]
    public void The_two_purposes_do_not_share_a_subject()
    {
        // The reminder lands in an inbox that already holds the invitation. An identical subject
        // line reads as the same mail resent and is the one a person skips.
        var reminder = CredentialsEmailComposer.Compose(
            "person@example.com", Person, Username, Password, LoginUrl, "es", CredentialsEmailPurpose.Reminder).Subject;
        var invitation = CredentialsEmailComposer.Compose(
            "person@example.com", Person, Username, Password, LoginUrl, "es", CredentialsEmailPurpose.Invitation).Subject;

        Assert.NotEqual(invitation, reminder);
        Assert.Contains("Recordatorio", reminder, StringComparison.Ordinal);

        // And the subject is in ONE language too. It used to read
        // "Tu acceso a ... / Your access to ...", which is the first thing the recipient saw
        // and the first place the duplication showed -- see the screenshot in the 2026-10-17
        // rehearsal review. The English subject still exists, for an English company.
        Assert.DoesNotContain("Reminder", reminder, StringComparison.Ordinal);
        Assert.DoesNotContain("/", reminder, StringComparison.Ordinal);
        Assert.Contains("Reminder", CredentialsEmailComposer.Compose(
            "person@example.com", Person, Username, Password, LoginUrl, "en",
            CredentialsEmailPurpose.Reminder).Subject, StringComparison.Ordinal);
    }

    [Theory]
    [InlineData(CredentialsEmailPurpose.Invitation)]
    [InlineData(CredentialsEmailPurpose.Reminder)]
    public void No_part_of_the_message_carries_the_recipients_name(CredentialsEmailPurpose purpose)
    {
        // Ruled 2026-10-16 by Federico: no name reaches the respondent. This replaced three
        // tests that asserted the opposite -- the greeting in both languages, the name
        // rendered whole rather than split, and the `To:` display name.
        //
        // The reason it reversed is the copy that shipped the day before (§6 of
        // `docs/decisions/who-may-see-an-individual-answer.md`): all 640 ESPH respondents are
        // now told their company will never see their name beside their answers, and this is
        // the first mail the platform sends them.
        //
        // EVERY rendered field is read, not just the body. The name reached the envelope
        // through `ToName`, which no assertion over `TextBody` or `HtmlBody` would catch --
        // and an envelope is the field a recipient sees before opening anything.
        var message = CredentialsEmailComposer.Compose(
            "person@example.com", Person, Username, Password, LoginUrl, "es", purpose);

        Assert.DoesNotContain(Person, message.TextBody, StringComparison.Ordinal);
        Assert.DoesNotContain(Person, message.HtmlBody, StringComparison.Ordinal);
        Assert.DoesNotContain(EmailBranding.Escape(Person), message.HtmlBody, StringComparison.Ordinal);
        Assert.DoesNotContain(Person, message.Subject, StringComparison.Ordinal);
        Assert.Null(message.ToName);

        // Nor one token of it. The greeting rendered the name whole, so a half-measure that
        // took a first name would pass an assertion on the whole string and still leak.
        foreach (var token in Person.Split(' '))
        {
            Assert.DoesNotContain(token, message.TextBody, StringComparison.Ordinal);
            Assert.DoesNotContain(token, message.HtmlBody, StringComparison.Ordinal);
        }

        // And it still carries the three things it exists to carry.
        Assert.Contains(Username, message.TextBody, StringComparison.Ordinal);
        Assert.Contains(Password, message.TextBody, StringComparison.Ordinal);
        Assert.Contains(LoginUrl, message.TextBody, StringComparison.Ordinal);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    public void A_nameless_account_gets_byte_identical_mail_to_a_named_one(string? missing)
    {
        // The nameless row used to be the one branch that rendered no greeting, which is why
        // it had a test of its own. There is no longer a branch: this asserts that, rather
        // than asserting the absence of a greeting twice over.
        var nameless = CredentialsEmailComposer.Compose(
            "person@example.com", missing, Username, Password, LoginUrl, "es",
            CredentialsEmailPurpose.Invitation);
        var named = CredentialsEmailComposer.Compose(
            "person@example.com", Person, Username, Password, LoginUrl, "es",
            CredentialsEmailPurpose.Invitation);

        Assert.Equal(named.TextBody, nameless.TextBody);
        Assert.Equal(named.HtmlBody, nameless.HtmlBody);
        Assert.Equal(named.Subject, nameless.Subject);
        Assert.Null(nameless.ToName);

        // And it still carries what it exists to carry.
        Assert.Contains(Username, nameless.TextBody, StringComparison.Ordinal);
        Assert.Contains(Password, nameless.TextBody, StringComparison.Ordinal);
    }

    [Fact]
    public void The_invitation_thanks_them_for_taking_part()
    {
        var text = SpanishText(CredentialsEmailPurpose.Invitation);

        Assert.Contains("Gracias por participar.", text, StringComparison.Ordinal);
        Assert.Contains("Thank you for taking part.", EnglishText(CredentialsEmailPurpose.Invitation), StringComparison.Ordinal);
        Assert.DoesNotContain("Thank you for taking part.", text, StringComparison.Ordinal);
    }

    [Theory]
    [InlineData(CredentialsEmailPurpose.Invitation)]
    [InlineData(CredentialsEmailPurpose.Reminder)]
    public void The_sign_in_link_carries_the_username_so_nobody_retypes_it(CredentialsEmailPurpose purpose)
    {
        // ESPH, 2026-10-18: "La encuesta no pude abrirla desde el celular, use los accesos
        // enviados." The screenshot beside that sentence shows `esphensa-k85j9ujv` typed into
        // the field against `esphensa-k85j9uyv` in the mail -- `y` read as `j`, which is what a
        // nine-character random suffix retyped by eye on a phone costs.
        var message = CredentialsEmailComposer.Compose(
            "person@example.com", Person, Username, Password, LoginUrl, "es", purpose);

        Assert.Contains($"{LoginUrl}?u={Username}", message.TextBody, StringComparison.Ordinal);
        Assert.Contains($"{LoginUrl}?u={Username}", message.HtmlBody, StringComparison.Ordinal);
    }

    [Fact]
    public void The_password_is_never_put_on_the_link()
    {
        // A query string outlives the message: browser history, the `Referer` header, and every
        // proxy and access log between the phone and the API. The username is printed in this
        // same mail in plain text and signs nobody in on its own; the password is the secret.
        var message = CredentialsEmailComposer.Compose(
            "person@example.com", Person, Username, Password, LoginUrl, "es", CredentialsEmailPurpose.Invitation);

        foreach (var line in message.TextBody.Split('\n'))
        {
            if (line.Contains(LoginUrl, StringComparison.Ordinal))
            {
                Assert.DoesNotContain(Password, line, StringComparison.Ordinal);
            }
        }

        Assert.DoesNotContain($"u={Password}", message.HtmlBody, StringComparison.Ordinal);
    }

    [Fact]
    public void A_login_url_that_already_has_a_query_or_a_fragment_is_still_a_valid_link()
    {
        // `?` twice is not a query, and `#x?u=` is not a query at all -- it is part of the
        // fragment, which never reaches the server.
        var withQuery = CredentialsEmailComposer.Compose(
            "person@example.com", Person, Username, Password, "https://app.example.com/login?lang=es", "es",
            CredentialsEmailPurpose.Invitation);
        Assert.Contains($"https://app.example.com/login?lang=es&u={Username}", withQuery.TextBody, StringComparison.Ordinal);

        var withFragment = CredentialsEmailComposer.Compose(
            "person@example.com", Person, Username, Password, "https://app.example.com/login#top", "es",
            CredentialsEmailPurpose.Invitation);
        Assert.Contains($"https://app.example.com/login?u={Username}#top", withFragment.TextBody, StringComparison.Ordinal);
    }

    // -----------------------------------------------------------------------------------
    // Which survey these details open, and when it closes (audit 2026-10-22, R3). The subject
    // has said which since #607; the message itself did not, and a person holding two of
    // these reads the message.
    // -----------------------------------------------------------------------------------

    private const string Clima = "Clima Organizacional ESPH 2026";
    private const string Teletrabajo = "Teletrabajo ESPH 2026";
    private static readonly DateOnly ClosesOn = new(2026, 10, 27);

    private static EmailMessage ForSurvey(
        string? survey, string language = "es", string company = "ESPH",
        CredentialsEmailPurpose purpose = CredentialsEmailPurpose.Invitation, DateOnly? closesOn = null) =>
        CredentialsEmailComposer.Compose(
            "person@example.com", Person, Username, Password, LoginUrl, language,
            purpose, new EmailBrand(null, company, null), survey, closesOn ?? ClosesOn);

    /// <summary>
    /// The heading is the line the inbox showed, not the product name. Measured 2026-10-20 on
    /// the mail the product actually composed: the subject read "Tu acceso a Clima
    /// Organizacional … — …" while the message opened "Tu acceso a OCC — Organizational
    /// Climate Check", so the two messages one person receives were identical once opened.
    /// </summary>
    [Fact]
    public void The_message_opens_with_the_survey_it_belongs_to_and_not_the_product_name()
    {
        var mail = ForSurvey(Teletrabajo);

        Assert.Contains($"Tu acceso a {Teletrabajo} \u2014 ESPH", mail.Subject, StringComparison.Ordinal);
        Assert.Contains($"Tu acceso a {Teletrabajo} \u2014 ESPH</h1>", mail.HtmlBody, StringComparison.Ordinal);
        Assert.StartsWith($"Tu acceso a {Teletrabajo} \u2014 ESPH", mail.TextBody, StringComparison.Ordinal);
        Assert.DoesNotContain($"Tu acceso a {EmailBranding.ProductName}", mail.TextBody, StringComparison.Ordinal);
    }

    /// <summary>
    /// The body names the survey and the day it closes, in the sentence the respondent screens
    /// print a date in ("27 de octubre de 2026"), and says the details open this survey only.
    /// </summary>
    [Fact]
    public void The_body_names_the_survey_and_the_day_it_closes()
    {
        var text = ForSurvey(Clima).TextBody;

        Assert.Contains(
            $"Tu organización te invita a responder la encuesta «{Clima}». Inicia sesión con el usuario y la contraseña de abajo; tus datos organizacionales ya están en tu cuenta. La encuesta cierra el 27 de octubre de 2026. Gracias por participar.",
            text, StringComparison.Ordinal);
        Assert.Contains("abren solo esta encuesta", text, StringComparison.Ordinal);
        // The generic sentence is replaced, not joined -- two of them would read as a mistake.
        Assert.DoesNotContain("responder una encuesta.", text, StringComparison.Ordinal);
    }

    /// <summary>
    /// Two surveys, one person: the whole requirement. The messages differ in the heading and
    /// in the body, not only in the code -- which is what "once opened" means.
    /// </summary>
    [Fact]
    public void Two_messages_to_one_person_differ_inside_and_not_only_in_the_code()
    {
        var clima = ForSurvey(Clima).TextBody;
        var teletrabajo = ForSurvey(Teletrabajo).TextBody;

        // The subject line is the first line of the text part; strip it, so what is compared
        // is what a person reads once the message is OPEN.
        static string Inside(string text) => text[(text.IndexOf("\n\n", StringComparison.Ordinal) + 2)..];

        Assert.Contains(Clima, Inside(clima), StringComparison.Ordinal);
        Assert.DoesNotContain(Teletrabajo, Inside(clima), StringComparison.Ordinal);
        Assert.Contains(Teletrabajo, Inside(teletrabajo), StringComparison.Ordinal);
        // "Teletrabajo ESPH 2026" does not contain "Clima Organizacional ESPH 2026", so this
        // is a real exclusion rather than one substring failing to be another.
        Assert.DoesNotContain(Clima, Inside(teletrabajo), StringComparison.Ordinal);
    }

    /// <summary>
    /// The placeholder guard, every copy: a reword that dropped <c>{0}</c> or <c>{1}</c> would
    /// render a message that never names its survey or its close, and every Spanish-only
    /// assertion above would still pass.
    /// </summary>
    [Theory]
    [InlineData(CredentialsEmailPurpose.Invitation, "es", "La encuesta cierra el 27 de octubre de 2026.")]
    [InlineData(CredentialsEmailPurpose.Invitation, "en", "The survey closes on October 27, 2026.")]
    [InlineData(CredentialsEmailPurpose.Reminder, "es", "La encuesta cierra el 27 de octubre de 2026.")]
    [InlineData(CredentialsEmailPurpose.Reminder, "en", "The survey closes on October 27, 2026.")]
    public void Every_copy_names_the_survey_and_its_close(CredentialsEmailPurpose purpose, string language, string closes)
    {
        var mail = ForSurvey(Clima, language, purpose: purpose);

        Assert.Contains(Clima, mail.TextBody, StringComparison.Ordinal);
        Assert.Contains(Clima, mail.HtmlBody, StringComparison.Ordinal);
        Assert.Contains(closes, mail.TextBody, StringComparison.Ordinal);
        Assert.Contains(EmailBranding.Escape(closes), mail.HtmlBody, StringComparison.Ordinal);
        Assert.DoesNotContain("{0}", mail.TextBody, StringComparison.Ordinal);
        Assert.DoesNotContain("{1}", mail.TextBody, StringComparison.Ordinal);
        Assert.DoesNotContain("  ", mail.TextBody, StringComparison.Ordinal);
    }

    /// <summary>
    /// The months are spelled by the composer, not a culture -- so the ends of the table are
    /// the places an off-by-one would show.
    /// </summary>
    [Theory]
    [InlineData(2027, 1, 1, "es", "La encuesta cierra el 1 de enero de 2027.")]
    [InlineData(2026, 12, 31, "es", "La encuesta cierra el 31 de diciembre de 2026.")]
    [InlineData(2027, 1, 1, "en", "The survey closes on January 1, 2027.")]
    [InlineData(2026, 12, 31, "en", "The survey closes on December 31, 2026.")]
    public void The_close_is_printed_as_the_screens_print_a_day(int year, int month, int day, string language, string expected)
    {
        var mail = ForSurvey(Clima, language, closesOn: new DateOnly(year, month, day));

        Assert.Contains(expected, mail.TextBody, StringComparison.Ordinal);
    }

    /// <summary>
    /// A per-survey message with no close known still reads as a sentence: no closing
    /// clause, no doubled space where it would have gone.
    /// </summary>
    [Fact]
    public void A_survey_with_no_close_known_omits_the_sentence_and_nothing_else()
    {
        var mail = CredentialsEmailComposer.Compose(
            "person@example.com", Person, Username, Password, LoginUrl, "es",
            CredentialsEmailPurpose.Invitation, new EmailBrand(null, "ESPH", null), Clima, surveyClosesOn: null);

        Assert.Contains(
            $"tus datos organizacionales ya están en tu cuenta. Gracias por participar.", mail.TextBody, StringComparison.Ordinal);
        Assert.DoesNotContain("cierra", mail.TextBody, StringComparison.Ordinal);
    }

    /// <summary>
    /// R4: a per-survey key is not an account, and the only route that replaces one -- the
    /// reissue (#620) -- refuses a key that has already signed in. So the line under the button
    /// says it opens this survey only and promises a replacement only before the first
    /// sign-in, in both languages.
    /// </summary>
    [Theory]
    [InlineData("es", "Guarda este mensaje: este usuario y esta contraseña abren solo esta encuesta. Si los pierdes antes de ingresar por primera vez, pide a tu administrador que te envíe unos nuevos.", "son tus datos de acceso")]
    [InlineData("en", "Keep this message: this username and password open this survey only. If you lose them before you first sign in, ask your administrator to send new ones.", "these are your sign-in details")]
    public void A_per_survey_key_promises_a_replacement_only_before_it_is_used(string language, string keep, string accountWording)
    {
        foreach (var purpose in new[] { CredentialsEmailPurpose.Invitation, CredentialsEmailPurpose.Reminder })
        {
            var mail = ForSurvey(Clima, language, purpose: purpose);

            Assert.Contains(keep, mail.TextBody, StringComparison.Ordinal);
            Assert.Contains(EmailBranding.Escape(keep), mail.HtmlBody, StringComparison.Ordinal);
            Assert.DoesNotContain(accountWording, mail.TextBody, StringComparison.Ordinal);
        }
    }

    /// <summary>
    /// `shared` mode did not move. These details really do open every survey their holder is
    /// targeted by, and an administrator really can send new ones at any time
    /// (<c>POST /admin/users/{id}/credentials</c>), so the generic copy is the true one --
    /// word for word what it was, in both languages, even if a close day is handed in.
    /// </summary>
    [Theory]
    [InlineData(CredentialsEmailPurpose.Invitation, "es", "Tu organización te invita a responder una encuesta. Inicia sesión con el usuario y la contraseña de abajo; tus datos organizacionales ya están en tu cuenta. Gracias por participar.", "Guarda este mensaje: son tus datos de acceso. Si los pierdes, pide a tu administrador que te envíe unos nuevos.")]
    [InlineData(CredentialsEmailPurpose.Invitation, "en", "Your organisation has invited you to answer a survey. Sign in with the username and password below; your organisational details are already on your account. Thank you for taking part.", "Keep this message: these are your sign-in details. If you lose them, ask your administrator to send new ones.")]
    [InlineData(CredentialsEmailPurpose.Reminder, "es", "Te pedimos que por favor ingreses y respondas la encuesta. Abajo están de nuevo tu usuario y una contraseña nueva: la anterior deja de funcionar, así que entra con estos datos. Si ya la habías empezado, puedes continuar donde la dejaste.", "Guarda este mensaje: son tus datos de acceso. Si los pierdes, pide a tu administrador que te envíe unos nuevos.")]
    [InlineData(CredentialsEmailPurpose.Reminder, "en", "Please sign in and answer the survey. Your username and a new password are below; the previous password stops working, so sign in with these details. If you had already started, you can carry on where you left off.", "Keep this message: these are your sign-in details. If you lose them, ask your administrator to send new ones.")]
    public void A_message_that_opens_everything_still_says_so(
        CredentialsEmailPurpose purpose, string language, string body, string keep)
    {
        var mail = CredentialsEmailComposer.Compose(
            "person@example.com", Person, Username, Password, LoginUrl, language, purpose,
            new EmailBrand(null, "ESPH", null), surveyName: null, surveyClosesOn: ClosesOn);

        Assert.Contains(EmailBranding.ProductName, mail.Subject, StringComparison.Ordinal);
        Assert.Contains(body, mail.TextBody, StringComparison.Ordinal);
        Assert.Contains(keep, mail.TextBody, StringComparison.Ordinal);
        Assert.DoesNotContain("2026", mail.TextBody, StringComparison.Ordinal);
        Assert.DoesNotContain("ESPH 2026", mail.Subject, StringComparison.Ordinal);
    }

    /// <summary>A survey's name is authored text: it is escaped in the HTML, like every other.</summary>
    [Fact]
    public void A_survey_name_is_escaped_in_the_html()
    {
        var mail = ForSurvey("Clima <b>&</b> 2026");

        Assert.DoesNotContain("<b>&</b>", mail.HtmlBody, StringComparison.Ordinal);
        Assert.Contains(EmailBranding.Escape("Clima <b>&</b> 2026"), mail.HtmlBody, StringComparison.Ordinal);
    }

    [Fact]
    public void An_unknown_purpose_throws_rather_than_sending_an_invitation()
    {
        // A new purpose added without copy must fail loudly. Falling back to the invitation is
        // how the wrong message shipped in the first place.
        Assert.Throws<ArgumentOutOfRangeException>(() => CredentialsEmailComposer.Compose(
            "person@example.com", Person, Username, Password, LoginUrl, "es", (CredentialsEmailPurpose)99));
    }
}
