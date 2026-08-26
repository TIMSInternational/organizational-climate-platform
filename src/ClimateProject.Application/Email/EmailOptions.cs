namespace ClimateProject.Application.Email;

/// <summary>
/// Mail provider configuration, bound from the <c>Email</c> configuration section.
///
/// <para>
/// **Why this is conditionally required rather than required.** #189's rule is that a
/// missing required setting fails at *startup*, not per request -- but the same issue is
/// explicit that a setting only becomes required when the app genuinely cannot run without
/// it, which is why <c>GoogleClientId</c> got <c>GoogleAuth:Required</c> instead of a hard
/// guard. Mail is the same shape: local development, CI and the integration suite all run
/// correctly with no provider at all, and refusing to start there would be wrong. So
/// <see cref="Provider"/> defaults to <see cref="ProviderNone"/> and nothing is required;
/// set it to <see cref="ProviderSmtp"/> and the settings that provider cannot work without
/// become mandatory and fail the host at startup, exactly like the other four.
/// </para>
/// <para>
/// The half-configured deploy is the case this shape exists to catch. An <c>Email</c>
/// section with a host and no <c>FromAddress</c> is not "mail is off" -- it is someone
/// intending to turn mail on and missing a value, and the worst outcome is a service that
/// boots, reports healthy, marks every notification <c>sent</c>, and delivers nothing.
/// </para>
/// </summary>
public sealed class EmailOptions
{
    /// <summary>No mail provider. The default, and what local dev, CI and tests run on.</summary>
    public const string ProviderNone = "none";

    /// <summary>
    /// Deliver over SMTP. Provider-agnostic on purpose -- Amazon SES, SendGrid, Postmark
    /// and Mailgun all expose an SMTP submission endpoint, so this one implementation
    /// covers the choice #100 leaves open without pulling a vendor SDK into a dependency
    /// list that is currently five packages long.
    /// </summary>
    public const string ProviderSmtp = "smtp";

    public static readonly string[] KnownProviders = [ProviderNone, ProviderSmtp];

    /// <summary>Submission port used when none is configured. 587 is the STARTTLS submission port every managed provider offers.</summary>
    public const int DefaultSmtpPort = 587;

    /// <summary>
    /// Sends per second, applied process-wide. Amazon SES's default sending rate for a
    /// production (out-of-sandbox) account is 14/second, so 10 leaves headroom for a second
    /// instance without either of them being throttled. #100 asks that a company-wide
    /// dispatch stay inside provider limits and this is the whole of that mechanism.
    /// </summary>
    public const int DefaultMaxSendsPerSecond = 10;

    public const int DefaultTimeoutSeconds = 30;

    public string Provider { get; set; } = ProviderNone;

    /// <summary>Envelope sender. Must be an address the provider has verified, or every send is rejected.</summary>
    public string? FromAddress { get; set; }

    public string? FromName { get; set; }

    /// <summary>
    /// Origin of the web app, used to build the links in outbound mail (the invitation
    /// accept link, the "manage your notification preferences" link). Required whenever a
    /// provider is configured: an invitation email with no working link is worse than one
    /// that was never sent, because the recipient has no way to tell it is broken.
    /// </summary>
    public string? AppBaseUrl { get; set; }

    public string? SmtpHost { get; set; }

    public int SmtpPort { get; set; } = DefaultSmtpPort;

    /// <summary>STARTTLS on the submission port. Off only for a local capture server (MailHog, smtp4dev).</summary>
    public bool SmtpUseStartTls { get; set; } = true;

    /// <summary>
    /// SMTP submission credentials. For Amazon SES these are the SES SMTP username/password
    /// pair, which are derived from an IAM key and are *not* the IAM key itself. Both blank
    /// means anonymous submission, which is only ever right for a local capture server.
    /// </summary>
    public string? SmtpUsername { get; set; }

    public string? SmtpPassword { get; set; }

    /// <summary>
    /// Amazon SES configuration set to attribute this product's sends to, or null/blank for
    /// none. Emitted as the <c>X-SES-CONFIGURATION-SET</c> header on every outbound message.
    ///
    /// <para>
    /// **What it buys.** SES scores bounce and complaint rates against the AWS ACCOUNT, and
    /// this account is shared with five other TIMS products. Without a configuration set,
    /// a bounce caused here is indistinguishable from one caused by any of them: it degrades
    /// a reputation nobody can attribute and nobody can defend. Naming a configuration set
    /// makes this product's sends separately measurable, and is the hook SES publishes
    /// bounce/complaint events through.
    /// </para>
    /// <para>
    /// **Optional on purpose, and absent must keep working.** Local development against
    /// MailHog, CI, the integration suite and any non-SES provider have no configuration set
    /// and must not acquire a meaningless header. So this is the one Email setting that stays
    /// optional even when <see cref="Provider"/> is <see cref="ProviderSmtp"/> -- unlike
    /// <see cref="SmtpHost"/> or <see cref="FromAddress"/>, mail sent without it is still
    /// correctly delivered mail. What IS validated is that a value, if given, is a legal
    /// header value; see <see cref="Validate"/>.
    /// </para>
    /// <para>
    /// Named for SES rather than generically because the header is: SendGrid, Postmark and
    /// Mailgun each have their own, differently-shaped equivalent, and a setting called
    /// "ConfigurationSet" that silently does nothing on four of the five providers this
    /// transport supports would be worse than one that says which provider it is for.
    /// </para>
    /// </summary>
    public string? SesConfigurationSet { get; set; }

