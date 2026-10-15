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

    [Fact]
    public void The_reminder_asks_the_person_to_go_in_and_answer()
    {
        // The client's own sentence is the acceptance criterion: a reminder asks them to enter
        // and do it. The invitation cannot ask that -- its reader has never heard of the account.
        var reminder = SpanishText(CredentialsEmailPurpose.Reminder);

        Assert.Contains("por favor ingreses y respondas la encuesta", reminder, StringComparison.Ordinal);
        Assert.Contains("Please sign in and answer the survey", reminder, StringComparison.Ordinal);
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
        Assert.Contains("previous password stops working", reminder, StringComparison.Ordinal);
    }

    [Fact]
    public void The_reminder_tells_them_a_half_finished_survey_is_still_there()
    {
        // Resume is real -- SurveyResponseEndpoints keeps it for a signed-in respondent -- and a
        // person who abandoned the survey has no way to know that unless the mail says it.
        var reminder = SpanishText(CredentialsEmailPurpose.Reminder);

        Assert.Contains("puedes continuar donde la dejaste", reminder, StringComparison.Ordinal);
        Assert.Contains("carry on where you left off", reminder, StringComparison.Ordinal);
    }

    [Theory]
    [InlineData(CredentialsEmailPurpose.Invitation)]
    [InlineData(CredentialsEmailPurpose.Reminder)]
    public void Both_purposes_send_both_languages_with_the_company_first(CredentialsEmailPurpose purpose)
    {
        // The account was created from a spreadsheet row a moment ago and its holder has chosen
        // no language, so both go in one message and the company's own language leads.
        var spanishCompany = CredentialsEmailComposer.Compose(
            "person@example.com", Person, Username, Password, LoginUrl, "es", purpose);
        var englishCompany = CredentialsEmailComposer.Compose(
            "person@example.com", Person, Username, Password, LoginUrl, "en", purpose);

        Assert.Contains("Usuario", spanishCompany.TextBody, StringComparison.Ordinal);
        Assert.Contains("Username", spanishCompany.TextBody, StringComparison.Ordinal);
        Assert.True(
            spanishCompany.TextBody.IndexOf("Usuario", StringComparison.Ordinal)
                < spanishCompany.TextBody.IndexOf("Username", StringComparison.Ordinal),
            "A company set to Spanish must read Spanish before English.");
        Assert.True(
            englishCompany.TextBody.IndexOf("Username", StringComparison.Ordinal)
                < englishCompany.TextBody.IndexOf("Usuario", StringComparison.Ordinal),
            "A company set to English must read English before Spanish.");
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
        Assert.Contains("Reminder", reminder, StringComparison.Ordinal);
    }

    [Theory]
    [InlineData(CredentialsEmailPurpose.Invitation)]
    [InlineData(CredentialsEmailPurpose.Reminder)]
    public void Both_purposes_greet_the_person_by_name_in_both_languages(CredentialsEmailPurpose purpose)
    {
        // "Ese correo de invitación es un correo personalizado: Muy buenas tardes, gracias por
        // participar." The name is the one already on the account; nothing is asked for it.
        var message = CredentialsEmailComposer.Compose(
            "person@example.com", Person, Username, Password, LoginUrl, "es", purpose);

        Assert.Contains($"Hola, {Person}:", message.TextBody, StringComparison.Ordinal);
        Assert.Contains($"Hello {Person},", message.TextBody, StringComparison.Ordinal);
        // ESCAPED in the HTML, which is both how an accent survives the transport and why a
        // name carrying "<" cannot inject markup into the message.
        Assert.Contains(EmailBranding.Escape($"Hola, {Person}:"), message.HtmlBody, StringComparison.Ordinal);
        Assert.DoesNotContain("<script", message.HtmlBody, StringComparison.OrdinalIgnoreCase);

        // Addressed to a person, not to an empty envelope.
        Assert.Equal(Person, message.ToName);
    }

    [Fact]
    public void The_name_is_never_split_into_a_first_name()
    {
        // A Costa Rican roster carries compound given names and rows entered surname-first, so
        // taking the first token would greet this person as "María" and "Rodríguez Vargas, Ana"
        // as "Rodríguez". Whole, exactly as imported.
        var text = SpanishText(CredentialsEmailPurpose.Invitation);

        Assert.Contains("Hola, María José Rodríguez Vargas:", text, StringComparison.Ordinal);
        Assert.DoesNotContain("Hola, María:", text, StringComparison.Ordinal);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    public void An_account_with_no_name_is_greeted_by_nothing_rather_than_by_a_blank(string? missing)
    {
        // Some imported rows carry an email and no name. A greeting built from one would read
        // "Hola, :" -- worse than no greeting at all.
        var message = CredentialsEmailComposer.Compose(
            "person@example.com", missing, Username, Password, LoginUrl, "es",
            CredentialsEmailPurpose.Invitation);

        Assert.DoesNotContain("Hola,", message.TextBody, StringComparison.Ordinal);
        Assert.DoesNotContain("Hello", message.TextBody, StringComparison.Ordinal);
        Assert.Null(message.ToName);

        // And it still carries what it exists to carry.
        Assert.Contains(Username, message.TextBody, StringComparison.Ordinal);
        Assert.Contains(Password, message.TextBody, StringComparison.Ordinal);
    }

    [Fact]
    public void The_invitation_thanks_them_for_taking_part()
    {
        var text = SpanishText(CredentialsEmailPurpose.Invitation);

        Assert.Contains("Gracias por participar.", text, StringComparison.Ordinal);
        Assert.Contains("Thank you for taking part.", text, StringComparison.Ordinal);
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
