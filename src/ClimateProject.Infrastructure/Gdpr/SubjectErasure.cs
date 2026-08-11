using ClimateProject.Application.Gdpr;
using ClimateProject.Application.OrgStructure;
using ClimateProject.Domain.Entities;
using ClimateProject.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace ClimateProject.Infrastructure.Gdpr;

/// <summary>
/// Carries out an erasure request (GDPR Art. 17) against this database.
///
/// <para><b>Erasure here is irreversible pseudonymisation, not DELETE, and that is a
/// position rather than a shortcut.</b> Sixteen foreign keys into <c>users</c> are
/// <c>ON DELETE RESTRICT</c> — <c>surveys.created_by</c>, <c>reports.created_by</c>,
/// <c>survey_audit_logs.user_id</c>, <c>demographic_snapshot_entries.user_id</c> and the
/// rest — so a row delete either fails outright or, with those restrictions relaxed, takes
/// the company's business records and its audit trail with it. Two obligations pull against
/// Art. 17 and both are recognised by it:</para>
/// <list type="number">
/// <item><description><b>Aggregate integrity.</b> Every climate score, benchmark and trend the
/// employer has acted on is an aggregate over <c>responses</c>. Deleting one person's answers
/// silently restates published figures. Art. 17 does not reach anonymous data, so the
/// responses are anonymised instead — <c>user_id</c> severed and the identifying envelope
/// (IP, user agent, session id) cleared — after which they are no longer that person's
/// data.</description></item>
/// <item><description><b>The audit trail.</b> <c>audit_logs</c> and <c>survey_audit_logs</c>
/// are what let the platform show who did what to whose data. Erasing them defeats the
/// mechanism the right depends on, so they are retained under Art. 17(3)(b) and (e). The one
/// concession is that <c>survey_audit_logs</c> denormalises the actor's name and email onto
/// every row; those copies are overwritten, because <c>user_id</c> still resolves to the
/// pseudonymised account and the trail stays attributable without them.</description></item>
/// </list>
///
/// <para>The full reasoning, including what a data subject is told and where this
/// implementation falls short, is in <c>docs/compliance/gdpr-subject-rights.md</c>. Every
/// table's treatment is declared in <see cref="SubjectDataMap"/> and this class returns one
/// <see cref="ErasureAction"/> per treated table, so the response itself states what was and
/// was not erased.</para>
///
/// <para><b>No orphans.</b> Because the account row survives, no foreign key into
/// <c>users</c> is left dangling. The three tables deleted outright
/// (<c>user_demographics</c>, <c>notifications</c>, <c>survey_drafts</c>) are the principal
/// end of no foreign key except an owned type stored in their own row, and
/// <c>user_invitation_demographics</c> is deleted only through its own parent key. Note what
/// backs that: Postgres enforces every one of those constraints, so a statement here that
/// orphaned a row would be refused rather than committed. A test that counts dangling keys
/// afterwards therefore proves the schema, not this class — what the tests hold is that the
/// erasure reaches the tables it claims to, and
/// <c>GdprEndpointsTests.Erasure_leaves_the_subjects_address_in_no_column_of_any_table</c> is
/// the one that goes red when it stops doing so.</para>
///
/// <para><b>Scoped to the caller's authority.</b> The invitee side of <c>user_invitations</c>
/// is matched by email alone, and an address is not tenant-unique, so an unscoped predicate
/// would redact and delete rows in companies the caller has no rights in — invisibly, since
/// nothing in that tenant would carry a record of it. <c>companyScope</c> is null only for a
/// super admin, whose reach is every tenant by design.</para>
///
/// <para><b>Scope: this database only.</b> <c>services/tracking-api</c> caches the roster and
/// keys its action plans by persona external id; this API cannot reach it, so the response is
/// marked incomplete. See <see cref="SubjectDataSources"/>.</para>
/// </summary>
public static class SubjectErasure
{
    /// <summary>
    /// What a redacted free-text or identifier column is set to. A single marker, so a
    /// maintainer reading the table can tell an erasure from a blank value somebody never
    /// filled in.
    /// </summary>
    public const string RedactedValue = "[erased]";

