using Microsoft.AspNetCore.Http.Features;
using Microsoft.Extensions.Options;

namespace ClimateProject.Api.Infrastructure;

/// <summary>
/// Response-header and request-size settings, bound from the <c>Security</c> configuration
/// section. Defaults are the safe ones, so an unconfigured deployment is hardened rather
/// than open; the one setting that cannot be defaulted on is HSTS -- see
/// <see cref="EnableHsts"/>.
/// </summary>
public sealed class SecurityOptions
{
    /// <summary>
    /// Whether to emit <c>Strict-Transport-Security</c>.
    ///
    /// <para>
    /// Off by default, and NOT derived from <c>Request.IsHttps</c> the way
    /// <c>app.UseHsts()</c> derives it. Behind App Runner TLS terminates at the AWS proxy
    /// and the container is spoken to over plain HTTP, so <c>Request.IsHttps</c> is false in
    /// exactly the deployment that needs the header -- <c>UseHsts()</c> would emit nothing
    /// there while looking like it worked. An explicit per-deployment switch is the only
    /// version of this that is honest about what it does.
    /// </para>
    /// </summary>
    public bool EnableHsts { get; set; }

    /// <summary>Max-age, in seconds, for the HSTS header. Two years, the usual preload value.</summary>
    public int HstsMaxAgeSeconds { get; set; } = 63072000;

    /// <summary>
    /// Default ceiling on a request body, in bytes. 4 MiB: an order of magnitude above the
    /// largest JSON this API accepts (a bilingual survey with its full question set) and far
    /// below Kestrel's 30 MiB default, which is what an attacker would otherwise get to send
    /// to any of the unauthenticated endpoints.
    /// </summary>
    public long MaxRequestBodyBytes { get; set; } = 4L * 1024 * 1024;

    /// <summary>
    /// Ceiling for routes marked with <see cref="LargeRequestBodyMetadata"/> -- today only
    /// <c>POST /admin/users/bulk-import</c>, which takes a CSV upload and legitimately needs
    /// more than the default. 32 MiB.
    /// </summary>
    public long MaxUploadBodyBytes { get; set; } = 32L * 1024 * 1024;
}

/// <summary>
/// Endpoint metadata opting a route into <see cref="SecurityOptions.MaxUploadBodyBytes"/>
/// instead of the default ceiling. Attached with <c>.WithMetadata(new LargeRequestBodyMetadata())</c>.
/// </summary>
public sealed class LargeRequestBodyMetadata;

/// <summary>
/// The two pieces of pipeline hardening added by #146 that are not rate limiting: security
/// response headers, and a request-body ceiling.
/// </summary>
public static class SecurityHardening
{
    public static void AddClimateProjectSecurityOptions(this IServiceCollection services)
    {
        ArgumentNullException.ThrowIfNull(services);

        services.AddOptions<SecurityOptions>()
            .Configure<IConfiguration>((options, configuration) => configuration.GetSection("Security").Bind(options))
            .Validate(
                options => options.MaxRequestBodyBytes > 0
                    && options.MaxUploadBodyBytes >= options.MaxRequestBodyBytes
                    && options.HstsMaxAgeSeconds > 0,
                "Security:MaxRequestBodyBytes and Security:HstsMaxAgeSeconds must be positive, and "
                + "Security:MaxUploadBodyBytes must not be below Security:MaxRequestBodyBytes.")
            .ValidateOnStart();
    }

