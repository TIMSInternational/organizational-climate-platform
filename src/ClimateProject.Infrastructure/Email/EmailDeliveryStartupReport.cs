using ClimateProject.Application.Email;
using Microsoft.Extensions.Logging;

namespace ClimateProject.Infrastructure.Email;

/// <summary>
/// Says, once, at host start, whether this deploy can actually send mail.
///
/// <para>
/// #100's requirement is that the unconfigured path be obvious rather than silently dropping
/// mail, and the trap it is guarding against is specific: with no provider configured the
/// logging stub reports success, so the notification row is marked <c>sent</c>, the API
/// returns 201, the admin sees "sent" in the UI, and nothing anywhere says the message did
/// not leave the building. The per-send stub log is Information-level and buried in request
/// noise. A single startup WARNING is the line an operator actually reads, and it is the
/// first thing in the log of a deploy that forgot the mail secret.
/// </para>
/// <para>
/// Warning rather than a hard failure, and that is the deliberate half of #189's rule: a
/// missing *required* setting fails at startup, but mail is genuinely optional -- local
/// development, CI and the integration suite all run correctly without it, and refusing to
/// start there would be wrong. What does fail at startup is a *half*-configured provider,
/// which <see cref="EmailOptions.Validate"/> catches.
/// </para>
/// </summary>
public static class EmailDeliveryStartupReport
{
    public const string LogCategory = "ClimateProject.Api.Email";

    public static void Write(ILogger logger, EmailOptions options)
    {
        ArgumentNullException.ThrowIfNull(logger);
        ArgumentNullException.ThrowIfNull(options);

        if (options.IsConfigured)
        {
            // Host, port and the From address only. The SMTP username is a credential half
            // and is never logged, even at startup.
            logger.LogInformation(
                "Email delivery is ENABLED via {Provider} at {Host}:{Port} (STARTTLS {Tls}), sending as {FromAddress}, " +
                "paced at {MaxSendsPerSecond}/second. Links are built from {AppBaseUrl}.",
                options.Provider,
                options.SmtpHost,
                options.SmtpPort,
                options.SmtpUseStartTls ? "on" : "off",
                options.FromAddress,
                options.MaxSendsPerSecond,
                options.AppBaseUrl);
            return;
        }

        logger.LogWarning(
            "Email delivery is NOT CONFIGURED (Email:Provider is '{Provider}'). Notifications and invitations will be " +
            "recorded as sent and NO MAIL WILL LEAVE THIS PROCESS. This is correct for local development, CI and tests. " +
            "To enable delivery set Email:Provider='{SmtpProvider}' together with Email:SmtpHost, Email:FromAddress and " +
            "Email:AppBaseUrl (plus Email:SmtpUsername/Email:SmtpPassword unless the relay accepts anonymous submission).",
            options.Provider,
            EmailOptions.ProviderSmtp);
    }
}
