using System.Text.Json;
using ClimateProject.Application.OrgStructure;
using ClimateProject.DataMigration.Legacy;
using ClimateProject.DataMigration.Reporting;
using ClimateProject.Domain.Entities;
using MongoDB.Bson;

namespace ClimateProject.DataMigration.Mapping;

/// <summary>A mapped invitation and its demographic fan-out.</summary>
public sealed record MappedUserInvitation(
    UserInvitation Invitation,
    IReadOnlyList<UserInvitationDemographic> Demographics);

/// <summary>
/// The roster's front door. Two rules it inherits rather than invents:
///
/// - <b>#193's fan-out, applied here for the reason the entity comment gives</b>:
///   invitations are where member data actually enters (companies pre-load rosters by
///   CSV and assign demographics at invitation time), so leaving the blob unvalidated
///   would let unmapped keys in through the front door and fail silently at acceptance.
///   Every key must name a DemographicField of the INVITING company.
/// - <b>#132's role remap</b>: legacy's five invitation roles include department_admin,
///   which the target split into leader/supervisor. Same named rule UserMapper uses, so
///   an invited department_admin and an existing one land on the same role.
///
/// Statuses narrow the way every other invitation in this migration does: the target
/// names pending/sent/accepted, so opened/expired/cancelled are reconstructed from the
/// row's own timestamps with the original preserved in metadata. Expiry is expires_at
/// on this side, which migrates faithfully.
///
/// created_at/updated_at are deliberate drops: the target entity has no timestamp
/// columns at all - an invitation's lifecycle is already told by sent_at/opened_at/
/// accepted_at/expires_at.
/// </summary>
public static class UserInvitationMapper
{
    public const string Collection = "userinvitations";

    private static readonly string[] TargetRoles =
        ["super_admin", "company_admin", "leader", "supervisor", "employee"];

    private static readonly string[] InvitationTypes =
    [
        InvitationValidation.TypeCompanyAdminSetup,
        InvitationValidation.TypeEmployeeDirect,
        InvitationValidation.TypeEmployeeSelfSignup,
    ];

