using ClimateProject.DataMigration.Legacy;
using ClimateProject.DataMigration.Reporting;
using ClimateProject.Domain.Entities;
using MongoDB.Bson;

namespace ClimateProject.DataMigration.Mapping;

/// <summary>A mapped user, its demographic fan-out, and what the second pass needs.</summary>
public sealed record MappedUser(
    User User,
    IReadOnlyList<UserDemographic> Demographics,
    string? LegacyManagerId);

/// <summary>
/// The identity root, realised 1:1 from the design doc's corrected mapping table
/// (docs/superpowers/specs/2026-08-03-mongo-to-postgres-etl-design.md, "Worked
/// example"). The four traps that table exists to record:
///
/// - #191: CompanyId is nullable FOR SUPER-ADMINS ONLY. A non-super user whose company
///   reference cannot resolve is a reported skip - writing NULL would quietly promote
///   them to global scope.
/// - #192: the six notification preferences carry over verbatim when present and stay
///   untouched when absent - the email_* fields are opt-outs real users set, and
///   fabricating a value re-subscribes them.
/// - #193: demographics fan out to UserDemographic rows, every key resolved against
///   the company's DemographicField vocabulary; unresolved keys and non-scalar or
///   oversize values go to the report, never silently dropped.
/// - #284: SecurityStamp is initialised by the entity itself and the ETL NEVER writes
///   it - not on insert beyond the entity's own initializer, and never on re-run,
///   because a re-keyed stamp ends that user's live sessions.
///
/// PersonaExternalId carries the raw legacy _id hex (#155): tracking-api consumers
/// read that string and are not being re-keyed.
/// </summary>
public static class UserMapper
{
    public const string Collection = "users";

    /// <summary>Roles.All plus nothing: the target vocabulary this mapper may emit.</summary>
    private static readonly HashSet<string> TargetRoles =
        ["super_admin", "company_admin", "leader", "supervisor", "employee"];

