using System.Text.Json;
using ClimateProject.Application.Surveys;

namespace ClimateProject.Application.Reports;

/// <summary>
/// The report document as an <b>anonymous</b> holder of a share link is allowed to read it.
///
/// <para>
/// ## Read this before you add a section OR A FIELD to <see cref="ReportOutputDocument"/>
/// </para>
/// <para>
/// <b>The records in this file are an allow-list, and they are the only thing that decides
/// what <c>GET /shared/reports/{token}</c> publishes to the whole internet.</b> A section you
/// add to <see cref="ReportOutputDocument"/> -- or a <em>field</em> you add to any type it
/// reaches -- is <b>private</b>: it reaches the authenticated report routes and stops here,
/// until somebody names it on the matching public record <em>and</em> in
/// <see cref="PublicReportProjection.ToPublic"/> on purpose. Adding to the stored document is a
/// reporting decision; publishing is a privacy decision, and they are not the same decision.
/// </para>
/// <para>
/// It exists because the resolve handler used to return <c>reports.report_output</c> verbatim,
/// which made the public payload whatever the last person to touch the generator happened to
/// add. That failed open exactly once and by exactly that route: #413 added per-question
/// results (word clouds included), demographic breakdowns and benchmark comparisons, and all
/// three became anonymously readable with nobody deciding. Fail-closed is the property being
/// bought here, and it is bought structurally -- the public shape is declared, not inherited,
/// so the default for anything new is "withheld".
/// </para>
/// <para>
/// <b>Why the whole tree is declared and not just the four sections.</b> The first version of
/// this file admitted the four sections by re-exporting the <em>internal</em> types --
/// <c>IReadOnlyList&lt;ReportBenchmarkComparison&gt;</c> and friends -- so the gate held at the
/// section level and nowhere below it. Every field on an admitted type published itself, then
/// and in future, with nobody deciding: that is how
/// <c>ReportBenchmarkComparison.CompanyId</c>, the <b>tenant GUID</b>, reached a payload the
/// whole internet can read. A public counterpart per internal type is what moves the decision
/// down to the field, and <c>PublicReportProjectionTests.Every_admitted_field_has_been_ruled_on</c>
/// is what makes the next omission loud instead of silent.
/// </para>
/// <para>
/// The fail-closed property has a second half that costs nothing and is worth knowing about:
/// <see cref="PublicReportProjection.ToPublicJson"/> re-serialises from a <em>typed</em>
/// deserialisation of the stored JSON, so a key sitting in <c>report_output</c> that no type
/// in this document declares -- a hand-written row, a document written by an older or newer
/// generator, anything at all -- is dropped at every level rather than forwarded.
/// <c>The_public_document_carries_only_the_allow_listed_sections</c> pins that.
/// </para>
/// <para>
/// <b>This type governs the anonymous route only.</b> <c>GET /admin/reports/{id}</c> and
/// <c>GET /admin/reports/{id}/download</c> still hand an authenticated, tenant-scoped,
/// role-checked reader the stored document verbatim through <c>ReportEndpoints.ToDetail</c>,
/// and must keep doing so: the floors inside that document were already computed for a reader
/// with a session, and a second subtraction here would make the shared page and the results
/// page disagree.
/// </para>
/// <para>
/// <b>Property names are the wire contract.</b> Every public record below names its fields
/// exactly as the internal one does, because <c>web/src/features/reports/reportDocument.ts</c>
/// parses those camelCase keys and the projection is not allowed to rename anything on its way
/// out. The one exception is <see cref="PublicBenchmarkComparison.IsGlobal"/>, which is a new
/// field that exists precisely so an old one does not have to be published.
/// </para>
/// </summary>
/// <param name="GenerationNote">
/// Admitted. The generator's own statement of what the document does not contain. Withholding
/// it would leave a public reader unable to tell an absent section from an empty one.
/// </param>
/// <param name="Surveys">
/// Admitted, <b>with the word frequencies stripped</b> -- see
/// <see cref="PublicReportProjection.WithoutWords"/>. Everything else in a section is an
/// aggregate the platform has already floored and suppressed
/// (<see cref="SurveyResultsPrivacy"/>): participation counters, per-question distributions,
/// dimension scores, department participation and demographic breakdowns.
/// </param>
/// <param name="AiInsights">
/// Admitted. Generated prose about the company, authored by the platform rather than by a
/// respondent, and already scoped to the report's tenant when the document was built.
/// </param>
/// <param name="Benchmarks">
/// Admitted, and this was a decision rather than an oversight: a benchmark comparison is
/// cohort data -- the company's own readings against a prior period, plus the global rows
/// every tenant compares against -- carrying no respondent and no segment below a floor. The
/// public page (<c>SharedReportSections.tsx</c>) exists to show them.
/// </param>
public sealed record PublicReportDocument(
    string GenerationNote,
    IReadOnlyList<PublicSurveySection> Surveys,
    IReadOnlyList<PublicAiInsight> AiInsights,
    IReadOnlyList<PublicBenchmarkComparison> Benchmarks);

