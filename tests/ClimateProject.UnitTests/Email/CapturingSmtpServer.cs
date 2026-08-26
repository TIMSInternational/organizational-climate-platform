using System.Net;
using System.Net.Sockets;
using System.Text;

namespace ClimateProject.UnitTests.Email;

/// <summary>
/// A minimal SMTP server that accepts one message and keeps what was transmitted.
///
/// <para>
/// **Why the mail tests need a socket at all.** Two of the guarantees on the transport can
/// only be stated in terms of the provider: that the <c>X-SES-CONFIGURATION-SET</c> header
/// reaches it, and that an undeliverable address never does. Both are unfalsifiable against a
/// <c>MailMessage</c> built in memory -- a test that inspects a header collection passes
/// whether or not the transport ever transmits it, and a test that asserts a returned
/// outcome passes whether or not a connection was opened first. So the assertions are made
/// against a server: what it read, and whether it was contacted at all.
/// </para>
/// <para>
/// Deliberately not an MTA. It validates nothing, delivers nothing, and speaks only the verbs
/// <c>SmtpClient</c> emits, advertising no extensions so that no STARTTLS and no AUTH is
/// attempted. Bound to <see cref="IPAddress.Loopback"/> on port 0, so parallel runs cannot
/// collide and nothing is reachable off the machine.
/// </para>
/// </summary>
internal sealed class CapturingSmtpServer : IDisposable
{
    private readonly TcpListener _listener;
    private readonly Task<string> _conversation;

    private readonly TaskCompletionSource _accepted =
        new(TaskCreationOptions.RunContinuationsAsynchronously);

    public CapturingSmtpServer()
    {
        _listener = new TcpListener(IPAddress.Loopback, 0);
        _listener.Start();
        _conversation = Task.Run(ServeOneAsync);
    }

    public int Port => ((IPEndPoint)_listener.LocalEndpoint).Port;

    /// <summary>
    /// The DATA block the client transmitted -- headers and body, as received.
    ///
    /// Awaits the whole conversation rather than reading a field, so a client that never sent
    /// DATA fails the wait instead of yielding a plausible empty string.
    /// </summary>
    public async Task<string> CapturedDataAsync()
        => await _conversation.WaitAsync(TimeSpan.FromSeconds(20));

    /// <summary>
    /// Whether anything connected within <paramref name="within"/>.
    ///
    /// This is how "the provider was never contacted" is asserted. A returned outcome cannot
    /// say it: a transport that dialled, was refused and then reported a permanent failure
    /// returns exactly what a transport that refused pre-flight returns -- and only one of
    /// them spent the sending account's reputation.
    /// </summary>
    public async Task<bool> WasContactedAsync(TimeSpan within)
    {
        var finished = await Task.WhenAny(_accepted.Task, Task.Delay(within)).ConfigureAwait(false);
        return ReferenceEquals(finished, _accepted.Task);
    }

    private async Task<string> ServeOneAsync()
    {
        using var client = await _listener.AcceptTcpClientAsync();
        _accepted.TrySetResult();

        using var stream = client.GetStream();
        using var reader = new StreamReader(stream, Encoding.ASCII);
        using var writer = new StreamWriter(stream, Encoding.ASCII) { AutoFlush = true, NewLine = "\r\n" };

        var data = new StringBuilder();
        await writer.WriteLineAsync("220 localhost ESMTP capture");

        while (await reader.ReadLineAsync() is { } line)
        {
            if (line.StartsWith("EHLO", StringComparison.OrdinalIgnoreCase))
            {
                // No extensions advertised on purpose: nothing to negotiate, so the
                // conversation stays plaintext and deterministic.
                await writer.WriteLineAsync("250-localhost");
                await writer.WriteLineAsync("250 HELP");
            }
            else if (line.StartsWith("DATA", StringComparison.OrdinalIgnoreCase))
            {
                await writer.WriteLineAsync("354 End data with <CR><LF>.<CR><LF>");

                while (await reader.ReadLineAsync() is { } dataLine && dataLine != ".")
                {
                    data.Append(dataLine).Append("\r\n");
                }

                await writer.WriteLineAsync("250 2.0.0 Ok: queued");
            }
            else if (line.StartsWith("QUIT", StringComparison.OrdinalIgnoreCase))
            {
                await writer.WriteLineAsync("221 Bye");
                break;
            }
            else
            {
                // HELO, MAIL FROM, RCPT TO, RSET, NOOP. None of them are what any test here is
                // about, and accepting them all keeps this server to one branch.
                await writer.WriteLineAsync("250 2.0.0 Ok");
            }
        }

        return data.ToString();
    }

    public void Dispose() => _listener.Stop();
}
