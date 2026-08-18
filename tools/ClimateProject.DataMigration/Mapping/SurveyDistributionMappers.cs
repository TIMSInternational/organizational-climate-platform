using System.Text.Json;
using ClimateProject.Application.Surveys;
using ClimateProject.DataMigration.Legacy;
using ClimateProject.DataMigration.Reporting;
using ClimateProject.Domain.Entities;
using MongoDB.Bson;

namespace ClimateProject.DataMigration.Mapping;

/// <summary>
/// The wizard's in-progress state. The four legacy step subdocuments land whole in the
/// single draft_data jsonb column rather than being re-mapped field by field: a draft
/// is unfinished input, not content the product reads through the question rules, and
/// step2_data's questions are ALREADY bilingual - the one place legacy stored both
/// languages - so running #195 attribution over them would collapse a real translation
/// into a guessed one.
///
/// Expired drafts migrate. They are inside the target's own retention policy (the draft
/// purge job deletes them on its next tick), and dropping rows on a policy this mapper
/// invented would be exactly the silent fix the design doc forbids - so the count is
/// reported instead and the product's own job does the deleting.
/// </summary>
public static class SurveyDraftMapper
{
    public const string Collection = "surveydrafts";

    public static SurveyDraft? Map(LegacySurveyDraft doc, MappingContext context)
    {
        var report = context.Report;
        var legacyId = doc.Id.ToString();
        MapperHelpers.ReportExtras(report, Collection, doc.Id, ("", doc.Extra));

        var userHex = LegacyReferences.HexOf(doc.UserId);
        var userRef = ReferenceResolver.Classify(UserMapper.Collection, userHex, context.Users);
        if (userRef.Kind != ReferenceKind.Resolved)
        {
            report.Skip(
                userRef.Kind == ReferenceKind.Malformed
                    ? MigrationRules.MalformedReference
                    : MigrationRules.DanglingReference,
                Collection, legacyId,
                $"user_id '{userHex}' is {userRef.Kind}; a draft belongs to the author still writing it",
                "user_id");
            return null;
        }

        var companyHex = LegacyReferences.HexOf(doc.CompanyId);
        var companyRef = ReferenceResolver.Classify(CompanyMapper.Collection, companyHex, context.Companies);
        if (companyRef.Kind != ReferenceKind.Resolved)
        {
            report.Skip(
                companyRef.Kind == ReferenceKind.Malformed
                    ? MigrationRules.MalformedReference
                    : MigrationRules.DanglingReference,
                Collection, legacyId,
                $"company_id '{companyHex}' is {companyRef.Kind}; the column is a non-nullable FK",
                "company_id");
            return null;
        }

        var sessionId = MapperHelpers.Truncated(doc.SessionId, 200, Collection, legacyId, "session_id", report);
        if (sessionId is null)
        {
            sessionId = $"legacy:{legacyId}";
            report.Normalisation(MigrationRules.ResponseSessionIdFabricated, Collection, legacyId, "session_id",
                "draft carries no session_id; the target column is NOT NULL, so a marked synthetic key is used");
        }

        // expires_at is NOT NULL. Legacy defaulted it to +7 days at write time, so an
        // absent one means a document that predates the field: the same 7 days from
        // whatever the draft's own clock says, never the migration run's clock.
        var createdAt = MapperHelpers.Timestamp(doc.CreatedAt, doc.Id, Collection, "created_at", report);
        DateTimeOffset expiresAt;
        if (doc.ExpiresAt is { } expiry)
        {
            expiresAt = new DateTimeOffset(DateTime.SpecifyKind(expiry, DateTimeKind.Utc));
        }
        else
        {
            expiresAt = createdAt.AddDays(7);
            report.Normalisation(MigrationRules.DraftExpiryDerived, Collection, legacyId, "expires_at",
                "draft carries no expires_at; derived as created_at + 7 days, the legacy schema's own default");
        }

        return new SurveyDraft
        {
            Id = MigrationIds.For(Collection, doc.Id),
            UserId = userRef.TargetId!.Value,
            CompanyId = companyRef.TargetId!.Value,
            SessionId = sessionId,
            CurrentStep = doc.CurrentStep ?? 1,
            LastEditedField = MapperHelpers.Truncated(
                doc.LastEditedField, 200, Collection, legacyId, "last_edited_field", report),
            AutoSaveCount = doc.AutoSaveCount ?? 0,
            Version = doc.Version ?? 1,
            LastAutosaveAt = doc.LastAutosaveAt is { } autosave
                ? new DateTimeOffset(DateTime.SpecifyKind(autosave, DateTimeKind.Utc))
                : null,
            ExpiresAt = expiresAt,
            IsRecovered = doc.IsRecovered ?? false,
            DraftData = BuildDraftData(doc),
            CreatedAt = createdAt,
            UpdatedAt = MapperHelpers.Timestamp(doc.UpdatedAt, doc.Id, Collection, "updated_at", report),
        };
    }

