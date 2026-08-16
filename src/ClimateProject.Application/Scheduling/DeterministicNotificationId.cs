using System.Security.Cryptography;
using System.Text;

namespace ClimateProject.Application.Scheduling;

/// <summary>
/// RFC 4122 version 5 (name-based, SHA-1) UUIDs, used to give every notification a scheduled
/// job produces a primary key that is a pure function of *what the notification is* rather
/// than of when it happened to be created.
///
/// <para><b>This is the double-send defence, and it is the only one that is a proof.</b>
/// App Runner's default autoscaling configuration tops out at 25 instances, and nothing in
/// the platform pins the scheduler to one of them. Advisory locking (see
/// <c>PostgresAdvisoryJobLease</c>) stops two instances doing the same work at the same time,
/// and re-reading persisted state stops a second tick redoing the first tick's work -- but
/// both are *avoidance*, and avoidance has a failure mode: a lock lost to a connection reset,
/// a tick that overran, a manual re-run during an incident. Making the id deterministic
/// changes the guarantee from "we try not to" to "the database will not let us": the second
/// insert of the same logical notification carries the same <c>id</c> as the first and
/// violates <c>notifications_pkey</c>.</para>
///
/// <para>The name fed in must therefore identify the notification, not the attempt. For a
/// digest that is (recipient, period key) -- see <see cref="ForDigest"/>. For a reminder it
/// is (invitation, ordinal) -- see <see cref="ForReminder"/>. Neither contains a timestamp,
/// a machine id, or a counter that a restart could reset.</para>
///
/// <para>The scheme, and the choice of v5, deliberately match the ETL design in
/// <c>docs/superpowers/specs/2026-08-03-mongo-to-postgres-etl-design.md</c>, which already
/// uses <c>uuidv5(namespace, key)</c> to make the Mongo import re-runnable. Two mechanisms
/// with the same shape for the same reason is one idea; two different ones would be two.</para>
///
/// <para>SHA-1 is used because RFC 4122 v5 specifies SHA-1 -- this is a namespacing
/// construction, not a security primitive. Nothing here authenticates anything, the inputs
/// are non-secret ids the caller already holds, and a collision would cost one skipped
/// notification rather than any breach of confidentiality or integrity.</para>
/// </summary>
public static class DeterministicNotificationId
{
    /// <summary>
    /// Namespace for scheduled digest notifications. A fixed, arbitrary, never-reused GUID:
    /// changing it re-keys every future digest and would let one already-sent digest be sent a
    /// second time, so it is a constant in source rather than anything configurable.
    /// </summary>
    public static readonly Guid DigestNamespace = new("6b1c9d02-4f3a-5a7e-9b21-0c4d8f61a3e7");

    /// <summary>Namespace for survey reminder notifications. See <see cref="DigestNamespace"/>.</summary>
    public static readonly Guid SurveyReminderNamespace = new("2f8e5a41-73d6-5c19-8e4b-1a9f0d27c6b3");

    /// <summary>Namespace for microclimate reminder notifications. See <see cref="DigestNamespace"/>.</summary>
    public static readonly Guid MicroclimateReminderNamespace = new("9d3b7c68-1e05-5f42-a7c8-53b6e2049f1d");

    /// <summary>Namespace for scheduled report delivery notifications (#91). See <see cref="DigestNamespace"/>.</summary>
    public static readonly Guid ScheduledReportNamespace = new("4e8a2c17-6b93-5d40-8f5a-b1c09e37d264");

    /// <summary>The id of the digest for <paramref name="userId"/> covering <paramref name="periodKey"/>.</summary>
    public static Guid ForDigest(Guid userId, string periodKey)
        => Create(DigestNamespace, string.Create(null, $"{userId:D}:{periodKey}"));

    /// <summary>
    /// The id of the <paramref name="reminderNumber"/>-th reminder for a survey invitation.
    ///
    /// Keyed on the ordinal rather than on a date: a reminder is "the third nudge for this
    /// invitation", and that identity has to survive the schedule being changed underneath it.
    /// If an admin widens the reminder interval from 3 days to 7, the third reminder is still
    /// the third reminder and must not be re-sent because its date moved.
    /// </summary>
    public static Guid ForReminder(Guid invitationId, int reminderNumber)
        => Create(SurveyReminderNamespace, string.Create(null, $"{invitationId:D}:{reminderNumber}"));

    /// <summary>
    /// The id of the <paramref name="reminderNumber"/>-th reminder for a microclimate
    /// invitation. A separate namespace from <see cref="ForReminder"/> because survey and
    /// microclimate invitation ids are independent GUID spaces and nothing forbids a
    /// collision between them.
    /// </summary>
    public static Guid ForMicroclimateReminder(Guid invitationId, int reminderNumber)
        => Create(MicroclimateReminderNamespace, string.Create(null, $"{invitationId:D}:{reminderNumber}"));

    /// <summary>
    /// The id of the delivery notification for one occurrence of a recurring report (#91).
    ///
    /// Keyed on the occurrence instant, which is <c>NextGeneration</c> as it stood before the
    /// schedule advanced -- a stored value every instance and every retry computes identically
    /// (see <c>ScheduledReportOccurrence.OccurrenceUtc</c>) -- never on the wall clock when a
    /// worker happened to notice. <c>UtcTicks</c> rather than a formatted string so the key
    /// cannot vary with culture or with how many fractional digits a format chose to print.
    /// </summary>
    public static Guid ForScheduledReport(Guid reportId, DateTimeOffset occurrenceUtc)
        => Create(ScheduledReportNamespace, string.Create(null, $"{reportId:D}:{occurrenceUtc.UtcTicks}"));

    /// <summary>
    /// The RFC 4122 v5 UUID of <paramref name="name"/> within <paramref name="namespaceId"/>.
    /// </summary>
    public static Guid Create(Guid namespaceId, string name)
    {
        ArgumentNullException.ThrowIfNull(name);

        var nameBytes = Encoding.UTF8.GetBytes(name);
        var buffer = new byte[16 + nameBytes.Length];

        // Big-endian on the way in and on the way out. .NET lays the first three fields of a
        // Guid out little-endian, so hashing Guid.ToByteArray() would produce ids that no
        // other RFC 4122 implementation -- including the ETL's -- could reproduce. The
        // scheme is only worth anything if it is the same scheme everywhere.
        namespaceId.TryWriteBytes(buffer.AsSpan(0, 16), bigEndian: true, out _);
        nameBytes.CopyTo(buffer.AsSpan(16));

        var hash = SHA1.HashData(buffer);

        hash[6] = (byte)((hash[6] & 0x0F) | 0x50); // version 5
        hash[8] = (byte)((hash[8] & 0x3F) | 0x80); // RFC 4122 variant

        return new Guid(hash.AsSpan(0, 16), bigEndian: true);
    }

    /// <summary>
    /// A stable 64-bit key for <c>pg_try_advisory_xact_lock</c>, derived from a job name.
    ///
    /// Postgres advisory locks are keyed by a bare integer with no registry behind them, so
    /// two unrelated pieces of code can silently contend on the same number. Deriving the key
    /// from the job's name makes collisions between *our* jobs impossible by construction and
    /// makes the number reproducible from the name during an incident, which a hand-assigned
    /// magic constant is not.
    /// </summary>
    public static long LockKey(string jobName)
    {
        ArgumentNullException.ThrowIfNull(jobName);

        var hash = SHA1.HashData(Encoding.UTF8.GetBytes("climate-project.job:" + jobName));
        return BitConverter.ToInt64(hash, 0);
    }
}
