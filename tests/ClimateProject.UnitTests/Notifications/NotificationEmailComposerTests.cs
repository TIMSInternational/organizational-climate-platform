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
