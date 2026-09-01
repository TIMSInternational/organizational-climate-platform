using System.Text.Json;
using ClimateProject.Application.Surveys;

namespace ClimateProject.Application.Reports;

/// <summary>
/// The report document as an <b>anonymous</b> holder of a share link is allowed to read it.
///
/// <para>
/// ## Read this before you add a section to <see cref="ReportOutputDocument"/>
/// </para>
/// <para>
/// <b>This record is an allow-list, and it is the only thing that decides what
/// <c>GET /shared/reports/{token}</c> publishes to the whole internet.</b> A section you add
/// to <see cref="ReportOutputDocument"/> is <b>private</b> -- it reaches the authenticated
/// report routes and stops here -- until somebody names it on this record <em>and</em> in
/// <see cref="PublicReportProjection.ToPublic"/> on purpose. Adding a section to the stored
/// document is a reporting decision; publishing one is a privacy decision, and they are not
/// the same decision.
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
    IReadOnlyList<ReportSurveySection> Surveys,
    IReadOnlyList<ReportAIInsightItem> AiInsights,
    IReadOnlyList<ReportBenchmarkComparison> Benchmarks);

/// <summary>
/// Builds the <see cref="PublicReportDocument"/> that <c>GET /shared/reports/{token}</c>
/// returns, from the document <c>ReportGeneration</c> stored.
/// </summary>
public static class PublicReportProjection
{
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
    };

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
            stored.Surveys is null ? [] : stored.Surveys.Select(ToPublicSection).ToList(),
            stored.AiInsights ?? [],
            stored.Benchmarks ?? []);
    }

    /// <summary>One survey section, with the only respondent-written content in it removed.</summary>
    private static ReportSurveySection ToPublicSection(ReportSurveySection section) => section with
    {
        Questions = section.Questions is null ? [] : section.Questions.Select(WithoutWords).ToList(),
    };

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
    private static SurveyQuestionResult WithoutWords(SurveyQuestionResult question) => question with
    {
        Words = [],
        SuppressedWordCount = question.SuppressedWordCount + (question.Words?.Count ?? 0),
    };
}