    private static string? BuildDraftData(LegacySurveyDraft doc)
    {
        // The step keys are preserved verbatim so a draft resumed after the migration
        // is recognisably the same wizard state, step for step.
        var steps = new BsonDocument();
        if (doc.Step1Data is { } step1 and not BsonNull) steps["step1_data"] = step1;
        if (doc.Step2Data is { } step2 and not BsonNull) steps["step2_data"] = step2;
        if (doc.Step3Data is { } step3 and not BsonNull) steps["step3_data"] = step3;
        if (doc.Step4Data is { } step4 and not BsonNull) steps["step4_data"] = step4;
        return steps.ElementCount == 0 ? null : LegacyJson.Serialize(steps);
    }
}

/// <summary>
/// One distribution per survey, both sides (legacy's unique index, the target's too).
///
/// Two decisions worth stating, and they land differently because the columns differ:
///
/// - <b>public_url is nulled.</b> The target stores a site-relative <c>/s/{token}</c>
///   whose token must be 43 base64url characters (SurveyAccessTokens); a legacy share
///   link carries a legacy token, which HasExpectedShape rejects before the lookup. The
///   column is nullable, and a dead share link rendered as a live one is a broken
///   affordance - the same class of defect as a dashboard linking somewhere that 403s.
///   So it is dropped by name, and regenerating the link is a one-click admin action.
/// - <b>The QR image fields are kept only when they fit a URL column.</b> Legacy
///   declared them as bare Strings and they may hold raw SVG markup or a data: URI;
///   the target's columns are varchar(500) URLs. Truncating markup to 500 characters
///   produces a link that looks real and resolves nowhere, so anything that does not
///   fit is dropped by name instead. qr_code_url is NOT NULL in the target, so a
///   distribution whose QR reference cannot be represented is a reported skip.
/// </summary>
public static class SurveyDistributionMapper
{
    public const string Collection = "surveydistributions";

    private static readonly string[] AccessTypes = ["tokenized", "open", "hybrid"];