/// <summary>
/// One survey's section, as a link holder reads it -- the public counterpart of
/// <see cref="ReportSurveySection"/>.
/// </summary>
/// <param name="SurveyId">
/// Published because the page reads it: <c>SharedReportSections.tsx</c> keys the section on it
/// and builds the heading's <c>id</c> and <c>aria-labelledby</c> out of it, so a screen-reader
/// reader can navigate between sections. A survey id joins to no tenant surface an anonymous
/// caller can reach -- every survey route is authenticated and tenant-scoped -- and the section
/// beside it already says everything the id could be used to look up.
/// </param>
/// <param name="SuppressedDepartmentCount">
/// The count of withheld departments, which names nobody. Its sibling
/// <c>ReportSurveySection.SuppressedRespondentCount</c> -- how many <em>people</em> are behind
/// them -- is <b>withheld</b>: see <see cref="PublicReportProjection.ShapeRulings"/>.
/// </param>
public sealed record PublicSurveySection(
    Guid SurveyId,
    string? Title,
    string Status,
    string ResolvedLocale,
    PublicSurveyParticipation Participation,
    IReadOnlyList<PublicQuestionResult> Questions,
    IReadOnlyList<PublicDimensionResult> Dimensions,
    IReadOnlyList<PublicDepartmentParticipation> Departments,
    int SuppressedDepartmentCount,
    int UnsegmentedRespondentCount,
    IReadOnlyList<PublicDemographicBreakdown> Demographics,
    bool IsSuppressed,
    string? SuppressionReason,
    int MinimumGroupSize);

/// <summary>
/// Participation counters -- <see cref="SurveyResultsSummary"/>, published whole.
///
/// <para>
/// Every field is a count or a rate over the survey population, and the platform's own rule is
/// that participation is returned even below the disclosure floor because "a count of responses
/// identifies nobody". The page renders four of these ten; the rest are carried because the
/// client's parser declares them and a reader of the document is entitled to reconcile the
/// numbers it does show.
/// </para>
/// </summary>
public sealed record PublicSurveyParticipation(
    int? InvitedCount,
    int ResponseCount,
    int CompletedCount,
    int PartialCount,
    double? ParticipationRate,
    double CompletionRate,
    double? AverageCompletionSeconds,
    DateTimeOffset? FirstResponseAt,
    DateTimeOffset? LastResponseAt,
    IReadOnlyList<PublicLanguageCount> ByLanguage);

/// <summary>How many responses arrived in each language -- <see cref="SurveyLanguageCount"/>.</summary>
public sealed record PublicLanguageCount(string Language, int Count);

/// <summary>
/// One question's results -- <see cref="SurveyQuestionResult"/> with
/// <see cref="Words"/> always empty; see <see cref="PublicReportProjection.WithoutWords"/>.
/// </summary>
/// <param name="QuestionId">
/// Published because the page reads it: it is the React key of every question block. Like
/// <see cref="PublicSurveySection.SurveyId"/> it joins to nothing an anonymous caller can
/// reach, and the question's own text is printed directly above it.
/// </param>
/// <param name="Words">
/// <b>Always empty on this document.</b> The type is declared so the key keeps its array shape
/// -- the client renders its "withheld" line off <see cref="SuppressedWordCount"/> and reads
/// <c>words</c> as an array either way -- not because anything is ever put in it.
/// </param>
public sealed record PublicQuestionResult(
    Guid QuestionId,
    int Order,
    string Type,
    string? Text,
    string? Category,
    int AnsweredCount,
    IReadOnlyList<PublicDistributionBucket> Distribution,
    double? Average,
    double? Median,
    int? ScaleMin,
    int? ScaleMax,
    string? ScaleLabelMin,
    string? ScaleLabelMax,
    IReadOnlyList<PublicWordFrequency> Words,
    int SuppressedWordCount);

/// <summary>One option bucket -- <see cref="SurveyDistributionBucket"/>, keyed by the stable option value.</summary>
public sealed record PublicDistributionBucket(
    string Value,
    string? Label,
    int Count,
    double Percentage,
    double? AverageRank);

/// <summary>
/// The shape of a word-cloud entry -- <see cref="SurveyWordFrequency"/>.
/// <b>No instance of this record is ever constructed by the projection.</b> It exists so
/// <see cref="PublicQuestionResult.Words"/> has an element type and so the field-level tripwire
/// covers the internal type it mirrors.
/// </summary>
public sealed record PublicWordFrequency(string Language, string Word, int Count, int ResponseCount);

