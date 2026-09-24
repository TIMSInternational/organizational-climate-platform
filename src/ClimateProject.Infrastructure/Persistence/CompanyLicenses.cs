using ClimateProject.Domain.Entities;
using Microsoft.EntityFrameworkCore;

namespace ClimateProject.Infrastructure.Persistence;

/// <summary>Why a seat consumption did or did not happen.</summary>
public enum SeatConsumeOutcome
{
    /// <summary>A seat was consumed. The completion may proceed.</summary>
    Consumed,

    /// <summary>The service is not metered (<c>custom</c>). Nothing was consumed; the completion may proceed.</summary>
    NotMetered,

    /// <summary>
    /// No licence row exists for this company+service. Grandfathered: nothing consumed, the
    /// completion may proceed. Enforcement begins the moment a super admin grants a licence.
    /// </summary>
    NoLicense,

    /// <summary>A licence exists but every seat is used. The completion must be refused.</summary>
    Exhausted,

    /// <summary>A licence exists but is suspended. The completion must be refused.</summary>
    Suspended,
}

/// <summary>
/// Reads and moves company service-licence seats. The consume is a single guarded UPDATE — the
/// only way a seat is ever spent — so two concurrent completions can never oversell the last seat.
/// </summary>
/// <remarks>
/// <para>
/// <b>Grandfathering is the absence of a row.</b> A company with no licence for a service is
/// unmetered, so deploying this is inert until a super admin grants a licence — an existing live
/// survey cannot start refusing responses on the day the feature ships. Once a row exists it is
/// enforced. <c>custom</c> surveys are never metered.
/// </para>
/// <para>
/// A seat = one <b>completed</b> response. Climate surveys can be anonymous (no stored identity),
/// so a seat cannot be "one unique person"; it is one completion, spent at submit time.
/// </para>
/// </remarks>
public static class CompanyLicenses
{
    /// <summary>
    /// Consumes one seat for <paramref name="companyId"/> + <paramref name="serviceType"/> if one is
    /// available. The increment is atomic and conditional; the classification of a non-consume is
    /// best-effort and only shapes the caller's message — a seat is only ever spent by the guarded
    /// UPDATE itself.
    /// </summary>
    public static async Task<SeatConsumeOutcome> TryConsumeSeatAsync(
        ClimateProjectDbContext db,
        Guid companyId,
        string? serviceType,
        DateTimeOffset nowUtc,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(db);

        // null/blank is "this survey is not an instrument of any licensed service" -- the
        // grandfathering path (#496), and the state of every row written before Survey.ServiceType
        // existed. It is NOT an argument error: the caller passes whatever the survey carries.
        if (string.IsNullOrWhiteSpace(serviceType) || !ClimateServiceTypes.IsMetered(serviceType))
        {
            return SeatConsumeOutcome.NotMetered;
        }

        // The compare-and-swap: the row moves only while it is active and has a free seat. The
        // unique (company_id, service_type) index guarantees this touches at most one row.
        var written = await db.CompanyServiceLicenses
            .Where(l => l.CompanyId == companyId
                && l.ServiceType == serviceType
                && l.Status == LicenseStatuses.Active
                && l.SeatsUsed < l.SeatsTotal)
            .ExecuteUpdateAsync(
                setters => setters
                    .SetProperty(l => l.SeatsUsed, l => l.SeatsUsed + 1)
                    .SetProperty(l => l.UpdatedAt, nowUtc),
                cancellationToken);

        if (written >= 1)
        {
            return SeatConsumeOutcome.Consumed;
        }

        // Zero rows moved: say why, from the row's current state.
        var licence = await db.CompanyServiceLicenses
            .AsNoTracking()
            .FirstOrDefaultAsync(l => l.CompanyId == companyId && l.ServiceType == serviceType, cancellationToken);

        if (licence is null)
        {
            return SeatConsumeOutcome.NoLicense;
        }

        return licence.Status != LicenseStatuses.Active
            ? SeatConsumeOutcome.Suspended
            : SeatConsumeOutcome.Exhausted;
    }

    /// <summary>Whether an outcome permits the completion to proceed.</summary>
    public static bool Allows(this SeatConsumeOutcome outcome) => outcome is
        SeatConsumeOutcome.Consumed or SeatConsumeOutcome.NotMetered or SeatConsumeOutcome.NoLicense;

