using ClimateProject.Application.Scheduling;

namespace ClimateProject.UnitTests.Scheduling;

/// <summary>
/// The double-send defence.
///
/// #101's central requirement is "double-send under multiple instances proven impossible".
/// The proof is that a repeated notification carries a repeated primary key, and these tests
/// are what establish the premise that proof rests on: that the id is a pure function of the
/// notification's identity, agreed on by every instance, forever.
/// </summary>
public class DeterministicNotificationIdTests
{
    private static readonly Guid UserId = new("6f0a1c33-2b8d-4e77-9a51-0d3c7e2b4f16");
    private static readonly Guid InvitationId = new("a1b2c3d4-e5f6-4718-8293-0a1b2c3d4e5f");

    [Fact]
    public void The_same_recipient_and_period_always_yield_the_same_id()
    {
        // This is the whole guarantee: two instances, or the same instance a week later,
        // compute the same primary key and the second INSERT cannot land.
        Assert.Equal(
            DeterministicNotificationId.ForDigest(UserId, "2026-W32"),
            DeterministicNotificationId.ForDigest(UserId, "2026-W32"));
    }

    [Fact]
    public void Different_periods_yield_different_ids()
    {
        // The other half: successive digests must not collide, or the second period's digest
        // would be silently swallowed as a duplicate of the first's.
        Assert.NotEqual(
            DeterministicNotificationId.ForDigest(UserId, "2026-W32"),
            DeterministicNotificationId.ForDigest(UserId, "2026-W33"));
    }

    [Fact]
    public void Different_recipients_yield_different_ids_for_the_same_period()
    {
        var other = new Guid("00000000-0000-0000-0000-000000000001");

        Assert.NotEqual(
            DeterministicNotificationId.ForDigest(UserId, "2026-W32"),
            DeterministicNotificationId.ForDigest(other, "2026-W32"));
    }

    [Fact]
    public void Reminder_ids_are_keyed_on_the_ordinal()
    {
        Assert.Equal(
            DeterministicNotificationId.ForReminder(InvitationId, 2),
            DeterministicNotificationId.ForReminder(InvitationId, 2));

        Assert.NotEqual(
            DeterministicNotificationId.ForReminder(InvitationId, 2),
            DeterministicNotificationId.ForReminder(InvitationId, 3));
    }

    [Fact]
    public void Survey_and_microclimate_reminders_never_collide_on_the_same_invitation_id()
    {
        // survey_invitations.id and microclimate_invitations.id are independent GUID spaces and
        // nothing forbids the same value appearing in both. Separate namespaces are what stop
        // one surface's reminder being swallowed as a duplicate of the other's.
        Assert.NotEqual(
            DeterministicNotificationId.ForReminder(InvitationId, 1),
            DeterministicNotificationId.ForMicroclimateReminder(InvitationId, 1));
    }

    [Fact]
    public void Scheduled_report_ids_are_keyed_on_the_occurrence_instant()
    {
        // The occurrence is NextGeneration as it stood before the advance -- a stored value
        // every instance and every retry computes identically -- which is what makes a
        // replayed occurrence (#91) a primary-key violation instead of a second email.
        var reportId = new Guid("b7e2d4a1-9c3f-4562-8d10-5f6a7b8c9d0e");
        var occurrence = new DateTimeOffset(2026, 8, 16, 9, 0, 0, TimeSpan.Zero);

        Assert.Equal(
            DeterministicNotificationId.ForScheduledReport(reportId, occurrence),
            DeterministicNotificationId.ForScheduledReport(reportId, occurrence));

        Assert.NotEqual(
            DeterministicNotificationId.ForScheduledReport(reportId, occurrence),
            DeterministicNotificationId.ForScheduledReport(reportId, occurrence.AddDays(1)));

        // The same instant written with a different offset is the same occurrence: the key is
        // UtcTicks, so +00:00 and the same moment expressed as -05:00 must not double-send.
        Assert.Equal(
            DeterministicNotificationId.ForScheduledReport(reportId, occurrence),
            DeterministicNotificationId.ForScheduledReport(reportId, occurrence.ToOffset(TimeSpan.FromHours(-5))));
    }

    [Fact]
    public void Namespaces_are_distinct_from_one_another()
    {
        Guid[] namespaces =
        [
            DeterministicNotificationId.DigestNamespace,
            DeterministicNotificationId.SurveyReminderNamespace,
            DeterministicNotificationId.MicroclimateReminderNamespace,
            DeterministicNotificationId.ScheduledReportNamespace,
        ];

        Assert.Equal(namespaces.Length, namespaces.Distinct().Count());
    }

    [Fact]
    public void Generated_ids_are_well_formed_rfc_4122_version_5_uuids()
    {
        // Not cosmetic. Postgres stores these in a uuid column and the ETL (#154) uses the same
        // construction; a value that is not a conformant v5 UUID would be a value produced by a
        // different scheme than the one documented, which is how two "deterministic" generators
        // silently stop agreeing.
        var id = DeterministicNotificationId.ForDigest(UserId, "2026-08");
        var bytes = new byte[16];
        Assert.True(id.TryWriteBytes(bytes, bigEndian: true, out _));

        Assert.Equal(0x50, bytes[6] & 0xF0);        // version 5
        Assert.Equal(0x80, bytes[8] & 0xC0);        // RFC 4122 variant
        Assert.NotEqual(Guid.Empty, id);
    }

    [Fact]
    public void The_construction_matches_the_published_rfc_4122_test_vector()
    {
        // uuidv5(DNS namespace, "www.example.org") is the canonical worked example in RFC 4122
        // and its successors. Pinning it proves the big-endian handling of the namespace is
        // right -- .NET lays a Guid's first three fields out little-endian, so hashing
        // ToByteArray() would produce a plausible-looking id that no other implementation,
        // including the ETL's, could reproduce.
        var dnsNamespace = new Guid("6ba7b810-9dad-11d1-80b4-00c04fd430c8");

        Assert.Equal(
            new Guid("74738ff5-5367-5958-9aee-98fffdcd1876"),
            DeterministicNotificationId.Create(dnsNamespace, "www.example.org"));
    }

    // -- advisory lock keys -------------------------------------------------------------

    [Fact]
    public void Lock_keys_are_stable_for_a_job_name()
    {
        // A key that varied between instances or across restarts would be no lock at all --
        // every instance would hold "its own" lock and run concurrently.
        Assert.Equal(
            DeterministicNotificationId.LockKey(WorkerJobs.Digests),
            DeterministicNotificationId.LockKey(WorkerJobs.Digests));
    }

    [Fact]
    public void Every_job_gets_its_own_lock_key()
    {
        // Two jobs sharing a key would serialise against each other -- the digest sweep would
        // block reminders and vice versa -- which looks exactly like a wedged worker.
        var keys = WorkerJobs.All.Select(DeterministicNotificationId.LockKey).ToList();

        Assert.Equal(WorkerJobs.All.Length, keys.Distinct().Count());
    }

    [Fact]
    public void Job_names_are_distinct()
        => Assert.Equal(WorkerJobs.All.Length, WorkerJobs.All.Distinct(StringComparer.Ordinal).Count());
}
