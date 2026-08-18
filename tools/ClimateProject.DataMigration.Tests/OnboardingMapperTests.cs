using System.Text.Json;
using ClimateProject.Application.OrgStructure;
using ClimateProject.DataMigration;
using ClimateProject.DataMigration.Legacy;
using ClimateProject.DataMigration.Mapping;
using ClimateProject.DataMigration.Reporting;
using MongoDB.Bson;
using MongoDB.Bson.Serialization;

namespace ClimateProject.DataMigration.Tests;

/// <summary>
/// The roster's front door and the compliance log. UserInvitation inherits two rules
/// rather than inventing them (#193's demographic fan-out, #132's role split);
/// AuditLog is the one collection that maps almost 1:1, so its interest is in what
/// survives an unresolvable actor.
/// </summary>
public class OnboardingMapperTests
{
    private static readonly ObjectId CompanyOid = ObjectId.Parse("652000000000000000000001");
    private static readonly ObjectId UserOid = ObjectId.Parse("652000000000000000000011");
    private static readonly ObjectId DeptOid = ObjectId.Parse("652000000000000000000021");
    private static readonly ObjectId InviteOid = ObjectId.Parse("652000000000000000000031");
    private static readonly ObjectId AuditOid = ObjectId.Parse("652000000000000000000041");

    private static readonly Guid CompanyId = MigrationIds.For("companies", CompanyOid);
    private static readonly Guid UserId = MigrationIds.For("users", UserOid);
    private static readonly Guid DeptId = MigrationIds.For("departments", DeptOid);
    private static readonly Guid TenureFieldId = Guid.NewGuid();

    private static T Load<T>(BsonDocument document) where T : LegacyDocument
        => BsonSerializer.Deserialize<T>(document);

    private static MappingContext Context(DataQualityReport report) => new()
    {
        Report = report,
        Companies = new HashSet<Guid> { CompanyId },
        CompanyLanguages = new Dictionary<Guid, string> { [CompanyId] = "en" },
        Users = new HashSet<Guid> { UserId },
        Departments = new HashSet<Guid> { DeptId },
        DemographicFields = new Dictionary<(Guid, string), Guid> { [(CompanyId, "tenure")] = TenureFieldId },
    };

    private static BsonDocument NominalInvitation() => new()
    {
        ["_id"] = InviteOid,
        ["email"] = "New@Acme.com",
        ["company_id"] = CompanyOid.ToString(),
        ["department_id"] = DeptOid.ToString(),
        ["invited_by"] = UserOid.ToString(),
        ["invitation_token"] = "tok-abcdef",
        ["invitation_type"] = "employee_direct",
        ["role"] = "employee",
        ["status"] = "sent",
        ["expires_at"] = new DateTime(2026, 7, 20, 0, 0, 0, DateTimeKind.Utc),
        ["sent_at"] = new DateTime(2026, 7, 13, 9, 0, 0, DateTimeKind.Utc),
        ["created_at"] = new DateTime(2026, 7, 13, 8, 0, 0, DateTimeKind.Utc),
    };

    [Fact]
    public void Invitation_maps_nominal_document_and_fans_out_demographics()
    {
        var report = new DataQualityReport();
        var doc = NominalInvitation();
        doc["demographics"] = new BsonDocument { ["tenure"] = "1-3", ["unknown_key"] = "x" };

        var mapped = UserInvitationMapper.Map(Load<LegacyUserInvitation>(doc), Context(report));

        Assert.NotNull(mapped);
        Assert.Equal("new@acme.com", mapped!.Invitation.Email);
        Assert.Equal(CompanyId, mapped.Invitation.CompanyId);
        Assert.Equal(DeptId, mapped.Invitation.DepartmentId);
        Assert.Equal(UserId, mapped.Invitation.InvitedBy);
        Assert.Equal(InvitationValidation.TypeEmployeeDirect, mapped.Invitation.InvitationType);
        Assert.Equal(InvitationValidation.StatusSent, mapped.Invitation.Status);

        // #193's rule, through the front door this time.
        var row = Assert.Single(mapped.Demographics);
        Assert.Equal(TenureFieldId, row.DemographicFieldId);
        Assert.Equal("1-3", row.Value);
        Assert.Contains(report.Entries, e => e.Rule == MigrationRules.DemographicKeyUnresolved);
    }

