namespace ClimateProject.Application.Microclimates;

public sealed record QuestionDto(Guid Id, string Text, string Type, string[]? Options, bool Required, int Order);
public sealed record CreateQuestionInput(string Text, string Type, string[]? Options, bool Required, int Order);

public sealed record MicroclimateListItem(
    Guid Id,
    string Title,
    Guid CompanyId,
    string Status,
    int ResponseCount,
    int TargetParticipantCount,
    DateTimeOffset CreatedAt);

public sealed record MicroclimateListResponse(IReadOnlyList<MicroclimateListItem> Microclimates);

public sealed record MicroclimateDetail(
    Guid Id,
    string Title,
    string? Description,
    Guid CompanyId,
    Guid CreatedBy,
    string Status,
    int ResponseCount,
    int TargetParticipantCount,
    DateTimeOffset StartTime,
    DateTimeOffset EndTime,
    bool AnonymousResponses,
    bool ShowLiveResults,
    List<QuestionDto> Questions);

// Deliberately reduced view served to unauthenticated callers (the public
// MicroclimateRespondPage) -- see GetAsync. Must never carry CompanyId, CreatedBy,
// Description, ResponseCount/TargetParticipantCount, or any other internal/participation
// data that an anonymous visitor holding a GUID has no business seeing.
public sealed record PublicMicroclimateDetail(
    Guid Id,
    string Title,
    string Status,
    List<QuestionDto> Questions);

public sealed record CreateMicroclimateRequest(
    string Title,
    string? Description,
    Guid CompanyId,
    DateTimeOffset StartTime,
    DateTimeOffset EndTime,
    int TargetParticipantCount,
    bool AnonymousResponses,
    Guid? TemplateId,
    List<CreateQuestionInput>? Questions,
    string? Timezone = null);

public sealed record UpdateMicroclimateRequest(
    string? Title,
    string? Description,
    string? Status,
    DateTimeOffset? EndTime);

public sealed record WordCloudEntry(string Text, int Value);

public sealed record LiveResultsDetail(
    double SentimentScore,
    string EngagementLevel,
    List<WordCloudEntry> WordCloud,
    int ResponseCount,
    int TargetParticipantCount);

public sealed record SubmitResponseRequest(Dictionary<Guid, string> Answers);
