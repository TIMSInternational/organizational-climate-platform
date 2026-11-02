using System.Security.Cryptography;
using System.Security.Cryptography.X509Certificates;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;

namespace ClimateProject.Application.Email;

/// <summary>
/// One Amazon SNS HTTP(S) delivery, as it arrives in the request body.
/// </summary>
/// <remarks>
/// Field names and the string that is signed are AWS's, documented under "Verifying the
/// signatures of Amazon SNS messages". Nothing here is optional in the sense of "may be
/// trusted without": a message is acted on only after <see cref="SnsMessageVerification.IsAuthentic"/>.
/// </remarks>
public sealed record SnsMessage(
    string Type,
    string MessageId,
    string TopicArn,
    string Message,
    string Timestamp,
    string SignatureVersion,
    string Signature,
    string SigningCertUrl,
    string? Subject,
    string? Token,
    string? SubscribeUrl);

/// <summary>
/// Whether a body that claims to be from Amazon SNS really is — hand-written rather than taken
/// from the AWS SDK, because the solution carries no AWS package and the procurement rule
/// (<c>docs/decisions/pdf-rendering.md</c>) asks for a reason that survives review before adding
/// one. The algorithm is short and fully specified; the tests sign with a throwaway key.
/// </summary>
/// <remarks>
/// <para>
/// <b>Three checks, all required.</b> The certificate URL must be HTTPS on an
/// <c>sns.&lt;region&gt;.amazonaws.com</c> host, so a forged message cannot point at a
/// certificate its author controls. The signature must verify against that certificate's
/// public key over the canonical string. And the topic must be the one this deployment was
/// configured to listen to — a valid message from somebody else's topic is still not ours.
/// </para>
/// <para>
/// <b>Signature versions.</b> "1" is SHA1withRSA, "2" is SHA256withRSA. Anything else is
/// refused rather than guessed at.
/// </para>
/// </remarks>
public static partial class SnsMessageVerification
{
    [GeneratedRegex(@"^sns\.[a-z0-9-]+\.amazonaws\.com$", RegexOptions.CultureInvariant)]
    private static partial Regex SnsHost();

    /// <summary>An HTTPS URL on an SNS endpoint host, with nothing that could redirect it elsewhere.</summary>
    public static bool IsSnsUrl(string? url)
    {
        if (!Uri.TryCreate(url, UriKind.Absolute, out var uri))
        {
            return false;
        }

        return uri.Scheme == Uri.UriSchemeHttps
            && uri.IsDefaultPort
            && string.IsNullOrEmpty(uri.UserInfo)
            && SnsHost().IsMatch(uri.Host);
    }

    /// <summary>The certificate URL is an SNS host AND names a .pem file.</summary>
    public static bool IsSnsCertificateUrl(string? url)
        => IsSnsUrl(url) && Uri.TryCreate(url, UriKind.Absolute, out var uri)
            && uri.AbsolutePath.EndsWith(".pem", StringComparison.Ordinal);

    /// <summary>Reads the body; null when it is not an SNS message at all.</summary>
    public static SnsMessage? Parse(string body)
    {
        try
        {
            using var document = JsonDocument.Parse(body);
            var root = document.RootElement;
            if (root.ValueKind != JsonValueKind.Object)
            {
                return null;
            }

            string? Get(string name)
                => root.TryGetProperty(name, out var value) && value.ValueKind == JsonValueKind.String
                    ? value.GetString()
                    : null;

            if (Get("Type") is not { } type
                || Get("MessageId") is not { } id
                || Get("TopicArn") is not { } topic
                || Get("Message") is not { } message
                || Get("Timestamp") is not { } timestamp
                || Get("SignatureVersion") is not { } version
                || Get("Signature") is not { } signature
                || Get("SigningCertURL") is not { } certificate)
            {
                return null;
            }

            return new SnsMessage(
                type, id, topic, message, timestamp, version, signature, certificate,
                Get("Subject"), Get("Token"), Get("SubscribeURL"));
        }
        catch (JsonException)
        {
            return null;
        }
    }

    /// <summary>
    /// The canonical string AWS signs: selected fields as <c>Name\nValue\n</c> pairs in byte
    /// order of the name. A notification without a subject leaves the Subject pair out entirely.
    /// </summary>
    public static string? StringToSign(SnsMessage message)
    {
        ArgumentNullException.ThrowIfNull(message);
        var builder = new StringBuilder();
        void Add(string name, string value) => builder.Append(name).Append('\n').Append(value).Append('\n');

        switch (message.Type)
        {
            case "Notification":
                Add("Message", message.Message);
                Add("MessageId", message.MessageId);
                if (message.Subject is not null)
                {
                    Add("Subject", message.Subject);
                }

                Add("Timestamp", message.Timestamp);
                Add("TopicArn", message.TopicArn);
                Add("Type", message.Type);
                return builder.ToString();

            case "SubscriptionConfirmation":
            case "UnsubscribeConfirmation":
                if (message.SubscribeUrl is null || message.Token is null)
                {
                    return null;
                }

                Add("Message", message.Message);
                Add("MessageId", message.MessageId);
                Add("SubscribeURL", message.SubscribeUrl);
                Add("Timestamp", message.Timestamp);
                Add("Token", message.Token);
                Add("TopicArn", message.TopicArn);
                Add("Type", message.Type);
                return builder.ToString();

            default:
                return null;
        }
    }

    /// <summary>Whether <paramref name="message"/> was signed by the key in <paramref name="certificate"/>.</summary>
    public static bool IsSignatureValid(SnsMessage message, X509Certificate2 certificate)
    {
        ArgumentNullException.ThrowIfNull(message);
        ArgumentNullException.ThrowIfNull(certificate);

        var algorithm = message.SignatureVersion switch
        {
            "1" => HashAlgorithmName.SHA1,
            "2" => HashAlgorithmName.SHA256,
            _ => (HashAlgorithmName?)null,
        };
        if (algorithm is null || StringToSign(message) is not { } canonical)
        {
            return false;
        }

        byte[] signature;
        try
        {
            signature = Convert.FromBase64String(message.Signature);
        }
        catch (FormatException)
        {
            return false;
        }

        using var rsa = certificate.GetRSAPublicKey();
        return rsa is not null
            && rsa.VerifyData(Encoding.UTF8.GetBytes(canonical), signature, algorithm.Value, RSASignaturePadding.Pkcs1);
    }
}