    /// <summary>The pseudonymised display name.</summary>
    public const string ErasedName = "Erased user";

    /// <summary>
    /// Reserved by RFC 2606 and guaranteed never to resolve, so a pseudonymised address can
    /// never become a real mailbox. The local part carries the user id because
    /// <c>users.email</c> is uniquely indexed and two erasures in the same tenant must not
    /// collide.
    /// </summary>
    public static string PseudonymisedEmail(Guid userId) => $"erased-{userId:N}@erased.invalid";

    /// <summary>
    /// Erases the subject and returns what was done, table by table.
    /// </summary>
    /// <param name="companyScope">
    /// The single tenant the caller has authority over, or null for a super admin. Constrains
    /// every lookup that matches on an email address rather than on a foreign key.
    /// </param>
    /// <remarks>
    /// Runs inside an explicit transaction, and the reason is specific rather than
    /// belt-and-braces: the deletes below go through <c>ExecuteDeleteAsync</c>, which issues
    /// its statement immediately and does <b>not</b> wait for <c>SaveChangesAsync</c>. Without
    /// a transaction wrapping both, a failure between the first delete and the final save
    /// would leave a subject whose demographics were gone and whose account still carried
    /// their name — a half-erasure that no retry would notice, because the second run would
    /// find nothing left to delete and report success.
    /// </remarks>
    public static async Task<ErasureResponse> EraseAsync(
        ClimateProjectDbContext db,
        User subject,
        Guid? companyScope,
        DateTimeOffset erasedAt,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(db);
        ArgumentNullException.ThrowIfNull(subject);

        await using var transaction = await db.Database.BeginTransactionAsync(cancellationToken);
        var response = await EraseWithinTransactionAsync(db, subject, companyScope, erasedAt, cancellationToken);
        await transaction.CommitAsync(cancellationToken);
        return response;
    }

