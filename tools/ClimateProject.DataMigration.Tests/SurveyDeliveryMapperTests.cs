using System.Text.Json;
using ClimateProject.Application.Surveys;
using ClimateProject.DataMigration;
using ClimateProject.DataMigration.Legacy;
using ClimateProject.DataMigration.Mapping;
using ClimateProject.DataMigration.Reporting;
using MongoDB.Bson;
using MongoDB.Bson.Serialization;

namespace ClimateProject.DataMigration.Tests;

/// <summary>
/// The delivery trio: drafts, distributions and invitations. The sharp surfaces are the
/// inert legacy invitation token, the dropped public share link, QR payloads that are
/// markup rather than URLs, and invitation statuses reconstructed from timestamps.
/// </summary>
public class SurveyDeliveryMapperTests
{
    private static readonly ObjectId CompanyOid = ObjectId.Parse("650000000000000000000001");
    private static readonly ObjectId UserOid = ObjectId.Parse("650000000000000000000011");
    private static readonly ObjectId SurveyOid = ObjectId.Parse("650000000000000000000021");
    private static readonly ObjectId DraftOid = ObjectId.Parse("650000000000000000000031");
    private static readonly ObjectId DistOid = ObjectId.Parse("650000000000000000000041");
    private static readonly ObjectId InviteOid = ObjectId.Parse("650000000000000000000051");

    private static readonly Guid CompanyId = MigrationIds.For("companies", CompanyOid);
    private static readonly Guid UserId = MigrationIds.For("users", UserOid);
    private static readonly Guid SurveyId = MigrationIds.For("surveys", SurveyOid);

    private static T Load<T>(BsonDocument document) where T : LegacyDocument
        => BsonSerializer.Deserialize<T>(document);

    private static MappingContext Context(DataQualityReport report) => new()
    {
        Report = report,
        Companies = new HashSet<Guid> { CompanyId },
        CompanyLanguages = new Dictionary<Guid, string> { [CompanyId] = "en" },
        Users = new HashSet<Guid> { UserId },
        Surveys = new HashSet<Guid> { SurveyId },
        SurveyLanguages = new Dictionary<Guid, string> { [SurveyId] = "en" },
    };

    // ------------------------------------------------------------------
    // SurveyDraft
    // ------------------------------------------------------------------

    private static BsonDocument NominalDraft() => new()
    {
        ["_id"] = DraftOid,
        ["user_id"] = UserOid,
        ["company_id"] = CompanyOid,
        ["session_id"] = "sess-draft-1",
        ["step1_data"] = new BsonDocument { ["survey_type"] = "climate", ["title"] = "Draft title" },
        ["step2_data"] = new BsonDocument
        {
            ["questions"] = new BsonArray
            {
                // Already bilingual in legacy - the one place it was.
                new BsonDocument
                {
                    ["id"] = "dq-1",
                    ["text"] = new BsonDocument { ["en"] = "How are you?", ["es"] = "¿Cómo estás?" },
                },
            },
        },
        ["current_step"] = 2,
        ["auto_save_count"] = 5,
        ["expires_at"] = new DateTime(2026, 7, 20, 0, 0, 0, DateTimeKind.Utc),
        ["created_at"] = new DateTime(2026, 7, 13, 0, 0, 0, DateTimeKind.Utc),
        ["updated_at"] = new DateTime(2026, 7, 14, 0, 0, 0, DateTimeKind.Utc),
    };

    [Fact]
    public void Draft_keeps_its_wizard_state_whole_and_its_bilingual_content_untouched()
    {
        var report = new DataQualityReport();

        var draft = SurveyDraftMapper.Map(Load<LegacySurveyDraft>(NominalDraft()), Context(report));

        Assert.NotNull(draft);
        Assert.Equal(UserId, draft!.UserId);
        Assert.Equal(CompanyId, draft.CompanyId);
        Assert.Equal(2, draft.CurrentStep);
        Assert.Equal(5, draft.AutoSaveCount);

        // Step keys preserved, and BOTH languages survive - no #195 attribution ran.
        using var data = JsonDocument.Parse(draft.DraftData!);
        var text = data.RootElement.GetProperty("step2_data").GetProperty("questions")[0].GetProperty("text");
        Assert.Equal("How are you?", text.GetProperty("en").GetString());
        Assert.Equal("¿Cómo estás?", text.GetProperty("es").GetString());
        Assert.True(data.RootElement.TryGetProperty("step1_data", out _));

        // No attribution entries at all: a draft is unfinished input, not content.
        Assert.DoesNotContain(report.Entries, e => e.Kind == ReportEntryKind.Attribution);
    }