    [Fact]
    public void An_invited_department_admin_lands_on_the_same_role_an_existing_one_does()
    {
        var report = new DataQualityReport();
        var doc = NominalInvitation();
        doc["role"] = "department_admin";

        var mapped = UserInvitationMapper.Map(Load<LegacyUserInvitation>(doc), Context(report));

        Assert.Equal("leader", mapped!.Invitation.Role);
        Assert.Contains(report.Entries, e => e.Rule == MigrationRules.RoleDepartmentAdminRemapped);
    }

    [Theory]
    [InlineData("expired")]
    [InlineData("cancelled")]
    [InlineData("opened")]
    public void A_status_the_target_lacks_is_reconstructed_from_timestamps(string legacyStatus)
    {
        var report = new DataQualityReport();
        var doc = NominalInvitation();
        doc["status"] = legacyStatus;

        var mapped = UserInvitationMapper.Map(Load<LegacyUserInvitation>(doc), Context(report));

        // sent_at is present and accepted_at is not, so 'sent' is the evidence.
        Assert.Equal(InvitationValidation.StatusSent, mapped!.Invitation.Status);
        Assert.Contains(report.Entries, e => e.Rule == MigrationRules.InvitationStatusReconstructed);

        using var metadata = JsonDocument.Parse(mapped.Invitation.Metadata!);
        Assert.Equal(legacyStatus, metadata.RootElement.GetProperty("legacy_status").GetString());
    }

    [Fact]
    public void An_accepted_invitation_keeps_its_status()
    {
        var report = new DataQualityReport();
        var doc = NominalInvitation();
        doc["status"] = "accepted";
        doc["accepted_at"] = new DateTime(2026, 7, 14, 10, 0, 0, DateTimeKind.Utc);

        var mapped = UserInvitationMapper.Map(Load<LegacyUserInvitation>(doc), Context(report));

        Assert.Equal(InvitationValidation.StatusAccepted, mapped!.Invitation.Status);
        Assert.DoesNotContain(report.Entries, e => e.Rule == MigrationRules.InvitationStatusReconstructed);
    }

    [Fact]
    public void An_unknown_invitation_type_is_a_reported_skip_because_it_picks_the_acceptance_branch()
    {
        var report = new DataQualityReport();
        var doc = NominalInvitation();
        doc["invitation_type"] = "magic_link";

        Assert.Null(UserInvitationMapper.Map(Load<LegacyUserInvitation>(doc), Context(report)));
        Assert.Contains(report.Entries,
            e => e.Rule == MigrationRules.InvitationTypeUnknown && e.Kind == ReportEntryKind.Skip);
    }

    [Fact]
    public void An_invitation_whose_inviter_never_migrated_is_a_reported_skip()
    {
        var report = new DataQualityReport();
        var doc = NominalInvitation();
        doc["invited_by"] = ObjectId.GenerateNewId().ToString();

        Assert.Null(UserInvitationMapper.Map(Load<LegacyUserInvitation>(doc), Context(report)));
        Assert.Contains(report.Entries, e => e.Kind == ReportEntryKind.Skip && e.Field == "invited_by");
    }

    [Fact]
    public void Two_demographic_keys_resolving_to_one_field_cannot_collide_on_the_primary_key()
    {
        var report = new DataQualityReport();
        var context = new MappingContext
        {
            Report = report,
            Companies = new HashSet<Guid> { CompanyId },
            Users = new HashSet<Guid> { UserId },
            Departments = new HashSet<Guid> { DeptId },
            DemographicFields = new Dictionary<(Guid, string), Guid>
            {
                [(CompanyId, "tenure")] = TenureFieldId,
                [(CompanyId, "seniority")] = TenureFieldId,
            },
        };
        var doc = NominalInvitation();
        doc["demographics"] = new BsonDocument { ["tenure"] = "1-3", ["seniority"] = "3+" };

        var mapped = UserInvitationMapper.Map(Load<LegacyUserInvitation>(doc), context);

        // (invitation, field) is the PK, so the FIRST key wins and only the second is
        // reported -- one entry, not two.
        var row = Assert.Single(mapped!.Demographics);
        Assert.Equal("1-3", row.Value);
        var collision = Assert.Single(report.Entries, e => e.Rule == MigrationRules.DemographicKeyUnresolved);
        Assert.Equal("demographics.seniority", collision.Field);
    }

