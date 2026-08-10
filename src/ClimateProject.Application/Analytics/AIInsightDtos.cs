namespace ClimateProject.Application.Analytics;

/// <summary>
/// One row of <c>GET /admin/ai-insights</c>.
/// </summary>
/// <remarks>
/// Deliberately narrower than <see cref="AIInsightDetail"/>: the list is a triage surface, and
/// <c>Description</c> / <c>RecommendedActions</c> are LLM prose that would dominate the payload
/// for a list nobody reads in full. The web client's <c>AIInsightListItem</c> in
/// <c>web/src/features/analytics/api/insights.ts</c> is this record field-for-field; changing
/// either without the other breaks the page that already ships against it.
/// </remarks>
public sealed record AIInsightListItem(
    Guid Id, Guid CompanyId, string Type, string Category, string Title, string Priority, bool IsAcknowledged);

/// <summary>The full record returned by get, create and acknowledge.</summary>
/// <remarks>
/// <para>
/// <c>ConfidenceScore</c> is an integer percentage, 0-100, not a 0-1 fraction. That distinction
/// is the #152 bug: the legacy app carried two different <c>AIInsight</c> models under one name,
/// one on each scale. See <c>ClimateProject.Application.Reports.ReportAIInsights</c>.
/// </para>
/// <para>
/// <c>AcknowledgedBy</c> is a user id, not a name -- resolving it to a person is the caller's
/// job (and can legitimately fail across tenants), so this endpoint does not join Users.
/// </para>
/// <para>
/// <c>Title</c> / <c>Description</c> carry no <c>En</c>/<c>Es</c> pair, and as with
/// <see cref="AnalyticsInsightDetail"/> that is correct rather than an oversight of #195:
/// <c>ai_insights</c> is machine-authored output with no paired locale columns, so the locale
/// belongs to the generation request (#92), not to a read DTO. An <c>*_en</c>/<c>*_es</c> pair
/// here is exactly what the #195 constraint forbids.
/// </para>
/// <para>
/// <c>SupportingData</c> and <c>ExpiresAt</c> exist on the entity but are not projected: neither
/// has a consumer, and <c>SupportingData</c> is free-form jsonb whose shape #92 has not fixed.
/// </para>
/// </remarks>
public sealed record AIInsightDetail(
    Guid Id, Guid? SurveyId, Guid CompanyId, Guid? DepartmentId, string Type, string Category,
    string Title, string Description, int ConfidenceScore, string Priority,
    IReadOnlyList<string> AffectedSegments, IReadOnlyList<string> RecommendedActions,
    bool IsAcknowledged, Guid? AcknowledgedBy, DateTimeOffset? AcknowledgedAt);

/// <remarks>
/// <para>
/// There is no <c>UpdateAIInsightRequest</c> and no delete verb. An insight is a dated finding,
/// not a document: editing the prose after the fact would make an acknowledgement attest to
/// something the acknowledger never read. Withdrawing one is what <c>ExpiresAt</c> is for, and
/// nothing writes it until #92.
/// </para>
/// <para>
/// <c>IsAcknowledged</c>, <c>AcknowledgedBy</c> and <c>AcknowledgedAt</c> are absent by design --
/// they are set only by <c>POST /{id}/acknowledge</c>, from the caller's token, so a creator
/// cannot file an insight that claims someone else already signed it off.
/// </para>
/// </remarks>
public sealed record CreateAIInsightRequest(
    Guid? SurveyId, Guid CompanyId, Guid? DepartmentId, string Type, string Category,
    string Title, string Description, int ConfidenceScore, string Priority,
    IReadOnlyList<string>? AffectedSegments, IReadOnlyList<string>? RecommendedActions);