    [Fact]
    public void Draft_without_expiry_derives_it_from_its_own_clock_not_the_runs()
    {
        var report = new DataQualityReport();
        var doc = NominalDraft();
        doc.Remove("expires_at");

        var draft = SurveyDraftMapper.Map(Load<LegacySurveyDraft>(doc), Context(report));

        // created_at + 7 days, the legacy schema's own default -- deterministic, so two
        // dry runs produce the same row.
        Assert.Equal(new DateTimeOffset(2026, 7, 20, 0, 0, 0, TimeSpan.Zero), draft!.ExpiresAt);
        Assert.Contains(report.Entries, e => e.Rule == MigrationRules.DraftExpiryDerived);
    }

    [Fact]
    public void Draft_whose_author_never_migrated_is_a_reported_skip()
    {
        var report = new DataQualityReport();
        var doc = NominalDraft();
        doc["user_id"] = ObjectId.GenerateNewId();

        Assert.Null(SurveyDraftMapper.Map(Load<LegacySurveyDraft>(doc), Context(report)));
        Assert.Contains(report.Entries, e => e.Kind == ReportEntryKind.Skip && e.Field == "user_id");
    }

    // ------------------------------------------------------------------
    // SurveyDistribution
    // ------------------------------------------------------------------

    private static BsonDocument NominalDistribution() => new()
    {
        ["_id"] = DistOid,
        ["survey_id"] = SurveyOid,
        ["access_type"] = "tokenized",
        ["qr_code_url"] = "https://cdn.example.com/qr/abc.png",
        ["tokenized_links_generated"] = 42,
        ["access_rules"] = new BsonDocument
        {
            ["require_login"] = false,
            ["allow_anonymous"] = true,
            ["allowed_domains"] = new BsonArray { "acme.com", "  " },
            ["max_responses"] = 500,
        },
        ["qr_customization"] = new BsonDocument
        {
            ["size"] = 400,
            ["color"] = "#112233",
            ["background_color"] = "#FFFFFF",
            ["error_correction"] = "H",
        },
        ["created_at"] = new DateTime(2026, 7, 1, 0, 0, 0, DateTimeKind.Utc),
    };

    [Fact]
    public void Distribution_maps_rules_and_renames_qr_colour_to_foreground()
    {
        var report = new DataQualityReport();

        var dist = SurveyDistributionMapper.Map(
            Load<LegacySurveyDistribution>(NominalDistribution()), Context(report));

        Assert.NotNull(dist);
        Assert.Equal(SurveyId, dist!.SurveyId);
        Assert.Equal(42, dist.TokenizedLinksGenerated);
        Assert.False(dist.AccessRules.RequireLogin);
        Assert.True(dist.AccessRules.AllowAnonymous);
        Assert.True(dist.AccessRules.SingleResponse); // absent in source, DDL default kept
        Assert.Equal(["acme.com"], dist.AccessRules.AllowedDomains!);
        Assert.Equal(500, dist.AccessRules.MaxResponses);

        // 'color' -> ForegroundColor is a rename, not a drop.
        Assert.Equal("#112233", dist.QrCustomization.ForegroundColor);
        Assert.Equal(400, dist.QrCustomization.Size);

        // error_correction has no target column.
        Assert.Contains(report.Entries, e => e.Rule == MigrationRules.DistributionErrorCorrectionDropped);

        // Target-side telemetry legacy never kept stays at its defaults, uninvented.
        Assert.Equal(0, dist.TotalAccesses);
        Assert.Equal(0, dist.RegeneratedCount);
    }

