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

    [Fact]
    public void An_unknown_purpose_throws_rather_than_sending_an_invitation()
    {
        // A new purpose added without copy must fail loudly. Falling back to the invitation is
        // how the wrong message shipped in the first place.
        Assert.Throws<ArgumentOutOfRangeException>(() => CredentialsEmailComposer.Compose(
            "person@example.com", Person, Username, Password, LoginUrl, "es", (CredentialsEmailPurpose)99));
    }
}
