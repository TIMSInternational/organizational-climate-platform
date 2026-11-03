using ClimateProject.Application.Email;

namespace ClimateProject.UnitTests.Email;

/// <summary>
/// Reading an SES event out of an SNS notification — and, as much as reading it, refusing the
/// events that are not this product's: the configuration set is shared with five others.
/// </summary>
public class SesDeliveryEventsTests
{
    private const string Ours = """{"ses:configuration-set":["tims-transactional"],"app":["climate"]}""";
    private const string Theirs = """{"ses:configuration-set":["tims-transactional"]}""";

    private static string Bounce(string tags, string recipients = """[{"emailAddress":"Carlos.RG@Gmail.com","diagnosticCode":"smtp; 552 5.2.2 mailbox full"}]""")
        => """
        {"eventType":"Bounce",
         "bounce":{"bounceType":"Transient","bounceSubType":"MailboxFull","bouncedRecipients":RECIPIENTS,"timestamp":"2026-10-20T21:14:03.000Z"},
         "mail":{"timestamp":"2026-10-20T21:13:58.000Z","messageId":"0100-abc","destination":["carlos.rg@gmail.com"],"tags":TAGS}}
        """.Replace("RECIPIENTS", recipients, StringComparison.Ordinal).Replace("TAGS", tags, StringComparison.Ordinal);

    private static string Tagged(string json) => json.Replace("TAGS", Ours, StringComparison.Ordinal);

    [Fact]
    public void A_bounce_of_this_products_mail_becomes_one_event_per_recipient()
    {
        var events = SesDeliveryEvents.Parse(Bounce(Ours));

        var only = Assert.Single(events);
        Assert.Equal("carlos.rg@gmail.com", only.Recipient);
        Assert.Equal("bounce", only.EventType);
        Assert.Equal("Transient", only.BounceType);
        Assert.Equal("MailboxFull", only.BounceSubType);
        Assert.Equal("smtp; 552 5.2.2 mailbox full", only.Diagnostic);
        Assert.Equal(DateTimeOffset.Parse("2026-10-20T21:14:03Z"), only.OccurredAt);
        Assert.Equal("0100-abc", only.SesMessageId);
    }

    /// <summary>The line this whole design rests on: another product's recipients are never kept.</summary>
    [Theory]
    [InlineData(Theirs)]
    [InlineData("""{"app":["tims-suite"]}""")]
    [InlineData("""{"app":"climate"}""")]
    [InlineData("{}")]
    public void Mail_this_product_did_not_tag_as_its_own_yields_nothing(string tags)
        => Assert.Empty(SesDeliveryEvents.Parse(Bounce(tags)));

    [Fact]
    public void Mail_with_no_tags_at_all_yields_nothing()
        => Assert.Empty(SesDeliveryEvents.Parse(
            """{"eventType":"Bounce","bounce":{"bouncedRecipients":[{"emailAddress":"a@b.cr"}]},"mail":{"messageId":"m"}}"""));

    [Fact]
    public void A_complaint_and_a_rejection_are_read_too()
    {
        var complaint = SesDeliveryEvents.Parse(Tagged("""
            {"eventType":"Complaint","complaint":{"complainedRecipients":[{"emailAddress":"a@b.cr"}],"complaintFeedbackType":"abuse","timestamp":"2026-11-01T10:00:00Z"},
             "mail":{"messageId":"m1","tags":TAGS}}
            """));
        Assert.Equal("complaint", Assert.Single(complaint).EventType);
        Assert.Equal("abuse", complaint[0].BounceSubType);

        var reject = SesDeliveryEvents.Parse(Tagged("""
            {"eventType":"Reject","reject":{"reason":"Bad content"},
             "mail":{"messageId":"m2","timestamp":"2026-11-01T10:00:00Z","destination":["a@b.cr","c@d.cr"],"tags":TAGS}}
            """));
        Assert.Equal(["a@b.cr", "c@d.cr"], reject.Select(e => e.Recipient));
        Assert.All(reject, e => Assert.Equal("Bad content", e.Diagnostic));
    }

    [Fact]
    public void The_identity_notification_shape_is_read_as_well_as_the_event_shape()
    {
        var shape = Bounce(Ours).Replace("\"eventType\"", "\"notificationType\"", StringComparison.Ordinal);

        Assert.Single(SesDeliveryEvents.Parse(shape));
    }

    [Fact]
    public void A_long_server_reply_is_capped_and_a_delivery_is_not_an_event()
    {
        var reply = new string('x', 2000);
        var events = SesDeliveryEvents.Parse(Bounce(Ours, """[{"emailAddress":"a@b.cr","diagnosticCode":"REPLY"}]""".Replace("REPLY", reply, StringComparison.Ordinal)));
        Assert.Equal(SesDeliveryEvents.MaxDiagnosticLength, Assert.Single(events).Diagnostic!.Length);

        Assert.Empty(SesDeliveryEvents.Parse(Tagged("""{"eventType":"Delivery","delivery":{},"mail":{"messageId":"m","tags":TAGS}}""")));
        Assert.Empty(SesDeliveryEvents.Parse("not json"));
    }
}
