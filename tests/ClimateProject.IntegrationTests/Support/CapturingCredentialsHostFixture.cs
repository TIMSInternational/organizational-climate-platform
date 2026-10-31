using System.Collections.Concurrent;
using ClimateProject.Application.Email;
using ClimateProject.Application.OrgStructure;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;

namespace ClimateProject.IntegrationTests.Support;

/// <summary>
/// What the product handed to the credentials email, for one person. <paramref name="Purpose"/> is
/// recorded because it is the only observable difference between an invitation and a reminder: the
/// pair is identical, so a test that did not read it could not tell which message went out.
/// </summary>
public sealed record SentCredentials(
    string ToEmail, string Username, string Password, string? Language, CredentialsEmailPurpose Purpose,
    string? RecipientName,
    /// <summary>
    /// Which survey these details open, or null when they open every survey the holder is
    /// targeted by. Captured so a test can prove the two messages one person receives for
    /// two surveys are actually distinguishable -- which is the whole requirement.
    /// </summary>
    string? SurveyName = null,
    /// <summary>The company as the mail will name it, for the same reason.</summary>
    string? CompanyName = null);

/// <summary>
/// A host whose <see cref="ICredentialsEmailSender"/> records instead of sending.
///
/// <para>
/// A mass invite puts the generated password in exactly one place -- the email -- so a test that
/// signs in as an imported person has to read it from there. The shared host registers the real
/// sender, and with no mail provider configured that is the logging stub, which composes nothing:
/// on it, "the person signs in with what the email gave them" is not merely unproven, it is
/// unobservable.
/// </para>
/// </summary>
/// <summary>
/// What the product handed to the no-password reminder, for one person. There is deliberately
/// no password field: the sender has no parameter for one, and a capture record that could hold
/// a password would make "no password was sent" unprovable in exactly the place it matters.
/// </summary>
public sealed record SentReminder(
    string ToEmail, string Username, string? Language, string? RecipientName,
    string? SurveyName = null, string? CompanyName = null);

public sealed class CapturingCredentialsFactory(string connectionString, ConcurrentQueue<SentCredentials> sent, ConcurrentBag<string> failFor, ConcurrentQueue<SentReminder> reminders)
    : AuthWebApplicationFactory(connectionString)
{
    public ConcurrentQueue<SentCredentials> Sent { get; } = sent;

    /// <summary>Reminders this host recorded instead of sending. Separate queue, separate type.</summary>
    public ConcurrentQueue<SentReminder> Reminders { get; } = reminders;

    /// <summary>Recipients this host refuses, so a row can be shown failing while its account stands.</summary>
    public ConcurrentBag<string> FailFor { get; } = failFor;

    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        base.ConfigureWebHost(builder);
        builder.ConfigureTestServices(services =>
        {
            services.RemoveAll<ICredentialsEmailSender>();
            services.AddScoped<ICredentialsEmailSender>(_ => new CapturingCredentialsSender(Sent, FailFor));
            services.RemoveAll<ISurveyReminderEmailSender>();
            services.AddScoped<ISurveyReminderEmailSender>(_ => new CapturingSurveyReminderSender(Reminders, FailFor));
        });
    }
}

internal sealed class CapturingSurveyReminderSender(ConcurrentQueue<SentReminder> reminders, ConcurrentBag<string> failFor)
    : ISurveyReminderEmailSender
{
    public Task<EmailSendOutcome> SendAsync(
        string toEmail, string? recipientName, string username, string? companyLanguage,
        EmailBrand? brand, string? surveyName, CancellationToken cancellationToken)
    {
        if (failFor.Contains(toEmail))
        {
            return Task.FromResult(EmailSendOutcome.PermanentFailure("refused for the test"));
        }

        reminders.Enqueue(new SentReminder(
            toEmail, username, companyLanguage, recipientName, surveyName, brand?.CompanyName));
        return Task.FromResult(EmailSendOutcome.Success());
    }
}

internal sealed class CapturingCredentialsSender(ConcurrentQueue<SentCredentials> sent, ConcurrentBag<string> failFor)
    : ICredentialsEmailSender
{
    public Task<EmailSendOutcome> SendAsync(
        string toEmail, string? recipientName, string username, string password, string? companyLanguage,
        EmailBrand? brand, CredentialsEmailPurpose purpose, string? surveyName, CancellationToken cancellationToken)
    {
        if (failFor.Contains(toEmail))
        {
            return Task.FromResult(EmailSendOutcome.PermanentFailure("refused for the test"));
        }

        sent.Enqueue(new SentCredentials(
            toEmail, username, password, companyLanguage, purpose, recipientName, surveyName, brand?.CompanyName));
        return Task.FromResult(EmailSendOutcome.Success());
    }
}

/// <summary>
/// Holds the credentials-capturing host, ONE for the whole run.
///
/// <para>
/// The host, the record and the refusal list are <b>static</b>, for the reason
/// <see cref="CapturingMailHostFixture"/> gives: xUnit constructs a class fixture per class and
/// an <see cref="IAsyncLifetime"/> class once per <c>[Fact]</c>, while every host is billed
/// against <see cref="AuthWebApplicationFactory.HostBudget"/>. Building one in
/// <c>InitializeAsync</c> is therefore one host per test CASE -- which is exactly the #279
/// defect, and what this type exists to make impossible.
/// </para>
/// <para>
/// Sharing the record is safe in the only way that matters. Every test filters by its own
/// recipient address, those addresses are GUID-derived and unique per test, and every class
/// using this sits in the <c>Postgres</c> collection, which xUnit runs one class at a time -- so
/// no two writers race it.
/// </para>
/// </summary>
public sealed class CapturingCredentialsHostFixture : IDisposable
{
    private static readonly Lock Gate = new();
    private static readonly ConcurrentQueue<SentCredentials> SharedSent = new();
    private static readonly ConcurrentQueue<SentReminder> SharedReminders = new();
    private static readonly ConcurrentBag<string> SharedFailFor = [];
    private static CapturingCredentialsFactory? _factory;

    public CapturingCredentialsFactory HostFor(string connectionString)
    {
        lock (Gate)
        {
            return _factory ??= new CapturingCredentialsFactory(connectionString, SharedSent, SharedFailFor, SharedReminders);
        }
    }

    /// <summary>
    /// Deliberately empty. The host outlives any one class that uses it; disposing it when the
    /// first such class finishes would leave the next one holding a dead host, and the budget
    /// counts hosts BUILT, so rebuilding is not free.
    /// </summary>
    public void Dispose()
    {
    }
}
