using System.Security.Claims;
using System.Text.Json;
using ClimateProject.Application.Analytics;
using ClimateProject.Application.Auth;
using ClimateProject.Application.OrgStructure;
using ClimateProject.Domain.Entities;
using ClimateProject.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace ClimateProject.Api.Endpoints;

/// <summary>
/// Demographic snapshots: what the workforce composition was at a point in time, which is
/// what makes period-over-period climate comparison meaningful rather than misleading.
/// Distinct from <see cref="DemographicFieldEndpoints"/>, which defines what is collected.
///
/// Snapshots are always company-scoped -- unlike Benchmark or SurveyTemplate there is no
/// global (CompanyId == null) variant, because a snapshot is a headcount roster and a
/// cross-tenant one would be meaningless as well as a leak. So a single
/// <see cref="CanAccessCompany"/> check covers both read and write; the read/write split
/// BenchmarkEndpoints needs does not apply here.
/// </summary>
public static class DemographicSnapshotEndpoints
{
    private const int MaxReasonLength = 500;
    private const int MaxFieldLength = 200;
    private const int MaxDepartmentLength = 200;
    private const int MaxRoleLength = 100;
    private const int MaxTenureLength = 100;
    private const int MaxLocationLength = 200;
    private const int MaxTeamLength = 200;
    private const int MaxLevelLength = 100;

    public static void MapDemographicSnapshotEndpoints(this WebApplication app)
    {
        var group = app.MapGroup("/admin/demographic-snapshots").RequireAuthorization();

        group.MapGet("", ListAsync);
        group.MapPost("", CreateAsync);
        group.MapGet("/{id:guid}", GetAsync);
        group.MapPost("/{id:guid}/entries", AddEntryAsync);
        group.MapPost("/{id:guid}/changes", AddChangeAsync);
        group.MapPost("/{id:guid}/changes/recompute", RecomputeChangesAsync);
    }

    private static bool CanAccessCompany(CurrentUser currentUser, Guid companyId)
        => currentUser.Role == Roles.SuperAdmin
           || (currentUser.Role == Roles.CompanyAdmin && currentUser.CompanyId == companyId.ToString());

    private static async Task<Guid> ResolveCurrentUserIdAsync(
        CurrentUser currentUser,
        ClimateProjectDbContext db,
        CancellationToken cancellationToken)
    {
        if (Guid.TryParse(currentUser.Sub, out var userId))
        {
            var byId = await db.Users.FirstOrDefaultAsync(u => u.Id == userId, cancellationToken);
            if (byId is not null) return byId.Id;
        }

        var byExternalId = await db.Users.FirstOrDefaultAsync(u => u.PersonaExternalId == currentUser.Sub, cancellationToken);
        return byExternalId?.Id ?? Guid.Empty;
    }

    private static async Task<IResult> ListAsync(
        Guid companyId,
        Guid? surveyId,
        ClaimsPrincipal principal,
        ClimateProjectDbContext db,
        CancellationToken cancellationToken)
    {
        var currentUser = principal.GetCurrentUser();
        if (!CanAccessCompany(currentUser, companyId)) return Results.Forbid();

        var query = db.DemographicSnapshots.Where(s => s.CompanyId == companyId);
        if (surveyId.HasValue)
        {
            query = query.Where(s => s.SurveyId == surveyId.Value);
        }

        var snapshots = await query
            .OrderByDescending(s => s.Timestamp)
            .ThenByDescending(s => s.Version)
            .Select(s => new DemographicSnapshotListItem(
                s.Id, s.SurveyId, s.CompanyId, s.Version, s.Timestamp, s.IsActive, s.Metadata.TotalUsers))
            .ToListAsync(cancellationToken);

        return Results.Ok(snapshots);
    }