    public static MappedUserInvitation? Map(LegacyUserInvitation doc, MappingContext context)
    {
        var report = context.Report;
        var legacyId = doc.Id.ToString();
        MapperHelpers.ReportExtras(report, Collection, doc.Id, ("", doc.Extra));

        var companyRef = ReferenceResolver.Classify(CompanyMapper.Collection, doc.CompanyId, context.Companies);
        if (companyRef.Kind != ReferenceKind.Resolved)
        {
            report.Skip(
                companyRef.Kind == ReferenceKind.Malformed
                    ? MigrationRules.MalformedReference
                    : MigrationRules.DanglingReference,
                Collection, legacyId,
                $"company_id '{doc.CompanyId}' is {companyRef.Kind}; the column is a non-nullable FK",
                "company_id");
            return null;
        }

        var inviterRef = ReferenceResolver.Classify(UserMapper.Collection, doc.InvitedBy, context.Users);
        if (inviterRef.Kind != ReferenceKind.Resolved)
        {
            report.Skip(
                inviterRef.Kind == ReferenceKind.Malformed
                    ? MigrationRules.MalformedReference
                    : MigrationRules.DanglingReference,
                Collection, legacyId,
                $"invited_by '{doc.InvitedBy}' is {inviterRef.Kind}; invited_by is a non-nullable Restrict FK",
                "invited_by");
            return null;
        }

        var token = MapperHelpers.Truncated(doc.InvitationToken, 255, Collection, legacyId, "invitation_token", report);
        if (token is null)
        {
            report.Skip(MigrationRules.MissingRequiredField, Collection, legacyId,
                "invitation has no token; the column is NOT NULL and uniquely indexed", "invitation_token");
            return null;
        }

        var invitationType = MapperHelpers.Trimmed(doc.InvitationType);
        if (invitationType is null || !InvitationTypes.Contains(invitationType, StringComparer.Ordinal))
        {
            report.Skip(MigrationRules.InvitationTypeUnknown, Collection, legacyId,
                $"invitation_type '{doc.InvitationType}' is not in the target vocabulary "
                + $"({string.Join(", ", InvitationTypes)}); it decides which acceptance branch runs",
                "invitation_type");
            return null;
        }

        // #132's split, the same named rule UserMapper applies.
        var role = MapperHelpers.Trimmed(doc.Role) ?? "employee";
        if (role == "department_admin")
        {
            report.Normalisation(MigrationRules.RoleDepartmentAdminRemapped, Collection, legacyId, "role",
                "legacy role 'department_admin' has no target equivalent; remapped to 'leader'");
            role = "leader";
        }

        if (!TargetRoles.Contains(role, StringComparer.Ordinal))
        {
            report.Skip(MigrationRules.RoleUnknown, Collection, legacyId,
                $"role '{doc.Role}' is not in the target vocabulary", "role");
            return null;
        }

        Guid? departmentId = null;
        var departmentRef = ReferenceResolver.Classify(
            DepartmentMapper.Collection, doc.DepartmentId, context.Departments);
        switch (departmentRef.Kind)
        {
            case ReferenceKind.Resolved:
                departmentId = departmentRef.TargetId;
                break;
            case ReferenceKind.Absent:
                break;
            default:
                report.Degraded(
                    departmentRef.Kind == ReferenceKind.Malformed
                        ? MigrationRules.MalformedReference
                        : MigrationRules.DanglingReference,
                    Collection, legacyId, "department_id",
                    $"department_id '{doc.DepartmentId}' is {departmentRef.Kind}; loaded as NULL");
                break;
        }

        var legacyStatus = MapperHelpers.Trimmed(doc.Status) ?? InvitationValidation.StatusPending;
        var status = legacyStatus;
        if (legacyStatus is not (InvitationValidation.StatusPending
            or InvitationValidation.StatusSent
            or InvitationValidation.StatusAccepted))
        {
            status = doc.AcceptedAt is not null ? InvitationValidation.StatusAccepted
                : doc.SentAt is not null ? InvitationValidation.StatusSent
                : InvitationValidation.StatusPending;
            report.Normalisation(MigrationRules.InvitationStatusReconstructed, Collection, legacyId, "status",
                $"legacy status '{legacyStatus}' has no target member; reconstructed as '{status}' from the row's "
                + "own timestamps (expiry lives in expires_at on this side)");
        }

        var createdAt = MapperHelpers.Timestamp(doc.CreatedAt, doc.Id, Collection, "created_at", report);
        var expiresAt = doc.ExpiresAt is { } expiry
            ? new DateTimeOffset(DateTime.SpecifyKind(expiry, DateTimeKind.Utc))
            : createdAt.AddDays(7);
        if (doc.ExpiresAt is null)
        {
            report.Normalisation(MigrationRules.InvitationExpiryDerived, Collection, legacyId, "expires_at",
                "invitation carries no expires_at; the target column is NOT NULL, so it is derived from created_at");
        }

        var invitation = new UserInvitation
        {
            Id = MigrationIds.For(Collection, doc.Id),
            Email = MapperHelpers.Truncated(doc.Email, 255, Collection, legacyId, "email", report)?.ToLowerInvariant(),
            CompanyId = companyRef.TargetId!.Value,
            DepartmentId = departmentId,
            InvitedBy = inviterRef.TargetId!.Value,
            InvitationToken = token,
            InvitationType = invitationType,
            Role = role,
            Status = status,
            ExpiresAt = expiresAt,
            SentAt = Utc(doc.SentAt),
            OpenedAt = Utc(doc.OpenedAt),
            AcceptedAt = Utc(doc.AcceptedAt),
            ReminderCount = doc.ReminderCount ?? 0,
            LastReminderSentAt = Utc(doc.LastReminderSent),
            Metadata = BuildMetadata(doc, legacyStatus),
            InvitationData = LegacyJson.Serialize(doc.InvitationData),
        };

        return new MappedUserInvitation(
            invitation, MapDemographics(doc, invitation, companyRef.TargetId!.Value, context));
    }

