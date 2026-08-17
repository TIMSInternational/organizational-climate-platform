using ClimateProject.DataMigration;
using ClimateProject.DataMigration.Legacy;
using ClimateProject.DataMigration.Mapping;
using ClimateProject.DataMigration.Reporting;
using MongoDB.Bson;
using MongoDB.Bson.Serialization;

namespace ClimateProject.DataMigration.Tests;

/// <summary>
/// Sub-issue B's unit layer: mappers as pure functions over fixture documents,
/// including per collection at least one document that does NOT match the nominal
/// schema. Fixtures deserialize from raw BsonDocuments - the same path production
/// bytes take - so the [BsonExtraElements] honesty mechanism is exercised for real.
/// </summary>
public class MapperTests
{
    private static readonly ObjectId CompanyOid = ObjectId.Parse("64a000000000000000000001");
    private static readonly ObjectId EsCompanyOid = ObjectId.Parse("64a000000000000000000002");
    private static readonly Guid CompanyId = MigrationIds.For("companies", CompanyOid);
    private static readonly Guid EsCompanyId = MigrationIds.For("companies", EsCompanyOid);

    private static T Load<T>(BsonDocument document) where T : LegacyDocument
        => BsonSerializer.Deserialize<T>(document);

    private static MappingContext Context(DataQualityReport report, Guid? fieldCompany = null, string? fieldKey = null)
        => new()
        {
            Report = report,
            Companies = new HashSet<Guid> { CompanyId, EsCompanyId },
            CompanyLanguages = new Dictionary<Guid, string> { [CompanyId] = "en", [EsCompanyId] = "es" },
            Departments = new HashSet<Guid>(),
            DemographicFields = fieldCompany is { } company && fieldKey is not null
                ? new Dictionary<(Guid, string), Guid> { [(company, fieldKey)] = Guid.NewGuid() }
                : new Dictionary<(Guid, string), Guid>(),
        };

    // ------------------------------------------------------------------
    // Company
    // ------------------------------------------------------------------

    [Fact]
    public void Company_maps_nominal_document_and_reports_nothing()
    {
        var report = new DataQualityReport();
        var doc = Load<LegacyCompany>(new BsonDocument
        {
            ["_id"] = CompanyOid,
            ["name"] = "Acme Inc",
            ["domain"] = "Acme.com",
            ["industry"] = "Manufacturing",
            ["size"] = "medium",
            ["country"] = "US",
            ["settings"] = new BsonDocument { ["language"] = "en", ["timezone"] = "America/New_York" },
            ["is_active"] = true,
            ["subscription_tier"] = "professional",
            ["created_at"] = new DateTime(2024, 3, 11, 0, 0, 0, DateTimeKind.Utc),
            ["updated_at"] = new DateTime(2024, 3, 12, 0, 0, 0, DateTimeKind.Utc),
        });

        var company = CompanyMapper.Map(doc, Context(report));

        Assert.NotNull(company);
        Assert.Equal(CompanyId, company!.Id);
        Assert.Equal("acme.com", company.EmailDomain);
        Assert.Equal("America/New_York", company.Settings.Timezone);
        Assert.Empty(report.Entries);
    }

    [Fact]
    public void Company_without_a_name_is_a_reported_skip()
    {
        var report = new DataQualityReport();
        var doc = Load<LegacyCompany>(new BsonDocument { ["_id"] = CompanyOid, ["domain"] = "a.com" });

        Assert.Null(CompanyMapper.Map(doc, Context(report)));
        var entry = Assert.Single(report.Entries, e => e.Kind == ReportEntryKind.Skip);
        Assert.Equal(MigrationRules.MissingRequiredField, entry.Rule);
        Assert.Equal(1, report.SkipCount("companies"));
    }

    [Fact]
    public void Company_undeclared_field_lands_in_the_report_not_in_silence()
    {
        var report = new DataQualityReport();
        var doc = Load<LegacyCompany>(new BsonDocument
        {
            ["_id"] = CompanyOid,
            ["name"] = "Acme",
            ["legacy_crm_code"] = "X-99",
            ["settings"] = new BsonDocument { ["language"] = "en", ["beta_flags"] = new BsonArray { "a" } },
        });

        Assert.NotNull(CompanyMapper.Map(doc, Context(report)));
        Assert.Contains(report.Entries, e => e.Kind == ReportEntryKind.UnmappedExtra && e.Field == "legacy_crm_code");
        Assert.Contains(report.Entries, e => e.Kind == ReportEntryKind.UnmappedExtra && e.Field == "settings.beta_flags");
    }