/// <summary>One dimension's rollup -- <see cref="SurveyDimensionResult"/>.</summary>
public sealed record PublicDimensionResult(
    string Dimension,
    int QuestionCount,
    int AnsweredCount,
    double? AverageScore);

/// <summary>
/// One department's participation -- <see cref="ReportDepartmentParticipation"/>.
/// </summary>
/// <param name="DepartmentId">
/// Published because the page reads it: it is the React key of the department row, and it is
/// the only field of the row guaranteed unique (two departments may share a name). It is a
/// department identifier of the report's own tenant, printed beside that department's name in
/// the same row -- it discloses no group the row does not already name.
/// </param>
public sealed record PublicDepartmentParticipation(
    string DepartmentId,
    string? Name,
    int RespondentCount,
    double? ParticipationRate,
    bool IsSuppressed);

/// <summary>
/// One demographic dimension and its groups -- <see cref="ReportDemographicBreakdown"/>.
/// </summary>
/// <param name="SuppressedSegmentCount">
/// How many groups were withheld, which names nobody. How many <em>people</em> are behind them
/// -- <c>ReportDemographicBreakdown.SuppressedRespondentCount</c> -- is <b>withheld</b>: see
/// <see cref="PublicReportProjection.ShapeRulings"/>.
/// </param>
public sealed record PublicDemographicBreakdown(
    string Dimension,
    IReadOnlyList<PublicSegmentParticipation> Segments,
    int SuppressedSegmentCount,
    int UnsegmentedRespondentCount);

/// <summary>One demographic group -- <see cref="ReportSegmentParticipation"/>.</summary>
public sealed record PublicSegmentParticipation(
    string Key,
    string? Label,
    int RespondentCount,
    bool IsSuppressed,
    IReadOnlyList<PublicSegmentDimensionScore> Dimensions);

/// <summary>One dimension's score inside one group -- <see cref="ReportSegmentDimensionScore"/>.</summary>
public sealed record PublicSegmentDimensionScore(string Dimension, double? AverageScore);

/// <summary>
/// One AI insight -- <see cref="ReportAIInsightItem"/> minus its affected segments.
/// </summary>
/// <param name="Id">
/// Published because the page reads it: it is the React key of the insight card, and the title
/// is not unique enough to key on. It is an <c>ai_insights</c> row id, reachable only through
/// authenticated, tenant-scoped routes.
/// </param>
/// <param name="ConfidenceScore">An integer percentage 0-100. Never a 0-1 fraction; see <see cref="ReportAIInsightItem"/> for the bug that was.</param>
public sealed record PublicAiInsight(
    Guid Id,
    string Type,
    string Category,
    string Title,
    string Description,
    int ConfidenceScore,
    string Priority,
    IReadOnlyList<string> RecommendedActions,
    bool IsAcknowledged);

/// <summary>
/// One benchmark read against its prior period -- <see cref="ReportBenchmarkComparison"/> with
/// the tenant GUID replaced by the one fact the page derived from it.
/// </summary>
/// <param name="BenchmarkId">
/// Published because the page reads it: React key, heading <c>id</c> and
/// <c>aria-labelledby</c>. A benchmark id is not a tenant id and every benchmark route is
/// authenticated; the readings it would look up are printed in the table underneath it.
/// </param>
/// <param name="IsGlobal">
/// <b>True for a benchmark every tenant compares against, false for one of this organisation's
/// own measurements.</b> This is the whole of what the page ever asked
/// <c>ReportBenchmarkComparison.CompanyId</c> -- it rendered a "Global" chip when the id was
/// null and nothing else, ever -- while the field itself carried the report's <b>tenant
/// GUID</b> to every anonymous holder of the URL. <c>SharedReportResponse</c> already calls
/// <c>companyId</c> one of "the two identifiers that would let a holder join this document to
/// another tenant surface" and omits it from the envelope; it was reaching the same reader one
/// level down, inside the document. A boolean answers the page's question and joins to nothing.
///
/// <para>
/// Named after what it means rather than after what it replaced, and not a new idea here:
/// <see cref="SurveyTemplateListItem.IsGlobal"/> is the same field for the same reason on the
/// same shape of row -- "<c>CompanyId == null</c>, restated as a flag so a client does not have
/// to infer a security-relevant property from a null" -- and the browser already calls this
/// distinction <c>isGlobalBenchmark</c> on the authenticated benchmark screens.
/// </para>
/// </param>
/// <param name="PriorPeriodStatus">
/// One of <c>PriorPeriodStatuses</c>. Load-bearing: a null <see cref="PriorPeriod"/> cannot
/// tell "this benchmark has no prior period" from "nobody has linked one yet" from "the link
/// points somewhere this company may not read", and the page prints a different sentence for
/// each.
/// </param>
public sealed record PublicBenchmarkComparison(
    Guid BenchmarkId,
    string Name,
    string Category,
    string Type,
    bool IsGlobal,
    string PriorPeriodStatus,
    IReadOnlyList<PublicBenchmarkMetric> Metrics,
    PublicBenchmarkPriorPeriod? PriorPeriod);

