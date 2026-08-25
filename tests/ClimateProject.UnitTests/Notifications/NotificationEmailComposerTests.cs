using ClimateProject.Application.Email;
using ClimateProject.Application.Localization;
using ClimateProject.Application.Notifications;
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
    private const string PreferencesUrl = "https://app.example.com/settings/notifications";

    private static Notification Notification(string title = "Survey closes Friday", string message = "Please respond.")
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
        };

    private static NotificationRecipient Recipient(string language = ContentLanguages.English, string name = "Ana")
        => new(Guid.NewGuid(), "ana@example.com", name, language);

    [Fact]
    public void The_subject_is_the_authored_title()
    {
        var message = NotificationEmailComposer.Compose(Notification(), Recipient(), PreferencesUrl, surveyUrl: null);

        Assert.Equal("Survey closes Friday", message.Subject);
        Assert.Equal("ana@example.com", message.ToAddress);
        Assert.Equal("Ana", message.ToName);
    }

    [Fact]
    public void An_empty_title_still_produces_a_subject()
    {
        // A blank subject line reads as spam and tells the recipient nothing.
        var message = NotificationEmailComposer.Compose(Notification(title: "   "), Recipient(), PreferencesUrl, surveyUrl: null);

        Assert.False(string.IsNullOrWhiteSpace(message.Subject));
        Assert.Contains(EmailBranding.ProductName, message.Subject, StringComparison.Ordinal);
    }

    [Fact]
    public void A_title_containing_a_line_break_cannot_inject_a_header()
    {
        var message = NotificationEmailComposer.Compose(
            Notification(title: "Reminder\r\nBcc: attacker@example.com"), Recipient(), PreferencesUrl, surveyUrl: null);

        Assert.False(EmailMessage.HasHeaderInjection(message.Subject));
    }

    [Fact]
    public void The_chrome_is_rendered_in_the_recipients_language()
    {
        var spanish = NotificationEmailComposer.Compose(
            Notification(), Recipient(ContentLanguages.Spanish), PreferencesUrl, surveyUrl: null);
        var english = NotificationEmailComposer.Compose(
            Notification(), Recipient(ContentLanguages.English), PreferencesUrl, surveyUrl: null);

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
            PreferencesUrl,
            surveyUrl: null);

        Assert.Contains("Survey closes Friday", spanish.Subject, StringComparison.Ordinal);
        Assert.Contains("Please respond.", spanish.TextBody, StringComparison.Ordinal);
    }

    [Fact]
    public void An_unknown_language_falls_back_rather_than_rendering_nothing()
    {
        var message = NotificationEmailComposer.Compose(Notification(), Recipient("klingon"), PreferencesUrl, surveyUrl: null);

        Assert.Contains("Hi Ana", message.TextBody, StringComparison.Ordinal);
    }

    [Fact]
    public void An_admin_authored_message_cannot_inject_markup_into_the_html_body()
    {
        // POST /notifications takes Message as free text from a company admin, and this mail
        // goes out under the platform's own verified sending domain.
        var message = NotificationEmailComposer.Compose(
            Notification(message: "<a href=\"https://evil.example\">Click</a>"), Recipient(), PreferencesUrl, surveyUrl: null);

        Assert.DoesNotContain("<a href=\"https://evil.example\"", message.HtmlBody, StringComparison.Ordinal);
        Assert.Contains("&lt;a href=", message.HtmlBody, StringComparison.Ordinal);
    }

    [Fact]
    public void The_preferences_link_is_included_when_one_is_supplied()
    {
        var message = NotificationEmailComposer.Compose(Notification(), Recipient(), PreferencesUrl, surveyUrl: null);

        Assert.Contains(PreferencesUrl, message.TextBody, StringComparison.Ordinal);
        Assert.Contains(PreferencesUrl, message.HtmlBody, StringComparison.Ordinal);
    }

    [Fact]
    public void The_preferences_link_is_omitted_rather_than_rendered_broken_when_absent()
    {
        var message = NotificationEmailComposer.Compose(Notification(), Recipient(), preferencesUrl: null, surveyUrl: null);

        Assert.DoesNotContain("href=\"\"", message.HtmlBody, StringComparison.Ordinal);
        Assert.Contains("You are receiving this", message.TextBody, StringComparison.Ordinal);
    }

    // ------------------------------------------------------------------
    // The survey link
    // ------------------------------------------------------------------

    private const string SurveyUrl = "https://app.example.com/survey-invitations/tok-EN-abc";

    [Fact]
    public void The_survey_link_is_rendered_in_BOTH_the_html_and_the_plain_text_parts()
    {
        // The property this file exists to hold. A call to action that appears only in the
        // HTML part is a dead end for every plain-text reader -- and the plain-text part is
        // what the conservative corporate mail clients this product's recipients use will
        // show them.
        var message = NotificationEmailComposer.Compose(Notification(), Recipient(), PreferencesUrl, SurveyUrl);

        Assert.Contains(SurveyUrl, message.TextBody, StringComparison.Ordinal);
        Assert.Contains(SurveyUrl, message.HtmlBody, StringComparison.Ordinal);

        // In the HTML part it is an anchor a recipient can click, not a URL printed as text.
        Assert.Contains($"href=\"{SurveyUrl}\"", message.HtmlBody, StringComparison.Ordinal);
    }

    [Fact]
    public void The_call_to_action_label_is_in_the_recipients_language()
    {
        var english = NotificationEmailComposer.Compose(
            Notification(), Recipient(ContentLanguages.English), PreferencesUrl, SurveyUrl);
        var spanish = NotificationEmailComposer.Compose(
            Notification(), Recipient(ContentLanguages.Spanish), PreferencesUrl, SurveyUrl);

        Assert.Contains("Open the survey", english.TextBody, StringComparison.Ordinal);
        Assert.Contains("Open the survey", english.HtmlBody, StringComparison.Ordinal);
        Assert.Contains("Abrir la encuesta", spanish.TextBody, StringComparison.Ordinal);
        Assert.Contains("Abrir la encuesta", spanish.HtmlBody, StringComparison.Ordinal);
    }

    [Fact]
    public void No_survey_url_means_no_call_to_action_in_either_part()
    {
        // Not an empty button and not a bare label with nothing after it: a notification
        // that is not about a survey, or whose invitation has been revoked, must read as a
        // complete message rather than as a broken one.
        var message = NotificationEmailComposer.Compose(Notification(), Recipient(), PreferencesUrl, surveyUrl: null);

        Assert.DoesNotContain("Open the survey", message.TextBody, StringComparison.Ordinal);
        Assert.DoesNotContain("Open the survey", message.HtmlBody, StringComparison.Ordinal);
        Assert.DoesNotContain("href=\"\"", message.HtmlBody, StringComparison.Ordinal);
    }

    [Fact]
    public void A_blank_survey_url_is_treated_as_no_url_rather_than_rendered_empty()
    {
        var message = NotificationEmailComposer.Compose(Notification(), Recipient(), PreferencesUrl, surveyUrl: "   ");

        Assert.DoesNotContain("Open the survey", message.HtmlBody, StringComparison.Ordinal);
        Assert.DoesNotContain("Open the survey", message.TextBody, StringComparison.Ordinal);
    }

    [Fact]
    public void The_two_parts_never_disagree_about_whether_a_link_is_present()
    {
        // One decision, read twice. Asserted as the symmetry itself rather than as two
        // independent Contains, because the failure being guarded is exactly the pair
        // disagreeing.
        foreach (var url in new[] { SurveyUrl, null })
        {
            var message = NotificationEmailComposer.Compose(Notification(), Recipient(), PreferencesUrl, url);

            Assert.Equal(
                message.TextBody.Contains("Open the survey", StringComparison.Ordinal),
                message.HtmlBody.Contains("Open the survey", StringComparison.Ordinal));
        }
    }

    [Fact]
    public void Both_a_text_and_an_html_body_are_always_produced()
    {
        var message = NotificationEmailComposer.Compose(Notification(), Recipient(), PreferencesUrl, surveyUrl: null);

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