    public int MaxSendsPerSecond { get; set; } = DefaultMaxSendsPerSecond;

    public int TimeoutSeconds { get; set; } = DefaultTimeoutSeconds;

    /// <summary>
    /// <see cref="Provider"/> with blank treated as <see cref="ProviderNone"/>.
    ///
    /// Blank is "not set", not a fourth provider. This is the one place the repo's usual
    /// "empty string means a forgotten secret, so fail" reading is deliberately inverted, and
    /// the reason is that mail is optional: an <c>Email__Provider=</c> that arrives empty from
    /// an environment variable should leave the service running with the stub -- announced by
    /// the startup warning -- rather than refuse to boot over a setting nothing requires.
    /// A misspelled provider is a different matter and is still rejected.
    /// </summary>
    private string NormalisedProvider
        => string.IsNullOrWhiteSpace(Provider) ? ProviderNone : Provider.Trim();

    /// <summary>True when a real provider is selected. False means the logging stub stays registered.</summary>
    public bool IsConfigured
        => string.Equals(NormalisedProvider, ProviderSmtp, StringComparison.OrdinalIgnoreCase);

    /// <summary>
    /// The reason this configuration cannot start a host, or null when it can.
    ///
    /// Returned rather than thrown so the same rule can be unit-tested without booting a
    /// host; Program.cs turns a non-null result into the <c>InvalidOperationException</c>
    /// that <c>.ValidateOnStart()</c> surfaces.
    /// </summary>
    public string? Validate()
    {
        var provider = NormalisedProvider;

        if (!KnownProviders.Contains(provider, StringComparer.OrdinalIgnoreCase))
        {
            // Not silently treated as "none": a typo'd provider name is someone trying to
            // turn mail on, and falling back to the stub would hide that from them forever.
            return $"Unknown Email:Provider '{provider}'. Supported: {string.Join(", ", KnownProviders)}.";
        }

        if (!IsConfigured)
        {
            return null;
        }

        if (string.IsNullOrWhiteSpace(SmtpHost))
        {
            return $"Missing Email:SmtpHost configuration (required because Email:Provider is '{ProviderSmtp}').";
        }

        if (string.IsNullOrWhiteSpace(FromAddress))
        {
            return $"Missing Email:FromAddress configuration (required because Email:Provider is '{ProviderSmtp}').";
        }

        if (string.IsNullOrWhiteSpace(AppBaseUrl))
        {
            return $"Missing Email:AppBaseUrl configuration (required because Email:Provider is '{ProviderSmtp}'; outbound mail links are built from it).";
        }

        if (!Uri.TryCreate(AppBaseUrl, UriKind.Absolute, out var baseUri)
            || (baseUri.Scheme != Uri.UriSchemeHttp && baseUri.Scheme != Uri.UriSchemeHttps))
        {
            return "Email:AppBaseUrl must be an absolute http or https URL.";
        }

        if (SmtpPort is < 1 or > 65535)
        {
            return $"Email:SmtpPort must be between 1 and 65535 (got {SmtpPort}).";
        }

        if (MaxSendsPerSecond < 1)
        {
            return $"Email:MaxSendsPerSecond must be at least 1 (got {MaxSendsPerSecond}).";
        }

        if (TimeoutSeconds < 1)
        {
            return $"Email:TimeoutSeconds must be at least 1 (got {TimeoutSeconds}).";
        }

        // Config, not user input -- but it is written verbatim into a MIME header, and the
        // one thing a header value must not contain is a line break. An operator who pastes a
        // value with a stray newline would otherwise be injecting headers into every message
        // this service sends, from the deploy template. Caught at startup, where a bad deploy
        // is meant to fail, rather than per message.
        if (!string.IsNullOrWhiteSpace(SesConfigurationSet) && EmailMessage.HasHeaderInjection(SesConfigurationSet))
        {
            return "Email:SesConfigurationSet must not contain a line break.";
        }

        // A username with no password (or the reverse) is a half-entered secret, not a
        // request for anonymous submission. Anonymous is both blank.
        if (string.IsNullOrWhiteSpace(SmtpUsername) != string.IsNullOrWhiteSpace(SmtpPassword))
        {
            return "Email:SmtpUsername and Email:SmtpPassword must be set together, or both left empty for anonymous submission.";
        }

        return null;
    }

    /// <summary>
    /// <paramref name="path"/> resolved against <see cref="AppBaseUrl"/>, with exactly one
    /// separating slash however the configured base URL is punctuated.
    /// </summary>
    public string LinkTo(string path)
    {
        ArgumentNullException.ThrowIfNull(path);

        var baseUrl = (AppBaseUrl ?? string.Empty).TrimEnd('/');
        return $"{baseUrl}/{path.TrimStart('/')}";
    }
}
