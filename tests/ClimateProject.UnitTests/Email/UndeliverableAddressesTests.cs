using ClimateProject.Application.Email;

namespace ClimateProject.UnitTests.Email;

/// <summary>
/// The rule that decides whether an address can ever receive mail.
///
/// Every reserved name in RFC 2606 and RFC 6761 is enumerated here rather than sampled,
/// because the cost of missing one is not a failed test: it is a hard bounce charged against
/// an AWS SES account shared with five other TIMS products.
/// </summary>
public class UndeliverableAddressesTests
{
    /// <summary>
    /// The reserved TLDs, each in the two shapes a real address takes -- a plain domain and a
    /// subdomain -- plus <c>localhost</c> as a bare label, which is how RFC 6761 actually
    /// reserves it and the one case a "must contain a dot" implementation would miss.
    /// </summary>
    [Theory]
    [InlineData("ana@company.test", "company.test")]
    [InlineData("ana@mail.company.test", "mail.company.test")]
    [InlineData("ana@company.invalid", "company.invalid")]
    [InlineData("ana@company.example", "company.example")]
    [InlineData("ana@company.localhost", "company.localhost")]
    [InlineData("ana@localhost", "localhost")]
    [InlineData("ana@example", "example")]
    // RFC 2606 s3's second-level names, and a subdomain of each: mail.example.com is as
    // undelegatable as example.com, and it is the shape a "== example.com" check misses.
    [InlineData("ana@example.com", "example.com")]
    [InlineData("ana@example.net", "example.net")]
    [InlineData("ana@example.org", "example.org")]
    [InlineData("ana@mail.example.com", "mail.example.com")]
    // Case and the trailing dot of a fully qualified name are not distinctions DNS makes,
    // and neither is leading/trailing whitespace off a pasted spreadsheet cell.
    [InlineData("ana@COMPANY.TEST", "company.test")]
    [InlineData("ana@company.test.", "company.test")]
    [InlineData("ana@ Company.Test ", "company.test")]
    // A '@' in the local part is legal in a quoted string; the domain is what follows the
    // LAST one, and reading the first would let "a@b"@company.test through.
    [InlineData("\"a@b\"@company.test", "company.test")]
    public void A_reserved_domain_is_recognised_and_named(string address, string expectedDomain)
    {
        Assert.Equal(expectedDomain, UndeliverableAddresses.ReservedDomainOf(address));
        Assert.True(UndeliverableAddresses.IsUndeliverable(address));
    }

    /// <summary>
    /// The other half, and the half that decides whether this guard is usable at all: a false
    /// positive would silently stop a real employee's mail.
    ///
    /// <c>testing.com</c>, <c>invalid-domain.com</c> and <c>example-corp.com</c> are the three
    /// a substring match rather than a label match would wrongly refuse -- and every one of
    /// them is a plausible customer domain.
    /// </summary>
    [Theory]
    [InlineData("ana@timsint.com")]
    [InlineData("ana@procomer.go.cr")]
    [InlineData("ana@testing.com")]
    [InlineData("ana@invalid-domain.com")]
    [InlineData("ana@example-corp.com")]
    [InlineData("ana@notexample.com")]
    [InlineData("ana@test.com")]
    [InlineData("ana@example.com.mx")]
    [InlineData("ana@localhost.com")]
    public void A_deliverable_domain_is_left_alone(string address)
    {
        Assert.Null(UndeliverableAddresses.ReservedDomainOf(address));
        Assert.False(UndeliverableAddresses.IsUndeliverable(address));
    }

    /// <summary>
    /// Malformed input is not this rule's business. The transport already refuses an address
    /// <c>MailAddress</c> cannot parse, and a second guard claiming to own address syntax is
    /// how the two drift apart -- so "not a reserved domain" is the honest answer here.
    /// </summary>
    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    [InlineData("no-at-sign")]
    [InlineData("trailing@")]
    public void Input_that_names_no_domain_is_not_claimed_by_this_rule(string? address)
        => Assert.Null(UndeliverableAddresses.ReservedDomainOf(address));

    /// <summary>
    /// The reason is read by an admin looking at a failed row, so it has to say which domain
    /// and has to say that no retry helps -- otherwise the reading is "the mail system is
    /// broken" and a ticket gets raised against a system that is working.
    ///
    /// And it must NOT carry the local part. This string is written verbatim into
    /// <c>Notification.FailureReason</c>, which every company admin of the tenant can read
    /// through <c>GET /notifications</c>; the local part is the half that names a person.
    /// </summary>
    [Fact]
    public void The_reason_names_the_domain_and_never_the_local_part()
    {
        var reason = UndeliverableAddresses.ReasonFor("ana.gomez@company.test");

        Assert.Contains("company.test", reason, StringComparison.Ordinal);
        Assert.DoesNotContain("ana.gomez", reason, StringComparison.Ordinal);
        Assert.Contains("no retry", reason, StringComparison.OrdinalIgnoreCase);
    }
}
