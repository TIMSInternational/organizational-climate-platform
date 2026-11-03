using System.Security.Cryptography.X509Certificates;

namespace ClimateProject.Application.Email;

/// <summary>
/// The certificate SNS signed a message with, fetched from its <c>SigningCertURL</c>.
/// </summary>
/// <remarks>
/// Behind an interface so the webhook can be tested with a key the test owns: the real one is
/// downloaded from an AWS host, and a test that needs the network to prove a signature check is
/// not a test. Callers pass only URLs that already satisfy
/// <see cref="SnsMessageVerification.IsSnsCertificateUrl"/>.
/// </remarks>
public interface ISnsCertificateSource
{
    /// <returns>The certificate, or null when it could not be fetched or read.</returns>
    Task<X509Certificate2?> GetAsync(string certificateUrl, CancellationToken cancellationToken);
}

/// <summary>
/// Confirms an SNS subscription by visiting its <c>SubscribeURL</c>, which is the whole of the
/// handshake: until that GET happens, SNS sends this endpoint nothing but the confirmation.
/// </summary>
public interface ISnsSubscriptionConfirmer
{
    /// <returns>Whether SNS answered the visit with a success.</returns>
    Task<bool> ConfirmAsync(string subscribeUrl, CancellationToken cancellationToken);
}
