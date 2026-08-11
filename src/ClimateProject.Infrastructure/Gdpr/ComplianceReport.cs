using ClimateProject.Application.Gdpr;
using ClimateProject.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace ClimateProject.Infrastructure.Gdpr;

/// <summary>
/// Builds the record-of-processing report: what personal data this platform holds, on what
/// lawful basis, for how long, and what an erasure request does to each table.
///
/// <para>Every line comes from <see cref="SubjectDataMap"/>, which is the same declaration the
/// access export and the erasure read. That is the point — a compliance report maintained
/// beside the code it describes drifts from it within a release, and a report that describes
/// a table the exporter does not visit is worse than no report, because it asserts a coverage
/// nobody has. <c>GdprEndpointsTests</c> asserts the report has exactly one
/// line per map entry.</para>
///
/// <para><b>Row counts are a volume indicator, not an inventory.</b> They are reported only
/// for the tables that carry a <c>company_id</c> and are listed in
/// <see cref="TenantScopedCounts"/>; everything else reports
/// <see cref="NotCountedForTenant"/>. Two reasons, and neither is effort. A table without a
/// company column cannot be counted for one tenant at all, and returning its global total to
/// a company administrator would hand them a figure about every other tenant. And a count of
/// zero would otherwise be indistinguishable from "not counted", which is the kind of
/// ambiguity a compliance artefact must not contain.</para>
/// </summary>
public static class ComplianceReport
{
    /// <summary>
    /// The row count reported for a table this report does not count: either it has no
    /// <c>company_id</c> to scope by, or no counter is declared for it below. Distinct from
    /// zero on purpose.
    /// </summary>
    public const long NotCountedForTenant = -1;

    /// <summary>
    /// The subject-data tables this report counts, keyed by entity name.
    ///
    /// <para>Written out as typed queries rather than derived from the model, because a
    /// generic count needs either raw SQL over a model-supplied table name or a hand-built
    /// expression tree, and neither is worth it for a figure that is contextual rather than
    /// load-bearing. A table added to <see cref="SubjectDataMap"/> and not added here is still
    /// fully reported — basis, retention, erasure treatment and rationale — and simply carries
    /// <see cref="NotCountedForTenant"/> as its count.</para>
    /// </summary>
    private static readonly Dictionary<string, Func<ClimateProjectDbContext, Guid, IQueryable<object>>> TenantScopedCountsInternal =
        new(StringComparer.Ordinal)
        {
            ["User"] = (db, c) => db.Users.Where(u => u.CompanyId == c).Cast<object>(),
            ["Response"] = (db, c) => db.Responses.Where(r => r.CompanyId == c).Cast<object>(),
            ["Notification"] = (db, c) => db.Notifications.Where(n => n.CompanyId == c).Cast<object>(),
            ["SurveyDraft"] = (db, c) => db.SurveyDrafts.Where(d => d.CompanyId == c).Cast<object>(),
            ["SurveyInvitation"] = (db, c) => db.SurveyInvitations.Where(i => i.CompanyId == c).Cast<object>(),
            ["MicroclimateInvitation"] = (db, c) => db.MicroclimateInvitations.Where(i => i.CompanyId == c).Cast<object>(),
            ["UserInvitation"] = (db, c) => db.UserInvitations.Where(i => i.CompanyId == c).Cast<object>(),
            ["AuditLog"] = (db, c) => db.AuditLogs.Where(a => a.CompanyId == c).Cast<object>(),
            ["Department"] = (db, c) => db.Departments.Where(d => d.CompanyId == c).Cast<object>(),
            ["Survey"] = (db, c) => db.Surveys.Where(s => s.CompanyId == c).Cast<object>(),
            ["Microclimate"] = (db, c) => db.Microclimates.Where(m => m.CompanyId == c).Cast<object>(),
            ["ActionPlan"] = (db, c) => db.ActionPlans.Where(p => p.CompanyId == c).Cast<object>(),
            ["Report"] = (db, c) => db.Reports.Where(r => r.CompanyId == c).Cast<object>(),
        };

    /// <summary>The entity names <see cref="BuildAsync"/> reports a row count for.</summary>
    public static IReadOnlyCollection<string> TenantScopedCounts => TenantScopedCountsInternal.Keys;

    public static async Task<ComplianceReportResponse> BuildAsync(
        ClimateProjectDbContext db,
        Guid? companyId,
        DateTimeOffset generatedAt,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(db);

        var entries = new List<ComplianceReportEntry>(SubjectDataMap.Entries.Count);

        foreach (var entry in SubjectDataMap.Entries)
        {
            long count = NotCountedForTenant;
            if (companyId is { } tenant && TenantScopedCountsInternal.TryGetValue(entry.Entity, out var counter))
            {
                count = await counter(db, tenant).LongCountAsync(cancellationToken);
            }

            entries.Add(new ComplianceReportEntry(
                entry.Entity, entry.Table, entry.Link, entry.LawfulBasis, entry.Retention,
                entry.Erasure, entry.Rationale, count));
        }

        return new ComplianceReportResponse(
            companyId,
            generatedAt,
            Complete: false,
            Sources:
            [
                SubjectDataSources.Primary($"Described in full: all {entries.Count} tables in this database."),
                SubjectDataSources.TrackingUnavailable(),
            ],
            TablesHoldingSubjectData: entries.Count(e => e.Link != SubjectLink.None),
            TablesWithNoSubjectData: entries.Count(e => e.Link == SubjectLink.None),
            Entries: entries);
    }
}
