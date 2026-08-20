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
    /// Stand-ins for minted tokens: 43 characters of the same base64url alphabet
    /// <see cref="SurveyAccessTokens.HasExpectedShape"/> accepts, but self-describing rather
    /// than random -- a real-looking 256-bit token in a committed fixture is what the secret
    /// scanner is for, and an obviously fake one reads better in a failure message anyway.
    /// </summary>
    private const string InvitationToken = "fixture-invitation-token-aaaaaaaaaaaaaaaaaa";

    private const string ShareToken = "fixture-public-share-token-bbbbbbbbbbbbbbbb";

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
    public void The_survey_link_is_rendered_from_the_invitation_token_in_the_payload()
    {
        // The defect this fixes: the invitation body says "follow the link in this message to
        // take part" and no link was ever rendered.
        var message = NotificationEmailComposer.Compose(
            Notification(data: $$"""{"surveyInvitationToken":"{{InvitationToken}}"}"""),
            Recipient(),
            PreferencesUrl,
            ResolveLink);

        var expected = $"{AppBaseUrl}{SurveyAccessTokens.InvitationLinkPrefix}{InvitationToken}";
        Assert.Contains(expected, message.TextBody, StringComparison.Ordinal);
        Assert.Contains(expected, message.HtmlBody, StringComparison.Ordinal);
        Assert.Contains("Open the survey", message.TextBody, StringComparison.Ordinal);
    }

    [Fact]
    public void The_share_link_carries_the_mail_when_there_is_no_personal_token()
    {
        var message = NotificationEmailComposer.Compose(
            Notification(data: $$"""{"surveyShareToken":"{{ShareToken}}"}"""),
            Recipient(),
            PreferencesUrl,
            ResolveLink);

        Assert.Contains(
            $"{AppBaseUrl}{SurveyAccessTokens.PublicLinkPrefix}{ShareToken}",
            message.TextBody,
            StringComparison.Ordinal);
    }

    [Fact]
    public void A_personal_link_is_preferred_over_the_company_wide_one()
    {
        // Only the personalised link can mark the invitation opened, which on an anonymous
        // survey is the last state the distribution surface is allowed to record at all.
        var message = NotificationEmailComposer.Compose(
            Notification(data: $$"""
                {"surveyInvitationToken":"{{InvitationToken}}","surveyShareToken":"{{ShareToken}}"}
                """),
            Recipient(),
            PreferencesUrl,
            ResolveLink);

        Assert.Contains(SurveyAccessTokens.InvitationLinkPath(InvitationToken), message.TextBody, StringComparison.Ordinal);
        Assert.DoesNotContain(ShareToken, message.TextBody, StringComparison.Ordinal);
    }

    [Fact]
    public void The_link_label_is_in_the_recipients_language()
    {
        var spanish = NotificationEmailComposer.Compose(
            Notification(data: $$"""{"surveyInvitationToken":"{{InvitationToken}}"}"""),
            Recipient(ContentLanguages.Spanish),
            PreferencesUrl,
            ResolveLink);

        Assert.Contains("Abrir la encuesta", spanish.TextBody, StringComparison.Ordinal);
        Assert.Contains("Abrir la encuesta", spanish.HtmlBody, StringComparison.Ordinal);
        Assert.DoesNotContain("Open the survey", spanish.HtmlBody, StringComparison.Ordinal);
    }

    [Fact]
    public void The_payload_the_distribution_surface_actually_writes_today_carries_no_link()
    {
        // SurveyDistributionEndpoints persists the invitation's *id*, never its token, so
        // that `data` cannot leak a credential through GET /notifications. This composer must
        // therefore treat a link-less payload as ordinary and still send a complete email.
        var message = NotificationEmailComposer.Compose(
            Notification(data: $$"""
                {"surveyId":"{{Guid.NewGuid()}}","surveyInvitationId":"{{Guid.NewGuid()}}"}
                """),
            Recipient(),
            PreferencesUrl,
            ResolveLink);

        Assert.DoesNotContain(SurveyAccessTokens.InvitationLinkPrefix, message.HtmlBody, StringComparison.Ordinal);
        Assert.DoesNotContain(SurveyAccessTokens.PublicLinkPrefix, message.HtmlBody, StringComparison.Ordinal);
        Assert.Contains("Please respond.", message.TextBody, StringComparison.Ordinal);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    [InlineData("not json at all")]
    [InlineData("{\"surveyInvitationToken\":")]
    [InlineData("[1,2,3]")]
    [InlineData("42")]
    [InlineData("\"a bare string\"")]
    [InlineData("{}")]
    [InlineData("{\"surveyInvitationToken\":null}")]
    [InlineData("{\"surveyInvitationToken\":12345}")]
    [InlineData("{\"surveyInvitationToken\":{\"nested\":\"object\"}}")]
    public void A_malformed_payload_degrades_to_the_email_we_already_sent(string? data)
    {
        // `data` is a jsonb column written by several producers and, through
        // POST /notifications, by hand. Throwing in here would surface as a row marked
        // `failed` and retried three times to no purpose, burning a recipient's retry budget
        // on a blob that will never parse.
        var message = NotificationEmailComposer.Compose(
            Notification(data: data), Recipient(), PreferencesUrl, ResolveLink);

        Assert.DoesNotContain(SurveyAccessTokens.InvitationLinkPrefix, message.HtmlBody, StringComparison.Ordinal);
        Assert.DoesNotContain(SurveyAccessTokens.PublicLinkPrefix, message.HtmlBody, StringComparison.Ordinal);
        Assert.DoesNotContain("href=\"\"", message.HtmlBody, StringComparison.Ordinal);
        Assert.Contains("Please respond.", message.TextBody, StringComparison.Ordinal);
    }

    [Theory]
    [InlineData("https://evil.example")]
    [InlineData("../../login?next=https://evil.example")]
    [InlineData("fixture-invitation-token-aaaaaaaaaaaaaaaaaa\" style=\"x")]
    public void A_token_that_is_not_shaped_like_ours_cannot_steer_the_link(string hostile)
    {
        // POST /notifications takes `data` verbatim from a company admin, and this mail goes
        // out under the platform's verified sending domain. The payload may choose between
        // our two links; it may not supply one.
        var message = NotificationEmailComposer.Compose(
            Notification(data: System.Text.Json.JsonSerializer.Serialize(
                new Dictionary<string, string> { ["surveyInvitationToken"] = hostile })),
            Recipient(),
            PreferencesUrl,
            ResolveLink);

        Assert.DoesNotContain("evil.example", message.HtmlBody, StringComparison.Ordinal);
        Assert.DoesNotContain("evil.example", message.TextBody, StringComparison.Ordinal);
        Assert.DoesNotContain(SurveyAccessTokens.InvitationLinkPrefix, message.HtmlBody, StringComparison.Ordinal);
    }

    [Fact]
    public void The_survey_link_is_omitted_when_nothing_can_make_it_absolute()
    {
        // A host-relative href in an email resolves against the mail client, which means
        // nowhere. Omitting the button is the honest outcome.
        var message = NotificationEmailComposer.Compose(
            Notification(data: $$"""{"surveyInvitationToken":"{{InvitationToken}}"}"""),
            Recipient(),
            PreferencesUrl,
            resolveLink: null);

        Assert.DoesNotContain(InvitationToken, message.HtmlBody, StringComparison.Ordinal);
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