    private static async Task<IResult> CreateAsync(
        CreateDemographicSnapshotRequest request,
        ClaimsPrincipal principal,
        ClimateProjectDbContext db,
        CancellationToken cancellationToken)
    {
        var currentUser = principal.GetCurrentUser();
        if (!CanAccessCompany(currentUser, request.CompanyId)) return Results.Forbid();

        var reason = request.Reason?.Trim();
        if (string.IsNullOrWhiteSpace(reason))
        {
            return Results.Json(new { message = "Reason is required" }, statusCode: 400);
        }

        if (reason.Length > MaxReasonLength)
        {
            return Results.Json(new { message = $"Reason exceeds {MaxReasonLength} characters" }, statusCode: 400);
        }

        if (DemographicSnapshotDiff.IsComputedReason(reason))
        {
            return Results.Json(
                new { message = $"Reason may not start with '{DemographicSnapshotDiff.ComputedReasonPrefix}'" },
                statusCode: 400);
        }

        // survey_id is a plain column rather than an EF FK (see DemographicSnapshotConfiguration),
        // so the tenancy of the survey has to be checked by hand. Checking only that the survey
        // exists -- as the original plan did -- would let a CompanyAdmin file a snapshot of their
        // own headcount against another tenant's survey id, which is a cross-tenant write.
        var surveyCompanyId = await db.Surveys
            .Where(s => s.Id == request.SurveyId)
            .Select(s => (Guid?)s.CompanyId)
            .FirstOrDefaultAsync(cancellationToken);

        if (surveyCompanyId is null)
        {
            return Results.Json(new { message = "SurveyId does not reference an existing survey" }, statusCode: 400);
        }

        if (surveyCompanyId.Value != request.CompanyId)
        {
            return Results.Json(new { message = "SurveyId belongs to a different company" }, statusCode: 400);
        }

        var maxVersion = await db.DemographicSnapshots
            .Where(s => s.SurveyId == request.SurveyId)
            .Select(s => (int?)s.Version)
            .MaxAsync(cancellationToken);

        var createdBy = await ResolveCurrentUserIdAsync(currentUser, db, cancellationToken);
        var now = DateTimeOffset.UtcNow;
        var snapshot = new DemographicSnapshot
        {
            Id = Guid.NewGuid(),
            SurveyId = request.SurveyId,
            CompanyId = request.CompanyId,
            Version = (maxVersion ?? 0) + 1,
            Timestamp = now,
            CreatedBy = createdBy,
            Reason = reason,
            IsActive = true,
            CreatedAt = now,
            UpdatedAt = now,
        };
        db.DemographicSnapshots.Add(snapshot);

        try
        {
            await db.SaveChangesAsync(cancellationToken);
        }
        catch (DbUpdateException)
        {
            // IX_demographic_snapshots_survey_id_version is UNIQUE, so two admins snapshotting
            // the same survey at once race on the version we just computed. 409 tells the caller
            // to retry rather than surfacing the unique-violation as an unhandled 500.
            return Results.Json(
                new { message = "A snapshot for this survey version was created concurrently; retry" },
                statusCode: 409);
        }

        return Results.Json(await LoadDetailAsync(db, snapshot.Id, cancellationToken), statusCode: 201);
    }

    private static async Task<IResult> GetAsync(
        Guid id,
        ClaimsPrincipal principal,
        ClimateProjectDbContext db,
        CancellationToken cancellationToken)
    {
        var currentUser = principal.GetCurrentUser();
        var snapshot = await db.DemographicSnapshots.FirstOrDefaultAsync(s => s.Id == id, cancellationToken);
        if (snapshot is null) return Results.Json(new { message = "Snapshot not found" }, statusCode: 404);
        if (!CanAccessCompany(currentUser, snapshot.CompanyId)) return Results.Forbid();

        return Results.Ok(await LoadDetailAsync(db, id, cancellationToken));
    }