    /// <summary>
    /// Gives back a seat this request took and then could not use. The counterpart to
    /// <see cref="TryConsumeSeatAsync"/> on a caller that has no transaction to roll back.
    /// </summary>
    /// <remarks>
    /// <para>
    /// <b>Why this exists at all, given the survey path does not need it.</b> A survey completion
    /// consumes inside <c>BeginTransactionAsync</c>, so a refusal rolls the increment back for
    /// free and there is deliberately no release path. The microclimate submission path cannot
    /// borrow that: its <c>ResponseCount</c>/word-cloud write is a read-modify-write aggregate
    /// run under an optimistic-concurrency retry loop, because a live microclimate is a burst.
    /// Holding a transaction across that loop would pin the microclimate row from the first
    /// <c>SaveChangesAsync</c> to commit and convoy the very path the loop exists to keep
    /// lock-free. So that caller consumes first, writes, and calls this if the write does not
    /// stand -- three single statements, no lock held across any of them (#496).
    /// </para>
    /// <para>
    /// <b>The guard is <c>SeatsUsed &gt; 0</c> and it is not decoration.</b> Without it a release
    /// that ran twice, or ran against a licence an admin had meanwhile reset, would drive the
    /// counter negative and manufacture seats nobody granted -- exhaustion is derived from
    /// <c>SeatsUsed &gt;= SeatsTotal</c>, so a negative count is a licence with free seats that
    /// were never bought. Returns whether a seat was actually given back, so a caller that wants
    /// to know can tell "released" from "there was nothing to release".
    /// </para>
    /// <para>
    /// This is compensation, not a transaction, and the difference is worth stating: if the
    /// process dies between the consume and the release, the seat stays spent. That window is
    /// one aggregate write wide, and it errs toward charging for a response that was not
    /// recorded rather than recording one that was not charged -- the direction that cannot
    /// oversell a licence.
    /// </para>
    /// </remarks>
    public static async Task<bool> ReleaseSeatAsync(
        ClimateProjectDbContext db,
        Guid companyId,
        string? serviceType,
        DateTimeOffset nowUtc,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(db);

        if (string.IsNullOrWhiteSpace(serviceType) || !ClimateServiceTypes.IsMetered(serviceType))
        {
            return false;
        }

        // Deliberately NOT filtered on Status: a licence suspended between the consume and the
        // release must still give the seat back. Suspension stops new consumption; it is not a
        // reason to keep a seat that bought nothing.
        var written = await db.CompanyServiceLicenses
            .Where(l => l.CompanyId == companyId
                && l.ServiceType == serviceType
                && l.SeatsUsed > 0)
            .ExecuteUpdateAsync(
                setters => setters
                    .SetProperty(l => l.SeatsUsed, l => l.SeatsUsed - 1)
                    .SetProperty(l => l.UpdatedAt, nowUtc),
                cancellationToken);

        return written >= 1;
    }

    /// <summary>
    /// Creates or updates the licence for a company+service. Does not change status — use
    /// <see cref="SetStatusAsync"/> to suspend or reactivate. Reducing <paramref name="seatsTotal"/>
    /// below the seats already used is allowed and simply leaves the licence exhausted.
    /// </summary>
    public static async Task<CompanyServiceLicense> GrantOrUpdateAsync(
        ClimateProjectDbContext db,
        Guid companyId,
        string serviceType,
        int seatsTotal,
        string? notes,
        DateTimeOffset nowUtc,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(db);
        if (!ClimateServiceTypes.IsMetered(serviceType))
        {
            throw new ArgumentException($"'{serviceType}' is not a metered climate service.", nameof(serviceType));
        }

        ArgumentOutOfRangeException.ThrowIfNegative(seatsTotal);

        var licence = await db.CompanyServiceLicenses
            .FirstOrDefaultAsync(l => l.CompanyId == companyId && l.ServiceType == serviceType, cancellationToken);

        if (licence is null)
        {
            licence = new CompanyServiceLicense
            {
                Id = Guid.NewGuid(),
                CompanyId = companyId,
                ServiceType = serviceType,
                SeatsTotal = seatsTotal,
                SeatsUsed = 0,
                Status = LicenseStatuses.Active,
                Notes = notes,
                CreatedAt = nowUtc,
                UpdatedAt = nowUtc,
            };
            db.CompanyServiceLicenses.Add(licence);
        }
        else
        {
            licence.SeatsTotal = seatsTotal;
            licence.Notes = notes;
            licence.UpdatedAt = nowUtc;
        }

        await db.SaveChangesAsync(cancellationToken);
        return licence;
    }

    /// <summary>Suspends or reactivates a licence. Returns false when no such licence exists.</summary>
    public static async Task<bool> SetStatusAsync(
        ClimateProjectDbContext db,
        Guid companyId,
        string serviceType,
        string status,
        DateTimeOffset nowUtc,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(db);
        if (status is not (LicenseStatuses.Active or LicenseStatuses.Suspended))
        {
            throw new ArgumentException($"'{status}' is not a valid licence status.", nameof(status));
        }

        var written = await db.CompanyServiceLicenses
            .Where(l => l.CompanyId == companyId && l.ServiceType == serviceType)
            .ExecuteUpdateAsync(
                setters => setters
                    .SetProperty(l => l.Status, status)
                    .SetProperty(l => l.UpdatedAt, nowUtc),
                cancellationToken);

        return written >= 1;
    }

    /// <summary>The licences a company holds, ordered by service.</summary>
    public static async Task<IReadOnlyList<CompanyServiceLicense>> ListAsync(
        ClimateProjectDbContext db,
        Guid companyId,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(db);
        return await db.CompanyServiceLicenses
            .AsNoTracking()
            .Where(l => l.CompanyId == companyId)
            .OrderBy(l => l.ServiceType)
            .ToListAsync(cancellationToken);
    }
}
