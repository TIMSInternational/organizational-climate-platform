using ClimateProject.Application.Gdpr;
using ClimateProject.Domain.Entities;
using ClimateProject.Infrastructure.Persistence;
using ClimateProject.Infrastructure.Persistence.Configurations;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.ChangeTracking;

namespace ClimateProject.Infrastructure.Gdpr;

/// <summary>
/// Builds a subject access response (GDPR Art. 15) from this database.
///
/// <para><b>One section per classified table, always.</b> Every entry in
/// <see cref="SubjectDataMap.Entries"/> whose <see cref="SubjectDataEntry.Export"/> is not
/// <see cref="ExportTreatment.None"/> produces a section here, and a section is emitted even
/// when it is empty. An absent section and an empty section mean different things to whoever
/// answers the request — "we did not look" versus "we looked and there is nothing" — and only
/// the second one discharges the obligation. <c>GdprEndpointsTests</c> asserts the section
/// set equals the map's exported set, so adding a table to the map without exporting it fails
/// rather than silently shrinking the response.</para>
///
/// <para><b>Columns come from the model, not from a projection.</b> Full records are
/// materialised as entities and then flattened through <c>ChangeTracker</c> metadata, so a
/// column added to a table later appears in the export with no change here — including
/// shadow properties and the owned types that share their owner's table (a user's
/// preferences, notification opt-outs and consent flags all arrive this way). Two kinds of
/// column are held back deliberately: the generated <c>search_vector</c>, which is a derived
/// index over columns already present and has no JSON form, and
/// <see cref="SubjectDataMap.RedactedColumns"/>, which are credentials.</para>
///
/// <para><b>Attribution is exported as a reference, never expanded.</b> Where the subject
/// appears as an author or a manager, the section carries the record's id and label and stops
/// there. Expanding a survey the subject created would hand its responses — other employees'
/// answers about their employer — to whoever asked, which is a disclosure, not an export.</para>
///
/// <para><b>Every email-matched lookup is scoped to the caller's authority.</b> An email
/// address is not tenant-unique: <c>user_invitations</c> names its invitee by email alone, and
/// <c>survey_invitations</c>, <c>microclimate_invitations</c>, <c>survey_audit_logs</c> and
/// <c>reports.shared_with</c> each carry an address column of their own. Matching on the address
/// with no company predicate therefore reaches rows in tenants the caller has no rights in —
/// another company's invitation to the same address, in full, including its free-form payload
/// and the id of the administrator who sent it. So <c>companyScope</c> is passed in from the
/// caller's own authority (null only for a super admin, who has every tenant) and constrains
/// every one of those lookups. The foreign-key lookups need no such predicate: a
/// <c>user_id</c> is the subject.</para>
///
/// <para><b>Incomplete by construction.</b> <c>services/tracking-api</c> holds subject data in
/// its own database and this API cannot read it; see <see cref="SubjectDataSources"/>. The
/// response is marked <see cref="SubjectAccessResponse.Complete"/> = false and names the store
/// it could not reach.</para>
/// </summary>
public static class SubjectAccessExport
{
    /// <summary>
    /// The key every exported record carries, naming which of the entity's declared link
    /// properties matched this row. It is what makes a mixed section readable — a
    /// <c>user_invitations</c> section holds both invitations addressed to the subject and
    /// invitations they sent, and the two are not the same disclosure.
    /// </summary>
    public const string LinkKey = "_link";

    /// <summary>Identifier key on a reference record.</summary>
    public const string IdKey = "id";

    /// <summary>Human-readable label key on a reference record.</summary>
    public const string LabelKey = "label";

    /// <summary>
    /// Things this export cannot do, stated in the response rather than left for a regulator
    /// to discover. Mirrored in <c>docs/compliance/gdpr-subject-rights.md</c>.
    /// </summary>
    public static readonly IReadOnlyList<string> KnownLimitations =
    [
        "Free-text answers (question_responses.response_text) and change payloads "
        + "(survey_audit_logs.changes, audit_logs.details, user_invitations.invitation_data) are opaque strings. "
        + "They are exported verbatim, but nothing here can find a third party named inside one, so a request "
        + "about a person mentioned only in someone else's free text will not match.",

        "Responses submitted anonymously carry no user_id and are not linked to the person who submitted them. "
        + "They cannot be included in, or removed from, a response to a request about that person — by design.",

        "Rows matched by email address are searched only inside the tenant the caller has authority over. An "
        + "email address is not unique across tenants, so an invitation or an audit copy of the address held by "
        + "another company is that company's record and is not disclosed here. A super admin's export is not "
        + "scoped this way.",

        SubjectDataSources.TrackingUnavailableDetail,
    ];