/// <summary>
/// One benchmark reading -- <see cref="BenchmarkMetricDto"/>.
/// </summary>
/// <param name="Id">
/// Published because the page reads it: it is the React key of the readings table, and nothing
/// enforces that two metrics of one benchmark carry different names
/// (<c>BenchmarkEndpoints.AddMetricAsync</c> validates the name's shape, not its uniqueness),
/// so the name cannot stand in for it. A <c>benchmark_metrics</c> row id names no tenant.
/// </param>
public sealed record PublicBenchmarkMetric(
    Guid Id,
    string MetricName,
    double Value,
    string Unit,
    double? Percentile,
    int? SampleSize);

/// <summary>
/// The prior period a benchmark links to -- <see cref="BenchmarkPriorPeriodDto"/> minus its id.
/// </summary>
/// <param name="Name">
/// The only thing the page reads off the prior period besides its metrics: it prints
/// "compared with {name}". <c>BenchmarkPriorPeriodDto.Id</c> is <b>withheld</b> -- see
/// <see cref="PublicReportProjection.ShapeRulings"/>.
/// </param>
public sealed record PublicBenchmarkPriorPeriod(
    string Name,
    IReadOnlyList<PublicBenchmarkMetricChange> Metrics);

/// <summary>
/// One metric read against the prior period's -- <see cref="BenchmarkMetricChangeDto"/>.
/// Carried whole because the page renders all seven fields: both values, both units (to say
/// <em>why</em> a change is absent when they differ), the delta and the ratio.
/// </summary>
public sealed record PublicBenchmarkMetricChange(
    string MetricName,
    double? Value,
    string? Unit,
    double? PriorValue,
    string? PriorUnit,
    double? Delta,
    double? ChangeRatio);

/// <summary>
/// One internal type of the stored document, its public counterpart, and the fields somebody
/// has ruled on by name.
/// </summary>
/// <param name="Stored">The type <c>ReportGeneration</c> writes into <c>reports.report_output</c>.</param>
/// <param name="Public">The record an anonymous reader is served instead.</param>
/// <param name="Withheld">
/// Fields of <paramref name="Stored"/> that are deliberately NOT published. Naming one here is
/// the decision; the public record not declaring it is what enforces it.
/// </param>
/// <param name="Derived">
/// Fields of <paramref name="Public"/> that have no counterpart on <paramref name="Stored"/>
/// because the projection computes them -- today, only
/// <see cref="PublicBenchmarkComparison.IsGlobal"/>. Named so a public field with no stored
/// source cannot appear without somebody saying where it comes from.
/// </param>
public sealed record PublicShapeRuling(
    Type Stored,
    Type Public,
    IReadOnlySet<string> Withheld,
    IReadOnlySet<string> Derived);

/// <summary>
/// Builds the <see cref="PublicReportDocument"/> that <c>GET /shared/reports/{token}</c>
/// returns, from the document <c>ReportGeneration</c> stored.
/// </summary>
public static class PublicReportProjection
{
    private static readonly IReadOnlySet<string> Nothing = new HashSet<string>(StringComparer.Ordinal);

    /// <summary>
    /// Every section of <see cref="ReportOutputDocument"/> a person has ruled on.
    /// </summary>
    /// <remarks>
    /// <para>
    /// This set is a <b>tripwire, not a gate</b>. The gate is <see cref="PublicReportDocument"/>
    /// itself: a section absent from that record cannot reach an anonymous reader whatever this
    /// set says. What the set buys is that the omission is <em>noticed</em> -- add a section to
    /// <see cref="ReportOutputDocument"/> without naming it here and
    /// <c>PublicReportProjectionTests.Every_stored_section_has_been_ruled_on</c> fails, which is
    /// how the next person is told that a publish/withhold decision is now theirs to make.
    /// </para>
    /// <para>
    /// Naming a section here does not publish it. Publishing it means adding it to
    /// <see cref="PublicReportDocument"/> and to <see cref="ToPublic"/>, deliberately.
    /// </para>
    /// </remarks>
    public static IReadOnlySet<string> StoredSectionsRuledOn { get; } = new HashSet<string>(StringComparer.Ordinal)
    {
        nameof(ReportOutputDocument.GenerationNote),
        nameof(ReportOutputDocument.Surveys),
        nameof(ReportOutputDocument.AiInsights),
        nameof(ReportOutputDocument.Benchmarks),

        // WITHHELD, and named here so the tripwire stops firing rather than because it is
        // published: `Comparison` is absent from `PublicReportDocument`, so no anonymous
        // holder of a share URL can reach it.
        //
        // Why withheld rather than published. The section is whole-company and every reading
        // in it is already gated by `SurveyClimateTrends`' floors, so publishing it would
        // probably be safe -- "probably" is the problem. A delta is the one figure in this
        // document that states a RELATIONSHIP between two waves rather than a reading of one,
        // and a share URL is forwardable to anyone. Deciding that a government client's
        // wave-over-wave movement may be read by whoever holds a link is a privacy boundary,
        // and this codebase's boundaries are the client's owner's to set, not a default an
        // implementer picks while wiring a section up.
        //
        // Reversing it is a deliberate three-part change, exactly as the remarks above
        // require: declare a `PublicReportComparison` on `PublicReportDocument`, project it in
        // `ToPublic`, and rule on each of its fields in `ShapeRulings`.
        //
        // The section IS delivered today -- in the authorized report's stored document and in
        // the PDF and CSV an administrator downloads. Only the anonymous link is without it.
        nameof(ReportOutputDocument.Comparison),
    };

