using ClimateProject.Domain.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;

namespace ClimateProject.Infrastructure.Persistence;

/// <summary>
/// Refuses any <c>SaveChanges</c> that would UPDATE or DELETE an audit row (#143).
///
/// The trail is only worth having if it cannot be edited afterwards, and "nobody would write
/// that code" is not a property. This makes rewriting history a thrown exception at the point
/// of the attempt, naming the row, rather than a silent success.
///
/// ## What this does and does not cover
///
/// It covers every write that goes through a <see cref="ClimateProjectDbContext"/> in the API
/// or the worker process — both register it. It does **not** cover raw SQL, <c>ExecuteUpdate</c>
/// / <c>ExecuteDelete</c> (neither goes through the change tracker), or anything holding the
/// database credentials directly.
///
/// The complete version of this guard is a <c>BEFORE UPDATE OR DELETE</c> trigger, or
/// <c>REVOKE UPDATE, DELETE</c> from the application role, which no application-side code path
/// can bypass. Both are schema changes, and this wave permits exactly one migration on another
/// branch — see <c>docs/decisions/audit-logging.md</c>, which records it as the outstanding
/// half.
///
/// ## Both tables
///
/// <c>survey_audit_logs</c> is guarded alongside <c>audit_logs</c>. It is a second, narrower
/// trail (the per-survey change history behind <c>GET /surveys/{id}/history</c>, written by
/// <c>SurveyAuditTrail</c>), and the append-only rule is a property of being an audit trail
/// rather than of one table.
/// </summary>
public sealed class AuditLogAppendOnlyInterceptor : SaveChangesInterceptor
{
    /// <summary>Stateless, so one instance is shared by every context that registers it.</summary>
    public static readonly AuditLogAppendOnlyInterceptor Instance = new();

    public override InterceptionResult<int> SavingChanges(
        DbContextEventData eventData,
        InterceptionResult<int> result)
    {
        Guard(eventData.Context);
        return base.SavingChanges(eventData, result);
    }

    public override ValueTask<InterceptionResult<int>> SavingChangesAsync(
        DbContextEventData eventData,
        InterceptionResult<int> result,
        CancellationToken cancellationToken = default)
    {
        Guard(eventData.Context);
        return base.SavingChangesAsync(eventData, result, cancellationToken);
    }

    /// <summary>
    /// Throws on the first tracked audit row in a state other than Added or Unchanged.
    /// </summary>
    /// <remarks>
    /// Unchanged is allowed and is the common case: a row inserted earlier in the same context
    /// stays tracked as Unchanged after its save, and every later <c>SaveChanges</c> on that
    /// context would otherwise trip over it. Detached and Deleted are distinguished by EF, so
    /// this only rejects a real DELETE.
    /// </remarks>
    private static void Guard(DbContext? context)
    {
        if (context is null)
        {
            return;
        }

        foreach (var entry in context.ChangeTracker.Entries())
        {
            if (entry.State is not (EntityState.Modified or EntityState.Deleted))
            {
                continue;
            }

            var table = entry.Entity switch
            {
                AuditLog => "audit_logs",
                SurveyAuditLog => "survey_audit_logs",
                _ => null,
            };

            if (table is null)
            {
                continue;
            }

            throw new InvalidOperationException(
                $"Audit records are append-only: a {entry.State} entry on {table} was rejected. " +
                "Nothing may rewrite the audit trail (#143).");
        }
    }
}
