using System.Text.Json;
using ClimateProject.Application.Localization;

namespace ClimateProject.Application.Surveys;

// ---------------------------------------------------------------------------
// READ SHAPES
//
// Same non-negotiable as SurveyDtos, inherited from #195: not one property below is
// En/Es-shaped. Title and Description arrive already resolved for the request locale,
// with ResolvedLocale and FallbackFields saying which language they are actually in.
//
// Content is the exception that proves the rule: it is the wizard's own opaque state,
// round-tripped verbatim and never resolved by the server, so it is not server-defined
// content at all. The Tier 1 fields were deliberately lifted out of it so that the
// fields the server does own obey the rule.
// ---------------------------------------------------------------------------

/// <summary>
/// A draft in a listing. Deliberately without <c>Content</c>: the recovery banner needs
/// to say "you have an unfinished survey from Tuesday", and shipping every wizard
/// snapshot in the company to render that is a listing that gets slower every week.
/// </summary>
public sealed record SurveyDraftSummary(
    Guid Id,
    string SessionId,
    string? Title,
    string Language,
    string ResolvedLocale,
    int CurrentStep,
    string? LastEditedField,
    int Version,
    int AutoSaveCount,
    bool IsRecovered,
    DateTimeOffset? LastAutosaveAt,
    DateTimeOffset ExpiresAt,
    DateTimeOffset CreatedAt,
    DateTimeOffset UpdatedAt);

/// <param name="Version">
/// The optimistic-concurrency token. Echo it back as <c>expectedVersion</c> on the next
/// save to be told about a conflict instead of silently overwriting another tab.
/// </param>
/// <param name="MissingTranslations">
/// Advisory, never blocking -- see <see cref="SurveyDraftContent.MissingTranslations"/>.
/// A brand-new empty draft is legitimately missing its title.
/// </param>
public sealed record SurveyDraftDetail(
    Guid Id,
    string SessionId,
    Guid CompanyId,
    string? Title,
    string? Description,
    string Language,
    string ResolvedLocale,
    IReadOnlyList<string> FallbackFields,
    IReadOnlyList<MissingTranslation> MissingTranslations,
    bool IsTranslationComplete,
    JsonElement? Content,
    int CurrentStep,
    string? LastEditedField,
    int Version,
    int AutoSaveCount,
    bool IsRecovered,
    DateTimeOffset? LastAutosaveAt,
    DateTimeOffset ExpiresAt,
    DateTimeOffset CreatedAt,
    DateTimeOffset UpdatedAt);

public sealed record SurveyDraftListResponse(IReadOnlyList<SurveyDraftSummary> Drafts);

/// <summary>
/// <c>GET /surveys/drafts/latest</c>'s envelope.
///
/// A wrapper with a nullable member rather than a 404, because "you have nothing to
/// recover" is the *normal* answer -- it is what the banner asks on every wizard open.
/// Answering the common case with an error status is how a client ends up with a console
/// full of 404s it has to learn to ignore.
/// </summary>
public sealed record SurveyDraftLatestResponse(SurveyDraftDetail? Draft);

/// <summary>
/// The 409 body. Carries the current server state rather than just a message so the tab
/// that lost can show the user what the other tab wrote and let them choose, instead of
/// having to re-fetch before it can say anything useful.
/// </summary>
public sealed record SurveyDraftConflict(string Message, SurveyDraftDetail Current);

public sealed record PurgeExpiredDraftsResponse(int Deleted);

// ---------------------------------------------------------------------------
// WRITE SHAPES
// ---------------------------------------------------------------------------

/// <param name="SessionId">
/// The wizard session this draft belongs to. Optional: omitted, the server mints one.
/// A draft is keyed on (user, session) rather than on a survey because
/// <c>SurveyDraft</c> has no <c>survey_id</c> -- it is the scratchpad for a survey that
/// does not exist yet.
/// </param>
public sealed record CreateSurveyDraftRequest(
    string? SessionId = null,
    string? Language = null,
    LocalizedInput? Title = null,
    LocalizedInput? Description = null,
    JsonElement? Content = null,
    int? CurrentStep = null,
    string? LastEditedField = null);

/// <param name="ExpectedVersion">
/// The <c>Version</c> the caller last saw.
///
/// **Supplied:** the write is conditional. If another tab saved in between, the write is
/// refused with 409 and the current state, and nothing is lost.
///
/// **Omitted:** last-writer-wins, explicitly and by the caller's choice. This is the
/// right default for a single-tab autosave loop, where every write is a superset of the
/// last and demanding a version would turn a dropped response into a spurious conflict.
///
/// Either way the write itself is a single conditional UPDATE with server-side
/// arithmetic on <c>version</c> and <c>auto_save_count</c>, so two concurrent autosaves
/// can never interleave into a half-applied row or lose a count.
/// </param>
/// <param name="Content">
/// A full replacement of the wizard's state, not a patch. Omitted means leave it alone.
/// </param>
public sealed record SaveSurveyDraftRequest(
    int? ExpectedVersion = null,
    string? Language = null,
    LocalizedInput? Title = null,
    LocalizedInput? Description = null,
    JsonElement? Content = null,
    int? CurrentStep = null,
    string? LastEditedField = null);
