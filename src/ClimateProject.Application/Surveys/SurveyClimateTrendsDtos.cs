namespace ClimateProject.Application.Surveys;

/// <summary>
/// One column of the climate-over-time matrix: a question <c>Category</c>, which this
/// product calls a dimension.
/// </summary>
/// <param name="Key">
/// The raw category string, locale-independent, exactly as
/// <see cref="SurveyDimensionResult.Dimension"/> carries it. Categories are authored as
/// free text and are not translated anywhere in this product, so there is no label to
/// resolve and none is invented here -- a server-side translation of an author's own word
/// would be a different word from the one the authoring screen shows.
/// </param>
/// <param name="SurveyCount">
/// How many of the surveys in this response actually contain the dimension. Reported so a
/// reader can tell a dimension that was dropped from later instruments (a short column)
/// from one every survey asked about (a full column) -- a distinction the null scores alone
/// cannot make, because a null is also what suppression and "no scale question" produce.
/// </param>
public sealed record ClimateTrendDimension(string Key, int SurveyCount);

/// <summary>
/// One row of the matrix: one survey, for one group.
///
/// **Rows are surveys and columns are dimensions, which is the transpose of how the
/// feature is usually described.** The orientation is forced by the anonymity floor, not
/// chosen for looks. A reading is withheld on the size of the group behind it, and the
/// group behind a row must therefore be constant across that row: within one survey, one
/// department answered every dimension, so one respondent count governs the whole row and
/// <c>ClimateMap</c>'s existing row-as-a-unit suppression is exactly right. Laid out the
/// other way -- a dimension per row, a survey per column -- the respondent count varies
/// along the row, and a component that suppresses by row would either withhold disclosable
/// cells or, far worse, disclose withheld ones.
/// </summary>
/// <param name="RespondentCount">
/// Completed responses behind this row: for the whole company, the survey's completed
/// count; for a group, that group's completed count in THAT survey. Never rendered, exactly
/// as <see cref="SurveySegmentResult.RespondentCount"/> is not -- it decides suppression and
/// is reported so a caller can apply a raised company floor, not so a screen can print it.
/// It is 0 when <paramref name="IsSuppressed"/> is true, so the withheld size never travels
/// with the withheld reading.
/// </param>
/// <param name="IsSuppressed">
/// True when this group had fewer than <see cref="SurveyResultsPrivacy.MinimumSegmentRespondents"/>
/// completed responses in this survey, or when the survey as a whole fell below
/// <see cref="SurveyResultsPrivacy.MinimumRespondents"/>. <paramref name="Scores"/> is then
/// all-null: the row is kept so the reader can see the survey happened, which is the same
/// reason <c>ClimateMap</c> keeps a suppressed row rather than dropping it.
/// </param>
/// <param name="Scores">
/// One entry per dimension, positionally aligned to
/// <see cref="ClimateTrendsResponse.Dimensions"/>. Null means "no score", which has three
/// causes a client must not try to distinguish: suppressed, the survey never asked this
/// dimension, or the dimension has no answered scale question. They are deliberately one
/// value -- <paramref name="IsSuppressed"/> already says whether the floor was the reason,
/// and a per-cell reason code would let a reader difference "asked but withheld" against
/// "never asked" to learn a group's size.
/// </param>
public sealed record ClimateTrendPoint(
    Guid SurveyId,
    int RespondentCount,
    bool IsSuppressed,
    IReadOnlyList<double?> Scores);

/// <summary>
/// One group's series across every survey in the window -- the whole company when the
/// caller did not group, one department or one demographic value when they did.
/// </summary>
/// <param name="Key">
/// The department id or the stable demographic value, locale-independent. The literal
/// <see cref="SurveyClimateTrends.WholeCompanyKey"/> when ungrouped.
/// </param>
/// <param name="Label">The already-resolved display name, or null when the key is its own name.</param>
/// <param name="Points">One per survey, oldest first, positionally aligned to <see cref="ClimateTrendsResponse.Surveys"/>. A survey a group did not exist in still gets a point, suppressed and scoreless, so every series is the same length and the columns line up.</param>
public sealed record ClimateTrendGroup(
    string Key,
    string? Label,
    IReadOnlyList<ClimateTrendPoint> Points);

/// <summary>One survey in the window, as the matrix's row heading.</summary>
/// <param name="EndDate">
/// What the row is ordered and dated by: the survey CLOSED here, so this is the point in
/// time the reading describes. Ordering by <c>StartDate</c> would put a long survey that
/// opened early but closed late before a short one that ran entirely inside it, which is
/// the wrong order for a time series; ordering by <c>CreatedAt</c> would date a reading by
/// when someone drafted it.
/// </param>
/// <param name="CompletedCount">The survey's own completed-response count, independent of any grouping. Present so a reader can see participation move even where a group's own row is withheld.</param>
public sealed record ClimateTrendSurvey(
    Guid SurveyId,
    string? Title,
    string Status,
    DateTimeOffset EndDate,
    int CompletedCount,
    bool IsSuppressed);

/// <summary>
/// <c>GET /surveys/climate-trends</c> -- the same dimension scores every other results
/// surface shows, read across surveys instead of within one.
/// </summary>
/// <param name="GroupBy">Echoed back so a client can tell an ungrouped response from a grouped one that matched nothing.</param>
/// <param name="MinimumGroupSize">The floor actually applied, so a client renders the promise the server kept rather than its own constant.</param>
/// <param name="SuppressedGroupCount">
/// How many groups were withheld in EVERY survey in the window. Those groups are still
/// present in <paramref name="Groups"/>, with every point suppressed -- they are counted
/// here, not dropped.
///
/// Dropping them was considered and refused, on the rule <c>ClimateMap</c> already states
/// for a single survey: removing a withheld row misreports the organisation's shape,
/// because the reader cannot tell that the group exists at all. A group small in every
/// survey is exactly the group whose absence would be read as "we have no such
/// department". The count is reported anyway so a client can say how much of the
/// organisation the visible rows account for, matching
/// <see cref="SurveyBreakdown.SuppressedSegmentCount"/>.
/// </param>
public sealed record ClimateTrendsResponse(
    Guid CompanyId,
    string? GroupBy,
    IReadOnlyList<ClimateTrendSurvey> Surveys,
    IReadOnlyList<ClimateTrendDimension> Dimensions,
    IReadOnlyList<ClimateTrendGroup> Groups,
    int SuppressedGroupCount,
    int MinimumGroupSize,
    DateTimeOffset GeneratedAt);
