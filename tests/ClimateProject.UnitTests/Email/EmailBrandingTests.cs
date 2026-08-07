using ClimateProject.Application.Email;

namespace ClimateProject.UnitTests.Email;

/// <summary>
/// The two ways untrusted text gets into an outbound email, and the guards on both.
///
/// Neither is hypothetical. <c>Notification.Title</c> and <c>Notification.Message</c> are
/// authored by a company admin through <c>POST /notifications</c> and reach the composer as
/// free text -- so the body is a markup-injection surface and the subject is a header-injection
/// surface, and both would be sent under this platform's own verified sending domain.
/// </summary>
public class EmailBrandingTests
{
    [Fact]
    public void Authored_text_is_escaped_before_line_breaks_become_markup()
    {
        var html = EmailBranding.Paragraphs("<script>alert(1)</script>\nsecond line");

        // Order is the whole point: escaping after inserting <br> would escape the <br>;
        // inserting <br> without escaping would ship the script tag.
        Assert.DoesNotContain("<script>", html, StringComparison.Ordinal);
        Assert.Contains("&lt;script&gt;", html, StringComparison.Ordinal);
        Assert.Contains("<br>", html, StringComparison.Ordinal);
    }

    [Fact]
    public void Windows_line_endings_do_not_produce_a_doubled_break()
    {
        var html = EmailBranding.Paragraphs("one\r\ntwo");

        Assert.Equal(1, html.Split("<br>").Length - 1);
    }

    [Fact]
    public void Empty_authored_text_renders_nothing_rather_than_an_empty_paragraph()
    {
        Assert.Equal(string.Empty, EmailBranding.Paragraphs(null));
        Assert.Equal(string.Empty, EmailBranding.Paragraphs("   "));
    }

    [Fact]
    public void A_button_escapes_both_its_url_and_its_label()
    {
        var html = EmailBranding.Button("https://app.example.com/a?b=1&c=2", "Accept & continue");

        Assert.Contains("b=1&amp;c=2", html, StringComparison.Ordinal);
        Assert.Contains("Accept &amp; continue", html, StringComparison.Ordinal);
    }

    [Fact]
    public void A_heading_escapes_its_text()
    {
        Assert.DoesNotContain("<img", EmailBranding.Heading("<img src=x onerror=alert(1)>"), StringComparison.Ordinal);
    }

    [Fact]
    public void The_document_declares_the_recipients_language()
    {
        Assert.Contains("""<html lang="es">""", EmailBranding.Document("es", "<p>hola</p>"), StringComparison.Ordinal);
    }

    [Theory]
    [InlineData("plain subject", false)]
    [InlineData("subject\nBcc: attacker@example.com", true)]
    [InlineData("subject\r\nBcc: attacker@example.com", true)]
    [InlineData("subject\rmore", true)]
    public void Header_injection_is_detected_on_any_line_break(string value, bool expected)
    {
        Assert.Equal(expected, EmailMessage.HasHeaderInjection(value));
    }

    [Fact]
    public void A_multi_line_value_is_collapsed_to_a_legal_header()
    {
        var header = EmailMessage.ToHeaderValue("subject\r\nBcc: attacker@example.com");

        Assert.False(EmailMessage.HasHeaderInjection(header));
        Assert.Equal("subject  Bcc: attacker@example.com", header);
    }

    [Fact]
    public void A_single_line_value_is_returned_untouched()
    {
        Assert.Equal("Survey closes Friday", EmailMessage.ToHeaderValue("Survey closes Friday"));
    }
}