    [Fact]
    public void Deactivated_company_is_reported_because_the_flag_has_no_column()
    {
        var report = new DataQualityReport();
        var doc = Load<LegacyCompany>(new BsonDocument
        {
            ["_id"] = CompanyOid, ["name"] = "Ghost Co", ["is_active"] = false,
        });

        Assert.NotNull(CompanyMapper.Map(doc, Context(report)));
        Assert.Contains(report.Entries, e => e.Rule == MigrationRules.CompanyInactiveDropped);
    }

    // ------------------------------------------------------------------
    // DemographicField
    // ------------------------------------------------------------------

    [Fact]
    public void Demographic_field_label_is_attributed_by_company_language()
    {
        var report = new DataQualityReport();
        var doc = Load<LegacyDemographicField>(new BsonDocument
        {
            ["_id"] = ObjectId.GenerateNewId(),
            ["company_id"] = EsCompanyOid.ToString(),
            ["field"] = "tenure",
            ["label"] = "Antigüedad",
            ["type"] = "select",
            ["options"] = new BsonArray { "0-1", "1-3", "3+" },
        });

        var mapped = DemographicFieldMapper.Map(doc, Context(report));

        Assert.NotNull(mapped);
        Assert.Null(mapped!.Field.LabelEn);
        Assert.Equal("Antigüedad", mapped.Field.LabelEs);
        Assert.Equal(3, mapped.Options.Count);
        Assert.Equal("0-1", mapped.Options[0].Value);
        Assert.Equal("0-1", mapped.Options[0].LabelEs);
        Assert.Null(mapped.Options[0].LabelEn);
        Assert.Contains(report.Entries, e => e.Kind == ReportEntryKind.Attribution && e.Field == "label");
    }

    // ------------------------------------------------------------------
    // Department
    // ------------------------------------------------------------------

    [Fact]
    public void Department_with_dangling_company_is_a_reported_skip_not_an_abort()
    {
        var report = new DataQualityReport();
        var doc = Load<LegacyDepartment>(new BsonDocument
        {
            ["_id"] = ObjectId.GenerateNewId(),
            ["name"] = "Orphans",
            ["company_id"] = ObjectId.GenerateNewId().ToString(),
            ["hierarchy"] = new BsonDocument { ["level"] = 0, ["path"] = "orphans" },
        });

        Assert.Null(DepartmentMapper.Map(doc, Context(report)));
        var entry = Assert.Single(report.Entries, e => e.Kind == ReportEntryKind.Skip);
        Assert.Equal(MigrationRules.DanglingReference, entry.Rule);
    }

    [Fact]
    public void Department_carries_raw_legacy_id_and_defers_parent_and_manager()
    {
        var report = new DataQualityReport();
        var oid = ObjectId.GenerateNewId();
        var parentOid = ObjectId.GenerateNewId();
        var doc = Load<LegacyDepartment>(new BsonDocument
        {
            ["_id"] = oid,
            ["name"] = "Backend API",
            ["company_id"] = CompanyOid.ToString(),
            ["manager_id"] = ObjectId.GenerateNewId().ToString(),
            ["hierarchy"] = new BsonDocument
            {
                ["parent_department_id"] = parentOid.ToString(),
                ["level"] = 1,
                ["path"] = "engineering/backend-api",
            },
        });

        var mapped = DepartmentMapper.Map(doc, Context(report));

        Assert.NotNull(mapped);
        Assert.Equal(oid.ToString(), mapped!.Department.LegacyExternalId);
        Assert.Null(mapped.Department.ParentDepartmentId);
        Assert.Null(mapped.Department.ManagerId);
        Assert.Equal(parentOid.ToString(), mapped.LegacyParentId);
        Assert.Equal(1, mapped.LegacyLevel);
        Assert.Equal("engineering/backend-api", mapped.LegacyPath);
    }

    // ------------------------------------------------------------------
    // User
    // ------------------------------------------------------------------

    private static BsonDocument NominalUser(ObjectId oid) => new()
    {
        ["_id"] = oid,
        ["name"] = "Ada Lovelace",
        ["email"] = "Ada@Acme.com",
        ["password_hash"] = "$2b$10$abcdefghijklmnopqrstuv",
        ["role"] = "employee",
        ["company_id"] = CompanyOid.ToString(),
        ["created_at"] = new DateTime(2024, 1, 1, 0, 0, 0, DateTimeKind.Utc),
        ["updated_at"] = new DateTime(2024, 1, 2, 0, 0, 0, DateTimeKind.Utc),
    };

