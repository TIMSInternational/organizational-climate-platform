using ClimateProject.Application.Email;
using ClimateProject.Application.Localization;
using ClimateProject.Application.Notifications;
using ClimateProject.Application.Surveys;
using ClimateProject.Domain.Entities;

namespace ClimateProject.UnitTests.Notifications;

/// <summary>
/// Rendering a notification into the email that carries it (#100).
///
/// Two properties matter more than the copy itself: the chrome is in the recipient's own
/// language, and admin-authored text never becomes markup.
/// </summary>
public class NotificationEmailComposerTests
{
    private const string AppBaseUrl = "https://app.example.com";

    private const string PreferencesUrl = $"{AppBaseUrl}/settings/notifications";

    /// <summary>
    /// The <c>data</c> blob a survey invitation actually carries, built the way
    /// <c>SurveyDistributionEndpoints.NewNotification</c> builds it -- both keys, serialised,
    /// in that order.
    ///
    /// <para>
    /// A fixture rather than an inline literal because the point of these tests is that the
    /// composer reads a key the queueing side really writes. The previous version of this
    /// file passed hand-written payloads carrying keys nothing in the system produced, so the
    /// suite was green while the shipped email contained no link at all. Anything asserting
    /// on a link goes through here.
    /// </para>
    /// </summary>
    private static string DistributionPayload(Guid surveyId)
        => System.Text.Json.JsonSerializer.Serialize(new Dictionary<string, string>
        {
            // Spelled as a literal, NOT through NotificationEmailComposer.SurveyIdKey. Writing
            // the fixture through the same constant the composer reads makes the test move
            // with the production code: rename the constant and the payload renames itself,
            // so the suite stays green while the shipped composer reads a key the database
            // has never contained. That is the precise shape of the bug this file exists to
            // catch, so the literal below is load-bearing and must stay a literal.
            ["surveyId"] = surveyId.ToString(),
            ["surveyInvitationId"] = Guid.NewGuid().ToString(),
        });