    /// <param name="companyScope">
    /// The single tenant the caller has authority over, or null for a super admin, who has all
    /// of them. Constrains every lookup that matches on an email address rather than on a
    /// foreign key — see the class remarks.
    /// </param>
    public static async Task<SubjectAccessResponse> BuildAsync(
        ClimateProjectDbContext db,
        User subject,
        Guid? companyScope,
        DateTimeOffset generatedAt,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(db);
        ArgumentNullException.ThrowIfNull(subject);

        var id = subject.Id;
        var email = subject.Email;
        var idText = id.ToString();

        // Harvested first: the child tables below have no person reference of their own and
        // are reachable only through these parents.
        var responseIds = await db.Responses.Where(r => r.UserId == id)
            .Select(r => r.Id).ToListAsync(cancellationToken);
        var invitationIds = await AddressedInvitations(db, email, companyScope)
            .Select(i => i.Id).ToListAsync(cancellationToken);

        var sections = new List<SubjectAccessSection>
        {
            // --- Subject: rows that exist because this person exists -------------------------
            // users.email is uniquely indexed, so the second predicate can only match the same
            // row as the first. It is written out because the map declares Email as a link
            // property of this table and a declaration nothing searches is a claim, not a rule.
            await FullAsync(db, "User", (User u) => u.Id == id ? "Id" : "Email",
                db.Users.Where(u => u.Id == id || u.Email == email), cancellationToken),
            await FullAsync(db, "UserDemographic", "UserId",
                db.UserDemographics.Where(d => d.UserId == id), cancellationToken),
            await FullAsync(db, "Response", "UserId",
                db.Responses.Where(r => r.UserId == id), cancellationToken),
            await FullAsync(db, "QuestionResponse", "ResponseId",
                db.QuestionResponses.Where(q => responseIds.Contains(q.ResponseId)), cancellationToken),
            await FullAsync(db, "ResponseDemographic", "ResponseId",
                db.ResponseDemographics.Where(rd => responseIds.Contains(rd.ResponseId)), cancellationToken),
            await FullAsync(db, "SurveyInvitation", (SurveyInvitation i) => i.UserId == id ? "UserId" : "Email",
                SurveyInvitationsFor(db, id, email, companyScope), cancellationToken),
            await FullAsync(db, "MicroclimateInvitation",
                (MicroclimateInvitation i) => i.UserId == id ? "UserId" : "Email",
                MicroclimateInvitationsFor(db, id, email, companyScope), cancellationToken),
            await FullAsync(db, "Notification", "UserId",
                db.Notifications.Where(n => n.UserId == id), cancellationToken),
            await FullAsync(db, "SurveyDraft", "UserId",
                db.SurveyDrafts.Where(d => d.UserId == id), cancellationToken),
            await FullAsync(db, "AuditLog", "UserId",
                db.AuditLogs.Where(a => a.UserId == id), cancellationToken),
            await FullAsync(db, "SurveyAuditLog", (SurveyAuditLog a) => a.UserId == id ? "UserId" : "UserEmail",
                SurveyAuditLogsFor(db, id, email, companyScope), cancellationToken),
            await FullAsync(db, "DemographicSnapshotEntry", "UserId",
                db.DemographicSnapshotEntries.Where(e => e.UserId == id), cancellationToken),
            await FullAsync(db, "UserInvitationDemographic", "InvitationId",
                db.UserInvitationDemographics.Where(d => invitationIds.Contains(d.InvitationId)), cancellationToken),

            // user_invitations is the one mixed section: invitations addressed to the subject
            // are theirs in full, invitations they *sent* name somebody else and are exported
            // as bare attribution. See the LinkKey remark above.
            await MixedInvitationsAsync(db, id, email, companyScope, cancellationToken),

            // --- Actor: the subject as author, approver or manager ---------------------------
            await ReferencesAsync("Survey", "CreatedBy",
                db.Surveys.Where(s => s.CreatedBy == id).Select(s => new Reference(s.Id, s.TitleEn)), cancellationToken),
            await ReferencesAsync("SurveyVersion", "CreatedBy",
                db.SurveyVersions.Where(v => v.CreatedBy == id)
                    .Select(v => new Reference(v.Id, "version " + v.VersionNumber)), cancellationToken),
            await ReferencesAsync("SurveyTemplate", "CreatedBy",
                db.SurveyTemplates.Where(t => t.CreatedBy == id).Select(t => new Reference(t.Id, t.Name)), cancellationToken),
            await ReferencesAsync("SurveyDistribution", "LastRegeneratedBy",
                db.SurveyDistributions.Where(d => d.LastRegeneratedBy == id)
                    .Select(d => new Reference(d.Id, d.AccessType)), cancellationToken),
            await ReferencesAsync("Microclimate", "CreatedBy",
                db.Microclimates.Where(m => m.CreatedBy == id).Select(m => new Reference(m.Id, m.TitleEn)), cancellationToken),
            await ReferencesAsync("MicroclimateTemplate", "CreatedBy",
                db.MicroclimateTemplates.Where(t => t.CreatedBy == id).Select(t => new Reference(t.Id, t.Name)), cancellationToken),
            await ReferencesAsync("ActionPlan", "CreatedBy",
                db.ActionPlans.Where(p => p.CreatedBy == id).Select(p => new Reference(p.Id, p.Title)), cancellationToken),
            await ReferencesAsync("ActionPlanTemplate", "CreatedBy",
                db.ActionPlanTemplates.Where(t => t.CreatedBy == id).Select(t => new Reference(t.Id, t.Name)), cancellationToken),
            await ReferencesAsync("ActionPlanProgressUpdate", "UpdatedBy",
                db.ActionPlanProgressUpdates.Where(u => u.UpdatedBy == id)
                    .Select(u => new Reference(u.Id, u.OverallNotes)), cancellationToken),
            await ReferencesAsync("Benchmark", "CreatedBy",
                db.Benchmarks.Where(b => b.CreatedBy == id).Select(b => new Reference(b.Id, b.Name)), cancellationToken),
            await ReferencesAsync("NotificationTemplate", "CreatedBy",
                db.NotificationTemplates.Where(t => t.CreatedBy == id).Select(t => new Reference(t.Id, t.Name)), cancellationToken),
            await ReferencesAsync("AIInsight", "AcknowledgedBy",
                db.AIInsights.Where(i => i.AcknowledgedBy == id).Select(i => new Reference(i.Id, i.Title)), cancellationToken),
            await ReferencesAsync("DemographicSnapshot", "CreatedBy",
                db.DemographicSnapshots.Where(s => s.CreatedBy == id).Select(s => new Reference(s.Id, s.Reason)), cancellationToken),
            await ReferencesAsync("DemographicSnapshotChange", "ChangedBy",
                db.DemographicSnapshotChanges.Where(c => c.ChangedBy == id)
                    .Select(c => new Reference(c.Id, c.Field)), cancellationToken),
            await ReferencesAsync("Department", "ManagerId",
                db.Departments.Where(d => d.ManagerId == id).Select(d => new Reference(d.Id, d.Name)), cancellationToken),

            // reports.shared_with is a text[] with no writer in src/ today; matched on both the
            // subject's id and their email because no code fixes which of the two it would hold.
            await ReportsAsync(db, id, idText, email, companyScope, cancellationToken),
        };

        // Direct reports are folded into the User section rather than given one of their own:
        // "who reports to this person" is a fact about the subject, but the rows are other data
        // subjects' accounts, so only the ids travel.
        sections = await AppendDirectReportsAsync(db, sections, id, cancellationToken);

        return new SubjectAccessResponse(
            new SubjectIdentity(subject.Id, subject.Email, subject.Name),
            generatedAt,
            Complete: false,
            Sources:
            [
                SubjectDataSources.Primary(
                    $"Read in full: one section for each of the {sections.Count} tables classified as holding "
                    + "subject data."),
                SubjectDataSources.TrackingUnavailable(),
            ],
            Limitations: KnownLimitations,
            Sections: sections);
    }

