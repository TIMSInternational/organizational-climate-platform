using System.Security.Cryptography;
using System.Security.Cryptography.X509Certificates;
using System.Text;
using System.Text.Json;
using ClimateProject.Application.Email;

namespace ClimateProject.UnitTests.Email;

/// <summary>
/// The SNS signature check behind <c>POST /webhooks/ses</c> — the only thing standing between an
/// anonymous route and the database, so every way it can say yes is pinned.
/// </summary>
/// <remarks>
/// Signed with a key generated here. The real certificate is downloaded from AWS, and a test that
/// needs the network to prove a signature is not a test.
/// </remarks>
public class SnsMessageVerificationTests
{
    private const string Topic = "arn:aws:sns:us-east-1:747814092517:tims-ses-transactional-events";
    private const string CertUrl = "https://sns.us-east-1.amazonaws.com/SimpleNotificationService-0000.pem";

    private static (RSA Signer, X509Certificate2 Cert) NewKey()
    {
        var key = RSA.Create(2048);
        var request = new CertificateRequest("CN=sns.test", key, HashAlgorithmName.SHA256, RSASignaturePadding.Pkcs1);
        return (key, request.CreateSelfSigned(DateTimeOffset.UtcNow.AddDays(-1), DateTimeOffset.UtcNow.AddDays(1)));
    }

    private static SnsMessage Notification(string message = "{\"eventType\":\"Bounce\"}", string? subject = null, string version = "2")
        => new("Notification", "5f1c-1", Topic, message, "2026-11-02T19:40:58.000Z", version, "", CertUrl, subject, null, null);

    private static SnsMessage Signed(SnsMessage message, RSA key)
    {
        var algorithm = message.SignatureVersion == "1" ? HashAlgorithmName.SHA1 : HashAlgorithmName.SHA256;
        var signature = key.SignData(
            Encoding.UTF8.GetBytes(SnsMessageVerification.StringToSign(message)!), algorithm, RSASignaturePadding.Pkcs1);
        return message with { Signature = Convert.ToBase64String(signature) };
    }

    [Theory]
    [InlineData("1")]
    [InlineData("2")]
    public void A_message_signed_by_the_certificates_key_verifies(string version)
    {
        var (key, certificate) = NewKey();
        var message = Signed(Notification(version: version), key);

        Assert.True(SnsMessageVerification.IsSignatureValid(message, certificate));
    }

    [Fact]
    public void A_message_changed_after_signing_does_not_verify()
    {
        var (key, certificate) = NewKey();
        var message = Signed(Notification(), key) with { Message = "{\"eventType\":\"Delivery\"}" };

        Assert.False(SnsMessageVerification.IsSignatureValid(message, certificate));
    }

    [Fact]
    public void A_message_signed_by_another_key_does_not_verify()
    {
        var (key, _) = NewKey();
        var (_, other) = NewKey();

        Assert.False(SnsMessageVerification.IsSignatureValid(Signed(Notification(), key), other));
    }

    [Theory]
    [InlineData("0")]
    [InlineData("3")]
    [InlineData("")]
    public void A_signature_version_aws_does_not_define_is_refused(string version)
    {
        var (key, certificate) = NewKey();
        // Signed with SHA256, then relabelled: only "1" and "2" may say which hash was used.
        var message = Signed(Notification(), key) with { SignatureVersion = version };

        Assert.False(SnsMessageVerification.IsSignatureValid(message, certificate));
    }

    [Fact]
    public void A_signature_that_is_not_base64_is_refused_rather_than_thrown()
    {
        var (_, certificate) = NewKey();

        Assert.False(SnsMessageVerification.IsSignatureValid(Notification() with { Signature = "not base64!" }, certificate));
    }

    [Fact]
    public void The_subject_is_signed_only_when_the_message_has_one()
    {
        Assert.DoesNotContain("Subject\n", SnsMessageVerification.StringToSign(Notification()), StringComparison.Ordinal);
        Assert.Contains("Subject\nBounce\n", SnsMessageVerification.StringToSign(Notification(subject: "Bounce")), StringComparison.Ordinal);
    }

    [Fact]
    public void A_subscription_confirmation_signs_its_subscribe_url_and_token()
    {
        var confirmation = new SnsMessage(
            "SubscriptionConfirmation", "c-1", Topic, "You have chosen to subscribe", "2026-11-02T19:00:00.000Z", "2",
            "", CertUrl, null, "tok-123", "https://sns.us-east-1.amazonaws.com/?Action=ConfirmSubscription&Token=tok-123");

        var canonical = SnsMessageVerification.StringToSign(confirmation)!;
        Assert.Contains("SubscribeURL\nhttps://sns.us-east-1.amazonaws.com/?Action=ConfirmSubscription&Token=tok-123\n", canonical, StringComparison.Ordinal);
        Assert.Contains("Token\ntok-123\n", canonical, StringComparison.Ordinal);

        // Without the two fields it cannot be signed at all, so it cannot verify.
        Assert.Null(SnsMessageVerification.StringToSign(confirmation with { Token = null }));
    }

    [Theory]
    [InlineData("https://sns.us-east-1.amazonaws.com/SimpleNotificationService-0000.pem", true)]
    [InlineData("https://sns.eu-west-2.amazonaws.com/SimpleNotificationService-abc.pem", true)]
    [InlineData("http://sns.us-east-1.amazonaws.com/SimpleNotificationService-0000.pem", false)]
    [InlineData("https://sns.us-east-1.amazonaws.com.attacker.test/cert.pem", false)]
    [InlineData("https://attacker.test/sns.us-east-1.amazonaws.com/cert.pem", false)]
    [InlineData("https://user@sns.us-east-1.amazonaws.com/cert.pem", false)]
    [InlineData("https://sns.us-east-1.amazonaws.com:8443/cert.pem", false)]
    [InlineData("https://sns.us-east-1.amazonaws.com/cert.txt", false)]
    [InlineData("https://s3.amazonaws.com/cert.pem", false)]
    [InlineData("", false)]
    [InlineData(null, false)]
    public void Only_an_https_pem_on_an_sns_host_counts_as_a_signing_certificate(string? url, bool expected)
        => Assert.Equal(expected, SnsMessageVerification.IsSnsCertificateUrl(url));

    [Fact]
    public void A_body_missing_a_required_field_or_not_json_is_not_a_message()
    {
        var full = new Dictionary<string, string>
        {
            ["Type"] = "Notification", ["MessageId"] = "m", ["TopicArn"] = Topic, ["Message"] = "{}",
            ["Timestamp"] = "2026-11-02T00:00:00Z", ["SignatureVersion"] = "2", ["Signature"] = "x", ["SigningCertURL"] = CertUrl,
        };
        Assert.NotNull(SnsMessageVerification.Parse(JsonSerializer.Serialize(full)));

        foreach (var field in full.Keys)
        {
            var missing = full.Where(kv => kv.Key != field).ToDictionary();
            Assert.Null(SnsMessageVerification.Parse(JsonSerializer.Serialize(missing)));
        }

        Assert.Null(SnsMessageVerification.Parse("not json"));
        Assert.Null(SnsMessageVerification.Parse("[]"));
    }
}
