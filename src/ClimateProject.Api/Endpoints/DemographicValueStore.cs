using ClimateProject.Application.OrgStructure;
using ClimateProject.Domain.Entities;
using ClimateProject.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace ClimateProject.Api.Endpoints;

// Read/write side of the normalised demographic tables, shared by the user,
// invitation and invitation-accept endpoints so that all three agree on how a
// {fieldKey: value} map maps to/from user_demographics and
// user_invitation_demographics rows.
internal static class DemographicValueStore
{
    public static async Task<List<DemographicFieldDefinition>> LoadDefinitionsAsync(
        ClimateProjectDbContext db,
        Guid companyId,
        CancellationToken cancellationToken)
    {
        var fields = await db.DemographicFields
            .Where(f => f.CompanyId == companyId)
            .OrderBy(f => f.Order)
            .ToListAsync(cancellationToken);

        // Allowed values are the options' stable VALUES, never their labels (#195).
        // A submitted demographic is stored as that value, so validating against the
        // label would make the same answer store two different strings depending on
        // which language the admin's browser happened to be in -- and every dashboard
        // filter, group-by and export would split accordingly, silently.
        var fieldIds = fields.Select(f => f.Id).ToList();
        var optionValues = (await db.DemographicFieldOptions
                .Where(o => fieldIds.Contains(o.DemographicFieldId))
                .OrderBy(o => o.Order)
                .Select(o => new { o.DemographicFieldId, o.Value })
                .ToListAsync(cancellationToken))
            .GroupBy(o => o.DemographicFieldId)
            .ToDictionary(g => g.Key, g => (IReadOnlyList<string>)g.Select(o => o.Value).ToList());

        return fields
            .Select(f => new DemographicFieldDefinition(
                f.Id, f.Field, f.Type, optionValues.GetValueOrDefault(f.Id), f.Required, f.IsActive))
            .ToList();
    }

    public static async Task<IReadOnlyDictionary<string, string>> LoadForUserAsync(
        ClimateProjectDbContext db,
        Guid userId,
        CancellationToken cancellationToken)
    {
        var byUser = await LoadForUsersAsync(db, [userId], cancellationToken);
        return byUser.TryGetValue(userId, out var values) ? values : Empty;
    }

    public static async Task<Dictionary<Guid, IReadOnlyDictionary<string, string>>> LoadForUsersAsync(
        ClimateProjectDbContext db,
        IReadOnlyCollection<Guid> userIds,
        CancellationToken cancellationToken)
    {
        if (userIds.Count == 0)
        {
            return [];
        }

        var rows = await (from d in db.UserDemographics
                          join f in db.DemographicFields on d.DemographicFieldId equals f.Id
                          where userIds.Contains(d.UserId)
                          orderby f.Order
                          select new { d.UserId, f.Field, d.Value })
            .ToListAsync(cancellationToken);

        var result = new Dictionary<Guid, IReadOnlyDictionary<string, string>>();
        foreach (var group in rows.GroupBy(r => r.UserId))
        {
            result[group.Key] = group.ToDictionary(r => r.Field, r => r.Value, StringComparer.Ordinal);
        }

        return result;
    }

    public static async Task<Dictionary<Guid, IReadOnlyDictionary<string, string>>> LoadForInvitationsAsync(
        ClimateProjectDbContext db,
        IReadOnlyCollection<Guid> invitationIds,
        CancellationToken cancellationToken)
    {
        if (invitationIds.Count == 0)
        {
            return [];
        }

        var rows = await (from d in db.UserInvitationDemographics
                          join f in db.DemographicFields on d.DemographicFieldId equals f.Id
                          where invitationIds.Contains(d.InvitationId)
                          orderby f.Order
                          select new { d.InvitationId, f.Field, d.Value })
            .ToListAsync(cancellationToken);

        var result = new Dictionary<Guid, IReadOnlyDictionary<string, string>>();
        foreach (var group in rows.GroupBy(r => r.InvitationId))
        {
            result[group.Key] = group.ToDictionary(r => r.Field, r => r.Value, StringComparer.Ordinal);
        }

        return result;
    }

    public static IReadOnlyDictionary<string, string> Empty { get; } =
        new Dictionary<string, string>(StringComparer.Ordinal);

    public static IReadOnlyDictionary<string, string> ToMap(IReadOnlyList<ResolvedDemographicValue> values)
        => values.ToDictionary(v => v.Field, v => v.Value, StringComparer.Ordinal);

    // Full replace, not a merge: UpdateUserRequest.Demographics carries the
    // complete set (see the DTO comment), so an answer the caller omitted has
    // been cleared and its row must go.
    public static async Task ReplaceForUserAsync(
        ClimateProjectDbContext db,
        Guid userId,
        IReadOnlyList<ResolvedDemographicValue> values,
        DateTimeOffset now,
        CancellationToken cancellationToken)
    {
        var existing = await db.UserDemographics.Where(d => d.UserId == userId).ToListAsync(cancellationToken);
        var keep = values.ToDictionary(v => v.FieldId, v => v.Value);

        foreach (var row in existing)
        {
            if (keep.TryGetValue(row.DemographicFieldId, out var newValue))
            {
                if (!string.Equals(row.Value, newValue, StringComparison.Ordinal))
                {
                    row.Value = newValue;
                    row.UpdatedAt = now;
                }

                keep.Remove(row.DemographicFieldId);
            }
            else
            {
                db.UserDemographics.Remove(row);
            }
        }

        foreach (var (fieldId, value) in keep)
        {
            db.UserDemographics.Add(new UserDemographic
            {
                UserId = userId,
                DemographicFieldId = fieldId,
                Value = value,
                CreatedAt = now,
                UpdatedAt = now,
            });
        }
    }

    public static void AddForInvitation(
        ClimateProjectDbContext db,
        Guid invitationId,
        IReadOnlyList<ResolvedDemographicValue> values)
    {
        foreach (var value in values)
        {
            db.UserInvitationDemographics.Add(new UserInvitationDemographic
            {
                InvitationId = invitationId,
                DemographicFieldId = value.FieldId,
                Value = value.Value,
            });
        }
    }
}
