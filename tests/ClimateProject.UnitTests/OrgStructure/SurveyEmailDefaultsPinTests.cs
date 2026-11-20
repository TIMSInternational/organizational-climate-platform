using System.Security.Cryptography;
using System.Text;
using ClimateProject.Application.Email;
using ClimateProject.Application.OrgStructure;

namespace ClimateProject.UnitTests.OrgStructure;

/// <summary>
/// "Empty = today's text, byte-identical" (lane L2, 2026-11-19): the credentials and reminder
/// mails a survey that wrote nothing, under a company that wrote nothing, receives.
///
/// <para>The hashes were taken from the composers as they stood at <c>6f68040d</c>, BEFORE either
/// learned to read the chain, over every rendered field (address, display name, subject, text,
/// HTML) for each language setting a company can have. A change to the default copy, to its
/// order, or to a single byte of markup fails here -- which is the point: the default is what
/// ESPH's 640 people already read.</para>
/// </summary>
public class SurveyEmailDefaultsPinTests
{
    private const string LoginUrl = "https://app.example.com/login";
    private const string Username = "esph-k7m2q9xa";
    private const string Password = "Qp7-Rm2-Tx9";
    private static readonly EmailBrand Brand = new("/brand/logo.png", "ESPH", "#0b5fff");
    private static readonly DateOnly ClosesOn = new(2026, 11, 30);

    public static TheoryData<string?, string> CredentialsPins => new()
    {
        { "es", "84C061AE34D8F67B" },
        { "en", "E1E7CA447F0F5A79" },
        { "both", "047D8162DD3170F3" },
        { null, "047D8162DD3170F3" },
    };

    public static TheoryData<string?, string> ReminderPins => new()
    {
        { "es", "D1E0E909671F200A" },
        { "en", "F60E0EE96D2D59B3" },
        { "both", "3433F45E684C585A" },
        { null, "3433F45E684C585A" },
    };

    [Theory]
    [MemberData(nameof(CredentialsPins))]
    public void The_default_credentials_mail_is_byte_identical_to_the_one_before_the_chain(string? language, string expected)
    {
        var message = CredentialsEmailComposer.Compose(
            "person@example.com", "Ana", Username, Password, LoginUrl, language, CredentialsEmailPurpose.Invitation,
            Brand, "Clima Organizacional 2026", ClosesOn);

        Assert.Equal(expected, Hash(message));
    }

    [Theory]
    [MemberData(nameof(ReminderPins))]
    public void The_default_reminder_is_byte_identical_to_the_one_before_the_chain(string? language, string expected)
    {
        var message = SurveyReminderEmailComposer.Compose(
            "person@example.com", "Ana", Username, LoginUrl, language, Brand, "Clima Organizacional 2026");

        Assert.Equal(expected, Hash(message));
    }

    internal static string Hash(EmailMessage message)
        => Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(
            string.Join("\u0001", message.ToAddress, message.ToName ?? "<null>", message.Subject, message.TextBody, message.HtmlBody))))[..16];
}
