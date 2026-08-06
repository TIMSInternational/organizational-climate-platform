namespace ClimateProject.Infrastructure.Email;

/// <summary>
/// Process-wide pacing for outbound mail, so a company-wide dispatch cannot exceed the
/// provider's sending rate.
///
/// <para>
/// Amazon SES throttles a production account at a fixed sends-per-second rate (14/second by
/// default) and returns <c>454 Throttling failure</c> above it. A 500-recipient bulk dispatch
/// with no pacing would hit that within the first second, and every message after it would be
/// a retryable failure -- the send path would spend the rest of the day retrying traffic it
/// generated itself. #100 asks specifically that a company-wide dispatch stay inside provider
/// limits; this is that.
/// </para>
/// <para>
/// A minimum interval between sends rather than a token bucket, and no burst allowance. A
/// bucket lets an idle service spend its accumulated credit all at once, which is precisely
/// the shape that trips a per-second cap; smoothing is what the provider actually wants.
/// </para>
/// <para>
/// **Registered as a singleton, and that is load-bearing** -- a scoped instance would reset
/// per request and pace nothing. It is deliberately per *process*: two App Runner instances
/// each pace themselves, so the configured rate is per instance and must be set below the
/// account limit divided by the instance count. Coordinating across instances needs shared
/// state and is not worth a Redis dependency for a cap this far from being reached.
/// </para>
/// </summary>
public sealed class EmailSendRateLimiter : IDisposable
{
    private readonly SemaphoreSlim _gate = new(1, 1);
    private readonly TimeSpan _minimumInterval;
    private readonly TimeProvider _timeProvider;
    private DateTimeOffset _nextSendAt = DateTimeOffset.MinValue;

    /// <param name="maxSendsPerSecond">Ceiling on the send rate. Values below 1 are treated as 1.</param>
    /// <param name="timeProvider">
    /// Injected so the pacing can be unit-tested without a test that actually sleeps -- a
    /// rate limiter verified by wall-clock timing is a flaky test by construction.
    /// </param>
    public EmailSendRateLimiter(int maxSendsPerSecond, TimeProvider? timeProvider = null)
    {
        var rate = Math.Max(1, maxSendsPerSecond);
        _minimumInterval = TimeSpan.FromSeconds(1.0 / rate);
        _timeProvider = timeProvider ?? TimeProvider.System;
    }

    /// <summary>
    /// Blocks until this caller is allowed to send, then reserves the next slot.
    ///
    /// The reservation happens while the gate is held, so N concurrent callers are spaced N
    /// intervals apart rather than all reading the same "now" and all deciding they may go.
    /// The wait itself also happens inside the gate: mail sending is I/O measured in
    /// milliseconds against an interval measured in tens of them, so serialising is simpler
    /// than a lock-free reservation and costs nothing real.
    /// </summary>
    public async Task WaitForTurnAsync(CancellationToken cancellationToken)
    {
        await _gate.WaitAsync(cancellationToken).ConfigureAwait(false);
        try
        {
            var now = _timeProvider.GetUtcNow();
            var delay = _nextSendAt - now;
            if (delay > TimeSpan.Zero)
            {
                await Task.Delay(delay, _timeProvider, cancellationToken).ConfigureAwait(false);
                now = _timeProvider.GetUtcNow();
            }

            _nextSendAt = now + _minimumInterval;
        }
        finally
        {
            _gate.Release();
        }
    }

    public void Dispose() => _gate.Dispose();
}