    public static SurveyDistribution? Map(LegacySurveyDistribution doc, MappingContext context)
    {
        var report = context.Report;
        var legacyId = doc.Id.ToString();
        MapperHelpers.ReportExtras(report, Collection, doc.Id,
            ("", doc.Extra), ("access_rules", doc.AccessRules?.Extra), ("qr_customization", doc.QrCustomization?.Extra));

        var surveyHex = LegacyReferences.HexOf(doc.SurveyId);
        var surveyRef = ReferenceResolver.Classify(SurveyMapper.Collection, surveyHex, context.Surveys);
        if (surveyRef.Kind != ReferenceKind.Resolved)
        {
            report.Skip(
                surveyRef.Kind == ReferenceKind.Malformed
                    ? MigrationRules.MalformedReference
                    : MigrationRules.DanglingReference,
                Collection, legacyId,
                $"survey_id '{surveyHex}' is {surveyRef.Kind}; a distribution cannot outlive its survey",
                "survey_id");
            return null;
        }

        var qrCodeUrl = UrlOrDropped(doc.QrCodeUrl, "qr_code_url", legacyId, report);
        if (qrCodeUrl is null)
        {
            report.Skip(MigrationRules.MissingRequiredField, Collection, legacyId,
                "qr_code_url is absent or is not something a varchar(500) URL column can hold "
                + "(raw markup or a data: URI); the column is NOT NULL",
                "qr_code_url");
            return null;
        }

        if (MapperHelpers.Trimmed(doc.PublicUrl) is not null)
        {
            report.Normalisation(MigrationRules.DistributionPublicLinkDropped, Collection, legacyId, "public_url",
                "the legacy share link carries a legacy token, which SurveyAccessTokens.HasExpectedShape "
                + "refuses; keeping it would render a dead link as a live one, so the link must be regenerated");
        }

        var accessType = MapperHelpers.Trimmed(doc.AccessType) ?? "tokenized";
        if (!AccessTypes.Contains(accessType, StringComparer.Ordinal))
        {
            report.Normalisation(MigrationRules.DistributionAccessTypeUnknown, Collection, legacyId, "access_type",
                $"access_type '{doc.AccessType}' is not in the vocabulary; recorded as 'tokenized', the safest default");
            accessType = "tokenized";
        }

        var distribution = new SurveyDistribution
        {
            Id = MigrationIds.For(Collection, doc.Id),
            SurveyId = surveyRef.TargetId!.Value,
            AccessType = accessType,
            PublicUrl = null,
            QrCodeUrl = qrCodeUrl,
            QrCodeSvgUrl = UrlOrDropped(doc.QrCodeSvg, "qr_code_svg", legacyId, report),
            QrCodePngUrl = UrlOrDropped(doc.QrCodePng, "qr_code_png", legacyId, report),
            QrCodePdfUrl = UrlOrDropped(doc.QrCodePdfUrl, "qr_code_pdf_url", legacyId, report),
            TokenizedLinksGenerated = doc.TokenizedLinksGenerated ?? 0,

            // regenerated_count, last_regenerated_*, total_accesses, unique_visitors and
            // last_accessed_at are target-side telemetry the legacy system never kept.
            // They stay at their DDL defaults rather than being invented.
            CreatedAt = MapperHelpers.Timestamp(doc.CreatedAt, doc.Id, Collection, "created_at", report),
            UpdatedAt = MapperHelpers.Timestamp(doc.UpdatedAt, doc.Id, Collection, "updated_at", report),
        };

        if (doc.AccessRules is { } rules)
        {
            if (rules.RequireLogin is { } requireLogin) distribution.AccessRules.RequireLogin = requireLogin;
            if (rules.AllowAnonymous is { } anonymous) distribution.AccessRules.AllowAnonymous = anonymous;
            if (rules.SingleResponse is { } single) distribution.AccessRules.SingleResponse = single;
            if (rules.ActiveOutsideSchedule is { } outside) distribution.AccessRules.ActiveOutsideSchedule = outside;
            distribution.AccessRules.AllowedDomains = Cleaned(rules.AllowedDomains);
            distribution.AccessRules.BlockedIps = Cleaned(rules.BlockedIps);
            distribution.AccessRules.MaxResponses = rules.MaxResponses;
        }

        if (doc.QrCustomization is { } qr)
        {
            // 'color' is the target's foreground_color: a rename, not a drop.
            if (MapperHelpers.Truncated(qr.Color, 20, Collection, legacyId, "qr_customization.color", report) is { } colour)
            {
                distribution.QrCustomization.ForegroundColor = colour;
            }

            if (MapperHelpers.Truncated(qr.BackgroundColor, 20, Collection, legacyId,
                    "qr_customization.background_color", report) is { } background)
            {
                distribution.QrCustomization.BackgroundColor = background;
            }

            distribution.QrCustomization.LogoUrl = UrlOrDropped(
                qr.LogoUrl, "qr_customization.logo_url", legacyId, report);
            if (qr.Size is { } size) distribution.QrCustomization.Size = size;

            if (MapperHelpers.Trimmed(qr.ErrorCorrection) is { } correction)
            {
                report.Normalisation(MigrationRules.DistributionErrorCorrectionDropped, Collection, legacyId,
                    "qr_customization.error_correction",
                    $"'{correction}' has no target column; the new system regenerates QR images and chooses its own");
            }
        }

        return distribution;
    }

    /// <summary>
    /// A value the target's varchar(500) URL columns can actually hold. Anything longer
    /// is markup or a data: URI, and truncating it would produce a plausible-looking
    /// link that resolves nowhere - so it is dropped by name.
    /// </summary>
    private static string? UrlOrDropped(string? raw, string field, string legacyId, DataQualityReport report)
    {
        var value = MapperHelpers.Trimmed(raw);
        if (value is null)
        {
            return null;
        }

        if (value.Length > 500)
        {
            report.Normalisation(MigrationRules.DistributionQrPayloadDropped, Collection, legacyId, field,
                $"value is {value.Length} chars - inline markup or a data: URI, not a URL the "
                + "varchar(500) column can hold; dropped rather than truncated into a broken link");
            return null;
        }

        return value;
    }

