namespace ClimateProject.Domain.Entities;

/// <summary>
/// A company's entitlement to run one climate service, metered in respondent seats.
/// </summary>
/// <remarks>
/// One row per <c>(CompanyId, ServiceType)</c>. A seat is consumed when a respondent completes a
/// response to an instrument of that service; partial saves never consume. Two submission paths
/// spend seats, and they are shaped differently: a survey completion consumes inside the
/// completion's own transaction, and a microclimate submission consumes before its lock-free
/// aggregate write and gives the seat back if that write does not stand (#496). Exhaustion is
/// derived — <c>SeatsUsed &gt;= SeatsTotal</c> — never a stored flag, so the guarded atomic
/// increment is the single source of truth and two concurrent completions can never oversell the
/// last seat.
/// </remarks>
public class CompanyServiceLicense
{
    public Guid Id { get; set; }

    /// <summary>The company this entitlement belongs to.</summary>
    public Guid CompanyId { get; set; }

    /// <summary>
    /// The metered climate service, one of <see cref="ClimateServiceTypes"/>. Matched against a
    /// survey's <c>ServiceType</c> — NOT its <c>Type</c>, which is cadence and never a service
    /// (#496) — or, for a microclimate, supplied by the submission endpoint itself, since a
    /// microclimate is the microclimate service by construction and carries no field to say so.
    /// </summary>
    public required string ServiceType { get; set; }

    /// <summary>Total seats granted (≥ 0).</summary>
    public int SeatsTotal { get; set; }

    /// <summary>Seats consumed so far. Incremented atomically at completion.</summary>
    public int SeatsUsed { get; set; }

    /// <summary>
    /// <see cref="LicenseStatuses.Active"/> or <see cref="LicenseStatuses.Suspended"/>. A
    /// suspended licence consumes no seats and blocks new completions.
    /// </summary>
    public string Status { get; set; } = LicenseStatuses.Active;

    /// <summary>Free-text provenance (purchase order, negotiation reference). Not shown to respondents.</summary>
    public string? Notes { get; set; }

    public DateTimeOffset CreatedAt { get; set; }

    public DateTimeOffset UpdatedAt { get; set; }
}

/// <summary>
/// The climate services that consume licence seats.
/// </summary>
/// <remarks>
/// These are product lines — what the customer bought — and they are their own axis. They are
/// NOT <c>Survey.Type</c> values, which are cadence and purpose (periodic, pulse, exit): that
/// confusion is #496, where the two vocabularies turned out not to intersect at all and no seat
/// was ever spent. A survey names its service in <c>Survey.ServiceType</c>; a microclimate does
/// not name one, because it can only ever be <see cref="Microclimate"/>.
/// </remarks>
public static class ClimateServiceTypes
{
    public const string GeneralClimate = "general_climate";
    public const string OrganizationalCulture = "organizational_culture";
    public const string Microclimate = "microclimate";

    /// <summary>The metered services, in display order. <c>custom</c> is deliberately excluded.</summary>
    public static readonly IReadOnlyList<string> Metered =
        [GeneralClimate, OrganizationalCulture, Microclimate];

    /// <summary>Whether a service name is subject to licence metering.</summary>
    /// <remarks>
    /// The argument is a <c>Survey.ServiceType</c>, NOT a <c>Survey.Type</c>. It was the latter
    /// until #496, which measured that the two vocabularies do not intersect at all -- so this
    /// returned false for every survey the product can create and no seat was ever spent.
    /// </remarks>
    public static bool IsMetered(string serviceType) => Metered.Contains(serviceType);

    /// <summary>
    /// Whether a caller-supplied service is acceptable on a survey: a metered service, or nothing.
    /// </summary>
    public static bool IsAssignable(string? serviceType)
        => string.IsNullOrWhiteSpace(serviceType) || Metered.Contains(serviceType);
}

/// <summary>Licence lifecycle states.</summary>
public static class LicenseStatuses
{
    public const string Active = "active";
    public const string Suspended = "suspended";
}