    private static async Task<IResult> AddEntryAsync(
        Guid id,
        AddSnapshotEntryRequest request,
        ClaimsPrincipal principal,
        ClimateProjectDbContext db,
        CancellationToken cancellationToken)
    {
        var currentUser = principal.GetCurrentUser();
        var snapshot = await db.DemographicSnapshots.FirstOrDefaultAsync(s => s.Id == id, cancellationToken);
        if (snapshot is null) return Results.Json(new { message = "Snapshot not found" }, statusCode: 404);
        if (!CanAccessCompany(currentUser, snapshot.CompanyId)) return Results.Forbid();

        var user = await db.Users.FirstOrDefaultAsync(u => u.Id == request.UserId, cancellationToken);
        if (user is null)
        {
            return Results.Json(new { message = "UserId does not reference an existing user" }, statusCode: 400);
        }

        // User.CompanyId is Guid? since #191 (NULL == global scope, today only super-admins).
        // A global user has no place in any company's headcount roster, so NULL fails here
        // rather than being treated as a match. Compared as Guid?, never as a string: EF
        // cannot translate Nullable<Guid>.ToString() and the string form would also make
        // NULL indistinguishable from empty.
        if (user.CompanyId != snapshot.CompanyId)
        {
            return Results.Json(new { message = "UserId belongs to a different company" }, statusCode: 400);
        }

        var alreadyPresent = await db.DemographicSnapshotEntries
            .AnyAsync(e => e.SnapshotId == id && e.UserId == request.UserId, cancellationToken);
        if (alreadyPresent)
        {
            return Results.Json(new { message = "This user already has an entry in this snapshot" }, statusCode: 409);
        }

        if (!TryResolveDemographics(request.Demographics, out var overrides, out var overrideError))
        {
            return Results.Json(new { message = overrideError }, statusCode: 400);
        }

        var definitions = await DemographicValueStore.LoadDefinitionsAsync(db, snapshot.CompanyId, cancellationToken);
        var validation = DemographicValueValidation.Validate(overrides, definitions, enforceRequired: false);
        if (!validation.IsValid)
        {
            return Results.Json(new { message = string.Join("; ", validation.Errors) }, statusCode: 400);
        }

        // Start from what the platform already knows about this person, then apply the
        // caller's overrides. A key the caller sent blank clears the stored answer, which is
        // why the merge removes every explicitly-supplied key before adding the validated
        // ones back -- DemographicValueValidation drops blanks, so without that step a blank
        // would silently mean "leave it alone" instead of "this person no longer has one".
        var merged = new Dictionary<string, string>(
            await DemographicValueStore.LoadForUserAsync(db, user.Id, cancellationToken),
            StringComparer.Ordinal);

        foreach (var key in overrides.Keys)
        {
            merged.Remove(key);
        }

        foreach (var value in validation.Values)
        {
            merged[value.Field] = value.Value;
        }

        var departmentName = user.DepartmentId is null
            ? null
            : await db.Departments
                .Where(d => d.Id == user.DepartmentId.Value)
                .Select(d => d.Name)
                .FirstOrDefaultAsync(cancellationToken);

        // The six explicit properties are org-structure facts, not demographic answers, so
        // they are bounded by their column widths rather than validated against
        // demographic_fields -- unlike Demographics, which is.
        if (!TryTake(request.Department, MaxDepartmentLength, "Department", out var departmentOverride, out var lengthError)
            || !TryTake(request.Role, MaxRoleLength, "Role", out var roleOverride, out lengthError)
            || !TryTake(request.Tenure, MaxTenureLength, "Tenure", out var tenureOverride, out lengthError)
            || !TryTake(request.Location, MaxLocationLength, "Location", out var locationOverride, out lengthError)
            || !TryTake(request.Team, MaxTeamLength, "Team", out var teamOverride, out lengthError)
            || !TryTake(request.Level, MaxLevelLength, "Level", out var levelOverride, out lengthError))
        {
            return Results.Json(new { message = lengthError }, statusCode: 400);
        }

        // Precedence, most specific first: an explicit override, then this person's own
        // demographic answer (a company may well define a "department" field of its own,
        // and their answer is more specific than the org chart), then the org record, then
        // the sentinel. The three NOT NULL columns always end up with something.
        var department = departmentOverride ?? merged.GetValueOrDefault("department") ?? Blank(departmentName) ?? SnapshotEntryValues.Unspecified;
        var role = roleOverride ?? merged.GetValueOrDefault("role") ?? Blank(user.Role) ?? SnapshotEntryValues.Unspecified;
        var tenure = tenureOverride ?? merged.GetValueOrDefault("tenure") ?? SnapshotEntryValues.Unspecified;
        var location = locationOverride ?? merged.GetValueOrDefault("location");
        var team = teamOverride ?? merged.GetValueOrDefault("team");
        var level = levelOverride ?? merged.GetValueOrDefault("level");

        db.DemographicSnapshotEntries.Add(new DemographicSnapshotEntry
        {
            Id = Guid.NewGuid(),
            SnapshotId = id,
            UserId = request.UserId,
            Department = Truncate(department, MaxDepartmentLength),
            Role = Truncate(role, MaxRoleLength),
            Tenure = Truncate(tenure, MaxTenureLength),
            Location = location is null ? null : Truncate(location, MaxLocationLength),
            Team = team is null ? null : Truncate(team, MaxTeamLength),
            Level = level is null ? null : Truncate(level, MaxLevelLength),
            CustomAttributes = SnapshotEntryValues.ToCustomAttributesJson(merged),
        });

        await db.SaveChangesAsync(cancellationToken);
        await RecomputeMetadataAsync(db, snapshot, cancellationToken);

        return Results.Json(await LoadDetailAsync(db, id, cancellationToken), statusCode: 201);
    }