    public static MappedUser? Map(LegacyUser doc, MappingContext context)
    {
        var report = context.Report;
        var legacyId = doc.Id.ToString();
        MapperHelpers.ReportExtras(report, Collection, doc.Id,
            ("", doc.Extra),
            ("preferences", doc.Preferences?.Extra),
            ("preferences.notification_settings", doc.Preferences?.NotificationSettings?.Extra),
            ("consent_preferences", doc.ConsentPreferences?.Extra));

        var name = MapperHelpers.Trimmed(doc.Name);
        if (name is null)
        {
            report.Skip(MigrationRules.MissingRequiredField, Collection, legacyId, "user has no name", "name");
            return null;
        }

        var email = MapperHelpers.Trimmed(doc.Email)?.ToLowerInvariant();
        if (email is null)
        {
            report.Skip(MigrationRules.MissingRequiredField, Collection, legacyId, "user has no email", "email");
            return null;
        }

        // Legacy has SIX roles; the target has five. department_admin was split into
        // leader/supervisor when the dashboards were rebuilt (#132); the ETL maps it to
        // 'leader' - the higher of the two department rungs - as a named, per-user rule.
        var role = MapperHelpers.Trimmed(doc.Role) ?? "employee";
        if (role == "department_admin")
        {
            report.Normalisation(MigrationRules.RoleDepartmentAdminRemapped, Collection, legacyId, "role",
                "legacy role 'department_admin' has no target equivalent; remapped to 'leader'");
            role = "leader";
        }

        if (!TargetRoles.Contains(role))
        {
            report.Skip(MigrationRules.RoleUnknown, Collection, legacyId,
                $"role '{doc.Role}' is not in the target vocabulary", "role");
            return null;
        }

        // #191: null company means GLOBAL scope, which only a super_admin may hold.
        Guid? companyId = null;
        var companyRef = ReferenceResolver.Classify(CompanyMapper.Collection, doc.CompanyId, context.Companies);
        switch (companyRef.Kind)
        {
            case ReferenceKind.Resolved:
                companyId = companyRef.TargetId;
                break;
            case ReferenceKind.Absent when role == "super_admin":
                break;
            default:
                report.Skip(
                    companyRef.Kind == ReferenceKind.Malformed
                        ? MigrationRules.MalformedReference
                        : MigrationRules.DanglingReference,
                    Collection, legacyId,
                    $"company_id '{doc.CompanyId}' is {companyRef.Kind} and role '{role}' cannot be global",
                    "company_id");
                return null;
        }

        // department_id is genuinely nullable: unresolved degrades to NULL, reported.
        Guid? departmentId = null;
        var departmentRef = ReferenceResolver.Classify(DepartmentMapper.Collection, doc.DepartmentId, context.Departments);
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

        var user = new User
        {
            Id = MigrationIds.For(Collection, doc.Id),
            CompanyId = companyId,
            Email = email,
            Name = name,
            PasswordHash = MapperHelpers.Trimmed(doc.PasswordHash),
            Role = role,
            PersonaExternalId = legacyId,
            DepartmentId = departmentId,
            IsActive = doc.IsActive ?? true,
            LastLoginAt = doc.LastLogin is { } lastLogin
                ? new DateTimeOffset(DateTime.SpecifyKind(lastLogin, DateTimeKind.Utc))
                : null,
            ConsentUpdatedAt = doc.ConsentUpdatedAt is { } consentAt
                ? new DateTimeOffset(DateTime.SpecifyKind(consentAt, DateTimeKind.Utc))
                : null,
            CreatedAt = MapperHelpers.Timestamp(doc.CreatedAt, doc.Id, Collection, "created_at", report),
            UpdatedAt = MapperHelpers.Timestamp(doc.UpdatedAt, doc.Id, Collection, "updated_at", report),
        };

        if (doc.Preferences is { } prefs)
        {
            if (prefs.Language is not null) user.Preferences.Language = prefs.Language;
            if (prefs.Timezone is not null) user.Preferences.Timezone = prefs.Timezone;
            if (prefs.DashboardLayout is not null) user.Preferences.DashboardLayout = prefs.DashboardLayout;
            if (prefs.Theme is not null) user.Preferences.Theme = prefs.Theme;

            // #192: verbatim when present, untouched when absent.
            if (prefs.NotificationSettings is { } notifications)
            {
                if (notifications.EmailSurveys is { } surveys) user.Notifications.EmailSurveys = surveys;
                if (notifications.EmailMicroclimates is { } micro) user.Notifications.EmailMicroclimates = micro;
                if (notifications.EmailActionPlans is { } plans) user.Notifications.EmailActionPlans = plans;
                if (notifications.EmailReminders is { } reminders) user.Notifications.EmailReminders = reminders;
                if (notifications.PushNotifications is { } push) user.Notifications.PushNotifications = push;
                if (notifications.DigestFrequency is not null) user.Notifications.DigestFrequency = notifications.DigestFrequency;
            }
        }

        if (doc.ConsentPreferences is { } consent)
        {
            if (consent.Essential is { } essential) user.Consent.Essential = essential;
            if (consent.Analytics is { } analytics) user.Consent.Analytics = analytics;
            if (consent.Marketing is { } marketing) user.Consent.Marketing = marketing;
            if (consent.Personalization is { } personalization) user.Consent.Personalization = personalization;
            if (consent.ThirdParty is { } thirdParty) user.Consent.ThirdParty = thirdParty;
            if (consent.Demographics is { } demographicsConsent) user.Consent.Demographics = demographicsConsent;
        }

        var demographics = MapDemographics(doc, user, companyId, context);

        return new MappedUser(user, demographics, MapperHelpers.Trimmed(doc.ManagerId));
    }

    /// <summary>
    /// #193: the schemaless demographics object fans out to UserDemographic rows.
    /// Every key must name a DemographicField the user's company defines; the value
    /// must be a scalar and fit the column. Everything else is reported by rule name.
    /// </summary>
    private static List<UserDemographic> MapDemographics(
        LegacyUser doc, User user, Guid? companyId, MappingContext context)
    {
        var report = context.Report;
        var legacyId = doc.Id.ToString();
        var rows = new List<UserDemographic>();
        if (doc.Demographics is not { } demographics || demographics.ElementCount == 0)
        {
            return rows;
        }

        foreach (var element in demographics.Elements)
        {
            if (companyId is not Guid company
                || !context.DemographicFields.TryGetValue((company, element.Name), out var fieldId))
            {
                report.Normalisation(MigrationRules.DemographicKeyUnresolved, Collection, legacyId,
                    $"demographics.{element.Name}",
                    "key does not name a DemographicField of the user's company; pair not migrated");
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

            rows.Add(new UserDemographic
            {
                UserId = user.Id,
                DemographicFieldId = fieldId,
                Value = value,
                CreatedAt = user.CreatedAt,
                UpdatedAt = user.UpdatedAt,
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
}