    [Fact]
    public void The_legacy_public_share_link_is_dropped_because_its_token_is_refused_by_shape()
    {
        var report = new DataQualityReport();
        var doc = NominalDistribution();
        doc["public_url"] = "https://legacy.example.com/survey/9f8e7d6c-1234-4abc-9def-0123456789ab";

        var dist = SurveyDistributionMapper.Map(Load<LegacySurveyDistribution>(doc), Context(report));

        Assert.Null(dist!.PublicUrl);
        var entry = Assert.Single(report.Entries, e => e.Rule == MigrationRules.DistributionPublicLinkDropped);
        Assert.Contains("regenerated", entry.Reason);
    }

    [Fact]
    public void Inline_qr_markup_is_dropped_rather_than_truncated_into_a_broken_link()
    {
        var report = new DataQualityReport();
        var doc = NominalDistribution();
        doc["qr_code_svg"] = "<svg xmlns='http://www.w3.org/2000/svg'>" + new string('x', 600) + "</svg>";

        var dist = SurveyDistributionMapper.Map(Load<LegacySurveyDistribution>(doc), Context(report));

        Assert.Null(dist!.QrCodeSvgUrl);
        Assert.Contains(report.Entries, e => e.Rule == MigrationRules.DistributionQrPayloadDropped);
        // And nothing was silently truncated to fit.
        Assert.DoesNotContain(report.Entries,
            e => e.Rule == MigrationRules.ContentOverlongTruncated && e.Field == "qr_code_svg");
    }

    [Fact]
    public void A_distribution_whose_qr_reference_cannot_be_represented_is_a_reported_skip()
    {
        var report = new DataQualityReport();
        var doc = NominalDistribution();
        doc["qr_code_url"] = "data:image/png;base64," + new string('A', 800);

        Assert.Null(SurveyDistributionMapper.Map(Load<LegacySurveyDistribution>(doc), Context(report)));
        Assert.Contains(report.Entries,
            e => e.Kind == ReportEntryKind.Skip && e.Field == "qr_code_url");
    }

    [Fact]
    public void An_unknown_access_type_falls_back_to_the_safest_one_by_name()
    {
        var report = new DataQualityReport();
        var doc = NominalDistribution();
        doc["access_type"] = "wide_open";

        var dist = SurveyDistributionMapper.Map(Load<LegacySurveyDistribution>(doc), Context(report));

        Assert.Equal("tokenized", dist!.AccessType);
        Assert.Contains(report.Entries, e => e.Rule == MigrationRules.DistributionAccessTypeUnknown);
    }

    // ------------------------------------------------------------------
    // SurveyInvitation
    // ------------------------------------------------------------------

    private static BsonDocument NominalInvitation() => new()
    {
        ["_id"] = InviteOid,
        ["survey_id"] = SurveyOid.ToString(),
        ["user_id"] = UserOid.ToString(),
        ["company_id"] = CompanyOid.ToString(),
        ["email"] = "Ada@Acme.com",
        // A uuidv4, exactly what invitation-service.ts:110 mints.
        ["invitation_token"] = "9f8e7d6c-1234-4abc-9def-0123456789ab",
        ["status"] = "sent",
        ["sent_at"] = new DateTime(2026, 7, 1, 9, 0, 0, DateTimeKind.Utc),
        ["expires_at"] = new DateTime(2026, 7, 31, 0, 0, 0, DateTimeKind.Utc),
        ["created_at"] = new DateTime(2026, 7, 1, 8, 0, 0, DateTimeKind.Utc),
    };

