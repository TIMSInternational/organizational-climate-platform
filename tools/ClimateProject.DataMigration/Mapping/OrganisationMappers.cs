using ClimateProject.DataMigration.Legacy;
using ClimateProject.DataMigration.Reporting;
using ClimateProject.Domain.Entities;

namespace ClimateProject.DataMigration.Mapping;

// The foundational non-user mappers. Field tables come from the legacy Mongoose
// schemas (climate-project/src/models/*.ts), realised per the design doc's method:
// every legacy field is mapped, deliberately dropped with the reason in a comment
// here, or routed to the report. Mongoose applied its defaults at write time, so an
// ABSENT field means the document predates the field - the mapper leaves the target
// at its own default rather than inventing a value.

public static class CompanyMapper
{
    public const string Collection = "companies";

    public static Company? Map(LegacyCompany doc, MappingContext context)
    {
        var report = context.Report;
        var legacyId = doc.Id.ToString();
        MapperHelpers.ReportExtras(report, Collection, doc.Id,
            ("", doc.Extra), ("branding", doc.Branding?.Extra), ("settings", doc.Settings?.Extra));

        var name = MapperHelpers.Trimmed(doc.Name);
        if (name is null)
        {
            report.Skip(MigrationRules.MissingRequiredField, Collection, legacyId, "company has no name", "name");
            return null;
        }

        // is_active=false has no target column: a deactivated tenant arrives active,
        // which is a real finding, not a footnote. updated_at and __v are deliberate
        // drops (no target column; pure metadata).
        if (doc.IsActive == false)
        {
            report.Normalisation(MigrationRules.CompanyInactiveDropped, Collection, legacyId, "is_active",
                "legacy company was deactivated; the target schema has no is_active column");
        }

        var company = new Company
        {
            Id = MigrationIds.For(Collection, doc.Id),
            Name = name,
            EmailDomain = MapperHelpers.Trimmed(doc.Domain)?.ToLowerInvariant(),
            Industry = MapperHelpers.Trimmed(doc.Industry),
            Size = MapperHelpers.Trimmed(doc.Size),
            Country = MapperHelpers.Trimmed(doc.Country),
            SubscriptionTier = MapperHelpers.Trimmed(doc.SubscriptionTier),
            CreatedAt = MapperHelpers.Timestamp(doc.CreatedAt, doc.Id, Collection, "created_at", report),
        };

        if (doc.Branding is { } branding)
        {
            company.Branding.LogoUrl = MapperHelpers.Trimmed(branding.LogoUrl);
            if (branding.PrimaryColor is not null) company.Branding.PrimaryColor = branding.PrimaryColor;
            if (branding.SecondaryColor is not null) company.Branding.SecondaryColor = branding.SecondaryColor;
            if (branding.FontFamily is not null) company.Branding.FontFamily = branding.FontFamily;
            company.Branding.CustomCss = MapperHelpers.Trimmed(branding.CustomCss);
        }

        if (doc.Settings is { } settings)
        {
            if (settings.SurveyFrequency is not null) company.Settings.SurveyFrequency = settings.SurveyFrequency;
            if (settings.MicroclimateEnabled is { } micro) company.Settings.MicroclimateEnabled = micro;
            if (settings.AiInsightsEnabled is { } ai) company.Settings.AiInsightsEnabled = ai;
            if (settings.AnonymousSurveys is { } anon) company.Settings.AnonymousSurveys = anon;
            if (settings.DataRetentionDays is { } retention) company.Settings.DataRetentionDays = retention;
            if (settings.Timezone is not null) company.Settings.Timezone = settings.Timezone;
            if (settings.Language is not null) company.Settings.Language = settings.Language;
        }

        return company;
    }
}

/// <summary>A mapped department plus what its second pass needs.</summary>
public sealed record MappedDepartment(
    Department Department,
    string? LegacyParentId,
    string? LegacyManagerId,
    int? LegacyLevel,
    string? LegacyPath);

public static class DepartmentMapper
{
    public const string Collection = "departments";