    private static string[]? Cleaned(List<string>? values)
    {
        if (values is null)
        {
            return null;
        }

        var cleaned = values
            .Select(MapperHelpers.Trimmed)
            .Where(value => value is not null)
            .Select(value => value!)
            .ToArray();
        return cleaned.Length == 0 ? null : cleaned;
    }
}

/// <summary>
/// Per-invitee delivery records.
///
/// <b>The token.</b> invitation_token is a bearer credential and the legacy database
/// was readable during the #70 exposure window, so whether it carries forward is a
/// security question, not a mapping one. It carries forward, and it is inert: legacy
/// minted these as <c>uuidv4()</c> - 36 characters - while
/// SurveyAccessTokens.HasExpectedShape admits only 43 base64url characters and rejects
/// anything else before the database is queried. So a migrated token authenticates
/// nobody, and the column (NOT NULL, unique) keeps the historical record of what was
/// actually mailed. The operational consequence is real and reported once per still-
/// open invitation: outstanding legacy invitation links are DEAD and those people must
/// be re-invited from the new system.
///
/// <b>The status.</b> Legacy has seven states, the target six, and they disagree at
/// both ends: legacy's <c>expired</c> and <c>bounced</c> have no target member, and the
/// target's <c>revoked</c> has no legacy one. Rather than guess, both are reconstructed
/// from the timestamp evidence the row already carries - completed_at, started_at,
/// opened_at, sent_at - which is what the target's own progression means. Expiry is not
/// a status in the target at all: it is expires_at, which migrates faithfully, so an
/// expired invitation still reads as expired through the mechanism the product uses.
/// The original value is preserved in metadata.
/// </summary>
public static class SurveyInvitationMapper
{
    public const string Collection = "surveyinvitations";

    public static SurveyInvitation? Map(LegacySurveyInvitation doc, MappingContext context)
    {
        var report = context.Report;
        var legacyId = doc.Id.ToString();
        MapperHelpers.ReportExtras(report, Collection, doc.Id, ("", doc.Extra), ("metadata", doc.Metadata?.Extra));

        var surveyRef = ReferenceResolver.Classify(SurveyMapper.Collection, doc.SurveyId, context.Surveys);
        if (surveyRef.Kind != ReferenceKind.Resolved)
        {
            report.Skip(
                surveyRef.Kind == ReferenceKind.Malformed
                    ? MigrationRules.MalformedReference
                    : MigrationRules.DanglingReference,
                Collection, legacyId,
                $"survey_id '{doc.SurveyId}' is {surveyRef.Kind}; an invitation cannot outlive its survey",
                "survey_id");
            return null;
        }

        var userRef = ReferenceResolver.Classify(UserMapper.Collection, doc.UserId, context.Users);
        if (userRef.Kind != ReferenceKind.Resolved)
        {
            report.Skip(
                userRef.Kind == ReferenceKind.Malformed
                    ? MigrationRules.MalformedReference
                    : MigrationRules.DanglingReference,
                Collection, legacyId,
                $"user_id '{doc.UserId}' is {userRef.Kind}; the column is a non-nullable FK",
                "user_id");
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
                $"company_id '{doc.CompanyId}' is {companyRef.Kind}; the column is a non-nullable FK",
                "company_id");
            return null;
        }

        var email = MapperHelpers.Truncated(doc.Email, 255, Collection, legacyId, "email", report)?.ToLowerInvariant();
        if (email is null)
        {
            report.Skip(MigrationRules.MissingRequiredField, Collection, legacyId,
                "invitation has no email; it is the address the invitation was sent to", "email");
            return null;
        }

        var token = MapperHelpers.Truncated(doc.InvitationToken, 255, Collection, legacyId, "invitation_token", report);
        if (token is null)
        {
            report.Skip(MigrationRules.MissingRequiredField, Collection, legacyId,
                "invitation has no token; the column is NOT NULL and uniquely indexed", "invitation_token");
            return null;
        }

        var legacyStatus = MapperHelpers.Trimmed(doc.Status) ?? SurveyInvitationStatuses.Pending;
        var status = ReconstructStatus(doc, legacyStatus, legacyId, report);

