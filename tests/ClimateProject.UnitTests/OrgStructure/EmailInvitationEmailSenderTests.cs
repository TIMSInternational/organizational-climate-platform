using ClimateProject.Application.Email;
using ClimateProject.Domain.Entities;
using ClimateProject.Infrastructure.OrgStructure;
using Microsoft.Extensions.Logging.Abstractions;

namespace ClimateProject.UnitTests.OrgStructure;

/// <summary>
/// The second sender that reaches the mail provider.
///
/// <c>EmailNotificationSender</c> carries survey invitations and reminders;
/// <see cref="EmailInvitationEmailSender"/> carries the org invitation that creates an
/// account, and it is the one behind the users screen's "invite" button. Both submit through
/// the same <c>IEmailTransport</c> to the same SES account, so a reserved-domain guard that
/// existed on only one of them would leave the other free to bounce.
/// </summary>
public class EmailInvitationEmailSenderTests
{
    private static EmailOptions Options() => new()
    {
        Provider = EmailOptions.ProviderSmtp,
        SmtpHost = "smtp.example.invalid",
        FromAddress = "no-reply@example.com",
        AppBaseUrl = "https://app.example.invalid",
    };

    private static UserInvitation Invitation(string? email) => new()
    {
        Id = Guid.NewGuid(),
        Email = email,
        // Shaped like what SurveyAccessTokens.Mint produces, and readable English so no
        // scanner mistakes a fixture for a leaked credential.
        InvitationToken = "invitation-token-for-test-not-a-real-secret",
        InvitationType = "employee",
        Role = "employee",
        Status = "pending",
        ExpiresAt = DateTimeOffset.UtcNow.AddDays(7),
    };

    private static EmailInvitationEmailSender Sender(RecordingTransport transport)
        => new(transport, Options(), NullLogger<EmailInvitationEmailSender>.Instance);

    /// <summary>
    /// The guarantee, asserted as "the transport was never called".
    ///
    /// The seeded demo tenant's users are in <c>.test</c> and <c>example.test</c>, and an
    /// admin clicking invite on that tenant is the exact scenario this refuses. A sender that
    /// submitted and then reported a failure would pass an assertion about the returned
    /// outcome and would still have spent the shared account's bounce rate.
    /// </summary>
    [Theory]
    [InlineData("someone@demo.test", "demo.test")]
    [InlineData("someone@example.com", "example.com")]
    [InlineData("someone@invitee.invalid", "invitee.invalid")]
    public async Task An_invitation_to_a_reserved_domain_is_never_handed_to_the_transport(
        string address,
        string expectedDomain)
    {
        var transport = new RecordingTransport();

        var outcome = await Sender(transport).SendAsync(Invitation(address), CancellationToken.None);

        Assert.Empty(transport.Sent);
        Assert.False(outcome.Delivered);

        // Permanent, so InvitationEndpoints leaves the row `pending` rather than recording a
        // send that did not happen -- and the resend route stays available once the address
        // is corrected.
        Assert.True(outcome.Permanent);
        Assert.Contains(expectedDomain, outcome.FailureReason, StringComparison.Ordinal);
    }

    /// <summary>
    /// Refusing before composing is not an optimisation. <c>InvitationEmailComposer</c> puts
    /// the invitation's live token into the accept link, so composing first would render a
    /// credential into a message with nowhere to go. Nothing built, because nothing sent.
    /// </summary>
    [Fact]
    public async Task Nothing_is_composed_for_a_reserved_domain()
    {
        var transport = new RecordingTransport();

        await Sender(transport).SendAsync(Invitation("someone@demo.test"), CancellationToken.None);

        Assert.Empty(transport.Sent);
    }

    /// <summary>
    /// The counterweight: an ordinary domain still goes. Without it, a guard that refused
    /// every address would satisfy everything above.
    /// </summary>
    [Fact]
    public async Task An_invitation_to_an_ordinary_domain_is_still_submitted()
    {
        var transport = new RecordingTransport();

        var outcome = await Sender(transport).SendAsync(
            Invitation("someone@procomer.go.cr"), CancellationToken.None);

        Assert.True(outcome.Delivered);
        Assert.Equal("someone@procomer.go.cr", Assert.Single(transport.Sent).ToAddress);
    }

    /// <summary>
    /// The pre-existing no-addressee case is untouched: a shareable self-signup link has no
    /// recipient, and that is still reported as its own permanent no-op rather than being
    /// swallowed by the new guard. <c>ReservedDomainOf</c> returns null for a blank address
    /// precisely so this branch keeps its own, more accurate reason.
    /// </summary>
    [Fact]
    public async Task An_invitation_with_no_address_still_reports_its_own_reason()
    {
        var transport = new RecordingTransport();

        var outcome = await Sender(transport).SendAsync(Invitation(null), CancellationToken.None);

        Assert.Empty(transport.Sent);
        Assert.True(outcome.Permanent);
        Assert.Contains("shareable link", outcome.FailureReason, StringComparison.Ordinal);
    }

    private sealed class RecordingTransport : IEmailTransport
    {
        public List<EmailMessage> Sent { get; } = [];

        public Task<EmailSendOutcome> SendAsync(EmailMessage message, CancellationToken cancellationToken)
        {
            Sent.Add(message);
            return Task.FromResult(EmailSendOutcome.Success());
        }
    }
}