    [Fact]
    public void Invitation_preserves_its_token_as_a_record_and_says_it_is_inert()
    {
        var report = new DataQualityReport();

        var invitation = SurveyInvitationMapper.Map(
            Load<LegacySurveyInvitation>(NominalInvitation()), Context(report));

        Assert.NotNull(invitation);
        Assert.Equal("ada@acme.com", invitation!.Email);
        Assert.Equal("9f8e7d6c-1234-4abc-9def-0123456789ab", invitation.InvitationToken);
        Assert.Equal(SurveyInvitationStatuses.Sent, invitation.Status);

        // The token is 36 chars; the target admits only 43-char base64url, so it can
        // never authenticate - and the report says the person must be re-invited.
        Assert.False(SurveyAccessTokens.HasExpectedShape(invitation.InvitationToken));
        var entry = Assert.Single(report.Entries, e => e.Rule == MigrationRules.InvitationTokenInert);
        Assert.Contains("re-invited", entry.Reason);
    }

    [Fact]
    public void A_completed_invitation_needs_no_reinvite_notice()
    {
        var report = new DataQualityReport();
        var doc = NominalInvitation();
        doc["status"] = "completed";
        doc["completed_at"] = new DateTime(2026, 7, 2, 10, 0, 0, DateTimeKind.Utc);

        var invitation = SurveyInvitationMapper.Map(Load<LegacySurveyInvitation>(doc), Context(report));

        Assert.Equal(SurveyInvitationStatuses.Completed, invitation!.Status);
        Assert.DoesNotContain(report.Entries, e => e.Rule == MigrationRules.InvitationTokenInert);
    }

    [Theory]
    [InlineData("expired")]
    [InlineData("bounced")]
    public void A_status_the_target_lacks_is_reconstructed_from_the_rows_own_timestamps(string legacyStatus)
    {
        var report = new DataQualityReport();
        var doc = NominalInvitation();
        doc["status"] = legacyStatus;
        doc["opened_at"] = new DateTime(2026, 7, 1, 12, 0, 0, DateTimeKind.Utc);

        var invitation = SurveyInvitationMapper.Map(Load<LegacySurveyInvitation>(doc), Context(report));

        // opened_at is the furthest evidence, so 'opened' - not a guess.
        Assert.Equal(SurveyInvitationStatuses.Opened, invitation!.Status);
        Assert.Contains(report.Entries, e => e.Rule == MigrationRules.InvitationStatusReconstructed);

        // Expiry is expires_at on this side, and it migrated faithfully.
        Assert.Equal(new DateTimeOffset(2026, 7, 31, 0, 0, 0, TimeSpan.Zero), invitation.ExpiresAt);

        // The original value is not lost.
        using var metadata = JsonDocument.Parse(invitation.Metadata!);
        Assert.Equal(legacyStatus, metadata.RootElement.GetProperty("legacy_status").GetString());
    }

    [Fact]
    public void A_never_sent_invitation_with_an_unknown_status_reconstructs_as_pending()
    {
        var report = new DataQualityReport();
        var doc = NominalInvitation();
        doc["status"] = "bounced";
        doc.Remove("sent_at");

        var invitation = SurveyInvitationMapper.Map(Load<LegacySurveyInvitation>(doc), Context(report));

        Assert.Equal(SurveyInvitationStatuses.Pending, invitation!.Status);
    }

    [Fact]
    public void Invitation_without_a_token_or_email_is_a_reported_skip()
    {
        foreach (var missing in new[] { "invitation_token", "email" })
        {
            var report = new DataQualityReport();
            var doc = NominalInvitation();
            doc.Remove(missing);

            Assert.Null(SurveyInvitationMapper.Map(Load<LegacySurveyInvitation>(doc), Context(report)));
            var entry = Assert.Single(report.Entries, e => e.Kind == ReportEntryKind.Skip);
            Assert.Equal(missing, entry.Field);
        }
    }

    [Fact]
    public void Invitation_without_expiry_derives_one_deterministically()
    {
        var report = new DataQualityReport();
        var doc = NominalInvitation();
        doc.Remove("expires_at");

        var invitation = SurveyInvitationMapper.Map(Load<LegacySurveyInvitation>(doc), Context(report));

        Assert.Equal(new DateTimeOffset(2026, 7, 31, 8, 0, 0, TimeSpan.Zero), invitation!.ExpiresAt);
        Assert.Contains(report.Entries, e => e.Rule == MigrationRules.InvitationExpiryDerived);
    }
}