    private static async Task<IResult> AddChangeAsync(
        Guid id,
        AddSnapshotChangeRequest request,
        ClaimsPrincipal principal,
        ClimateProjectDbContext db,
        CancellationToken cancellationToken)
    {
        var currentUser = principal.GetCurrentUser();
        var snapshot = await db.DemographicSnapshots.FirstOrDefaultAsync(s => s.Id == id, cancellationToken);
        if (snapshot is null) return Results.Json(new { message = "Snapshot not found" }, statusCode: 404);
        if (!CanAccessCompany(currentUser, snapshot.CompanyId)) return Results.Forbid();

        var field = request.Field?.Trim();
        if (string.IsNullOrWhiteSpace(field))
        {
            return Results.Json(new { message = "Field is required" }, statusCode: 400);
        }

        if (field.Length > MaxFieldLength)
        {
            return Results.Json(new { message = $"Field exceeds {MaxFieldLength} characters" }, statusCode: 400);
        }

        // old_value/new_value are jsonb columns. Passing raw text straight through -- as the
        // original plan did -- makes every non-JSON body an unhandled 500 at SaveChanges
        // instead of a 400 the caller can act on.
        if (!IsJsonOrNull(request.OldValue) || !IsJsonOrNull(request.NewValue))
        {
            return Results.Json(new { message = "OldValue and NewValue must be valid JSON" }, statusCode: 400);
        }

        var reason = request.Reason?.Trim();
        if (reason is { Length: > MaxReasonLength })
        {
            return Results.Json(new { message = $"Reason exceeds {MaxReasonLength} characters" }, statusCode: 400);
        }

        if (DemographicSnapshotDiff.IsComputedReason(reason))
        {
            // Recomputation deletes rows whose reason carries this prefix. Letting a caller
            // set it would mean their row silently disappears on the next recompute.
            return Results.Json(
                new { message = $"Reason may not start with '{DemographicSnapshotDiff.ComputedReasonPrefix}' -- that prefix marks machine-computed changes" },
                statusCode: 400);
        }

        var changedBy = await ResolveCurrentUserIdAsync(currentUser, db, cancellationToken);
        db.DemographicSnapshotChanges.Add(new DemographicSnapshotChange
        {
            Id = Guid.NewGuid(),
            SnapshotId = id,
            Field = field,
            OldValue = request.OldValue,
            NewValue = request.NewValue,
            ChangedBy = changedBy,
            Timestamp = DateTimeOffset.UtcNow,
            Reason = reason,
        });
        await db.SaveChangesAsync(cancellationToken);

        return Results.Json(await LoadDetailAsync(db, id, cancellationToken), statusCode: 201);
    }