    /// <summary>
    /// The same tripwire, <b>one level down</b>: every field of every internal type an admitted
    /// section reaches, ruled on by name.
    /// </summary>
    /// <remarks>
    /// <para>
    /// <see cref="StoredSectionsRuledOn"/> works at the section level and did not work below it.
    /// When the four admitted sections were typed as the internal records themselves, adding a
    /// property to <see cref="ReportBenchmarkComparison"/> -- or to
    /// <see cref="SurveyQuestionResult"/>, or to any of the fifteen other types they reach --
    /// published it to the whole internet with nobody deciding and nothing going red. It had
    /// already happened once: <c>CompanyId</c>, the tenant GUID.
    /// </para>
    /// <para>
    /// <c>PublicReportProjectionTests.Every_admitted_field_has_been_ruled_on</c> reads this list
    /// and fails, <b>naming the field</b>, when a property appears on a stored type that its
    /// public counterpart neither declares nor withholds. It fails the other way too: a
    /// <see cref="PublicShapeRuling.Withheld"/> name that no longer exists on the stored type is
    /// stale and would stop tripping, and a public field with no stored source and no
    /// <see cref="PublicShapeRuling.Derived"/> entry is a field nobody can explain.
    /// <c>Every_public_type_reaches_a_ruling</c> closes the last hole by walking the public
    /// document's own type graph, so a whole new nested record cannot arrive unruled either.
    /// </para>
    /// <para>
    /// <b>The four withholdings, and why each one.</b>
    /// </para>
    /// <list type="bullet">
    /// <item><description>
    /// <c>ReportBenchmarkComparison.CompanyId</c> -- the <b>tenant GUID</b>, and the reason this
    /// list exists. Replaced by <see cref="PublicBenchmarkComparison.IsGlobal"/>, which is
    /// everything the page ever derived from it.
    /// </description></item>
    /// <item><description>
    /// <c>ReportAIInsightItem.AffectedSegments</c> -- a free list of segment names written by
    /// the insight generator, which passes through <b>none</b> of the aggregation that applies
    /// the anonymity floor. A department too small to keep its row in the table above can be
    /// named there beside a finding about it. <c>SharedReportSections.tsx</c> already refuses to
    /// render it for exactly that reason, and pins the refusal with a fixture -- but the server
    /// was still publishing it in the bytes, where refusing to render is no protection at all.
    /// The authenticated Insights page shows it and should: its reader is inside the tenant.
    /// </description></item>
    /// <item><description>
    /// <c>ReportSurveySection.SuppressedRespondentCount</c> and
    /// <c>ReportDemographicBreakdown.SuppressedRespondentCount</c> -- the withheld
    /// <em>headcount</em> behind the suppressed departments and groups. This is the number the
    /// segment floor exists to hide, and the authenticated product will not print it:
    /// <c>SegmentBreakdownPanel</c> reports how many groups were withheld and never how many
    /// people, "because printing it, or printing anything it can be recovered from by one
    /// subtraction, publishes the exact sub-threshold count the floor exists to hide". Neither
    /// the shared page nor the authenticated one renders it, and this is the most exposed
    /// surface in the product. The counts of withheld <em>groups</em> stay: they name nobody.
    /// </description></item>
    /// <item><description>
    /// <c>BenchmarkPriorPeriodDto.Id</c> -- the linked benchmark's own row id, which the page
    /// never reads (it prints <c>name</c> and the metric changes). <see cref="BenchmarkDetail"/>
    /// already withholds this same pointer from an authenticated caller who may not read the
    /// row, on the grounds that "returning the id while withholding the numbers still discloses
    /// that a benchmark with that id exists somewhere -- and hands a chain walk an id it can
    /// only be refused on". An anonymous caller is further outside that boundary, not closer to
    /// it.
    /// </description></item>
    /// </list>
    /// <para>
    /// <b>What is published but never rendered, and why it stays.</b> The client's parser
    /// (<c>reportDocument.ts</c>) declares every field below, and a handful of them --
    /// <c>status</c>, <c>order</c>, <c>median</c>, the scale bounds and anchors, an insight's
    /// <c>type</c>/<c>category</c>/<c>priority</c>/<c>isAcknowledged</c>, most of the
    /// participation counters -- reach the browser without being drawn on the page. Each is an
    /// aggregate or a classification the platform itself authored, carries no identifier and no
    /// sub-floor figure, and a report reader is entitled to reconcile the numbers that ARE
    /// drawn against them. They are listed here so the next reader knows the omission from this
    /// paragraph is deliberate rather than an oversight.
    /// </para>
    /// </remarks>
    public static IReadOnlyList<PublicShapeRuling> ShapeRulings { get; } =
    [
        // `Comparison` is withheld, not published -- see StoredSectionsRuledOn for the
        // reasoning and for the three-part change that would reverse it. Named here so the
        // field-level tripwire stops firing on a decision that HAS been made, rather than
        // going quiet on one that has not.
        new(
            typeof(ReportOutputDocument),
            typeof(PublicReportDocument),
            Withhold(nameof(ReportOutputDocument.Comparison)),
            Nothing),
        new(
            typeof(ReportSurveySection),
            typeof(PublicSurveySection),
            Withhold(nameof(ReportSurveySection.SuppressedRespondentCount)),
            Nothing),
        new(typeof(SurveyResultsSummary), typeof(PublicSurveyParticipation), Nothing, Nothing),
        new(typeof(SurveyLanguageCount), typeof(PublicLanguageCount), Nothing, Nothing),
        new(typeof(SurveyQuestionResult), typeof(PublicQuestionResult), Nothing, Nothing),
        new(typeof(SurveyDistributionBucket), typeof(PublicDistributionBucket), Nothing, Nothing),
        new(typeof(SurveyWordFrequency), typeof(PublicWordFrequency), Nothing, Nothing),
        new(typeof(SurveyDimensionResult), typeof(PublicDimensionResult), Nothing, Nothing),
        new(typeof(ReportDepartmentParticipation), typeof(PublicDepartmentParticipation), Nothing, Nothing),
        new(
            typeof(ReportDemographicBreakdown),
            typeof(PublicDemographicBreakdown),
            Withhold(nameof(ReportDemographicBreakdown.SuppressedRespondentCount)),
            Nothing),
        new(typeof(ReportSegmentParticipation), typeof(PublicSegmentParticipation), Nothing, Nothing),
        new(typeof(ReportSegmentDimensionScore), typeof(PublicSegmentDimensionScore), Nothing, Nothing),
        new(
            typeof(ReportAIInsightItem),
            typeof(PublicAiInsight),
            Withhold(nameof(ReportAIInsightItem.AffectedSegments)),
            Nothing),
        new(
            typeof(ReportBenchmarkComparison),
            typeof(PublicBenchmarkComparison),
            Withhold(nameof(ReportBenchmarkComparison.CompanyId)),
            Withhold(nameof(PublicBenchmarkComparison.IsGlobal))),
        new(typeof(BenchmarkMetricDto), typeof(PublicBenchmarkMetric), Nothing, Nothing),
        new(
            typeof(BenchmarkPriorPeriodDto),
            typeof(PublicBenchmarkPriorPeriod),
            Withhold(nameof(BenchmarkPriorPeriodDto.Id)),
            Nothing),
        new(typeof(BenchmarkMetricChangeDto), typeof(PublicBenchmarkMetricChange), Nothing, Nothing),
    ];

