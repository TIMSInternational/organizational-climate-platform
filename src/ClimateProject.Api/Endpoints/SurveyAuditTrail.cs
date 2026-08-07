using ClimateProject.Application.Auth;
using ClimateProject.Application.Surveys;
using ClimateProject.Domain.Entities;
using ClimateProject.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace ClimateProject.Api.Endpoints;

/// <summary>
/// Who did a thing, resolved once per request.
///
/// The identity fields are denormalised onto every audit row on purpose: an audit entry
/// has to still read correctly after the actor is renamed, changes role or leaves the
/// company. <c>survey_audit_logs.user_id</c> carries a RESTRICT foreign key precisely so
/// the actor cannot be deleted out from under the history, but a RESTRICT does not stop an
/// UPDATE, so the name/email/role at the time are copied rather than joined.
/// </summary>
/// <param name="IpAddress">
/// The socket peer. Not <c>X-Forwarded-For</c>: nothing in this API configures
/// ForwardedHeaders, so trusting the header would let any caller write whatever address
/// they liked into the audit log, which is worse than recording the proxy's.
/// </param>
internal sealed record SurveyActor(
    Guid UserId,
    string Name,
    string Email,
    string Role,
    string? IpAddress,
    string? UserAgent);

/// <summary>
/// Writing the survey domain's version snapshots and audit entries.
///
/// <b>Where the boundary is, for #143.</b> Everything here writes
/// <c>survey_versions</c> and <c>survey_audit_logs</c>, both of which are keyed by a NOT
/// NULL <c>survey_id</c>, and it is called only from <c>SurveyEndpoints</c>. It is not a
/// mutation interceptor, there is no <c>SaveChangesAsync</c> override and no
/// <c>IAuditable</c> marker: #143 has to touch every mutating endpoint in the product and
/// belongs on the tenant-scoped <c>audit_logs</c> table, and half-building that mechanism
/// here would leave #143 undoing it. See <see cref="SurveyAuditActions"/> for the shapes
/// worth reconciling if #143 wants a single writer.
/// </summary>
internal static class SurveyAuditTrail
{
    // Mirrors the column widths in SurveyAuditLogConfiguration. Postgres rejects an
    // over-length varchar rather than truncating, and a 500 out of an audit write would
    // fail the operation the audit was only observing.
    private const int MaxName = 200;
    private const int MaxEmail = 255;
    private const int MaxRole = 32;
    private const int MaxIpAddress = 64;
    private const int MaxUserAgent = 500;
    private const int MaxEntityId = 100;
    private const int MaxReason = 500;

    /// <summary>
    /// Resolves the acting user, or null when the token maps to no user row.
    ///
    /// Both <c>survey_audit_logs.user_id</c> and <c>survey_versions.created_by</c> are
    /// NOT NULL with RESTRICT foreign keys, so an unattributable mutation cannot be
    /// recorded -- which means it must not be allowed to happen. Callers turn a null here
    /// into the same 400 <c>POST /surveys</c> already returns.
    /// </summary>
    public static async Task<SurveyActor?> ResolveActorAsync(
        CurrentUser currentUser,
        HttpContext http,
        ClimateProjectDbContext db,
        CancellationToken cancellationToken)
    {
        var userId = await SurveyEndpoints.ResolveActingUserIdAsync(currentUser, db, cancellationToken);
        if (userId is null)
        {
            return null;
        }

        // The claims are the source of truth for what the actor called themselves at the
        // time. They fall back to the user row only when a claim is absent, because the row
        // is current-state and the point of the copy is that it is not.
        var stored = await db.Users
            .Where(u => u.Id == userId.Value)
            .Select(u => new { u.Name, u.Email, u.Role })
            .FirstOrDefaultAsync(cancellationToken);

        var name = FirstNonEmpty(currentUser.Name, stored?.Name, currentUser.Email, stored?.Email, userId.Value.ToString());
        var email = FirstNonEmpty(currentUser.Email, stored?.Email, userId.Value.ToString());
        var role = FirstNonEmpty(currentUser.Role, stored?.Role, Roles.Employee);

        return new SurveyActor(
            userId.Value,
            TruncateRequired(name, MaxName),
            TruncateRequired(email, MaxEmail),
            TruncateRequired(role, MaxRole),
            Truncate(http.Connection.RemoteIpAddress?.ToString(), MaxIpAddress),
            Truncate(http.Request.Headers.UserAgent.ToString(), MaxUserAgent));
    }

    /// <summary>
    /// Queues one audit entry. Does not save -- it joins the caller's unit of work, so an
    /// operation that ultimately fails leaves no entry claiming it happened.
    /// </summary>
    public static void Record(
        ClimateProjectDbContext db,
        Guid surveyId,
        string action,
        string entityType,
        SurveyActor actor,
        DateTimeOffset timestamp,
        SurveyAuditChangeSet? changes = null,
        string? entityId = null)
    {
        db.SurveyAuditLogs.Add(new SurveyAuditLog
        {
            Id = Guid.NewGuid(),
            SurveyId = surveyId,
            Action = action,
            EntityType = entityType,
            EntityId = Truncate(entityId, MaxEntityId),
            Changes = changes?.ToJson(),
            UserId = actor.UserId,
            UserName = actor.Name,
            UserEmail = actor.Email,
            UserRole = actor.Role,
            Timestamp = timestamp,
            IpAddress = actor.IpAddress,
            UserAgent = actor.UserAgent,
        });
    }