    /// <summary>
    /// Replaces this snapshot's machine-computed changes with a fresh diff against the
    /// previous version of the same survey. Idempotent: running it twice yields the same
    /// rows, and manually recorded changes are left untouched.
    /// </summary>
    private static async Task<IResult> RecomputeChangesAsync(
        Guid id,
        ClaimsPrincipal principal,
        ClimateProjectDbContext db,
        CancellationToken cancellationToken)
    {
        var currentUser = principal.GetCurrentUser();
        var snapshot = await db.DemographicSnapshots.FirstOrDefaultAsync(s => s.Id == id, cancellationToken);
        if (snapshot is null) return Results.Json(new { message = "Snapshot not found" }, statusCode: 404);
        if (!CanAccessCompany(currentUser, snapshot.CompanyId)) return Results.Forbid();

        // Highest version below this one, active or not: a superseded snapshot is still what
        // the composition was, and skipping inactive ones would diff across a gap and report
        // one period's movement as if it were another's.
        var prior = await db.DemographicSnapshots
            .Where(s => s.SurveyId == snapshot.SurveyId && s.Version < snapshot.Version)
            .OrderByDescending(s => s.Version)
            .FirstOrDefaultAsync(cancellationToken);

        var stale = await db.DemographicSnapshotChanges
            .Where(c => c.SnapshotId == id && c.Reason != null && c.Reason.StartsWith(DemographicSnapshotDiff.ComputedReasonPrefix))
            .ToListAsync(cancellationToken);
        db.DemographicSnapshotChanges.RemoveRange(stale);

        var computedCount = 0;
        if (prior is not null)
        {
            var priorValues = await LoadEntryValueSetsAsync(db, prior.Id, cancellationToken);
            var currentValues = await LoadEntryValueSetsAsync(db, id, cancellationToken);
            var changes = DemographicSnapshotDiff.Compute(priorValues, currentValues);

            var changedBy = await ResolveCurrentUserIdAsync(currentUser, db, cancellationToken);
            var now = DateTimeOffset.UtcNow;
            var reason = DemographicSnapshotDiff.ComputedReason(prior.Version);

            foreach (var change in changes)
            {
                db.DemographicSnapshotChanges.Add(new DemographicSnapshotChange
                {
                    Id = Guid.NewGuid(),
                    SnapshotId = id,
                    Field = Truncate(change.Field, MaxFieldLength),
                    OldValue = change.OldValue,
                    NewValue = change.NewValue,
                    ChangedBy = changedBy,
                    Timestamp = now,
                    Reason = reason,
                });
            }

            computedCount = changes.Count;
        }

        await db.SaveChangesAsync(cancellationToken);
        await RecomputeMetadataAsync(db, snapshot, cancellationToken);

        return Results.Ok(new RecomputeSnapshotChangesResponse(
            prior?.Version, computedCount, await LoadDetailAsync(db, id, cancellationToken)));
    }

    private static bool TryResolveDemographics(
        Dictionary<string, string?>? submitted,
        out Dictionary<string, string?> resolved,
        out string? error)
    {
        resolved = new Dictionary<string, string?>(StringComparer.Ordinal);
        error = null;

        foreach (var (key, value) in submitted ?? [])
        {
            var trimmed = key?.Trim();
            if (string.IsNullOrEmpty(trimmed))
            {
                error = "Demographic field key cannot be blank";
                return false;
            }

            resolved[trimmed] = value;
        }

        return true;
    }

    private static bool TryTake(string? value, int maxLength, string name, out string? taken, out string? error)
    {
        taken = string.IsNullOrWhiteSpace(value) ? null : value.Trim();
        if (taken is not null && taken.Length > maxLength)
        {
            error = $"{name} exceeds {maxLength} characters";
            return false;
        }

        error = null;
        return true;
    }

    private static string? Blank(string? value) => string.IsNullOrWhiteSpace(value) ? null : value.Trim();

    private static string Truncate(string value, int maxLength)
        => value.Length <= maxLength ? value : value[..maxLength];

    private static bool IsJsonOrNull(string? value)
    {
        if (value is null)
        {
            return true;
        }

        if (string.IsNullOrWhiteSpace(value))
        {
            return false;
        }

        try
        {
            using var _ = JsonDocument.Parse(value);
            return true;
        }
        catch (JsonException)
        {
            return false;
        }
    }