    private static string BuildMetadata(LegacyUserInvitation doc, string legacyStatus)
    {
        // The original status and whatever legacy metadata carried, in one jsonb.
        var payload = new Dictionary<string, object?> { ["legacy_status"] = legacyStatus };
        if (LegacyJson.Serialize(doc.Metadata) is { } metadata)
        {
            payload["legacy_metadata"] = JsonDocument.Parse(metadata).RootElement;
        }

        return JsonSerializer.Serialize(payload);
    }

    /// <summary>
    /// #193's rule, verbatim from UserMapper: keys resolve against the inviting
    /// company's DemographicField vocabulary, values must be scalar and fit the column.
    /// </summary>
    private static List<UserInvitationDemographic> MapDemographics(
        LegacyUserInvitation doc, UserInvitation invitation, Guid companyId, MappingContext context)
    {
        var report = context.Report;
        var legacyId = doc.Id.ToString();
        var rows = new List<UserInvitationDemographic>();
        var seen = new HashSet<Guid>();
        if (doc.Demographics is not { } demographics || demographics.ElementCount == 0)
        {
            return rows;
        }

        foreach (var element in demographics.Elements)
        {
            if (!context.DemographicFields.TryGetValue((companyId, element.Name), out var fieldId))
            {
                report.Normalisation(MigrationRules.DemographicKeyUnresolved, Collection, legacyId,
                    $"demographics.{element.Name}",
                    "key does not name a DemographicField of the inviting company; pair not migrated");
                continue;
            }

            var value = ScalarOf(element.Value);
            if (value is null)
            {
                report.Normalisation(MigrationRules.DemographicValueNotScalar, Collection, legacyId,
                    $"demographics.{element.Name}",
                    $"value of type {element.Value.BsonType} is not a scalar; pair not migrated");
                continue;
            }

            if (value.Length > 500)
            {
                report.Normalisation(MigrationRules.DemographicValueOverlong, Collection, legacyId,
                    $"demographics.{element.Name}",
                    $"value is {value.Length} chars; the column holds 500; pair not migrated");
                continue;
            }

            // (invitation, field) is the primary key, so a repeated key would collide.
            if (!seen.Add(fieldId))
            {
                report.Normalisation(MigrationRules.DemographicKeyUnresolved, Collection, legacyId,
                    $"demographics.{element.Name}",
                    "another key already resolved to this demographic field; pair not migrated");
                continue;
            }

            rows.Add(new UserInvitationDemographic
            {
                InvitationId = invitation.Id,
                DemographicFieldId = fieldId,
                Value = value,
            });
        }

        return rows;
    }

    private static string? ScalarOf(BsonValue value) => value.BsonType switch
    {
        BsonType.String => MapperHelpers.Trimmed(value.AsString),
        BsonType.Int32 => value.AsInt32.ToString(System.Globalization.CultureInfo.InvariantCulture),
        BsonType.Int64 => value.AsInt64.ToString(System.Globalization.CultureInfo.InvariantCulture),
        BsonType.Double => value.AsDouble.ToString(System.Globalization.CultureInfo.InvariantCulture),
        BsonType.Boolean => value.AsBoolean ? "true" : "false",
        _ => null,
    };

    private static DateTimeOffset? Utc(DateTime? value)
        => value is { } present ? new DateTimeOffset(DateTime.SpecifyKind(present, DateTimeKind.Utc)) : null;
}