    /// <summary>Loads a survey's whole current content, in the shape a snapshot and a diff work in.</summary>
    public static async Task<SurveyVersionContent> LoadContentAsync(
        ClimateProjectDbContext db,
        Survey survey,
        CancellationToken cancellationToken)
    {
        var questions = await db.Questions
            .Where(q => q.SurveyId == survey.Id)
            .ToListAsync(cancellationToken);

        var options = await SurveyContent.LoadOptionsAsync(db, questions.Select(q => q.Id).ToList(), cancellationToken);

        var departmentIds = await db.SurveyDepartmentTargets
            .Where(t => t.SurveyId == survey.Id)
            .Select(t => t.DepartmentId)
            .ToListAsync(cancellationToken);

        return SurveyVersioning.Capture(survey, questions, options, departmentIds);
    }

    /// <summary>
    /// Writes the content snapshot for a publish, advances <c>surveys.version</c> to match,
    /// and queues the <c>version_created</c> audit entry. Does not save.
    ///
    /// The version number is <c>max(version_number) + 1</c> read from the table rather than
    /// <c>surveys.version + 1</c>, so a survey whose counter was never advanced (every
    /// survey created before this endpoint existed sits at 1 with no snapshots) still gets
    /// version 1 for its first snapshot instead of 2, and the unique
    /// <c>(survey_id, version_number)</c> index cannot be violated by a stale counter.
    /// </summary>
    public static async Task<SurveyVersion> CaptureVersionAsync(
        ClimateProjectDbContext db,
        Survey survey,
        IReadOnlyList<Question> questions,
        IReadOnlyDictionary<Guid, List<QuestionOption>> optionsByQuestion,
        SurveyActor actor,
        DateTimeOffset timestamp,
        CancellationToken cancellationToken)
    {
        var departmentIds = await db.SurveyDepartmentTargets
            .Where(t => t.SurveyId == survey.Id)
            .Select(t => t.DepartmentId)
            .ToListAsync(cancellationToken);

        var content = SurveyVersioning.Capture(survey, questions, optionsByQuestion, departmentIds);

        var previousRow = await db.SurveyVersions
            .Where(v => v.SurveyId == survey.Id)
            .OrderByDescending(v => v.VersionNumber)
            .FirstOrDefaultAsync(cancellationToken);

        var previous = previousRow is null ? null : SurveyVersioning.ReadContent(previousRow);
        var versionNumber = (previousRow?.VersionNumber ?? 0) + 1;

        var version = new SurveyVersion
        {
            Id = Guid.NewGuid(),
            SurveyId = survey.Id,
            VersionNumber = versionNumber,
            TitleEn = survey.TitleEn,
            TitleEs = survey.TitleEs,
            DescriptionEn = survey.DescriptionEn,
            DescriptionEs = survey.DescriptionEs,
            Changes = SurveyVersioning.Diff(previous, content).ToArray(),
            Reason = TruncateRequired(
                previousRow is null ? SurveyVersionReasons.Publish : SurveyVersionReasons.Republish,
                MaxReason),
            CreatedBy = actor.UserId,
            QuestionsSnapshot = SurveyVersioning.SerializeQuestions(content.Questions),
            SettingsSnapshot = SurveyVersioning.SerializeSettings(content.Settings),
            // demographics_snapshot stays null -- see SurveyVersioning's class comment.
            DemographicsSnapshot = null,
            CreatedAt = timestamp,
        };

        db.SurveyVersions.Add(version);

        // The survey now points at the snapshot that describes it. This is the link that
        // makes a response resolvable to its wording: response -> survey.Version ->
        // survey_versions(survey_id, version_number) -> questions_snapshot.
        survey.Version = versionNumber;

        Record(
            db, survey.Id, SurveyAuditActions.VersionCreated, SurveyAuditEntityTypes.Version, actor, timestamp,
            new SurveyAuditChangeSet(VersionNumber: versionNumber),
            version.Id.ToString());

        return version;
    }

    private static string FirstNonEmpty(params string?[] candidates)
        => candidates.FirstOrDefault(c => !string.IsNullOrWhiteSpace(c))?.Trim() ?? string.Empty;

    /// <summary>Null-or-blank in, null out; otherwise trimmed and capped at the column's width.</summary>
    private static string? Truncate(string? value, int maxLength)
    {
        if (string.IsNullOrWhiteSpace(value))
        {
            return null;
        }

        var trimmed = value.Trim();
        return trimmed.Length <= maxLength ? trimmed : trimmed[..maxLength];
    }

    /// <summary>For the NOT NULL identity columns, where the caller has already guaranteed a value.</summary>
    private static string TruncateRequired(string value, int maxLength)
        => Truncate(value, maxLength) ?? string.Empty;
}
