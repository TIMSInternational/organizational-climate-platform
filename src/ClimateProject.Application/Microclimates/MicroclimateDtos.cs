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

public sealed record CreateMicroclimateRequest(
    string Title,
    string? Description,
    Guid CompanyId,
    DateTimeOffset StartTime,
    DateTimeOffset EndTime,
    int TargetParticipantCount,
    bool AnonymousResponses,
    Guid? TemplateId,
    List<CreateQuestionInput>? Questions);

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