    public static MappedDepartment? Map(LegacyDepartment doc, MappingContext context)
    {
        var report = context.Report;
        var legacyId = doc.Id.ToString();
        MapperHelpers.ReportExtras(report, Collection, doc.Id,
            ("", doc.Extra),
            ("hierarchy", doc.Hierarchy?.Extra),
            ("settings", doc.Settings?.Extra),
            ("settings.notification_preferences", doc.Settings?.NotificationPreferences?.Extra));

        var name = MapperHelpers.Trimmed(doc.Name);
        if (name is null)
        {
            report.Skip(MigrationRules.MissingRequiredField, Collection, legacyId, "department has no name", "name");
            return null;
        }

        // company_id is a NOT NULL FK: unresolvable means a reported skip, never an abort.
        var companyRef = ReferenceResolver.Classify(CompanyMapper.Collection, doc.CompanyId, context.Companies);
        if (companyRef.Kind != ReferenceKind.Resolved)
        {
            report.Skip(
                companyRef.Kind == ReferenceKind.Malformed
                    ? MigrationRules.MalformedReference
                    : MigrationRules.DanglingReference,
                Collection, legacyId,
                $"company_id '{doc.CompanyId}' is {companyRef.Kind}; departments cannot load without a company",
                "company_id");
            return null;
        }

        var department = new Department
        {
            Id = MigrationIds.For(Collection, doc.Id),
            // #155: tracking-api consumers read the RAW legacy id, so it rides along.
            LegacyExternalId = legacyId,
            CompanyId = companyRef.TargetId!.Value,
            Name = name,
            Description = MapperHelpers.Trimmed(doc.Description),
            EmployeeCount = doc.EmployeeCount ?? 0,
            IsActive = doc.IsActive ?? true,
            CreatedAt = MapperHelpers.Timestamp(doc.CreatedAt, doc.Id, Collection, "created_at", report),
            UpdatedAt = MapperHelpers.Timestamp(doc.UpdatedAt, doc.Id, Collection, "updated_at", report),
        };

        if (doc.Settings is { } settings)
        {
            if (settings.SurveyParticipationRequired is { } participation)
                department.Settings.SurveyParticipationRequired = participation;
            if (settings.MicroclimateFrequency is not null)
                department.Settings.MicroclimateFrequency = settings.MicroclimateFrequency;
            if (settings.AutoActionPlans is { } auto) department.Settings.AutoActionPlans = auto;
            if (settings.NotificationPreferences is { } prefs)
            {
                if (prefs.EmailEnabled is { } email) department.Settings.NotificationEmail = email;
                if (prefs.SlackEnabled is { } slack) department.Settings.NotificationSlack = slack;
                if (prefs.TeamsEnabled is { } teams) department.Settings.NotificationTeams = teams;
            }
        }

        // ParentDepartmentId and ManagerId load in the second pass: parents because a
        // child can precede its parent in _id order, managers because users load after
        // departments (the users<->departments FK cycle). level/path are derived values
        // with no target column - the pipeline recomputes and asserts them post-pass.
        return new MappedDepartment(
            department,
            MapperHelpers.Trimmed(doc.Hierarchy?.ParentDepartmentId),
            MapperHelpers.Trimmed(doc.ManagerId),
            doc.Hierarchy?.Level,
            MapperHelpers.Trimmed(doc.Hierarchy?.Path));
    }
}

/// <summary>A mapped demographic field plus its fanned-out option rows.</summary>
public sealed record MappedDemographicField(
    DemographicField Field,
    IReadOnlyList<DemographicFieldOption> Options);

public static class DemographicFieldMapper
{
    public const string Collection = "demographicfields";