    private static async Task<ErasureResponse> EraseWithinTransactionAsync(
        ClimateProjectDbContext db,
        User subject,
        Guid? companyScope,
        DateTimeOffset erasedAt,
        CancellationToken cancellationToken)
    {
        var id = subject.Id;

        // Captured before the account row is rewritten: the invitee side of user_invitations
        // is matched on email alone, and after pseudonymisation there is nothing left to match.
        var originalEmail = subject.Email;
        var identity = new SubjectIdentity(id, originalEmail, subject.Name);

        var actions = new List<ErasureAction>();

        // --- Deleted --------------------------------------------------------------------
        actions.Add(await DeleteAsync("UserDemographic",
            db.UserDemographics.Where(d => d.UserId == id), cancellationToken));
        actions.Add(await DeleteAsync("Notification",
            db.Notifications.Where(n => n.UserId == id), cancellationToken));
        actions.Add(await DeleteAsync("SurveyDraft",
            db.SurveyDrafts.Where(d => d.UserId == id), cancellationToken));

        var invitationIds = await SubjectAccessExport
            .AddressedInvitations(db, originalEmail, companyScope)
            .Select(i => i.Id)
            .ToListAsync(cancellationToken);
        actions.Add(await DeleteAsync("UserInvitationDemographic",
            db.UserInvitationDemographics.Where(d => invitationIds.Contains(d.InvitationId)), cancellationToken));

        // --- Redacted -------------------------------------------------------------------
        // The same predicates the export uses, deliberately: a row the export hands to the
        // subject as theirs and the eraser then leaves alone is the two halves of this feature
        // disagreeing about whose data it is.
        var surveyInvitations = await SubjectAccessExport
            .SurveyInvitationsFor(db, id, originalEmail, companyScope)
            .ToListAsync(cancellationToken);
        foreach (var invitation in surveyInvitations)
        {
            invitation.Email = RedactedValue;
            invitation.InvitationToken = NonResolvableToken();
            invitation.Metadata = null;
            invitation.UpdatedAt = erasedAt;
        }
        actions.Add(Action("SurveyInvitation", surveyInvitations.Count));

        var microclimateInvitations = await SubjectAccessExport
            .MicroclimateInvitationsFor(db, id, originalEmail, companyScope)
            .ToListAsync(cancellationToken);
        foreach (var invitation in microclimateInvitations)
        {
            invitation.Email = RedactedValue;
            invitation.InvitationToken = NonResolvableToken();
            invitation.Metadata = null;
            invitation.UpdatedAt = erasedAt;
        }
        actions.Add(Action("MicroclimateInvitation", microclimateInvitations.Count));

        // Only the invitee side. An invitation this person *sent* is an administrative act on
        // the company's behalf and names somebody else; invited_by is retained.
        var userInvitations = await SubjectAccessExport
            .AddressedInvitations(db, originalEmail, companyScope)
            .ToListAsync(cancellationToken);
        foreach (var invitation in userInvitations)
        {
            invitation.Email = RedactedValue;
            invitation.InvitationToken = NonResolvableToken();
            invitation.InvitationData = null;
            invitation.Metadata = null;
        }
        actions.Add(Action("UserInvitation", userInvitations.Count));

        // The denormalised identity copies only. user_id, action, entity, changes, timestamp,
        // IP and user agent all stay -- see the class remarks.
        var surveyAuditLogs = await SubjectAccessExport
            .SurveyAuditLogsFor(db, id, originalEmail, companyScope)
            .ToListAsync(cancellationToken);
        foreach (var entry in surveyAuditLogs)
        {
            entry.UserName = ErasedName;
            entry.UserEmail = RedactedValue;
        }
        actions.Add(Action("SurveyAuditLog", surveyAuditLogs.Count));

        // --- Anonymised -----------------------------------------------------------------
        var responses = await db.Responses.Where(r => r.UserId == id).ToListAsync(cancellationToken);
        foreach (var response in responses)
        {
            response.UserId = null;
            response.IpAddress = null;
            response.UserAgent = null;

            // is_anonymous is deliberately NOT flipped to true. It records what the respondent
            // chose at submission time -- SurveyResponseEndpoints reads it back and
            // SurveyResponsePrivacy branches on it -- and rewriting it afterwards would put a
            // choice in someone's mouth. The resulting row, is_anonymous = false with a null
            // user_id, is a state the schema already provides for: responses.user_id is
            // ON DELETE SET NULL precisely so an answer can outlive its author.
            //
            // session_id is NOT NULL and correlates the sittings of one browser session, so it
            // is replaced rather than cleared. A fresh value per row means the sittings can no
            // longer be correlated with each other either -- which is the point: a session id
            // shared across an erased subject's answers would re-link them.
            response.SessionId = $"erased-{Guid.NewGuid():N}";
            response.UpdatedAt = erasedAt;
        }
        actions.Add(Action("Response", responses.Count));

        AnonymiseAccount(subject, erasedAt);
        actions.Add(Action("User", 1));

        // --- Retained -------------------------------------------------------------------
        // Counted, not touched. Reporting a zero here would read as "there was nothing", which
        // is a different statement from "there was something and it was kept, for this reason".
        actions.Add(await RetainedAsync("AuditLog",
            db.AuditLogs.Where(a => a.UserId == id), cancellationToken));
        actions.Add(await RetainedAsync("DemographicSnapshotEntry",
            db.DemographicSnapshotEntries.Where(e => e.UserId == id), cancellationToken));
        var responseIds = responses.Select(r => r.Id).ToList();
        actions.Add(await RetainedAsync("QuestionResponse",
            db.QuestionResponses.Where(q => responseIds.Contains(q.ResponseId)), cancellationToken));
        actions.Add(await RetainedAsync("ResponseDemographic",
            db.ResponseDemographics.Where(rd => responseIds.Contains(rd.ResponseId)), cancellationToken));

        await db.SaveChangesAsync(cancellationToken);

        return new ErasureResponse(
            identity,
            erasedAt,
            Complete: false,
            Sources:
            [
                SubjectDataSources.Primary($"Erased in place: {actions.Count} tables acted on or explicitly retained."),
                SubjectDataSources.TrackingUnavailable(),
            ],
            Limitations: KnownLimitations,
            Actions: actions);
    }