/// <summary>
/// The cross-domain compliance log - #143's table, and the one collection that maps
/// almost 1:1. Both sides carry action/resource/resource_id/details/success/
/// error_message/timestamp with the same meanings, and the target's action and resource
/// columns are free-form varchar(100) with no validated vocabulary class, so the legacy
/// enum values carry verbatim: narrowing them would destroy compliance history to fit a
/// vocabulary that does not exist.
///
/// user_id is SetNull (a deleted actor must not erase the record), company_id is
/// Restrict and NOT NULL - a log entry with no tenant cannot be scoped to anyone, so it
/// is a reported skip.
/// </summary>
public static class AuditLogMapper
{
    public const string Collection = "auditlogs";

    public static AuditLog? Map(LegacyAuditLog doc, MappingContext context)
    {
        var report = context.Report;
        var legacyId = doc.Id.ToString();
        MapperHelpers.ReportExtras(report, Collection, doc.Id, ("", doc.Extra));

        var companyRef = ReferenceResolver.Classify(
            CompanyMapper.Collection, LegacyReferences.HexOf(doc.CompanyId), context.Companies);
        if (companyRef.Kind != ReferenceKind.Resolved)
        {
            report.Skip(
                companyRef.Kind == ReferenceKind.Malformed
                    ? MigrationRules.MalformedReference
                    : MigrationRules.DanglingReference,
                Collection, legacyId,
                "company_id does not resolve; an audit entry that cannot be tenant-scoped "
                + "would be readable by the wrong company or by nobody",
                "company_id");
            return null;
        }

        // The actor is SetNull by design: a deleted user must not erase the evidence
        // that they acted, so an unresolvable actor degrades rather than skipping.
        Guid? userId = null;
        var userRef = ReferenceResolver.Classify(
            UserMapper.Collection, LegacyReferences.HexOf(doc.UserId), context.Users);
        switch (userRef.Kind)
        {
            case ReferenceKind.Resolved:
                userId = userRef.TargetId;
                break;
            case ReferenceKind.Absent:
                break;
            default:
                report.Degraded(
                    userRef.Kind == ReferenceKind.Malformed
                        ? MigrationRules.MalformedReference
                        : MigrationRules.DanglingReference,
                    Collection, legacyId, "user_id",
                    "user_id does not resolve; loaded as NULL, which the column allows so the entry survives");
                break;
        }

        var action = MapperHelpers.Truncated(doc.Action, 100, Collection, legacyId, "action", report);
        var resource = MapperHelpers.Truncated(doc.Resource, 100, Collection, legacyId, "resource", report);
        if (action is null || resource is null)
        {
            report.Skip(MigrationRules.MissingRequiredField, Collection, legacyId,
                "entry is missing its action or resource, both NOT NULL; an audit row that says neither "
                + "what happened nor to what is not evidence of anything",
                action is null ? "action" : "resource");
            return null;
        }

        return new AuditLog
        {
            Id = MigrationIds.For(Collection, doc.Id),
            UserId = userId,
            CompanyId = companyRef.TargetId!.Value,
            Action = action,
            Resource = resource,
            ResourceId = MapperHelpers.Truncated(doc.ResourceId, 255, Collection, legacyId, "resource_id", report),
            Details = LegacyJson.Serialize(doc.Details),
            IpAddress = MapperHelpers.Truncated(doc.IpAddress, 64, Collection, legacyId, "ip_address", report),
            UserAgent = MapperHelpers.Truncated(doc.UserAgent, 500, Collection, legacyId, "user_agent", report),

            // success has no legacy default: absent means the row predates the field.
            // Recording an unknown outcome as a failure would invent incidents, so it
            // takes the true-by-omission reading and says so.
            Success = doc.Success ?? true,
            ErrorMessage = MapperHelpers.Truncated(
                doc.ErrorMessage, 2000, Collection, legacyId, "error_message", report),
            Timestamp = MapperHelpers.Timestamp(doc.Timestamp, doc.Id, Collection, "timestamp", report),
        };
    }
}
