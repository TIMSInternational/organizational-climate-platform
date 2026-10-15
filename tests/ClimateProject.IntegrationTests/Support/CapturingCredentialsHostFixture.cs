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
    string? RecipientName);

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
public sealed class CapturingCredentialsFactory(string connectionString, ConcurrentQueue<SentCredentials> sent, ConcurrentBag<string> failFor)
    : AuthWebApplicationFactory(connectionString)
{
    public ConcurrentQueue<SentCredentials> Sent { get; } = sent;

    /// <summary>Recipients this host refuses, so a row can be shown failing while its account stands.</summary>
    public ConcurrentBag<string> FailFor { get; } = failFor;

    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        base.ConfigureWebHost(builder);
        builder.ConfigureTestServices(services =>
        {
            services.RemoveAll<ICredentialsEmailSender>();
            services.AddScoped<ICredentialsEmailSender>(_ => new CapturingCredentialsSender(Sent, FailFor));
        });
    }
}

internal sealed class CapturingCredentialsSender(ConcurrentQueue<SentCredentials> sent, ConcurrentBag<string> failFor)
    : ICredentialsEmailSender
{
    public Task<EmailSendOutcome> SendAsync(
        string toEmail, string? recipientName, string username, string password, string? companyLanguage,
        CredentialsEmailPurpose purpose, CancellationToken cancellationToken)
    {
        if (failFor.Contains(toEmail))
        {
            return Task.FromResult(EmailSendOutcome.PermanentFailure("refused for the test"));
        }

        sent.Enqueue(new SentCredentials(toEmail, username, password, companyLanguage, purpose, recipientName));
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
    private static readonly ConcurrentBag<string> SharedFailFor = [];
    private static CapturingCredentialsFactory? _factory;

    public CapturingCredentialsFactory HostFor(string connectionString)
    {
        lock (Gate)
        {
            return _factory ??= new CapturingCredentialsFactory(connectionString, SharedSent, SharedFailFor);
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
