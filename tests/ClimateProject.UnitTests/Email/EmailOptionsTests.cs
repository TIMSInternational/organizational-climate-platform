using ClimateProject.Application.Email;

namespace ClimateProject.UnitTests.Email;

/// <summary>
/// The conditional-requirement rule for mail configuration (#100).
///
/// The case this exists for is the half-configured deploy: a host with no <c>FromAddress</c>,
/// or a provider name with a typo. Both are someone turning mail *on*, and both would
/// otherwise boot into a service that reports every notification as sent and delivers none --
/// the exact failure #189 was raised about, one setting further along.
/// </summary>
public class EmailOptionsTests
{
    private static EmailOptions Smtp() => new()
    {
        Provider = EmailOptions.ProviderSmtp,
        SmtpHost = "email-smtp.us-east-1.amazonaws.com",
        FromAddress = "no-reply@example.com",
        AppBaseUrl = "https://app.example.com",
        SmtpUsername = "user",
        SmtpPassword = "secret",
    };

    [Fact]
    public void The_default_is_no_provider_and_it_is_valid()
    {
        var options = new EmailOptions();

        Assert.Equal(EmailOptions.ProviderNone, options.Provider);
        Assert.False(options.IsConfigured);

        // Local dev, CI and the integration suite all run on this. It must start.
        Assert.Null(options.Validate());
    }

    [Fact]
    public void A_fully_configured_smtp_provider_is_valid()
    {
        var options = Smtp();

        Assert.True(options.IsConfigured);
        Assert.Null(options.Validate());
    }

    [Theory]
    [InlineData("ses")]
    [InlineData("sendgrid")]
    [InlineData("smpt")]
    public void An_unknown_provider_is_rejected_rather_than_treated_as_none(string provider)
    {
        var options = new EmailOptions { Provider = provider };

        // Falling back to the stub would hide the typo from the person who made it, forever.
        Assert.Contains(provider, options.Validate());
        Assert.False(options.IsConfigured);
    }

    [Theory]
    [InlineData("")]
    [InlineData("   ")]
    [InlineData(null)]
    public void A_blank_provider_means_none_rather_than_a_failed_start(string? provider)
    {
        // The one place this repo's usual "empty string is a forgotten secret, so fail" reading
        // is deliberately inverted: mail is optional, so an Email__Provider that arrives empty
        // leaves the stub registered (announced by the startup warning) rather than refusing to
        // boot over a setting nothing requires. A *misspelled* provider is still rejected.
        var options = new EmailOptions { Provider = provider! };

        Assert.False(options.IsConfigured);
        Assert.Null(options.Validate());
    }

    [Fact]
    public void The_provider_name_is_matched_case_insensitively()
    {
        var options = Smtp();
        options.Provider = "SMTP";

        Assert.True(options.IsConfigured);
        Assert.Null(options.Validate());
    }

    [Fact]
    public void Smtp_without_a_host_fails()
    {
        var options = Smtp();
        options.SmtpHost = "   ";

        Assert.Contains("Email:SmtpHost", options.Validate());
    }

    [Fact]
    public void Smtp_without_a_from_address_fails()
    {
        var options = Smtp();
        options.FromAddress = null;

        Assert.Contains("Email:FromAddress", options.Validate());
    }

    [Fact]
    public void Smtp_without_an_app_base_url_fails()
    {
        // An invitation email whose link goes nowhere is worse than one never sent: the
        // recipient has no way to tell it is broken.
        var options = Smtp();
        options.AppBaseUrl = null;

        Assert.Contains("Email:AppBaseUrl", options.Validate());
    }

    [Theory]
    [InlineData("app.example.com")]
    [InlineData("ftp://app.example.com")]
    [InlineData("/relative")]
    public void An_app_base_url_that_is_not_an_absolute_http_url_fails(string baseUrl)
    {
        var options = Smtp();
        options.AppBaseUrl = baseUrl;

        Assert.Contains("absolute http", options.Validate());
    }

    [Theory]
    [InlineData(0)]
    [InlineData(70000)]
    public void An_out_of_range_port_fails(int port)
    {
        var options = Smtp();
        options.SmtpPort = port;

        Assert.Contains("Email:SmtpPort", options.Validate());
    }

    [Fact]
    public void A_send_rate_below_one_fails()
    {
        var options = Smtp();
        options.MaxSendsPerSecond = 0;

        Assert.Contains("Email:MaxSendsPerSecond", options.Validate());
    }

    [Fact]
    public void A_timeout_below_one_second_fails()
    {
        var options = Smtp();
        options.TimeoutSeconds = 0;

        Assert.Contains("Email:TimeoutSeconds", options.Validate());
    }

    /// <summary>
    /// The SES configuration set stays optional even with a provider configured, unlike every
    /// other SMTP setting. Mail sent without one is still correctly delivered mail; MailHog,
    /// CI and the integration suite have no configuration set to name, and requiring one
    /// would stop them booting.
    /// </summary>
    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("tims-transactional")]
    public void A_configuration_set_is_optional_with_a_provider_configured(string? configurationSet)
    {
        var options = Smtp();
        options.SesConfigurationSet = configurationSet;

        Assert.Null(options.Validate());
    }

    /// <summary>
    /// A value with a line break in it is refused at startup rather than emitted.
    ///
    /// This setting is written verbatim into a MIME header, so a pasted deploy value carrying
    /// a newline would be header injection into every message this service sends -- from the
    /// deploy template. A bad deploy is meant to fail at boot.
    /// </summary>
    [Theory]
    [InlineData("tims-transactional\r\nBcc: attacker@example.com")]
    [InlineData("tims-transactional\nBcc: attacker@example.com")]
    public void A_configuration_set_containing_a_line_break_fails(string configurationSet)
    {
        var options = Smtp();
        options.SesConfigurationSet = configurationSet;

        Assert.Contains("Email:SesConfigurationSet", options.Validate());
    }

    [Fact]
    public void A_username_without_a_password_fails_and_so_does_the_reverse()
    {
        // A half-entered credential is not a request for anonymous submission.
        var noPassword = Smtp();
        noPassword.SmtpPassword = null;
        Assert.NotNull(noPassword.Validate());

        var noUsername = Smtp();
        noUsername.SmtpUsername = null;
        Assert.NotNull(noUsername.Validate());
    }

    [Fact]
    public void Anonymous_submission_is_allowed_when_both_credentials_are_empty()
    {
        // A local capture server (MailHog, smtp4dev) needs no credentials at all.
        var options = Smtp();
        options.SmtpUsername = null;
        options.SmtpPassword = null;

        Assert.Null(options.Validate());
    }

    [Theory]
    [InlineData("https://app.example.com", "settings/notifications", "https://app.example.com/settings/notifications")]
    [InlineData("https://app.example.com/", "settings/notifications", "https://app.example.com/settings/notifications")]
    [InlineData("https://app.example.com", "/settings/notifications", "https://app.example.com/settings/notifications")]
    [InlineData("https://app.example.com/", "/settings/notifications", "https://app.example.com/settings/notifications")]
    public void LinkTo_joins_with_exactly_one_slash_however_the_base_url_is_punctuated(
        string baseUrl, string path, string expected)
    {
        var options = Smtp();
        options.AppBaseUrl = baseUrl;

        Assert.Equal(expected, options.LinkTo(path));
    }

    [Fact]
    public void Default_send_rate_leaves_headroom_under_the_SES_production_limit()
    {
        // SES's default production sending rate is 14/second and it returns 454 above it.
        // Pacing at the limit leaves no room for a second instance.
        Assert.True(EmailOptions.DefaultMaxSendsPerSecond < 14);
    }
}
