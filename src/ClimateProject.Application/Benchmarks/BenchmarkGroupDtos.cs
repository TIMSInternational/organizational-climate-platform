namespace ClimateProject.Application.Benchmarks;

/// <summary>A reference group as the groups tab lists it.</summary>
/// <param name="CompanyCount">
/// Companies that meet the criteria today and have a closed survey of the group's instrument
/// family that cleared the respondent floor. Counted across every company, so this is the
/// group's size, not its size as seen from one subject (a reading excludes the subject).
/// </param>
/// <param name="LatestSurveyOn">The newest of those surveys' close dates, or null with none.</param>
public sealed record BenchmarkGroupDto(
    Guid Id,
    string Name,
    string? Industry,
    string? CompanySize,
    string? Country,
    string ServiceType,
    int CompanyCount,
    int MinimumCompanies,
    DateTimeOffset? LatestSurveyOn);

public sealed record CreateBenchmarkGroupRequest(
    string? Name,
    string? Industry,
    string? CompanySize,
    string? Country,
    string? ServiceType);

/// <summary>The values the create dialog offers: what companies actually carry, nothing invented.</summary>
public sealed record BenchmarkGroupOptions(
    IReadOnlyList<string> Industries,
    IReadOnlyList<string> CompanySizes,
    IReadOnlyList<string> Countries,
    IReadOnlyList<string> ServiceTypes);

public sealed record BenchmarkGroupPreview(int CompanyCount, int MinimumCompanies);

public sealed record BenchmarkReadingSurvey(Guid Id, string? Title, DateTimeOffset EndDate, string? ServiceType);

/// <summary>
/// One company against one group. <see cref="Kind"/> says which of the shapes this is; every
/// number is null unless it is <see cref="BenchmarkReadingKinds.Ready"/>.
/// </summary>
public sealed record BenchmarkGroupReadingResponse(
    string Kind,
    Guid GroupId,
    Guid CompanyId,
    string? CompanyName,
    BenchmarkReadingSurvey? Survey,
    int CompanyCount,
    int MinimumCompanies,
    double? CompanyIndex,
    double? GroupMedian,
    IReadOnlyList<BenchmarkGroupReading.DimensionReading> Dimensions);

public static class BenchmarkReadingKinds
{
    public const string Ready = "ready";

    /// <summary>Fewer than the minimum companies besides the subject.</summary>
    public const string Insufficient = "insufficient";

    /// <summary>The subject has no closed survey of the group's instrument family.</summary>
    public const string NoSurvey = "no_survey";

    /// <summary>The survey asked for is of another instrument family than the group's.</summary>
    public const string ServiceMismatch = "service_mismatch";

    /// <summary>The subject's own survey is under the respondent floor.</summary>
    public const string SurveySuppressed = "survey_suppressed";
}