    private sealed record Reference(Guid Id, string? Label);

    /// <summary>
    /// Invitations addressed to the subject's email, inside the caller's authority.
    /// </summary>
    /// <remarks>
    /// The invitee of a <c>user_invitations</c> row is identified by email alone — there is no
    /// user row until they accept — so this is the one lookup that cannot fall back to a
    /// foreign key, and the one that most needs the company predicate: without it a company
    /// admin's export of their own employee returns another tenant's invitation to the same
    /// address in full.
    /// </remarks>
    internal static IQueryable<UserInvitation> AddressedInvitations(
        ClimateProjectDbContext db,
        string email,
        Guid? companyScope)
    {
        var query = db.UserInvitations.Where(i => i.Email == email);
        return companyScope is { } company ? query.Where(i => i.CompanyId == company) : query;
    }

    /// <summary>
    /// Survey invitations the subject holds, by user id or by the address on the row.
    /// </summary>
    internal static IQueryable<SurveyInvitation> SurveyInvitationsFor(
        ClimateProjectDbContext db,
        Guid id,
        string email,
        Guid? companyScope)
    {
        var query = db.SurveyInvitations.Where(i => i.UserId == id || i.Email == email);
        return companyScope is { } company ? query.Where(i => i.CompanyId == company) : query;
    }

