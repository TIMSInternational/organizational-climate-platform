using ClimateProject.Application.Email;
using ClimateProject.Infrastructure.Email;
using Microsoft.Extensions.Logging.Abstractions;

namespace ClimateProject.UnitTests.Email;

/// <summary>
/// Whether the <c>X-SES-CONFIGURATION-SET</c> header is actually on the wire.
///
/// <para>
/// **Why this stands up a socket rather than inspecting a <c>MailMessage</c>.** The obvious
/// test -- call a helper that builds headers and assert the dictionary -- proves that the
/// helper works and nothing about whether the transport calls it. That is the shape of test
/// that closes a question without answering it: delete the call site and it still passes. The
/// header only counts if SES receives it, so the assertion here is made against the bytes a
/// server on the other end of an SMTP conversation actually read.
/// </para>
/// <para>
/// The server is a loopback <see cref="TcpListener"/> on an ephemeral port speaking the
/// minimum of RFC 5321 that <c>SmtpClient</c> needs: a greeting, EHLO, MAIL FROM, RCPT TO,
/// DATA, QUIT. It advertises no extensions, so no STARTTLS and no AUTH is attempted. Nothing
/// leaves the machine.
/// </para>
/// </summary>
public class SesConfigurationSetTests
{
    private static SmtpEmailTransport Transport(int port, string? configurationSet)
    {
        var options = new EmailOptions
        {
            Provider = EmailOptions.ProviderSmtp,
            SmtpHost = "127.0.0.1",
            SmtpPort = port,
            // The capture server speaks plaintext; STARTTLS against it would be a handshake
            // failure, not a test.
            SmtpUseStartTls = false,
            FromAddress = "no-reply@example.com",
            AppBaseUrl = "https://app.example.invalid",
            SesConfigurationSet = configurationSet,
            // Short, so a hung conversation fails the test in seconds rather than half a minute.
            TimeoutSeconds = 10,
        };

        return new SmtpEmailTransport(
            options,
            new EmailSendRateLimiter(options.MaxSendsPerSecond),
            NullLogger<SmtpEmailTransport>.Instance);
    }

    private static EmailMessage Message()
        => new("ana@fixtures.timsint.com", "Ana", "Subject", "text", "<p>html</p>");

    /// <summary>
    /// The guarantee: what SES reads includes the configuration set it should attribute this
    /// product's bounces and complaints to.
    ///
    /// Without it, every send from this service is scored only against the shared AWS account
    /// -- one that five other TIMS products also send from -- so a bounce here is a reputation
    /// cost none of them can attribute, and a bad enough day pauses sending for all six.
    /// </summary>
    [Fact]
    public async Task The_configured_set_is_on_the_wire()
    {
        using var server = new CapturingSmtpServer();

        var outcome = await Transport(server.Port, "tims-transactional").SendAsync(Message(), CancellationToken.None);

        Assert.True(outcome.Delivered, outcome.FailureReason);

        var data = await server.CapturedDataAsync();
        Assert.Contains("X-SES-CONFIGURATION-SET: tims-transactional", data, StringComparison.OrdinalIgnoreCase);
    }

    /// <summary>
    /// The other half of "optional", and the half that keeps local development working: with
    /// no configuration set there is no header at all, rather than an empty or placeholder
    /// one. MailHog, CI and the integration suite send to destinations where a configuration
    /// set does not exist.
    /// </summary>
    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    public async Task No_header_is_emitted_when_none_is_configured(string? configurationSet)
    {
        using var server = new CapturingSmtpServer();

        var outcome = await Transport(server.Port, configurationSet).SendAsync(Message(), CancellationToken.None);

        Assert.True(outcome.Delivered, outcome.FailureReason);

        var data = await server.CapturedDataAsync();
        Assert.DoesNotContain("X-SES-CONFIGURATION-SET", data, StringComparison.OrdinalIgnoreCase);
    }

    /// <summary>
    /// Surrounding whitespace off a pasted deploy value is trimmed rather than emitted: SES
    /// matches the configuration set name exactly, and " tims-transactional" is not a set
    /// that exists.
    /// </summary>
    [Fact]
    public async Task A_padded_value_is_trimmed()
    {
        using var server = new CapturingSmtpServer();

        var outcome = await Transport(server.Port, "  tims-transactional  ").SendAsync(Message(), CancellationToken.None);

        Assert.True(outcome.Delivered, outcome.FailureReason);

        var data = await server.CapturedDataAsync();
        Assert.Contains("X-SES-CONFIGURATION-SET: tims-transactional\r\n", data, StringComparison.OrdinalIgnoreCase);
    }
}