    /// <summary>
    /// What an erasure here does not achieve, stated in the response rather than left for a
    /// regulator to find. Mirrored in <c>docs/compliance/gdpr-subject-rights.md</c>.
    /// </summary>
    public static readonly IReadOnlyList<string> KnownLimitations =
    [
        "Free text is not scrubbed. An open-ended answer (question_responses.response_text), an audit change "
        + "payload (survey_audit_logs.changes, audit_logs.details) or an invitation payload can name a person "
        + "inside prose, and no automated rule can find that reliably. Those columns are retained as written.",

        "Survey responses are anonymised, not deleted: user_id, IP address and user agent are cleared and the "
        + "session id is replaced, but the answers themselves remain so that the aggregates the employer has "
        + "already acted on are not silently restated.",

        "Audit records are retained under Art. 17(3)(b) and (e). audit_logs is untouched; survey_audit_logs "
        + "keeps everything except the denormalised copy of the actor's name and email.",

        "The account row survives as a pseudonym. Sixteen foreign keys into users are ON DELETE RESTRICT, so a "
        + "row delete is not available without destroying the audit trail and the company's business records.",

        "A session the subject already holds is not ended. The account is deactivated, so no new token can be "
        + "issued for it -- /auth/login and /auth/refresh both refuse an inactive account -- but an access token "
        + "minted before the erasure is self-contained and keeps authorising requests until it expires, unless "
        + "it identifies the account by a legacy persona id, which erasure clears. Revoking an outstanding token "
        + "needs a per-user security stamp checked on every request, which is #284's work and is not duplicated "
        + "here.",

        "Rows matched by email address are erased only inside the tenant the caller has authority over. An "
        + "address is not unique across tenants, and an invitation held by another company is that company's "
        + "record: a company administrator's erasure does not reach it. A super admin's erasure is not scoped.",

        SubjectDataSources.TrackingUnavailableDetail,
    ];