    /// <summary>
    /// The one survey URL in a text body, failing if there is not exactly one.
    ///
    /// Exact-matching the whole URL is what makes the "which route" tests bite: a substring
    /// assertion on <c>/surveys/{id}</c> passes just as happily against
    /// <c>/surveys/{id}/respond</c> as against the admin detail page, so it cannot tell the
    /// two apart and would not have noticed the link pointing at the wrong screen.
    /// </summary>
    private static string SoleSurveyLinkIn(string textBody)
        => Assert.Single(textBody
            .Split((char[])['\n', ' '], StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
            .Where(token => token.Contains($"{AppBaseUrl}{SurveyWebPaths.Prefix}", StringComparison.Ordinal))
            .ToList());

    /// <summary>Asserts no survey link reached either body, in any form.</summary>
    private static void AssertNoSurveyLink(EmailMessage message)
    {
        foreach (var body in new[] { message.HtmlBody, message.TextBody })
        {
            Assert.DoesNotContain(SurveyWebPaths.Prefix, body, StringComparison.Ordinal);
            Assert.DoesNotContain(SurveyWebPaths.RespondSuffix, body, StringComparison.Ordinal);
            Assert.DoesNotContain("Open the survey", body, StringComparison.Ordinal);
        }

        Assert.DoesNotContain("href=\"\"", message.HtmlBody, StringComparison.Ordinal);
    }

    private static Notification Notification(
        string title = "Survey closes Friday",
        string message = "Please respond.",
        string? data = null)
        => new()
        {
            Id = Guid.NewGuid(),
            UserId = Guid.NewGuid(),
            CompanyId = Guid.NewGuid(),
            Type = NotificationTypes.SurveyReminder,
            Channel = NotificationChannels.Email,
            Status = NotificationStatuses.Pending,
            Title = title,
            Message = message,
            Data = data,
        };

    /// <summary>
    /// What <c>EmailOptions.LinkTo</c> does in production, kept deliberately naive here so a
    /// test failure points at the composer's choice of path and not at URL joining.
    /// </summary>
    private static string ResolveLink(string path) => AppBaseUrl + path;

    private static NotificationRecipient Recipient(string language = ContentLanguages.English, string name = "Ana")
        => new(Guid.NewGuid(), "ana@example.com", name, language);

    [Fact]
    public void The_subject_is_the_authored_title()
    {
        var message = NotificationEmailComposer.Compose(Notification(), Recipient(), PreferencesUrl);

        Assert.Equal("Survey closes Friday", message.Subject);
        Assert.Equal("ana@example.com", message.ToAddress);
        Assert.Equal("Ana", message.ToName);
    }

    [Fact]
    public void An_empty_title_still_produces_a_subject()
    {
        // A blank subject line reads as spam and tells the recipient nothing.
        var message = NotificationEmailComposer.Compose(Notification(title: "   "), Recipient(), PreferencesUrl);

        Assert.False(string.IsNullOrWhiteSpace(message.Subject));
        Assert.Contains(EmailBranding.ProductName, message.Subject, StringComparison.Ordinal);
    }

    [Fact]
    public void A_title_containing_a_line_break_cannot_inject_a_header()
    {
        var message = NotificationEmailComposer.Compose(
            Notification(title: "Reminder\r\nBcc: attacker@example.com"), Recipient(), PreferencesUrl);

        Assert.False(EmailMessage.HasHeaderInjection(message.Subject));
    }

    [Fact]
    public void The_chrome_is_rendered_in_the_recipients_language()
    {
        var spanish = NotificationEmailComposer.Compose(
            Notification(), Recipient(ContentLanguages.Spanish), PreferencesUrl);
        var english = NotificationEmailComposer.Compose(
            Notification(), Recipient(ContentLanguages.English), PreferencesUrl);

        Assert.Contains("Hola Ana", spanish.TextBody, StringComparison.Ordinal);
        Assert.Contains("Recibes este mensaje", spanish.TextBody, StringComparison.Ordinal);
        Assert.Contains("""<html lang="es">""", spanish.HtmlBody, StringComparison.Ordinal);

        Assert.Contains("Hi Ana", english.TextBody, StringComparison.Ordinal);
        Assert.Contains("You are receiving this", english.TextBody, StringComparison.Ordinal);
    }

    [Fact]
    public void Authored_content_is_not_translated_only_the_chrome_around_it_is()
    {
        // Title and Message are authored once, by an admin, for the whole batch. A send path
        // cannot translate them and must not pretend to.
        var spanish = NotificationEmailComposer.Compose(
            Notification(title: "Survey closes Friday", message: "Please respond."),
            Recipient(ContentLanguages.Spanish),
            PreferencesUrl);

        Assert.Contains("Survey closes Friday", spanish.Subject, StringComparison.Ordinal);
        Assert.Contains("Please respond.", spanish.TextBody, StringComparison.Ordinal);
    }

    [Fact]
    public void An_unknown_language_falls_back_rather_than_rendering_nothing()
    {
        var message = NotificationEmailComposer.Compose(Notification(), Recipient("klingon"), PreferencesUrl);

        Assert.Contains("Hi Ana", message.TextBody, StringComparison.Ordinal);
    }

    [Fact]
    public void An_admin_authored_message_cannot_inject_markup_into_the_html_body()
    {
        // POST /notifications takes Message as free text from a company admin, and this mail
        // goes out under the platform's own verified sending domain.
        var message = NotificationEmailComposer.Compose(
            Notification(message: "<a href=\"https://evil.example\">Click</a>"), Recipient(), PreferencesUrl);

        Assert.DoesNotContain("<a href=\"https://evil.example\"", message.HtmlBody, StringComparison.Ordinal);
        Assert.Contains("&lt;a href=", message.HtmlBody, StringComparison.Ordinal);
    }

    [Fact]
    public void The_preferences_link_is_included_when_one_is_supplied()
    {
        var message = NotificationEmailComposer.Compose(Notification(), Recipient(), PreferencesUrl);

        Assert.Contains(PreferencesUrl, message.TextBody, StringComparison.Ordinal);
        Assert.Contains(PreferencesUrl, message.HtmlBody, StringComparison.Ordinal);
    }

    [Fact]
    public void The_preferences_link_is_omitted_rather_than_rendered_broken_when_absent()
    {
        var message = NotificationEmailComposer.Compose(Notification(), Recipient(), preferencesUrl: null);

        Assert.DoesNotContain("href=\"\"", message.HtmlBody, StringComparison.Ordinal);
        Assert.Contains("You are receiving this", message.TextBody, StringComparison.Ordinal);
    }

    [Fact]
    public void Both_a_text_and_an_html_body_are_always_produced()
    {
        var message = NotificationEmailComposer.Compose(Notification(), Recipient(), PreferencesUrl);

        Assert.False(string.IsNullOrWhiteSpace(message.TextBody));
        Assert.StartsWith("<!doctype html>", message.HtmlBody, StringComparison.Ordinal);
    }

    [Theory]
    [InlineData("es-CO", ContentLanguages.Spanish)]
    [InlineData("EN-us", ContentLanguages.English)]
    [InlineData("", ContentLanguages.English)]
    [InlineData("klingon", ContentLanguages.English)]
    public void The_recipients_language_is_normalised_from_the_stored_preference(string stored, string expected)
    {
        var user = new User
        {
            Id = Guid.NewGuid(),
            Email = "ana@example.com",
            Name = "Ana",
            Role = "employee",
            Preferences = new UserPreferences { Language = stored },
        };

        Assert.Equal(expected, NotificationRecipient.From(user).Language);
    }

    [Fact]
    public void The_survey_link_is_rendered_from_the_survey_id_the_payload_really_carries()
    {
        // The defect this fixes: the invitation body says "follow the link in this message to
        // take part" and no link was ever rendered. The fixture is DistributionPayload, which
        // is built the way SurveyDistributionEndpoints builds `data` -- a composer reading any
        // other key renders nothing in production while its own tests stay green, which is
        // exactly the failure this replaces.
        var surveyId = Guid.NewGuid();
        var message = NotificationEmailComposer.Compose(
            Notification(data: DistributionPayload(surveyId)),
            Recipient(),
            PreferencesUrl,
            ResolveLink);

        var expected = $"{AppBaseUrl}/surveys/{surveyId}/respond";
        Assert.Contains(expected, message.TextBody, StringComparison.Ordinal);
        Assert.Contains($"href=\"{expected}\"", message.HtmlBody, StringComparison.Ordinal);
        Assert.Contains("Open the survey", message.TextBody, StringComparison.Ordinal);
    }

    [Fact]
    public void The_link_is_the_respond_form_not_the_administrators_survey_page()
    {
        // `/surveys/{id}` is the detail screen inside AdminLayout: an invitee who lands there
        // is shown a survey to administer rather than a form to answer, and on most roles a
        // permission error instead. `/surveys/{id}/respond` is declared outside that shell
        // precisely so a mailed link does not do that.
        var surveyId = Guid.NewGuid();
        var message = NotificationEmailComposer.Compose(
            Notification(data: DistributionPayload(surveyId)),
            Recipient(),
            PreferencesUrl,
            ResolveLink);

        Assert.EndsWith(
            SurveyWebPaths.RespondSuffix,
            SoleSurveyLinkIn(message.TextBody),
            StringComparison.Ordinal);
    }

    [Fact]
    public void The_link_label_is_in_the_recipients_language()
    {
        var spanish = NotificationEmailComposer.Compose(
            Notification(data: DistributionPayload(Guid.NewGuid())),
            Recipient(ContentLanguages.Spanish),
            PreferencesUrl,
            ResolveLink);

        Assert.Contains("Abrir la encuesta", spanish.TextBody, StringComparison.Ordinal);
        Assert.Contains("Abrir la encuesta", spanish.HtmlBody, StringComparison.Ordinal);
        Assert.DoesNotContain("Open the survey", spanish.HtmlBody, StringComparison.Ordinal);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    [InlineData("not json at all")]
    [InlineData("{\"surveyId\":")]
    [InlineData("[1,2,3]")]
    [InlineData("42")]
    [InlineData("\"a bare string\"")]
    [InlineData("{}")]
    [InlineData("{\"surveyId\":null}")]
    [InlineData("{\"surveyId\":12345}")]
    [InlineData("{\"surveyId\":{\"nested\":\"object\"}}")]
    [InlineData("{\"surveyId\":\"\"}")]
    [InlineData("{\"surveyId\":\"not-a-guid\"}")]
    // The id under a key nobody reads: a notification about an invitation, with no survey
    // named in the place this composer looks.
    [InlineData("{\"surveyInvitationId\":\"6f9619ff-8b86-d011-b42d-00c04fc964ff\"}")]
    public void A_malformed_payload_degrades_to_the_email_we_already_sent(string? data)
    {
        // `data` is a jsonb column written by several producers and, through
        // POST /notifications, by hand. Throwing in here would surface as a row marked
        // `failed` and retried three times to no purpose, burning a recipient's retry budget
        // on a blob that will never parse.
        var message = NotificationEmailComposer.Compose(
            Notification(data: data), Recipient(), PreferencesUrl, ResolveLink);

        AssertNoSurveyLink(message);
        Assert.Contains("Please respond.", message.TextBody, StringComparison.Ordinal);
    }

    [Fact]
    public void An_all_zero_survey_id_renders_no_button_rather_than_a_button_onto_a_404()
    {
        // Guid.Empty parses, so a parse-only guard would emit it -- and the recipient would
        // get a button onto a not-found page. A missing button reads as "nothing to link
        // to"; a dead one reads as a broken product, which is worse than the email we sent
        // before this change.
        var message = NotificationEmailComposer.Compose(
            Notification(data: $$"""{"surveyId":"{{Guid.Empty}}"}"""),
            Recipient(),
            PreferencesUrl,
            ResolveLink);

        AssertNoSurveyLink(message);
        Assert.DoesNotContain(Guid.Empty.ToString(), message.HtmlBody, StringComparison.Ordinal);
        Assert.Contains("Please respond.", message.TextBody, StringComparison.Ordinal);
    }

    [Theory]
    // Nothing resembling an id at all.
    [InlineData("https://evil.example")]
    [InlineData("../../login?next=https://evil.example")]
    // Exactly 36 characters -- the length of a canonical GUID -- so a length check passes it
    // and only a real parse rejects it.
    [InlineData("zzzzzzzz-zzzz-zzzz-zzzz-zzzzzzzzzzzz")]
    [InlineData("..%2f..%2f..%2flogin%3fnext%3dhttps%3a")]
    // A genuine GUID with something appended. These are the ones a guard that validates a
    // prefix and then emits the caller's own string would let straight through, and they are
    // the whole reason the path is rendered from the parsed Guid instead.
    [InlineData("6f9619ff-8b86-d011-b42d-00c04fc964ff/../../login?next=https://evil.example")]
    [InlineData("6f9619ff-8b86-d011-b42d-00c04fc964ff\" style=\"x")]
    [InlineData("6f9619ff-8b86-d011-b42d-00c04fc964ff?next=https://evil.example")]
    [InlineData("6f9619ff-8b86-d011-b42d-00c04fc964ff#https://evil.example")]
    public void A_payload_cannot_steer_the_link_anywhere_but_at_a_survey(string hostile)
    {
        // POST /notifications takes `data` verbatim from a company admin, and this mail goes
        // out under the platform's verified sending domain. The payload may choose *which*
        // survey; it may not choose the path, and it may not supply a URL.
        var message = NotificationEmailComposer.Compose(
            Notification(data: System.Text.Json.JsonSerializer.Serialize(
                new Dictionary<string, string> { [NotificationEmailComposer.SurveyIdKey] = hostile })),
            Recipient(),
            PreferencesUrl,
            ResolveLink);

        foreach (var body in new[] { message.HtmlBody, message.TextBody })
        {
            Assert.DoesNotContain("evil.example", body, StringComparison.Ordinal);
            Assert.DoesNotContain("login", body, StringComparison.Ordinal);

            // The hostile string itself, unaltered, must appear nowhere: the failure mode is
            // a guard that checks the value and then emits the caller's own characters.
            Assert.DoesNotContain(hostile, body, StringComparison.Ordinal);
        }
    }

    [Fact]
    public void A_braced_guid_is_re_rendered_canonically_rather_than_pasted_through()
    {
        // Guid.TryParse also accepts "{...}", "(...)" and the 32-digit "N" form. Emitting the
        // caller's own text would put braces into a URL; rendering from the parsed value
        // cannot, and this is what proves the path is built from 16 bytes and not from string
        // input that merely passed a check.
        var surveyId = Guid.NewGuid();
        var message = NotificationEmailComposer.Compose(
            Notification(data: $$"""{"surveyId":"{{{surveyId}}}"}"""),
            Recipient(),
            PreferencesUrl,
            ResolveLink);

        Assert.Equal($"{AppBaseUrl}/surveys/{surveyId}/respond", SoleSurveyLinkIn(message.TextBody));
    }

    [Fact]
    public void A_dotted_n_format_guid_cannot_smuggle_a_different_path_shape()
    {
        // The "N" form has no dashes. Round-tripping through Guid means the rendered path is
        // canonical regardless of which accepted spelling arrived.
        var surveyId = Guid.NewGuid();
        var message = NotificationEmailComposer.Compose(
            Notification(data: $$"""{"surveyId":"{{surveyId.ToString("N")}}"}"""),
            Recipient(),
            PreferencesUrl,
            ResolveLink);

        Assert.Equal($"{AppBaseUrl}/surveys/{surveyId}/respond", SoleSurveyLinkIn(message.TextBody));
    }

    [Fact]
    public void The_survey_link_is_omitted_when_nothing_can_make_it_absolute()
    {
        // A host-relative href in an email resolves against the mail client, which means
        // nowhere. Omitting the button is the honest outcome.
        var surveyId = Guid.NewGuid();
        var message = NotificationEmailComposer.Compose(
            Notification(data: DistributionPayload(surveyId)),
            Recipient(),
            PreferencesUrl,
            resolveLink: null);

        Assert.DoesNotContain(surveyId.ToString(), message.HtmlBody, StringComparison.Ordinal);
        Assert.DoesNotContain("href=\"\"", message.HtmlBody, StringComparison.Ordinal);
    }

    [Fact]
    public void The_recipient_carries_the_address_the_notification_row_does_not_hold()
    {
        var user = new User
        {
            Id = Guid.NewGuid(),
            Email = "ana@example.com",
            Name = "Ana",
            Role = "employee",
        };

        var recipient = NotificationRecipient.From(user);

        Assert.Equal(user.Id, recipient.UserId);
        Assert.Equal("ana@example.com", recipient.EmailAddress);
        Assert.Equal("Ana", recipient.Name);
    }
}
