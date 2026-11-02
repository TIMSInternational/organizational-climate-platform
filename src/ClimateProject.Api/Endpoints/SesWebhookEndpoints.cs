using System.Text;
using ClimateProject.Application.Email;
using ClimateProject.Domain.Entities;
using ClimateProject.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace ClimateProject.Api.Endpoints;

/// <summary>
/// <c>POST /webhooks/ses</c> — where Amazon SNS delivers the bounces, complaints and rejections
/// SES publishes for the configuration set this product sends through.
/// </summary>
/// <remarks>
/// <para>
/// <b>Why.</b> On 20 Oct 2026 ten ESPH credential emails bounced and nothing in the product said
/// so: a send only knows the mail server took the message. Every "did it arrive?" since then has
/// been answered by reading AWS by hand. This is the path that lets the delivery audit answer it.
/// </para>
/// <para>
/// <b>Who may call it: nobody but SNS, proven per message.</b> The route is anonymous because SNS
/// cannot sign in, so every message has to prove itself instead, and is refused unless ALL of:
/// <list type="number">
/// <item>this deployment has a topic configured (<see cref="EmailOptions.SesEventsTopicArn"/>) —
/// with none, every request is a 404 and nothing is read;</item>
/// <item>the message names exactly that topic;</item>
/// <item>its signing certificate is served over HTTPS by an <c>sns.&lt;region&gt;.amazonaws.com</c>
/// host, so a forger cannot point at a certificate they made;</item>
/// <item>the signature verifies against that certificate.</item>
/// </list>
/// Only then is a subscription confirmed or an event stored.
/// </para>
/// <para>
/// <b>What is kept.</b> Only events for mail this product tagged as its own
/// (<see cref="SesDeliveryEvents"/>), and only for addresses that belong to a user here. The
/// configuration set is shared with five other products; their recipients are dropped, not stored.
/// Logs carry counts, never addresses.
/// </para>
/// <para>
/// <b>Unattributable, and listed as such.</b> No user is signed in, so no audit row can be written
/// (<c>audit_logs.company_id</c> is NOT NULL); the route is written down in
/// <c>AuditCoverageTests.UnattributableMutatingRoutes</c> with the other anonymous writers.
/// </para>
/// </remarks>
public static class SesWebhookEndpoints
{
    public const string Route = "/webhooks/ses";

    /// <summary>An SES event is a few kilobytes; SNS caps a message at 256 KB.</summary>
    private const int MaxBodyBytes = 256 * 1024;

    public static void MapSesWebhookEndpoints(this WebApplication app)
    {
        app.MapPost(Route, ReceiveAsync).AllowAnonymous();
    }

    internal static async Task<IResult> ReceiveAsync(
        HttpRequest request,
        EmailOptions options,
        ISnsCertificateSource certificates,
        ISnsSubscriptionConfirmer confirmer,
        ClimateProjectDbContext db,
        ILoggerFactory loggers,
        CancellationToken cancellationToken)
    {
        var topic = options.SesEventsTopicArn?.Trim();
        if (string.IsNullOrEmpty(topic))
        {
            return Results.NotFound();
        }

        var logger = loggers.CreateLogger("ClimateProject.SesWebhook");
        var body = await ReadLimitedAsync(request.Body, cancellationToken);
        if (body is null)
        {
            return Results.StatusCode(StatusCodes.Status413PayloadTooLarge);
        }

        var message = SnsMessageVerification.Parse(body);
        if (message is null)
        {
            return Results.BadRequest();
        }

        if (!string.Equals(message.TopicArn, topic, StringComparison.Ordinal)
            || !SnsMessageVerification.IsSnsCertificateUrl(message.SigningCertUrl))
        {
            logger.LogWarning("SES webhook refused a message: wrong topic or certificate host");
            return Results.StatusCode(StatusCodes.Status403Forbidden);
        }

        var certificate = await certificates.GetAsync(message.SigningCertUrl, cancellationToken);
        if (certificate is null || !SnsMessageVerification.IsSignatureValid(message, certificate))
        {
            logger.LogWarning("SES webhook refused a message: signature did not verify");
            return Results.StatusCode(StatusCodes.Status403Forbidden);
        }

        switch (message.Type)
        {
            case "SubscriptionConfirmation":
                var confirmed = await confirmer.ConfirmAsync(message.SubscribeUrl!, cancellationToken);
                logger.LogInformation("SES webhook subscription confirmation: {Confirmed}", confirmed);
                return confirmed ? Results.Ok() : Results.StatusCode(StatusCodes.Status502BadGateway);

            case "Notification":
                var stored = await StoreAsync(message, db, cancellationToken);
                logger.LogInformation("SES webhook stored {Count} delivery event(s)", stored);
                return Results.Ok();

            default:
                // A signed UnsubscribeConfirmation, or a type AWS adds later: nothing to do, and
                // a non-2xx would only make SNS retry it.
                return Results.Ok();
        }
    }