    /// <summary>
    /// Overwrites the identifiers on the account row itself.
    /// </summary>
    /// <remarks>
    /// <para><c>CompanyId</c> is deliberately left in place. A null <c>company_id</c> on
    /// <c>users</c> does not mean "no tenant" in this schema — it means global scope, which
    /// today only a super admin holds (see the remark on <c>User.CompanyId</c>). Clearing it
    /// during an erasure would widen the row's scope rather than narrow it.</para>
    ///
    /// <para><c>Role</c> is left in place for the same class of reason: it is not identifying,
    /// and the retained attribution rows read correctly only if the actor's role still says
    /// what it said. The account is deactivated, so the role grants nothing.</para>
    ///
    /// <para><c>DepartmentId</c> and <c>ManagerId</c> are cleared. "Worked in this team,
    /// reported to this person" is a fact about the individual and nothing aggregates over the
    /// live account row — the department a response was filed under is copied onto
    /// <c>responses.department_id</c> and onto <c>response_demographics</c> at submission time,
    /// so clearing these changes no reported figure.</para>
    ///
    /// <para>Consent flags are set to withdrawn and the notification opt-outs to silence, so
    /// that nothing downstream can read a live permission off an erased account. Preferences
    /// go back to defaults because a timezone is weakly identifying.</para>
    ///
    /// <para><c>IsActive = false</c> closes the door on new tokens, not on old ones, and the
    /// difference matters enough to say here rather than only in the response. It is read at
    /// <c>AuthEndpoints.IssueTokenForAsync</c>, which every mint in this API goes through, and
    /// at the <c>/auth/login</c> lookup — both of them mint-time checks. Nothing consults it
    /// per request: <c>ActingUserResolver</c> resolves the <c>sub</c> claim to this row by id,
    /// which erasure does not change, so an access token issued before the erasure keeps
    /// working until it expires. (One shape does die with the erasure, by accident rather than
    /// design: a token whose <c>sub</c> is a legacy <c>PersonaExternalId</c> stops resolving,
    /// because that column is cleared above. Every token this API mints for an account without
    /// one carries the account's own id.) Revoking one needs a per-user security stamp validated on
    /// every request; that is #284, and a second mechanism invented here would be one more
    /// thing to keep in step with it. Do not describe an erasure as "ends the subject's
    /// session" anywhere, for the reason <c>ProfileEndpoints.ChangePasswordAsync</c> gives
    /// about the identical gap on a password change ("do not summarise this route as 'ends
    /// the compromise' anywhere").</para>
    /// </remarks>
    private static void AnonymiseAccount(User subject, DateTimeOffset erasedAt)
    {
        subject.Email = PseudonymisedEmail(subject.Id);
        subject.Name = ErasedName;
        subject.PasswordHash = null;
        subject.PersonaExternalId = null;
        subject.LastLoginAt = null;
        subject.DepartmentId = null;
        subject.ManagerId = null;
        subject.IsActive = false;

        subject.Preferences = new UserPreferences();

        subject.Notifications = new NotificationPreferences
        {
            EmailSurveys = false,
            EmailMicroclimates = false,
            EmailActionPlans = false,
            EmailReminders = false,
            PushNotifications = false,
            DigestFrequency = NotificationPreferenceValidation.DigestNever,
        };

        subject.Consent = new UserConsent
        {
            Essential = false,
            Analytics = false,
            Marketing = false,
            Personalization = false,
            ThirdParty = false,
            Demographics = false,
        };
        subject.ConsentUpdatedAt = erasedAt;
        subject.UpdatedAt = erasedAt;
    }

    /// <summary>
    /// A replacement for an invitation token.
    /// </summary>
    /// <remarks>
    /// Not <see cref="RedactedValue"/>: <c>invitation_token</c> is looked up by value to accept
    /// an invitation, and a constant would make every redacted invitation collide with every
    /// other one — and, where the column is uniquely indexed, make the second erasure fail. A
    /// fresh random value is unguessable and unique, and the invitation it belongs to is dead
    /// because the account is deactivated.
    /// </remarks>
    private static string NonResolvableToken() => $"erased-{Guid.NewGuid():N}";

    private static async Task<ErasureAction> DeleteAsync<T>(
        string entity,
        IQueryable<T> rows,
        CancellationToken cancellationToken)
        where T : class
    {
        var deleted = await rows.ExecuteDeleteAsync(cancellationToken);
        return Action(entity, deleted);
    }

    private static async Task<ErasureAction> RetainedAsync<T>(
        string entity,
        IQueryable<T> rows,
        CancellationToken cancellationToken)
        where T : class
    {
        return Action(entity, await rows.CountAsync(cancellationToken));
    }

    private static ErasureAction Action(string entity, int rowsAffected)
    {
        var mapped = SubjectDataMap.Find(entity)
            ?? throw new InvalidOperationException(
                $"'{entity}' is erased but is not in SubjectDataMap. The map is the record of what is held and "
                + "what erasure does to it; an erasure that reaches a table the map does not describe means the "
                + "two have diverged.");

        return new ErasureAction(mapped.Entity, mapped.Table, mapped.Erasure, rowsAffected, mapped.Rationale);
    }
}