    private static async Task<List<SnapshotEntryValueSet>> LoadEntryValueSetsAsync(
        ClimateProjectDbContext db,
        Guid snapshotId,
        CancellationToken cancellationToken)
    {
        var entries = await db.DemographicSnapshotEntries
            .Where(e => e.SnapshotId == snapshotId)
            .OrderBy(e => e.UserId)
            .ToListAsync(cancellationToken);

        return entries
            .Select(e => new SnapshotEntryValueSet(
                e.UserId,
                SnapshotEntryValues.Flatten(e.Department, e.Role, e.Tenure, e.Location, e.Team, e.Level, e.CustomAttributes)))
            .ToList();
    }

    /// <summary>
    /// Recomputes the owned metadata from the entries that are actually there.
    ///
    /// Recomputed rather than incremented on write (which is what the original plan did):
    /// an increment drifts the moment an entry is removed, re-added or written by anything
    /// other than this endpoint, and a headcount that is quietly wrong is worse than no
    /// headcount at all in a table whose entire purpose is comparison over time.
    /// </summary>
    private static async Task RecomputeMetadataAsync(
        ClimateProjectDbContext db,
        DemographicSnapshot snapshot,
        CancellationToken cancellationToken)
    {
        var entries = await db.DemographicSnapshotEntries
            .Where(e => e.SnapshotId == snapshot.Id)
            .Select(e => new { e.Department, e.Role, e.Tenure })
            .ToListAsync(cancellationToken);

        snapshot.Metadata.TotalUsers = entries.Count;
        snapshot.Metadata.DepartmentsCount = entries
            .Select(e => e.Department)
            .Distinct(StringComparer.Ordinal)
            .Count();

        // Suppressed before it is stored, not just before it is served: these two columns are
        // what reports and exports read, and a threshold applied only on one read path is a
        // threshold that will be bypassed by the next one.
        snapshot.Metadata.RolesDistribution =
            DemographicSnapshotPrivacy.ToJson(DemographicSnapshotPrivacy.Summarise("role", entries.Select(e => (string?)e.Role)));
        snapshot.Metadata.TenureDistribution =
            DemographicSnapshotPrivacy.ToJson(DemographicSnapshotPrivacy.Summarise("tenure", entries.Select(e => (string?)e.Tenure)));

        snapshot.UpdatedAt = DateTimeOffset.UtcNow;
        await db.SaveChangesAsync(cancellationToken);
    }

    private static async Task<DemographicSnapshotDetail> LoadDetailAsync(
        ClimateProjectDbContext db,
        Guid id,
        CancellationToken cancellationToken)
    {
        var snapshot = await db.DemographicSnapshots.FirstAsync(s => s.Id == id, cancellationToken);

        var entryRows = await db.DemographicSnapshotEntries
            .Where(e => e.SnapshotId == id)
            .OrderBy(e => e.Department)
            .ThenBy(e => e.UserId)
            .ToListAsync(cancellationToken);

        var entries = entryRows
            .Select(e => new SnapshotEntryDto(
                e.Id, e.UserId, e.Department, e.Role, e.Tenure, e.Location, e.Team, e.Level,
                SnapshotEntryValues.Flatten(e.Department, e.Role, e.Tenure, e.Location, e.Team, e.Level, e.CustomAttributes)))
            .ToList();

        var changes = await db.DemographicSnapshotChanges
            .Where(c => c.SnapshotId == id)
            .OrderByDescending(c => c.Timestamp)
            .ThenBy(c => c.Field)
            .Select(c => new SnapshotChangeDto(
                c.Id, c.Field, c.OldValue, c.NewValue, c.ChangedBy, c.Timestamp, c.Reason,
                c.Reason != null && c.Reason.StartsWith(DemographicSnapshotDiff.ComputedReasonPrefix)))
            .ToListAsync(cancellationToken);

        var distributions = DemographicSnapshotPrivacy.SummariseAll(
            entries.Select(e => e.Demographics).ToList());

        return new DemographicSnapshotDetail(
            snapshot.Id, snapshot.SurveyId, snapshot.CompanyId, snapshot.Version, snapshot.Timestamp,
            snapshot.CreatedBy, snapshot.Reason, snapshot.IsActive,
            snapshot.Metadata.TotalUsers, snapshot.Metadata.DepartmentsCount,
            entries, changes, distributions, DemographicSnapshotPrivacy.MinimumGroupSize);
    }
}