    private static IReadOnlySet<string> Withhold(params string[] names)
        => new HashSet<string>(names, StringComparer.Ordinal);

    /// <summary>
    /// The stored document as JSON, projected to the public document as JSON.
    /// </summary>
    /// <remarks>
    /// <para>
    /// String in, string out, because <c>reports.report_output</c> is <c>jsonb</c> and
    /// <see cref="SharedReportResponse.ReportOutput"/> is a JSON <em>string</em> the browser
    /// parses a second time -- the shape <c>sharedReports.ts</c> has always read.
    /// <see cref="JsonSerializerOptions.Web"/> on both sides, so the camelCase the generator
    /// wrote is the camelCase that comes back out.
    /// </para>
    /// <para>
    /// Null in, null out; <b>unparseable in, null out</b>. A document this code cannot read is
    /// a document it cannot vouch for, and forwarding it would be the verbatim behaviour this
    /// class exists to end. The caller's status code does not change -- a share link that
    /// resolves still answers 200 with a null <c>reportOutput</c>, which is the same answer a
    /// report generated before the generator ever wrote a document gives.
    /// </para>
    /// </remarks>
    public static string? ToPublicJson(string? storedDocument)
    {
        if (string.IsNullOrWhiteSpace(storedDocument))
        {
            return null;
        }

        ReportOutputDocument? stored;
        try
        {
            stored = JsonSerializer.Deserialize<ReportOutputDocument>(storedDocument, JsonSerializerOptions.Web);
        }
        catch (JsonException)
        {
            return null;
        }

        return stored is null
            ? null
            : JsonSerializer.Serialize(ToPublic(stored), JsonSerializerOptions.Web);
    }