        var expiresAt = doc.ExpiresAt is { } expiry
            ? new DateTimeOffset(DateTime.SpecifyKind(expiry, DateTimeKind.Utc))
            : null as DateTimeOffset?;
        var createdAt = MapperHelpers.Timestamp(doc.CreatedAt, doc.Id, Collection, "created_at", report);
        if (expiresAt is null)
        {
            expiresAt = createdAt.AddDays(30);
            report.Normalisation(MigrationRules.InvitationExpiryDerived, Collection, legacyId, "expires_at",
                "invitation carries no expires_at; the target column is NOT NULL, so it is derived from created_at");
        }

        // The consequence the operator has to act on, said once per invitation that
        // never completed. Deliberately NOT filtered by "is it expired now": a mapper
        // that reads the wall clock makes two dry runs produce different reports, and
        // the design requires them to reconcile identically.
        if (status is not SurveyInvitationStatuses.Completed)
        {
            report.Normalisation(MigrationRules.InvitationTokenInert, Collection, legacyId, "invitation_token",
                "the legacy token is preserved as a record but cannot authenticate in the new system "
                + "(uuidv4 shape, refused by SurveyAccessTokens.HasExpectedShape); this person must be re-invited");
        }

        return new SurveyInvitation
        {
            Id = MigrationIds.For(Collection, doc.Id),
            SurveyId = surveyRef.TargetId!.Value,
            UserId = userRef.TargetId!.Value,
            CompanyId = companyRef.TargetId!.Value,
            Email = email,
            InvitationToken = token,
            Status = status,
            SentAt = Utc(doc.SentAt),
            OpenedAt = Utc(doc.OpenedAt),
            StartedAt = Utc(doc.StartedAt),
            CompletedAt = Utc(doc.CompletedAt),
            ReminderCount = doc.ReminderCount ?? 0,
            LastReminderSent = Utc(doc.LastReminderSent),
            ExpiresAt = expiresAt.Value,
            Metadata = BuildMetadata(doc, legacyStatus),
            CreatedAt = createdAt,
            UpdatedAt = MapperHelpers.Timestamp(doc.UpdatedAt, doc.Id, Collection, "updated_at", report),
        };
    }

    /// <summary>
    /// The target's progression is pending -> sent -> opened -> started -> completed
    /// (plus revoked, which legacy has no equivalent for). A legacy status that IS a
    /// target member carries over; expired and bounced are reconstructed from the
    /// row's own timestamps, which is evidence rather than a guess.
    /// </summary>
    private static string ReconstructStatus(
        LegacySurveyInvitation doc, string legacyStatus, string legacyId, DataQualityReport report)
    {
        if (SurveyInvitationStatuses.All.Contains(legacyStatus, StringComparer.Ordinal))
        {
            return legacyStatus;
        }

        var reconstructed = doc.CompletedAt is not null ? SurveyInvitationStatuses.Completed
            : doc.StartedAt is not null ? SurveyInvitationStatuses.Started
            : doc.OpenedAt is not null ? SurveyInvitationStatuses.Opened
            : doc.SentAt is not null ? SurveyInvitationStatuses.Sent
            : SurveyInvitationStatuses.Pending;

        report.Normalisation(MigrationRules.InvitationStatusReconstructed, Collection, legacyId, "status",
            $"legacy status '{legacyStatus}' has no target member; reconstructed as '{reconstructed}' from the row's "
            + "own timestamps (expiry lives in expires_at, not in the status, on this side)");
        return reconstructed;
    }

    private static string BuildMetadata(LegacySurveyInvitation doc, string legacyStatus)
    {
        var payload = new Dictionary<string, object?> { ["legacy_status"] = legacyStatus };
        if (doc.Metadata?.UserAgent is { } userAgent) payload["user_agent"] = userAgent;
        if (doc.Metadata?.IpAddress is { } ipAddress) payload["ip_address"] = ipAddress;
        if (doc.Metadata?.EmailClient is { } emailClient) payload["email_client"] = emailClient;
        return JsonSerializer.Serialize(payload);
    }

    private static DateTimeOffset? Utc(DateTime? value)
        => value is { } present ? new DateTimeOffset(DateTime.SpecifyKind(present, DateTimeKind.Utc)) : null;
}
