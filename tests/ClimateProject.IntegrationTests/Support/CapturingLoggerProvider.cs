using System.Collections.Concurrent;
using Microsoft.Extensions.Logging;

namespace ClimateProject.IntegrationTests.Support;

/// <summary>
/// An <see cref="ILoggerProvider"/> that keeps every record the host writes, so a test can
/// assert on what reached the log sink rather than on what the code appears to log.
///
/// <para>
/// Added for #146: the rate limiter's rejection warning is a place where a bearer credential
/// can leak into CloudWatch, and the only way to prove it does not is to read the formatted
/// message the way an operator would. Registered with
/// <c>ConfigureLogging(builder =&gt; builder.AddProvider(...))</c> on a
/// <c>WebApplicationFactory</c>, so it sees exactly the records the configured log levels let
/// through -- the same ones production would ship.
/// </para>
/// </summary>
public sealed class CapturingLoggerProvider : ILoggerProvider
{
    private readonly ConcurrentQueue<CapturedLogRecord> _records = new();

    public IReadOnlyCollection<CapturedLogRecord> Records => _records.ToArray();

    public ILogger CreateLogger(string categoryName) => new CapturingLogger(categoryName, _records);

    public void Dispose()
    {
        // Nothing to release: the queue outlives the provider on purpose, because the test
        // reads it after the host that produced it has been torn down.
    }

    private sealed class CapturingLogger(string categoryName, ConcurrentQueue<CapturedLogRecord> records) : ILogger
    {
        public IDisposable? BeginScope<TState>(TState state) where TState : notnull => null;

        public bool IsEnabled(LogLevel logLevel) => true;

        public void Log<TState>(
            LogLevel logLevel,
            EventId eventId,
            TState state,
            Exception? exception,
            Func<TState, Exception?, string> formatter)
        {
            ArgumentNullException.ThrowIfNull(formatter);

            records.Enqueue(new CapturedLogRecord(categoryName, logLevel, formatter(state, exception)));
        }
    }
}

/// <summary>One formatted log record: the category, the level and the message an operator reads.</summary>
public sealed record CapturedLogRecord(string Category, LogLevel Level, string Message);
