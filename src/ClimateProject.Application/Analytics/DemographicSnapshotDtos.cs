namespace ClimateProject.Application.Analytics;

/// <summary>
/// One person's row in a snapshot.
/// </summary>
/// <param name="Demographics">
/// Every demographic this person carried, reserved columns and custom attributes merged
/// into one <c>{fieldKey: value}</c> map (see <see cref="SnapshotEntryValues.Flatten"/>).
/// The six named properties beside it are the same data, kept because they are what the
/// entry table indexes; consumers that need to filter on a company's *custom* fields --
/// which the PRD requires of every field, not just the six -- read this map.
///
/// Values are the stable locale-independent option values (#195), never display labels:
/// a snapshot whose group names changed with the reader's language would make
/// period-over-period comparison meaningless. Resolving a label for display is the
/// caller's job, via /admin/demographic-fields.
/// </param>
public sealed record SnapshotEntryDto(
    Guid Id,
    Guid UserId,
    string Department,
    string Role,
    string Tenure,
    string? Location,
    string? Team,
    string? Level,
    IReadOnlyDictionary<string, string> Demographics);

public sealed record SnapshotChangeDto(
    Guid Id,
    string Field,
    string? OldValue,
    string? NewValue,
    Guid ChangedBy,
    DateTimeOffset Timestamp,
    string? Reason,
    bool IsComputed);

public sealed record DemographicSnapshotListItem(
    Guid Id,
    Guid SurveyId,
    Guid CompanyId,
    int Version,
    DateTimeOffset Timestamp,
    bool IsActive,
    int TotalUsers);

/// <param name="Distributions">
/// Per-field group counts with small groups suppressed -- see
/// <see cref="DemographicSnapshotPrivacy"/> for the threshold and why entries are not
/// suppressed the same way.
/// </param>
/// <param name="MinimumGroupSize">
/// Echoed so a client can tell a reader *why* a group is missing instead of showing a
/// silently short total.
/// </param>
public sealed record DemographicSnapshotDetail(
    Guid Id,
    Guid SurveyId,
    Guid CompanyId,
    int Version,
    DateTimeOffset Timestamp,
    Guid CreatedBy,
    string Reason,
    bool IsActive,
    int TotalUsers,
    int DepartmentsCount,
    IReadOnlyList<SnapshotEntryDto> Entries,
    IReadOnlyList<SnapshotChangeDto> Changes,
    IReadOnlyList<DemographicDistribution> Distributions,
    int MinimumGroupSize);

public sealed record CreateDemographicSnapshotRequest(Guid SurveyId, Guid CompanyId, string Reason);

/// <summary>
/// Adds one person to a snapshot.
/// </summary>
/// <remarks>
/// Deviation from the plan's shape, which had Department/Role/Tenure as required strings
/// the caller typed in. Post-#193 that cannot be right: demographic answers live in
/// user_demographics keyed to demographic_fields precisely so that nothing can write an
/// unvalidated free-text value into an analytics dimension, and a snapshot built from
/// hand-typed strings would reintroduce exactly the split-your-own-headcount problem #193
/// removed. So every field here is an optional override and anything omitted is derived
/// from the live record: department from the user's department, role from the user's role,
/// and the rest from that user's stored demographics.
/// </remarks>
/// <param name="Demographics">
/// Optional overrides for the company's configured demographic fields, keyed by field key
/// and validated against those definitions. Anything not overridden comes from the user's
/// stored answers.
/// </param>
public sealed record AddSnapshotEntryRequest(
    Guid UserId,
    string? Department,
    string? Role,
    string? Tenure,
    string? Location,
    string? Team,
    string? Level,
    Dictionary<string, string?>? Demographics);

/// <param name="OldValue">JSON scalar or document; the column is jsonb, so anything else is rejected with a 400.</param>
/// <param name="NewValue">JSON scalar or document; same constraint as <paramref name="OldValue"/>.</param>
public sealed record AddSnapshotChangeRequest(string Field, string? OldValue, string? NewValue, string? Reason);

/// <param name="PriorVersion">
/// The version diffed against, or null when this is the first snapshot of the survey and
/// there was nothing to compare with.
/// </param>
public sealed record RecomputeSnapshotChangesResponse(
    int? PriorVersion,
    int ComputedCount,
    DemographicSnapshotDetail Snapshot);
