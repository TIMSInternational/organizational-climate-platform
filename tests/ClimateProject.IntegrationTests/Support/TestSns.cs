using System.Collections.Concurrent;
using System.Security.Cryptography;
using System.Security.Cryptography.X509Certificates;
using System.Text;
using System.Text.Json;
using ClimateProject.Application.Email;

namespace ClimateProject.IntegrationTests.Support;

/// <summary>
/// An SNS stand-in for the bounce webhook: a topic, a signing key this test assembly owns, and the
/// certificate URL that resolves to it. The shared host is configured with all three, so a test
/// can post a message exactly as SNS would — signed — and one SNS would never send.
/// </summary>
public static class TestSns
{
    public const string TopicArn = "arn:aws:sns:us-east-1:000000000000:climate-tests-ses-events";
    public const string CertificateUrl = "https://sns.us-east-1.amazonaws.com/SimpleNotificationService-tests.pem";

    private static readonly RSA Key = RSA.Create(2048);

    public static readonly X509Certificate2 Certificate = new CertificateRequest(
            "CN=sns.tests", Key, HashAlgorithmName.SHA256, RSASignaturePadding.Pkcs1)
        .CreateSelfSigned(DateTimeOffset.UtcNow.AddDays(-1), DateTimeOffset.UtcNow.AddYears(1));

    /// <summary>Every SubscribeURL the host visited, in order.</summary>
    public static ConcurrentQueue<string> Confirmed { get; } = new();

    /// <summary>An SES event body, tagged as this product's mail unless told otherwise.</summary>
    public static string BounceEvent(string recipient, string bounceType = "Permanent", string reply = "smtp; 550 5.1.1 user unknown", bool tagged = true)
        => JsonSerializer.Serialize(new
        {
            eventType = "Bounce",
            bounce = new
            {
                bounceType,
                bounceSubType = "General",
                bouncedRecipients = new[] { new { emailAddress = recipient, diagnosticCode = reply } },
                timestamp = "2026-11-02T19:41:00.000Z",
            },
            mail = new
            {
                messageId = "0100-" + Guid.NewGuid().ToString("N"),
                tags = tagged
                    ? new Dictionary<string, string[]> { ["ses:configuration-set"] = ["tims-transactional"], ["app"] = ["climate"] }
                    : new Dictionary<string, string[]> { ["ses:configuration-set"] = ["tims-transactional"] },
            },
        });

    /// <summary>A signed SNS Notification carrying <paramref name="sesEvent"/>.</summary>
    public static string Notification(string sesEvent, string? messageId = null, string topic = TopicArn, string certificateUrl = CertificateUrl, RSA? signer = null)
    {
        var message = new SnsMessage(
            "Notification", messageId ?? Guid.NewGuid().ToString(), topic, sesEvent, "2026-11-02T19:41:02.000Z", "2", "",
            certificateUrl, null, null, null);
        return Serialize(Sign(message, signer ?? Key));
    }

    /// <summary>A signed SubscriptionConfirmation.</summary>
    public static string Confirmation(string subscribeUrl)
    {
        var message = new SnsMessage(
            "SubscriptionConfirmation", Guid.NewGuid().ToString(), TopicArn, "You have chosen to subscribe to the topic.",
            "2026-11-02T19:00:00.000Z", "2", "", CertificateUrl, null, "tok-" + Guid.NewGuid().ToString("N"), subscribeUrl);
        return Serialize(Sign(message, Key));
    }

    private static SnsMessage Sign(SnsMessage message, RSA key)
        => message with
        {
            Signature = Convert.ToBase64String(key.SignData(
                Encoding.UTF8.GetBytes(SnsMessageVerification.StringToSign(message)!), HashAlgorithmName.SHA256, RSASignaturePadding.Pkcs1)),
        };

    private static string Serialize(SnsMessage m)
    {
        var body = new Dictionary<string, string?>
        {
            ["Type"] = m.Type, ["MessageId"] = m.MessageId, ["TopicArn"] = m.TopicArn, ["Message"] = m.Message,
            ["Timestamp"] = m.Timestamp, ["SignatureVersion"] = m.SignatureVersion, ["Signature"] = m.Signature,
            ["SigningCertURL"] = m.SigningCertUrl,
        };
        if (m.Token is not null) body["Token"] = m.Token;
        if (m.SubscribeUrl is not null) body["SubscribeURL"] = m.SubscribeUrl;
        return JsonSerializer.Serialize(body);
    }
}

/// <summary>Serves <see cref="TestSns.Certificate"/> for its URL and nothing for any other.</summary>
public sealed class TestSnsCertificateSource : ISnsCertificateSource
{
    public Task<X509Certificate2?> GetAsync(string certificateUrl, CancellationToken cancellationToken)
        => Task.FromResult(certificateUrl == TestSns.CertificateUrl ? TestSns.Certificate : null);
}

/// <summary>Records the visit instead of calling AWS.</summary>
public sealed class RecordingSnsConfirmer : ISnsSubscriptionConfirmer
{
    public Task<bool> ConfirmAsync(string subscribeUrl, CancellationToken cancellationToken)
    {
        TestSns.Confirmed.Enqueue(subscribeUrl);
        return Task.FromResult(true);
    }
}
