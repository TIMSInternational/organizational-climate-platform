using ClimateProject.Application.Email;
using ClimateProject.Application.OrgStructure;
using ClimateProject.Domain.Entities;

namespace ClimateProject.UnitTests.OrgStructure;

/// <summary>
/// The invitation email (#100 retires the stub that only logged it).
///
/// The invitation stub is what blocks realistic UAT: an invite flow that never sends an invite
/// cannot be walked through by a human.
/// </summary>
public class InvitationEmailComposerTests
{
    private const string AcceptUrl = "https://app.example.com/accept-invitation/abc123";

    private static UserInvitation Invitation(string? email = "new@example.com") => new()
    {
        Id = Guid.NewGuid(),
        Email = email,
        CompanyId = Guid.NewGuid(),
        InvitedBy = Guid.NewGuid(),
        InvitationToken = "abc123",
        InvitationType = "employee_direct",
        Role = "employee",
        Status = "sent",
        ExpiresAt = new DateTimeOffset(2026, 9, 1, 10, 0, 0, TimeSpan.Zero),
    };

    [Fact]
    public void The_invitation_is_sent_in_both_languages()
    {
        // The recipient has no account yet, so there is no stored language preference and no
        // language column on the invitation. Guessing would mean sending Spanish-speaking
        // employees an English-only invitation, which is the failure #78 was raised about.
        var message = InvitationEmailComposer.Compose(Invitation(), AcceptUrl)!;

        Assert.Contains("You have been invited", message.Subject, StringComparison.Ordinal);
        Assert.Contains("Te han invitado", message.Subject, StringComparison.Ordinal);
        Assert.Contains("Accept the invitation", message.TextBody, StringComparison.Ordinal);
        Assert.Contains("Aceptar la invitación", message.TextBody, StringComparison.Ordinal);
    }

    [Fact]
    public void The_accept_link_appears_in_both_bodies()
    {
        var message = InvitationEmailComposer.Compose(Invitation(), AcceptUrl)!;

        Assert.Contains(AcceptUrl, message.TextBody, StringComparison.Ordinal);
        Assert.Contains(AcceptUrl, message.HtmlBody, StringComparison.Ordinal);
    }

    [Fact]
    public void The_expiry_is_stated_so_a_stale_link_is_explicable()
    {
        var message = InvitationEmailComposer.Compose(Invitation(), AcceptUrl)!;

        Assert.Contains("2026-09-01", message.TextBody, StringComparison.Ordinal);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    public void An_invitation_with_no_address_composes_nothing(string? email)
    {
        // UserInvitation.Email is nullable because a shareable self-signup link is an
        // invitation with no recipient; the admin distributes it. Sending nothing is correct.
        Assert.Null(InvitationEmailComposer.Compose(Invitation(email), AcceptUrl));
    }

    [Fact]
    public void The_subject_cannot_carry_a_header_injection()
    {
        Assert.False(EmailMessage.HasHeaderInjection(
            InvitationEmailComposer.Compose(Invitation(), AcceptUrl)!.Subject));
    }

    [Fact]
    public void The_accept_path_matches_the_route_the_web_app_registers()
    {
        // A link that 404s is, to the recipient, indistinguishable from an invitation that was
        // never sent. web/src/app/router.tsx registers '/accept-invitation/:token'.
        Assert.Equal("accept-invitation/{0}", InvitationEmailComposer.AcceptPathTemplate);
    }

    [Fact]
    public void An_html_hostile_accept_url_is_escaped_in_the_markup()
    {
        var message = InvitationEmailComposer.Compose(
            Invitation(), "https://app.example.com/accept-invitation/a\"onmouseover=\"alert(1)")!;

        Assert.DoesNotContain("onmouseover=\"alert(1)\"", message.HtmlBody, StringComparison.Ordinal);
    }
}