    /// <summary>
    /// The allow-list itself: one line per section of the stored document that an anonymous
    /// reader may have, and nothing for the sections they may not.
    /// </summary>
    /// <remarks>
    /// Every list is null-guarded because a stored document is JSON that some other version of
    /// this application wrote: <c>System.Text.Json</c> fills a missing property with null even
    /// where the record declares it non-nullable, and a public endpoint is the wrong place to
    /// find that out.
    /// </remarks>
    public static PublicReportDocument ToPublic(ReportOutputDocument stored)
    {
        ArgumentNullException.ThrowIfNull(stored);

        return new PublicReportDocument(
            stored.GenerationNote ?? string.Empty,
            Map(stored.Surveys, ToPublicSection),
            Map(stored.AiInsights, ToPublicInsight),
            Map(stored.Benchmarks, ToPublicBenchmark));
    }

    private static IReadOnlyList<TPublic> Map<TStored, TPublic>(
        IReadOnlyList<TStored>? stored,
        Func<TStored, TPublic> project)
        => stored is null ? [] : stored.Select(project).ToList();

    /// <summary>One survey section, field by field, with the only respondent-written content removed.</summary>
    private static PublicSurveySection ToPublicSection(ReportSurveySection section) => new(
        section.SurveyId,
        section.Title,
        section.Status ?? string.Empty,
        section.ResolvedLocale ?? string.Empty,
        ToPublicParticipation(section.Participation),
        Map(section.Questions, WithoutWords),
        Map(section.Dimensions, d => new PublicDimensionResult(d.Dimension ?? string.Empty, d.QuestionCount, d.AnsweredCount, d.AverageScore)),
        Map(section.Departments, d => new PublicDepartmentParticipation(d.DepartmentId ?? string.Empty, d.Name, d.RespondentCount, d.ParticipationRate, d.IsSuppressed)),
        section.SuppressedDepartmentCount,
        section.UnsegmentedRespondentCount,
        Map(section.Demographics, ToPublicBreakdown),
        section.IsSuppressed,
        section.SuppressionReason,
        section.MinimumGroupSize);

    private static PublicSurveyParticipation ToPublicParticipation(SurveyResultsSummary? participation)
        => participation is null
            ? new PublicSurveyParticipation(null, 0, 0, 0, null, 0, null, null, null, [])
            : new PublicSurveyParticipation(
                participation.InvitedCount,
                participation.ResponseCount,
                participation.CompletedCount,
                participation.PartialCount,
                participation.ParticipationRate,
                participation.CompletionRate,
                participation.AverageCompletionSeconds,
                participation.FirstResponseAt,
                participation.LastResponseAt,
                Map(participation.ByLanguage, l => new PublicLanguageCount(l.Language ?? string.Empty, l.Count)));

    private static PublicDemographicBreakdown ToPublicBreakdown(ReportDemographicBreakdown breakdown) => new(
        breakdown.Dimension ?? string.Empty,
        Map(breakdown.Segments, segment => new PublicSegmentParticipation(
            segment.Key ?? string.Empty,
            segment.Label,
            segment.RespondentCount,
            segment.IsSuppressed,
            Map(segment.Dimensions, score => new PublicSegmentDimensionScore(score.Dimension ?? string.Empty, score.AverageScore)))),
        breakdown.SuppressedSegmentCount,
        breakdown.UnsegmentedRespondentCount);

    private static PublicAiInsight ToPublicInsight(ReportAIInsightItem insight) => new(
        insight.Id,
        insight.Type ?? string.Empty,
        insight.Category ?? string.Empty,
        insight.Title ?? string.Empty,
        insight.Description ?? string.Empty,
        insight.ConfidenceScore,
        insight.Priority ?? string.Empty,
        insight.RecommendedActions ?? [],
        insight.IsAcknowledged);

