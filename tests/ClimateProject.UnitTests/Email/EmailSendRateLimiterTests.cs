using ClimateProject.Infrastructure.Email;

namespace ClimateProject.UnitTests.Email;

/// <summary>
/// Pacing for outbound mail, so a company-wide dispatch stays inside the provider's
/// sends-per-second limit (#100).
///
/// Driven by a fake <see cref="TimeProvider"/> rather than by the wall clock. A rate limiter
/// verified by measuring elapsed time is a flaky test by construction -- it either sleeps for
/// real (slow) or asserts on a lower bound the scheduler is free to overshoot (flaky). Asking
/// what delay it *requested* is exact and instant.
/// </summary>
public class EmailSendRateLimiterTests
{
    [Fact]
    public async Task The_first_send_is_not_delayed()
    {
        var time = new ImmediateTimeProvider();
        using var limiter = new EmailSendRateLimiter(10, time);

        await limiter.WaitForTurnAsync(CancellationToken.None);

        Assert.Empty(time.RequestedDelays);
    }

    [Fact]
    public async Task Later_sends_are_spaced_by_the_configured_interval()
    {
        var time = new ImmediateTimeProvider();
        using var limiter = new EmailSendRateLimiter(10, time);

        for (var i = 0; i < 3; i++)
        {
            await limiter.WaitForTurnAsync(CancellationToken.None);
        }

        // 10/second is one send every 100ms; the first is free, the next two each wait.
        Assert.Equal(2, time.RequestedDelays.Count);
        Assert.All(time.RequestedDelays, delay => Assert.Equal(TimeSpan.FromMilliseconds(100), delay));
    }

    [Fact]
    public async Task A_send_after_a_long_idle_period_is_not_delayed()
    {
        var time = new ImmediateTimeProvider();
        using var limiter = new EmailSendRateLimiter(10, time);

        await limiter.WaitForTurnAsync(CancellationToken.None);
        time.Advance(TimeSpan.FromMinutes(5));
        await limiter.WaitForTurnAsync(CancellationToken.None);

        // No burst credit accumulates either -- the idle service simply owes nothing.
        Assert.Empty(time.RequestedDelays);
    }

    [Theory]
    [InlineData(0)]
    [InlineData(-5)]
    public async Task A_nonsensical_rate_is_clamped_rather_than_dividing_by_zero(int rate)
    {
        var time = new ImmediateTimeProvider();
        using var limiter = new EmailSendRateLimiter(rate, time);

        await limiter.WaitForTurnAsync(CancellationToken.None);
        await limiter.WaitForTurnAsync(CancellationToken.None);

        Assert.Equal(TimeSpan.FromSeconds(1), Assert.Single(time.RequestedDelays));
    }

    [Fact]
    public async Task Cancellation_is_honoured_while_waiting_for_a_turn()
    {
        var time = new ImmediateTimeProvider();
        using var limiter = new EmailSendRateLimiter(1, time);

        await limiter.WaitForTurnAsync(CancellationToken.None);

        using var cancelled = new CancellationTokenSource();
        await cancelled.CancelAsync();

        await Assert.ThrowsAnyAsync<OperationCanceledException>(
            () => limiter.WaitForTurnAsync(cancelled.Token));
    }

    /// <summary>
    /// A clock that records what it was asked to wait for and then treats the wait as having
    /// happened instantly. <c>Task.Delay(TimeSpan, TimeProvider, CancellationToken)</c> goes
    /// through <see cref="TimeProvider.CreateTimer"/>, which is the hook this exploits.
    /// </summary>
    private sealed class ImmediateTimeProvider : TimeProvider
    {
        private readonly List<TimeSpan> _requestedDelays = [];
        private DateTimeOffset _now = DateTimeOffset.UnixEpoch;

        public IReadOnlyList<TimeSpan> RequestedDelays
        {
            get { lock (_requestedDelays) { return [.. _requestedDelays]; } }
        }

        public void Advance(TimeSpan by) => _now += by;

        public override DateTimeOffset GetUtcNow() => _now;

        public override ITimer CreateTimer(TimerCallback callback, object? state, TimeSpan dueTime, TimeSpan period)
        {
            lock (_requestedDelays) { _requestedDelays.Add(dueTime); }

            // The wait "happens": the clock moves forward by exactly the requested amount, so
            // the limiter's own arithmetic sees the time it asked for.
            _now += dueTime;
            return new ImmediateTimer(callback, state);
        }

        private sealed class ImmediateTimer : ITimer
        {
            public ImmediateTimer(TimerCallback callback, object? state)
                // Queued rather than invoked inline: Task.Delay creates the timer from inside
                // its own construction, and completing the promise re-entrantly from there is
                // asking for a deadlock.
                => ThreadPool.QueueUserWorkItem(_ => callback(state));

            public bool Change(TimeSpan dueTime, TimeSpan period) => true;

            public void Dispose()
            {
            }

            public ValueTask DisposeAsync() => ValueTask.CompletedTask;
        }
    }
}