    // ------------------------------------------------------------------
    // AuditLog
    // ------------------------------------------------------------------

    private static BsonDocument NominalAudit() => new()
    {
        ["_id"] = AuditOid,
        ["user_id"] = UserOid,
        ["company_id"] = CompanyOid,
        ["action"] = "login_success",
        ["resource"] = "auth",
        ["resource_id"] = "session-1",
        ["details"] = new BsonDocument { ["method"] = "password" },
        ["ip_address"] = "203.0.113.7",
        ["success"] = true,
        ["timestamp"] = new DateTime(2026, 7, 10, 7, 0, 0, DateTimeKind.Utc),
    };

    [Fact]
    public void Audit_entry_maps_one_to_one_and_keeps_its_vocabulary_verbatim()
    {
        var report = new DataQualityReport();

        var entry = AuditLogMapper.Map(Load<LegacyAuditLog>(NominalAudit()), Context(report));

        Assert.NotNull(entry);
        Assert.Equal(CompanyId, entry!.CompanyId);
        Assert.Equal(UserId, entry.UserId);
        // No narrowing: the target's columns are free-form, so compliance history
        // carries across unchanged.
        Assert.Equal("login_success", entry.Action);
        Assert.Equal("auth", entry.Resource);
        Assert.Contains("password", entry.Details);
        Assert.True(entry.Success);
        Assert.DoesNotContain(report.Entries, e => e.Kind == ReportEntryKind.Skip);
    }

    [Fact]
    public void A_deleted_actor_does_not_erase_the_evidence_that_they_acted()
    {
        var report = new DataQualityReport();
        var doc = NominalAudit();
        doc["user_id"] = ObjectId.GenerateNewId();

        var entry = AuditLogMapper.Map(Load<LegacyAuditLog>(doc), Context(report));

        // SetNull by design: the row survives with a null actor.
        Assert.NotNull(entry);
        Assert.Null(entry!.UserId);
        Assert.Equal("login_success", entry.Action);
        Assert.Contains(report.Entries, e => e.Kind == ReportEntryKind.Degraded && e.Field == "user_id");
        Assert.DoesNotContain(report.Entries, e => e.Kind == ReportEntryKind.Skip);
    }

    [Fact]
    public void An_entry_that_cannot_be_tenant_scoped_is_a_reported_skip()
    {
        var report = new DataQualityReport();
        var doc = NominalAudit();
        doc["company_id"] = ObjectId.GenerateNewId();

        Assert.Null(AuditLogMapper.Map(Load<LegacyAuditLog>(doc), Context(report)));
        Assert.Contains(report.Entries, e => e.Kind == ReportEntryKind.Skip && e.Field == "company_id");
    }

    [Fact]
    public void An_absent_success_flag_reads_as_true_rather_than_inventing_an_incident()
    {
        var report = new DataQualityReport();
        var doc = NominalAudit();
        doc.Remove("success");

        var entry = AuditLogMapper.Map(Load<LegacyAuditLog>(doc), Context(report));

        Assert.True(entry!.Success);
    }

    [Fact]
    public void An_entry_missing_action_or_resource_is_a_reported_skip()
    {
        foreach (var missing in new[] { "action", "resource" })
        {
            var report = new DataQualityReport();
            var doc = NominalAudit();
            doc.Remove(missing);

            Assert.Null(AuditLogMapper.Map(Load<LegacyAuditLog>(doc), Context(report)));
            var entry = Assert.Single(report.Entries, e => e.Kind == ReportEntryKind.Skip);
            Assert.Equal(missing, entry.Field);
        }
    }
}
