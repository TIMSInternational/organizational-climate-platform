namespace ClimateProject.Application.Email;

/// <summary>
/// Addresses that can never receive mail, recognised before a provider is contacted.
///
/// <para>
/// **Why this exists at all.** Production mail is armed: the API submits to Amazon SES as
/// <c>no-reply@timsint.com</c>. The seeded demo tenant -- and every fixture, every manual
/// smoke test, every "let me try the invite flow" account -- is full of addresses in
/// <c>.test</c>, <c>.invalid</c> and <c>example.com</c>. Those are not merely unlikely to
/// arrive; they are reserved by RFC so that they can never resolve to a mailbox, so every
/// one of them is a guaranteed hard bounce. One click of "send invitations" on the demo
/// tenant is dozens of them in a single burst.
/// </para>
/// <para>
/// **And the cost is not paid by this product alone.** SES enforces its bounce-rate
/// reputation metric per AWS ACCOUNT, and this account is shared with five other TIMS
/// products. A demo blast here is a sending pause for all of them. That is the whole reason
/// this check is worth a class rather than a regex at one call site: it has to be the same
/// rule on every path mail can take out of this process.
/// </para>
/// <para>
/// **The rule, and its sources.** RFC 2606 reserves four top-level domains -- <c>.test</c>,
/// <c>.invalid</c>, <c>.example</c>, <c>.localhost</c> -- and three second-level names,
/// <c>example.com</c>, <c>example.net</c> and <c>example.org</c>. RFC 6761 restates
/// <c>.test</c>, <c>.invalid</c>, <c>.example</c> and <c>.localhost</c> as special-use names
/// that must never be delegated in the public DNS. Nothing here is a heuristic about which
/// domains look fake: every entry is a name the standards guarantee has no mailbox behind it.
/// </para>
/// <para>
/// **What this deliberately does NOT try to be.** It is not address validation -- the
/// transport already rejects a malformed address, and <c>MailAddress</c> is the authority on
/// syntax. It is not deliverability prediction: a typo'd real domain, a closed mailbox or a
/// full inbox all still bounce, and no local check can know that. This answers exactly one
/// question, with certainty: is the recipient in a domain the standards say cannot exist?
/// A false positive here is impossible, which is what makes refusing outright the right
/// response rather than a warning.
/// </para>
/// </summary>
public static class UndeliverableAddresses
{
    /// <summary>
    /// RFC 2606 s2 / RFC 6761: reserved top-level domains. A domain whose LAST label is one
    /// of these can never be delegated, so <c>anything.test</c> and the bare label
    /// <c>localhost</c> are both covered.
    /// </summary>
    public static readonly string[] ReservedTopLevelDomains = ["test", "invalid", "example", "localhost"];

    /// <summary>
    /// RFC 2606 s3: reserved second-level names. Matched on the domain itself and on any
    /// subdomain of it, because <c>mail.example.com</c> is as undelegatable as
    /// <c>example.com</c>.
    /// </summary>
    public static readonly string[] ReservedSecondLevelDomains = ["example.com", "example.net", "example.org"];

    /// <summary>
    /// The reserved domain this address sits in, or null when it is not in one.
    ///
    /// <para>
    /// Returns the DOMAIN rather than a bare bool because the domain is what a failure reason
    /// has to name: an admin reading a <c>failed</c> row needs to see that the address is the
    /// problem, not the mail system. It is also the only part of the address that is safe to
    /// persist there -- <c>Notification.FailureReason</c> is readable by every company admin
    /// of the tenant, and the local part is the half that identifies a person.
    /// </para>
    /// <para>
    /// A null, blank or address-less string returns null: "not a reserved domain" is the
    /// honest answer, and rejecting malformed input is the transport's existing job, not this
    /// one's. Two guards that both claim to own address syntax is how they drift.
    /// </para>
    /// </summary>
    public static string? ReservedDomainOf(string? address)
    {
        if (string.IsNullOrWhiteSpace(address))
        {
            return null;
        }

        var at = address.LastIndexOf('@');
        if (at < 0 || at == address.Length - 1)
        {
            return null;
        }

        // Lowercased because DNS names are case-insensitive, and the trailing dot of a fully
        // qualified name stripped because "example.com." is the same domain as "example.com".
        var domain = address[(at + 1)..].Trim().TrimEnd('.').ToLowerInvariant();
        if (domain.Length == 0)
        {
            return null;
        }

        var lastDot = domain.LastIndexOf('.');
        var topLevel = lastDot < 0 ? domain : domain[(lastDot + 1)..];
        if (Array.IndexOf(ReservedTopLevelDomains, topLevel) >= 0)
        {
            return domain;
        }

        foreach (var reserved in ReservedSecondLevelDomains)
        {
            if (string.Equals(domain, reserved, StringComparison.Ordinal)
                || domain.EndsWith($".{reserved}", StringComparison.Ordinal))
            {
                return domain;
            }
        }

        return null;
    }

    /// <summary>True when this address is in a domain that can never receive mail.</summary>
    public static bool IsUndeliverable(string? address) => ReservedDomainOf(address) is not null;

    /// <summary>
    /// The text persisted on the failed row, naming the cause.
    ///
    /// <para>
    /// Written for the admin who opens a failed invitation and has to decide what to do about
    /// it. It says which domain, says the domain is reserved rather than broken, and says
    /// retrying is pointless -- because the alternative reading, "the mail system is down",
    /// is the one that gets a support ticket raised against a system that is working
    /// correctly.
    /// </para>
    /// <para>
    /// The domain only, never the whole address, for the reason
    /// <see cref="ReservedDomainOf"/> gives.
    /// </para>
    /// </summary>
    public static string ReasonFor(string? address)
    {
        var domain = ReservedDomainOf(address);

        return domain is null
            ? "The recipient's address cannot be delivered to."
            : $"The recipient's address is in '{domain}', a domain reserved by RFC 2606/6761 that can never receive mail. "
              + "Nothing was sent, and no retry will succeed: correct the address on the recipient's account.";
    }
}
