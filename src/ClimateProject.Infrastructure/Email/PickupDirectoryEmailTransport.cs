using System.Net.Mail;
using System.Text;
using ClimateProject.Application.Email;
using Microsoft.Extensions.Logging;

namespace ClimateProject.Infrastructure.Email;

/// <summary>
/// DEVELOPMENT ONLY (<see cref="EmailOptions.ProviderPickup"/>): writes each message into
/// <see cref="EmailOptions.PickupDirectory"/> -- the full MIME message as an <c>.eml</c> file,
/// through <see cref="SmtpDeliveryMethod.SpecifiedPickupDirectory"/>, and the HTML body as an
/// <c>.html</c> file beside it so a person can open or screenshot exactly what was composed.
///
/// <para><b>No socket is opened.</b> That is the whole reason the RFC 2606/6761 reserved domains
/// are NOT refused here, unlike <see cref="SmtpEmailTransport"/>: the backstop there protects a
/// shared SES reputation from guaranteed bounces, and nothing written to a local folder can
/// bounce. The hosts refuse this provider outside Development (<c>Program.cs</c>,
/// <c>WorkerHostFactory</c>).</para>
///
/// <para>It logs the file name only. The message itself can carry a sign-in secret (a password,
/// a personal survey link), and the folder is the one place it is meant to be read.</para>
/// </summary>
public sealed class PickupDirectoryEmailTransport(
    EmailOptions options,
    ILogger<PickupDirectoryEmailTransport> logger) : IEmailTransport
{
    public async Task<EmailSendOutcome> SendAsync(EmailMessage message, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(message);

        if (EmailMessage.HasHeaderInjection(message.Subject))
        {
            return EmailSendOutcome.PermanentFailure("The message subject contains a line break and cannot be sent.");
        }

        MailAddress to;
        try
        {
            to = new MailAddress(message.ToAddress);
        }
        catch (FormatException)
        {
            return EmailSendOutcome.PermanentFailure("The recipient address is not a valid email address.");
        }

        var directory = Path.GetFullPath(options.PickupDirectory!);
        Directory.CreateDirectory(directory);

        using var mail = new MailMessage
        {
            From = new MailAddress(
                string.IsNullOrWhiteSpace(options.FromAddress) ? "no-reply@localhost" : options.FromAddress,
                options.FromName),
            Subject = message.Subject,
            Body = message.TextBody,
            IsBodyHtml = false,
            SubjectEncoding = Encoding.UTF8,
            BodyEncoding = Encoding.UTF8,
        };
        mail.To.Add(to);
        using var htmlView = AlternateView.CreateAlternateViewFromString(message.HtmlBody, Encoding.UTF8, "text/html");
        mail.AlternateViews.Add(htmlView);

        using var client = new SmtpClient
        {
            DeliveryMethod = SmtpDeliveryMethod.SpecifiedPickupDirectory,
            PickupDirectoryLocation = directory,
        };

        var before = Directory.GetFiles(directory, "*.eml").ToHashSet(StringComparer.Ordinal);
        await client.SendMailAsync(mail, cancellationToken).ConfigureAwait(false);
        var written = Directory.GetFiles(directory, "*.eml").FirstOrDefault(f => !before.Contains(f));

        var stem = written is null
            ? Path.Combine(directory, $"{DateTimeOffset.UtcNow:yyyyMMddHHmmssfff}-{Guid.NewGuid():N}")
            : Path.Combine(directory, Path.GetFileNameWithoutExtension(written));
        await File.WriteAllTextAsync(stem + ".html", message.HtmlBody, Encoding.UTF8, cancellationToken).ConfigureAwait(false);

        logger.LogInformation("Mail written to the local pickup folder as {File}.", Path.GetFileName(stem));
        return EmailSendOutcome.Success();
    }
}
