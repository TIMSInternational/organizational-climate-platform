using System.Collections.Concurrent;
using System.Security.Cryptography.X509Certificates;
using ClimateProject.Application.Email;
using Microsoft.Extensions.Logging;

namespace ClimateProject.Api.Infrastructure;

/// <summary>
/// Downloads SNS signing certificates over HTTPS and keeps them in memory.
/// </summary>
/// <remarks>
/// <para>
/// <b>Only SNS hosts, checked again here.</b> The webhook checks the URL before calling, and so does
/// this: the class is the thing that makes the outbound request, so it is the one that must not be
/// talked into fetching anything else.
/// </para>
/// <para>
/// <b>Cached, with a ceiling.</b> SNS signs with a handful of certificates that rotate rarely, so a
/// cache turns every message after the first into no network call at all. The ceiling is what
/// keeps a stream of valid-looking URLs from growing it without bound; past it the cache is simply
/// cleared, which costs one download and nothing else.
/// </para>
/// </remarks>
public sealed class HttpSnsCertificateSource(IHttpClientFactory httpClientFactory, ILogger<HttpSnsCertificateSource> logger)
    : ISnsCertificateSource
{
    public const string HttpClientName = "sns";
    private const int MaxCached = 16;

    private static readonly ConcurrentDictionary<string, X509Certificate2> Cache = new(StringComparer.Ordinal);

    public async Task<X509Certificate2?> GetAsync(string certificateUrl, CancellationToken cancellationToken)
    {
        if (!SnsMessageVerification.IsSnsCertificateUrl(certificateUrl))
        {
            return null;
        }

        if (Cache.TryGetValue(certificateUrl, out var cached))
        {
            return cached;
        }

        try
        {
            using var client = httpClientFactory.CreateClient(HttpClientName);
            var pem = await client.GetStringAsync(new Uri(certificateUrl), cancellationToken).ConfigureAwait(false);
            var certificate = X509Certificate2.CreateFromPem(pem);
            if (Cache.Count >= MaxCached)
            {
                Cache.Clear();
            }

            Cache[certificateUrl] = certificate;
            return certificate;
        }
        catch (Exception exception) when (exception is HttpRequestException or TaskCanceledException or System.Security.Cryptography.CryptographicException)
        {
            logger.LogWarning(exception, "SNS signing certificate could not be fetched from {Url}", certificateUrl);
            return null;
        }
    }
}

/// <summary>Visits an SNS <c>SubscribeURL</c> to confirm the subscription.</summary>
public sealed class HttpSnsSubscriptionConfirmer(IHttpClientFactory httpClientFactory, ILogger<HttpSnsSubscriptionConfirmer> logger)
    : ISnsSubscriptionConfirmer
{
    public async Task<bool> ConfirmAsync(string subscribeUrl, CancellationToken cancellationToken)
    {
        // The same host rule as the certificate: a SubscribeURL that is not an SNS endpoint is a
        // request to make this server visit somewhere else, and it is refused.
        if (!SnsMessageVerification.IsSnsUrl(subscribeUrl))
        {
            return false;
        }

        try
        {
            using var client = httpClientFactory.CreateClient(HttpSnsCertificateSource.HttpClientName);
            using var response = await client.GetAsync(new Uri(subscribeUrl), cancellationToken).ConfigureAwait(false);
            return response.IsSuccessStatusCode;
        }
        catch (Exception exception) when (exception is HttpRequestException or TaskCanceledException)
        {
            logger.LogWarning(exception, "SNS subscription could not be confirmed");
            return false;
        }
    }
}