    [Fact]
    public void User_maps_the_corrected_table_including_the_raw_persona_id()
    {
        var report = new DataQualityReport();
        var oid = ObjectId.GenerateNewId();
        var doc = NominalUser(oid);
        doc["preferences"] = new BsonDocument
        {
            ["language"] = "es",
            ["notification_settings"] = new BsonDocument
            {
                // The opt-out that must survive verbatim (#192).
                ["email_reminders"] = false,
            },
        };

        var mapped = UserMapper.Map(Load<LegacyUser>(doc), Context(report));

        Assert.NotNull(mapped);
        Assert.Equal("ada@acme.com", mapped!.User.Email);
        Assert.Equal(oid.ToString(), mapped.User.PersonaExternalId);
        Assert.Equal(CompanyId, mapped.User.CompanyId);
        Assert.Equal("es", mapped.User.Preferences.Language);
        // Present-and-false carries over; the five absent preferences keep their defaults.
        Assert.False(mapped.User.Notifications.EmailReminders);
        Assert.True(mapped.User.Notifications.EmailSurveys);
    }

    [Fact]
    public void Department_admin_is_remapped_to_leader_as_a_named_rule()
    {
        var report = new DataQualityReport();
        var doc = NominalUser(ObjectId.GenerateNewId());
        doc["role"] = "department_admin";

        var mapped = UserMapper.Map(Load<LegacyUser>(doc), Context(report));

        Assert.Equal("leader", mapped!.User.Role);
        Assert.Contains(report.Entries, e => e.Rule == MigrationRules.RoleDepartmentAdminRemapped);
    }

    [Fact]
    public void Unknown_role_is_a_reported_skip()
    {
        var report = new DataQualityReport();
        var doc = NominalUser(ObjectId.GenerateNewId());
        doc["role"] = "wizard";

        Assert.Null(UserMapper.Map(Load<LegacyUser>(doc), Context(report)));
        Assert.Contains(report.Entries, e => e.Rule == MigrationRules.RoleUnknown && e.Kind == ReportEntryKind.Skip);
    }

    [Fact]
    public void Non_super_user_with_unresolvable_company_is_skipped_never_made_global()
    {
        var report = new DataQualityReport();
        var doc = NominalUser(ObjectId.GenerateNewId());
        doc["company_id"] = "undefined";

        Assert.Null(UserMapper.Map(Load<LegacyUser>(doc), Context(report)));
        Assert.Contains(report.Entries, e => e.Rule == MigrationRules.MalformedReference && e.Kind == ReportEntryKind.Skip);
    }

    [Fact]
    public void Super_admin_without_a_company_is_global_scope_by_design()
    {
        var report = new DataQualityReport();
        var doc = NominalUser(ObjectId.GenerateNewId());
        doc["role"] = "super_admin";
        doc.Remove("company_id");

        var mapped = UserMapper.Map(Load<LegacyUser>(doc), Context(report));

        Assert.NotNull(mapped);
        Assert.Null(mapped!.User.CompanyId);
        Assert.Empty(report.Entries);
    }

    [Fact]
    public void Demographics_fan_out_resolves_keys_and_reports_every_misfit()
    {
        var report = new DataQualityReport();
        var context = new MappingContext
        {
            Report = report,
            Companies = new HashSet<Guid> { CompanyId },
            CompanyLanguages = new Dictionary<Guid, string> { [CompanyId] = "en" },
            DemographicFields = new Dictionary<(Guid, string), Guid>
            {
                [(CompanyId, "tenure")] = Guid.NewGuid(),
                [(CompanyId, "nested")] = Guid.NewGuid(),
                [(CompanyId, "novel")] = Guid.NewGuid(),
            },
        };
        var doc = NominalUser(ObjectId.GenerateNewId());
        doc["demographics"] = new BsonDocument
        {
            ["tenure"] = "1-3",
            ["shoe_size"] = 44,
            ["nested"] = new BsonDocument { ["x"] = 1 },
            ["novel"] = new string('x', 501),
        };

        var mapped = UserMapper.Map(Load<LegacyUser>(doc), context);

        var row = Assert.Single(mapped!.Demographics);
        Assert.Equal("1-3", row.Value);
        Assert.Contains(report.Entries, e => e.Rule == MigrationRules.DemographicKeyUnresolved && e.Field == "demographics.shoe_size");
        Assert.Contains(report.Entries, e => e.Rule == MigrationRules.DemographicValueNotScalar && e.Field == "demographics.nested");
        Assert.Contains(report.Entries, e => e.Rule == MigrationRules.DemographicValueOverlong && e.Field == "demographics.novel");
    }
}