    public static MappedDemographicField? Map(LegacyDemographicField doc, MappingContext context)
    {
        var report = context.Report;
        var legacyId = doc.Id.ToString();
        MapperHelpers.ReportExtras(report, Collection, doc.Id, ("", doc.Extra));

        var fieldKey = MapperHelpers.Trimmed(doc.Field);
        if (fieldKey is null)
        {
            report.Skip(MigrationRules.MissingRequiredField, Collection, legacyId,
                "demographic field has no field key", "field");
            return null;
        }

        var companyRef = ReferenceResolver.Classify(CompanyMapper.Collection, doc.CompanyId, context.Companies);
        if (companyRef.Kind != ReferenceKind.Resolved)
        {
            report.Skip(
                companyRef.Kind == ReferenceKind.Malformed
                    ? MigrationRules.MalformedReference
                    : MigrationRules.DanglingReference,
                Collection, legacyId,
                $"company_id '{doc.CompanyId}' is {companyRef.Kind}; a demographic field belongs to a company",
                "company_id");
            return null;
        }

        var companyId = companyRef.TargetId!.Value;

        // One monolingual label, attributed by Company.language like every #195 field.
        var language = context.LanguageOf(companyId);
        var label = MapperHelpers.Trimmed(doc.Label);
        if (label is not null)
        {
            report.Attribution(Collection, legacyId, "label", language);
        }

        var field = new DemographicField
        {
            Id = MigrationIds.For(Collection, doc.Id),
            CompanyId = companyId,
            Field = fieldKey,
            LabelEn = language == "en" ? label : null,
            LabelEs = language == "es" ? label : null,
            Type = MapperHelpers.Trimmed(doc.Type) ?? "text",
            Required = doc.Required ?? false,
            Order = doc.Order ?? 0,
            IsActive = doc.IsActive ?? true,
            CreatedAt = MapperHelpers.Timestamp(doc.CreatedAt, doc.Id, Collection, "created_at", report),
            UpdatedAt = MapperHelpers.Timestamp(doc.UpdatedAt, doc.Id, Collection, "updated_at", report),
        };

        // Options fan out to rows whose stable Value is the option text verbatim -
        // the same decision the #195 migration made for question options, and the
        // reason existing stored answers keep matching.
        var options = new List<DemographicFieldOption>();
        var order = 0;
        foreach (var option in doc.Options ?? [])
        {
            var value = MapperHelpers.Trimmed(option);
            if (value is null)
            {
                continue;
            }

            options.Add(new DemographicFieldOption
            {
                DemographicFieldId = field.Id,
                Order = order++,
                Value = value,
                LabelEn = language == "en" ? value : null,
                LabelEs = language == "es" ? value : null,
            });
        }

        return new MappedDemographicField(field, options);
    }
}

public static class SystemSettingsMapper
{
    public const string Collection = "systemsettings";

    public static SystemSettings Map(LegacySystemSettings doc, MappingContext context)
    {
        var report = context.Report;
        var legacyId = doc.Id.ToString();
        MapperHelpers.ReportExtras(report, Collection, doc.Id,
            ("", doc.Extra), ("password_policy", doc.PasswordPolicy?.Extra), ("email_settings", doc.EmailSettings?.Extra));

        var settings = new SystemSettings
        {
            Id = MigrationIds.For(Collection, doc.Id),
            CreatedAt = MapperHelpers.Timestamp(doc.CreatedAt, doc.Id, Collection, "created_at", report),
            UpdatedAt = MapperHelpers.Timestamp(doc.UpdatedAt, doc.Id, Collection, "updated_at", report),
        };

        if (doc.LoginEnabled is { } login) settings.LoginEnabled = login;
        if (doc.MaintenanceMode is { } maintenance) settings.MaintenanceMode = maintenance;

        // Platform-level content has no company to attribute by; it goes to the
        // fallback locale (en), recorded like every other attribution.
        var message = MapperHelpers.Trimmed(doc.MaintenanceMessage);
        if (message is not null)
        {
            settings.MaintenanceMessageEn = message;
            report.Attribution(Collection, legacyId, "maintenance_message", "en");
        }

        if (doc.MaxLoginAttempts is { } attempts) settings.MaxLoginAttempts = attempts;
        if (doc.SessionTimeoutMinutes is { } timeout) settings.SessionTimeoutMinutes = timeout;

        if (doc.PasswordPolicy is { } policy)
        {
            if (policy.MinLength is { } minLength) settings.PasswordPolicy.MinLength = minLength;
            if (policy.RequireUppercase is { } upper) settings.PasswordPolicy.RequireUppercase = upper;
            if (policy.RequireLowercase is { } lower) settings.PasswordPolicy.RequireLowercase = lower;
            if (policy.RequireNumbers is { } numbers) settings.PasswordPolicy.RequireNumbers = numbers;
            if (policy.RequireSpecialChars is { } special) settings.PasswordPolicy.RequireSpecialChars = special;
        }

        if (doc.EmailSettings is { } email)
        {
            if (email.SmtpEnabled is { } smtp) settings.EmailSettings.SmtpEnabled = smtp;
            settings.EmailSettings.FromEmail = MapperHelpers.Trimmed(email.FromEmail);
            settings.EmailSettings.SmtpHost = MapperHelpers.Trimmed(email.SmtpHost);
            settings.EmailSettings.SmtpPort = email.SmtpPort;
        }

        return settings;
    }
}