    /// <summary>
    /// Adds the headers that cost nothing on a JSON API and close the cheap classes of
    /// attack against whatever renders its responses.
    ///
    /// <para>
    /// The CSP is <c>default-src 'none'</c> because this service returns JSON and one
    /// redirect and never HTML: there is no script, style, image or frame for a policy to
    /// permit. <c>frame-ancestors 'none'</c> and <c>X-Frame-Options: DENY</c> say the same
    /// thing to new and old browsers respectively. <c>Referrer-Policy: no-referrer</c>
    /// matters here specifically because several URLs in this API carry a bearer token in
    /// the path (<c>/invitations/{token}/accept</c>, <c>/survey-links/{token}</c>) and a
    /// referrer would leak it to whatever the browser navigates to next.
    /// </para>
    /// <para>
    /// Registered with <c>OnStarting</c> rather than by writing headers after
    /// <c>await next()</c>: once a response has begun the header collection is read-only, so
    /// the post-await version silently drops the headers on any response that streams or is
    /// written early. Nothing here overwrites a header an endpoint already set.
    /// </para>
    /// </summary>
    public static IApplicationBuilder UseClimateProjectSecurityHeaders(this IApplicationBuilder app)
    {
        ArgumentNullException.ThrowIfNull(app);

        return app.Use(async (context, next) =>
        {
            var options = context.RequestServices.GetRequiredService<IOptions<SecurityOptions>>().Value;

            context.Response.OnStarting(static state =>
            {
                var (response, securityOptions) = ((HttpResponse, SecurityOptions))state;
                var headers = response.Headers;

                headers.XContentTypeOptions = "nosniff";
                headers["Referrer-Policy"] = "no-referrer";
                headers.XFrameOptions = "DENY";
                headers.ContentSecurityPolicy = "default-src 'none'; frame-ancestors 'none'; base-uri 'none'";

                if (securityOptions.EnableHsts)
                {
                    headers.StrictTransportSecurity =
                        $"max-age={securityOptions.HstsMaxAgeSeconds}; includeSubDomains";
                }

                return Task.CompletedTask;
            }, (context.Response, options));

            await next(context);
        });
    }

    /// <summary>
    /// Rejects an oversized request body with 413 before anything reads it.
    ///
    /// <para>
    /// Two mechanisms, because neither alone is enough. <c>Content-Length</c> is checked
    /// explicitly, which is what catches the ordinary case and is the only part of this that
    /// a <c>TestServer</c>-based test can exercise at all. For a chunked body, which has no
    /// <c>Content-Length</c>, the per-request
    /// <see cref="IHttpMaxRequestBodySizeFeature"/> is lowered instead, and the server
    /// enforces it while the body is read.
    /// </para>
    /// <para>
    /// Placed after CORS so a 413 still carries the headers a browser needs to read it, and
    /// before authentication so an unauthenticated flood is refused without a database or
    /// token round trip.
    /// </para>
    /// </summary>
    public static IApplicationBuilder UseClimateProjectRequestSizeLimit(this IApplicationBuilder app)
    {
        ArgumentNullException.ThrowIfNull(app);

        return app.Use(async (context, next) =>
        {
            var options = context.RequestServices.GetRequiredService<IOptions<SecurityOptions>>().Value;
            var limit = MaxBodyBytesFor(context.GetEndpoint(), options);

            if (context.Request.ContentLength > limit)
            {
                context.Response.StatusCode = StatusCodes.Status413PayloadTooLarge;
                await context.Response.WriteAsJsonAsync(new { message = "Request body is too large." });
                return;
            }

            var sizeFeature = context.Features.Get<IHttpMaxRequestBodySizeFeature>();
            if (sizeFeature is { IsReadOnly: false })
            {
                sizeFeature.MaxRequestBodySize = limit;
            }

            await next(context);
        });
    }

    /// <summary>
    /// The ceiling that applies to <paramref name="endpoint"/>: the upload ceiling for a
    /// route carrying <see cref="LargeRequestBodyMetadata"/>, the default otherwise. A
    /// request that matched no endpoint gets the default, which is the strict one.
    /// </summary>
    internal static long MaxBodyBytesFor(Endpoint? endpoint, SecurityOptions options)
    {
        ArgumentNullException.ThrowIfNull(options);

        return endpoint?.Metadata.GetMetadata<LargeRequestBodyMetadata>() is not null
            ? options.MaxUploadBodyBytes
            : options.MaxRequestBodyBytes;
    }
}