    /// <returns>How many rows were added. A redelivery of the same message adds none.</returns>
    private static async Task<int> StoreAsync(SnsMessage message, ClimateProjectDbContext db, CancellationToken cancellationToken)
    {
        var events = SesDeliveryEvents.Parse(message.Message);
        if (events.Count == 0)
        {
            return 0;
        }

        var addresses = events.Select(e => e.Recipient).Distinct(StringComparer.Ordinal).ToList();
        var people = await db.Users.AsNoTracking()
            .Where(u => addresses.Contains(u.Email.ToLower()))
            .Select(u => new { u.Id, Email = u.Email.ToLower() })
            .ToListAsync(cancellationToken);
        var byEmail = people
            .GroupBy(p => p.Email, StringComparer.Ordinal)
            .ToDictionary(g => g.Key, g => g.First().Id, StringComparer.Ordinal);

        var already = (await db.EmailDeliveryEvents.AsNoTracking()
                .Where(e => e.SnsMessageId == message.MessageId)
                .Select(e => new { e.Email, e.EventType })
                .ToListAsync(cancellationToken))
            .Select(e => (e.Email, e.EventType))
            .ToHashSet();

        var receivedAt = DateTimeOffset.UtcNow;
        var added = 0;
        foreach (var ses in events)
        {
            if (!byEmail.TryGetValue(ses.Recipient, out var userId) || !already.Add((ses.Recipient, ses.EventType)))
            {
                continue;
            }

            db.EmailDeliveryEvents.Add(new EmailDeliveryEvent
            {
                Id = Guid.NewGuid(),
                UserId = userId,
                Email = ses.Recipient,
                EventType = ses.EventType,
                BounceType = ses.BounceType,
                BounceSubType = ses.BounceSubType,
                Diagnostic = ses.Diagnostic,
                OccurredAt = ses.OccurredAt,
                SesMessageId = ses.SesMessageId,
                SnsMessageId = message.MessageId,
                ReceivedAt = receivedAt,
            });
            added++;
        }

        if (added == 0)
        {
            return 0;
        }

        try
        {
            await db.SaveChangesAsync(cancellationToken);
            return added;
        }
        catch (DbUpdateException)
        {
            // Two deliveries of one message racing each other: the unique index let one in, and
            // the other is the redelivery it was always going to be.
            return 0;
        }
    }

    /// <returns>The body as text, or null when it is larger than any SNS message can be.</returns>
    private static async Task<string?> ReadLimitedAsync(Stream body, CancellationToken cancellationToken)
    {
        using var buffer = new MemoryStream();
        var chunk = new byte[16 * 1024];
        int read;
        while ((read = await body.ReadAsync(chunk, cancellationToken)) > 0)
        {
            if (buffer.Length + read > MaxBodyBytes)
            {
                return null;
            }

            buffer.Write(chunk, 0, read);
        }

        return Encoding.UTF8.GetString(buffer.GetBuffer(), 0, (int)buffer.Length);
    }
}