    /// <summary>
    /// Microclimate invitations the subject holds, by user id or by the address on the row.
    /// </summary>
    internal static IQueryable<MicroclimateInvitation> MicroclimateInvitationsFor(
        ClimateProjectDbContext db,
        Guid id,
        string email,
        Guid? companyScope)
    {
        var query = db.MicroclimateInvitations.Where(i => i.UserId == id || i.Email == email);
        return companyScope is { } company ? query.Where(i => i.CompanyId == company) : query;
    }

    /// <summary>
    /// Survey audit rows attributed to the subject, by user id or by the denormalised address.
    /// </summary>
    /// <remarks>
    /// <c>survey_audit_logs</c> has no <c>company_id</c> of its own, so the tenant comes from
    /// the survey the row belongs to. The predicate is scoped as a whole rather than only its
    /// email half, which errs closed: a row attributed to the subject but hanging off another
    /// company's survey is that company's change trail either way, and a caller who is entitled
    /// to read it is a super admin, who is unscoped.
    /// </remarks>
    internal static IQueryable<SurveyAuditLog> SurveyAuditLogsFor(
        ClimateProjectDbContext db,
        Guid id,
        string email,
        Guid? companyScope)
    {
        var query = db.SurveyAuditLogs.Where(a => a.UserId == id || a.UserEmail == email);
        return companyScope is { } company
            ? query.Where(a => db.Surveys.Any(s => s.Id == a.SurveyId && s.CompanyId == company))
            : query;
    }

    /// <summary>
    /// Materialise the rows and flatten every mapped column of each.
    /// </summary>
    /// <remarks>
    /// Tracked on purpose. <c>db.Entry(row).Properties</c> is what makes the column list come
    /// from the model instead of from a projection somebody has to remember to widen, and it
    /// needs the entity tracked to reach that metadata. This is a read-only path — nothing
    /// here calls <c>SaveChangesAsync</c> — so the only cost is the snapshot.
    /// </remarks>
    private static Task<SubjectAccessSection> FullAsync<T>(
        ClimateProjectDbContext db,
        string entity,
        string linkProperty,
        IQueryable<T> query,
        CancellationToken cancellationToken)
        where T : class
        => FullAsync(db, entity, _ => linkProperty, query, cancellationToken);

    /// <summary>
    /// The same, where the link differs per row because the section is matched on more than one
    /// property — an invitation reached by user id and one reached by the address on it are not
    /// the same statement about the subject.
    /// </summary>
    private static async Task<SubjectAccessSection> FullAsync<T>(
        ClimateProjectDbContext db,
        string entity,
        Func<T, string> linkProperty,
        IQueryable<T> query,
        CancellationToken cancellationToken)
        where T : class
    {
        var rows = await query.ToListAsync(cancellationToken);
        var records = rows.Select(row => Flatten(db.Entry(row), entity, linkProperty(row))).ToList();
        return Section(entity, ExportTreatment.FullRecord, records);
    }

    private static async Task<SubjectAccessSection> ReferencesAsync(
        string entity,
        string linkProperty,
        IQueryable<Reference> query,
        CancellationToken cancellationToken)
    {
        var rows = await query.ToListAsync(cancellationToken);
        return Section(entity, ExportTreatment.Reference, rows.Select(r => ReferenceRecord(r, linkProperty)).ToList());
    }

    private static IReadOnlyDictionary<string, object?> ReferenceRecord(Reference reference, string linkProperty)
        => new Dictionary<string, object?>(StringComparer.Ordinal)
        {
            [LinkKey] = linkProperty,
            [IdKey] = reference.Id,
            [LabelKey] = reference.Label,
        };

