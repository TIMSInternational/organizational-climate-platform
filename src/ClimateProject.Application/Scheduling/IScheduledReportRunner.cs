namespace ClimateProject.Application.Scheduling;

/// <summary>
/// The seam between "a recurring report came due" (#101) and "a report is generated and
/// delivered" (#91).
///
/// <para>#91's acceptance criteria say scheduled delivery must run "from Workers, not a second
/// scheduler", and #101's say scheduled reports must go through "the same scheduler". Read
/// together, the division is: this repository gets exactly one thing that decides *when*, and
/// generation plugs into it. So the scheduler owns recurrence arithmetic, catch-up, and the
/// idempotent advance of <c>Report.NextGeneration</c>; everything downstream of this interface
/// -- rendering PDF/CSV, storage, share links, mailing the file to people who will never log
/// in -- is #91's.</para>
///
/// <para>This is the same shape as <c>INotificationSender</c>, which is stubbed until #100
/// wires a real provider in, and for the same reason: it lets the half that exists be built
/// and tested end to end without the half that does not. Report generation in this repository
/// is currently a literal stub (<c>ReportEndpoints.CreateAsync</c> writes "Report generation is
/// stubbed"), so a scheduler that tried to call it would only be scheduling a placeholder.</para>
/// </summary>
public interface IScheduledReportRunner
{
    /// <summary>
    /// Run one occurrence of a recurring report.
    ///
    /// <para><b>Implementations must be idempotent on
    /// <see cref="ScheduledReportOccurrence.OccurrenceUtc"/>.</b> The scheduler guarantees it
    /// will not ask twice under normal operation -- the advance of <c>NextGeneration</c> is
    /// committed in the same transaction as this call, under the same advisory lease -- but
    /// "normal operation" is not a guarantee worth betting an emailed report on. The occurrence
    /// instant is supplied precisely so an implementation can key its own output on it.</para>
    ///
    /// <para>Throwing aborts the transaction, which rolls back the schedule advance too, so the
    /// occurrence is retried on the next tick. That is the intended behaviour for a transient
    /// failure and the reason the advance is not committed separately first.</para>
    /// </summary>
    Task RunAsync(ScheduledReportOccurrence occurrence, CancellationToken cancellationToken);
}

/// <summary>One firing of a recurring report schedule.</summary>
/// <param name="ReportId">The recurring report definition that fired.</param>
/// <param name="CompanyId">Its tenant.</param>
/// <param name="OccurrenceUtc">
/// The scheduled instant this firing represents -- <c>NextGeneration</c> as it stood before the
/// advance, not the wall clock when the worker noticed. Two instances, or a retry an hour
/// later, compute the same value, which is what makes it usable as an idempotency key.
/// </param>
/// <param name="RecurrencePattern">The pattern that produced it, for the record.</param>
/// <param name="Format">The report's output format.</param>
public sealed record ScheduledReportOccurrence(
    Guid ReportId,
    Guid CompanyId,
    DateTimeOffset OccurrenceUtc,
    string? RecurrencePattern,
    string? Format);