    /// <summary>
    /// One benchmark comparison, with the tenant GUID answered rather than published.
    /// </summary>
    /// <remarks>
    /// <c>IsGlobal</c> is <c>CompanyId is null</c> and nothing else, which is the same test
    /// <c>SharedReportSections.tsx</c> ran on the id itself -- so the "Global" chip appears on
    /// exactly the rows it appeared on before, including for a document so old or so damaged
    /// that it carries no <c>companyId</c> key at all (absent deserialises to null, and null
    /// read as global is the behaviour that shipped).
    /// </remarks>
    private static PublicBenchmarkComparison ToPublicBenchmark(ReportBenchmarkComparison benchmark) => new(
        benchmark.BenchmarkId,
        benchmark.Name ?? string.Empty,
        benchmark.Category ?? string.Empty,
        benchmark.Type ?? string.Empty,
        benchmark.CompanyId is null,
        benchmark.PriorPeriodStatus ?? string.Empty,
        Map(benchmark.Metrics, m => new PublicBenchmarkMetric(m.Id, m.MetricName ?? string.Empty, m.Value, m.Unit ?? string.Empty, m.Percentile, m.SampleSize)),
        benchmark.PriorPeriod is null
            ? null
            : new PublicBenchmarkPriorPeriod(
                benchmark.PriorPeriod.Name ?? string.Empty,
                Map(benchmark.PriorPeriod.Metrics, c => new PublicBenchmarkMetricChange(
                    c.MetricName ?? string.Empty, c.Value, c.Unit, c.PriorValue, c.PriorUnit, c.Delta, c.ChangeRatio))));

    /// <summary>
    /// One question's results with <see cref="SurveyQuestionResult.Words"/> emptied and the
    /// withheld total told to the reader instead.
    /// </summary>
    /// <remarks>
    /// <para>
    /// <b>Why words and only words.</b> A word frequency is the one thing in this document a
    /// respondent <em>wrote</em>; every other field is a number the platform computed. The two
    /// floors this platform runs both miss the case: the segment floor of
    /// <see cref="SurveyResultsPrivacy.MinimumSegmentRespondents"/> governs segments and does
    /// not govern words, and the word floor of
    /// <see cref="SurveyResultsPrivacy.MinimumWordRespondents"/> counts distinct responses and
    /// does not know which segment they came from -- so a phrase written by all three members
    /// of a department that is suppressed everywhere else in the same document clears the word
    /// floor and prints. That is survivable on an authenticated results page, where the reader
    /// is a named administrator of that tenant. It is not survivable on a URL.
    /// </para>
    /// <para>
    /// <see cref="SurveyQuestionResult.Distribution"/> stays, and is a different thing
    /// entirely: option counts keyed by the stable option value, which
    /// <see cref="SurveyResultsPrivacy"/> deliberately does not suppress even to a bucket of
    /// one, because a bucket over a population that already passed the survey floor says
    /// nothing about <em>which</em> respondent.
    /// </para>
    /// <para>
    /// <b>Why the count is set rather than zeroed.</b> This codebase's rule is that withheld
    /// counts are always reported (see <see cref="SurveyResultsPrivacy"/>), so a reader can
    /// tell "nobody said anything" from "you are not being shown what they said". Zeroing
    /// <see cref="SurveyQuestionResult.SuppressedWordCount"/> would make the public page render
    /// its no-results line for an open question that thirty people answered -- "absent" where
    /// the truth is "withheld", which are different statements. <c>SharedReportSections.tsx</c>
    /// renders its word block when <c>words.length &gt; 0 || suppressedWordCount &gt; 0</c>, so
    /// a non-zero count is what makes it say so at all.
    /// </para>
    /// <para>
    /// The number is <c>SuppressedWordCount + Words.Count</c>: the words the aggregation had
    /// already withheld under the word floor, plus the ones withheld here. It is a count of the
    /// word entries the stored document carried, every one of which this reader is not shown --
    /// not a claim about the full vocabulary of the answers, which the stored document does not
    /// know either (<see cref="SurveyAggregation.MaxWordsPerLanguage"/> caps what it keeps).
    /// A question nobody answered has neither, so it stays 0 and the page correctly says there
    /// is nothing rather than that something is being held back.
    /// </para>
    /// </remarks>
    private static PublicQuestionResult WithoutWords(SurveyQuestionResult question) => new(
        question.QuestionId,
        question.Order,
        question.Type ?? string.Empty,
        question.Text,
        question.Category,
        question.AnsweredCount,
        Map(question.Distribution, b => new PublicDistributionBucket(b.Value ?? string.Empty, b.Label, b.Count, b.Percentage, b.AverageRank)),
        question.Average,
        question.Median,
        question.ScaleMin,
        question.ScaleMax,
        question.ScaleLabelMin,
        question.ScaleLabelMax,
        [],
        question.SuppressedWordCount + (question.Words?.Count ?? 0));
}