    private static async Task<SubjectAccessSection> ReportsAsync(
        ClimateProjectDbContext db,
        Guid id,
        string idText,
        string email,
        Guid? companyScope,
        CancellationToken cancellationToken)
    {
        // shared_with is matched on the address as well as on the id, so it carries the same
        // cross-tenant reach as the invitation tables and takes the same predicate.
        IQueryable<Report> reports = db.Reports;
        if (companyScope is { } company)
        {
            reports = reports.Where(r => r.CompanyId == company);
        }

        var authored = await reports.Where(r => r.CreatedBy == id)
            .Select(r => new Reference(r.Id, r.Title)).ToListAsync(cancellationToken);
        var shared = await reports
            .Where(r => r.CreatedBy != id && (r.SharedWith.Contains(idText) || r.SharedWith.Contains(email)))
            .Select(r => new Reference(r.Id, r.Title)).ToListAsync(cancellationToken);

        var records = authored.Select(r => ReferenceRecord(r, "CreatedBy"))
            .Concat(shared.Select(r => ReferenceRecord(r, "SharedWith")))
            .ToList();

        return Section("Report", ExportTreatment.Reference, records);
    }

    private static async Task<SubjectAccessSection> MixedInvitationsAsync(
        ClimateProjectDbContext db,
        Guid id,
        string email,
        Guid? companyScope,
        CancellationToken cancellationToken)
    {
        var addressed = await AddressedInvitations(db, email, companyScope).ToListAsync(cancellationToken);

        IQueryable<UserInvitation> sentQuery = db.UserInvitations.Where(i => i.InvitedBy == id && i.Email != email);
        if (companyScope is { } company)
        {
            sentQuery = sentQuery.Where(i => i.CompanyId == company);
        }

        var sent = await sentQuery
            .Select(i => new Reference(i.Id, i.InvitationType))
            .ToListAsync(cancellationToken);

        var records = addressed.Select(i => Flatten(db.Entry(i), "UserInvitation", "Email"))
            .Concat(sent.Select(r => ReferenceRecord(r, "InvitedBy")))
            .ToList();

        return Section("UserInvitation", ExportTreatment.FullRecord, records);
    }

    private static async Task<List<SubjectAccessSection>> AppendDirectReportsAsync(
        ClimateProjectDbContext db,
        List<SubjectAccessSection> sections,
        Guid id,
        CancellationToken cancellationToken)
    {
        var reports = await db.Users.Where(u => u.ManagerId == id)
            .Select(u => u.Id).ToListAsync(cancellationToken);
        if (reports.Count == 0)
        {
            return sections;
        }

        var index = sections.FindIndex(s => s.Entity == "User");
        var user = sections[index];
        var records = user.Records
            .Concat(reports.Select(r => ReferenceRecord(new Reference(r, null), "ManagerId")))
            .ToList();
        sections[index] = user with { RecordCount = records.Count, Records = records };
        return sections;
    }

    private static SubjectAccessSection Section(
        string entity,
        ExportTreatment treatment,
        IReadOnlyList<IReadOnlyDictionary<string, object?>> records)
    {
        var entry = SubjectDataMap.Find(entity)
            ?? throw new InvalidOperationException(
                $"'{entity}' is exported but is not in SubjectDataMap. The map is the record of what is held; "
                + "an export that reaches a table the map does not describe means the two have diverged.");

        return new SubjectAccessSection(
            entry.Entity, entry.Table, entry.Link, treatment,
            entry.LawfulBasis, entry.Retention, records.Count, records);
    }

    /// <summary>
    /// Every mapped column of one row, plus the owned types stored in the same table.
    /// </summary>
    private static Dictionary<string, object?> Flatten(EntityEntry entry, string entity, string linkProperty)
    {
        var record = new Dictionary<string, object?>(StringComparer.Ordinal) { [LinkKey] = linkProperty };

        foreach (var property in entry.Properties)
        {
            var name = property.Metadata.Name;

            // A GENERATED ALWAYS tsvector over columns that are already in this record, with no
            // sensible JSON form. See SearchIndexConfiguration.
            if (name == SearchIndexConfiguration.PropertyName)
            {
                continue;
            }

            record[name] = SubjectDataMap.RedactedColumns.Contains($"{entity}.{name}")
                ? SubjectDataMap.RedactedMarker
                : property.CurrentValue;
        }

        // Owned types share the owner's table, so their columns are part of this row: a user's
        // preferences, notification opt-outs and consent flags, a notification's delivery
        // metadata. Flattened as "Navigation.Property" so the shape says where they came from.
        foreach (var reference in entry.References)
        {
            if (!reference.Metadata.TargetEntityType.IsOwned() || reference.TargetEntry is not { } owned)
            {
                continue;
            }

            foreach (var property in owned.Properties)
            {
                if (property.Metadata.IsForeignKey())
                {
                    // The owned type's key is the owner's key, already present above.
                    continue;
                }

                record[$"{reference.Metadata.Name}.{property.Metadata.Name}"] = property.CurrentValue;
            }
        }

        return record;
    }
}
