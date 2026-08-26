using ClimateProject.Application.Questions;
using Microsoft.EntityFrameworkCore;

namespace ClimateProject.Infrastructure.Persistence;

/// <summary>
/// Usage and effectiveness for bank items (#110), DERIVED from the response tables rather
/// than accumulated into a counter.
/// </summary>
/// <remarks>
/// <para>
/// <b>This is the whole answer to "usage/effectiveness updates must not contend under
/// concurrent survey submission".</b> The alternative -- and what the legacy surface did --
/// is to bump <c>usage_count</c> / <c>response_rate</c> on the bank row every time somebody
/// answers. That makes one row per POPULAR question the hottest row in the database:
/// a question in a survey sent to four thousand people is four thousand updates to a single
/// tuple, every one of them taking a row lock the next writer waits on, and every one of
/// them inside the submission transaction, so respondents queue behind each other for a
/// statistic nobody reads in real time. The fix is not a cleverer lock. It is to not write.
/// </para>
/// <para>
/// So the write path here is EMPTY: nothing in <c>SurveyResponseEndpoints</c> touches
/// <c>question_bank_items</c>, and there is no code path anywhere that a respondent can
/// reach which does. The numbers are computed on demand from <c>questions</c>,
/// <c>responses</c> and <c>question_responses</c> -- three set-based reads, no locks, and
/// correct by construction rather than correct-if-every-increment-landed. A counter can
/// drift (a rolled-back transaction, a re-run import, a deleted survey); a COUNT cannot.
/// </para>
/// <para>
/// The stored <c>usage_count</c>/<c>response_rate</c>/<c>last_used_at</c> columns remain,
/// and one route writes them: <c>POST /admin/question-bank/effectiveness-measurement</c>,
/// which is an admin action over an admin-sized batch. They are a published SNAPSHOT for
/// consumers that read the table directly (exports, and #111 when the AI work lands), never
/// the source of truth -- every read route below reports the derived value, so a stale
/// snapshot cannot be served as a live number.
/// </para>
/// <para>
/// <b>Provenance is the join.</b> <c>questions.source_question_bank_item_id</c> is what
/// makes any of this computable, exactly as <c>source_library_item_id</c> was meant to for
/// the library. Instantiation is a COPY -- an answer belongs to the question as it was
/// ASKED -- so the column records where a copy came from without making the copy depend on
/// the source, which is also why retiring a source cannot disturb a stored answer.
/// </para>
/// </remarks>
public static class QuestionBankMetrics
{
    /// <summary>
    /// Metrics for every requested item, including items nothing has ever used (which come
    /// back as zeroes rather than missing -- an author comparing candidates needs to see
    /// that a question has never been asked, and an absent key reads as an error).
    /// </summary>
    public static async Task<Dictionary<Guid, QuestionBankMetricsDto>> ComputeAsync(
        ClimateProjectDbContext db,
        IReadOnlyCollection<Guid> itemIds,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(db);
        ArgumentNullException.ThrowIfNull(itemIds);

        var result = itemIds.ToDictionary(id => id, Empty);
        if (itemIds.Count == 0)
        {
            return result;
        }

        var ids = itemIds.ToList();

        // Every copy of every requested item, with the survey it was copied into.
        var copies = await db.Questions
            .Where(q => q.SourceQuestionBankItemId != null && ids.Contains(q.SourceQuestionBankItemId.Value))
            .Join(db.Surveys, q => q.SurveyId, s => s.Id, (q, s) => new QuestionCopy(
                q.SourceQuestionBankItemId!.Value, q.Id, q.SurveyId, s.CreatedAt))
            .ToListAsync(cancellationToken);

        if (copies.Count == 0)
        {
            return result;
        }

        var questionIds = copies.Select(c => c.QuestionId).Distinct().ToList();
        var surveyIds = copies.Select(c => c.SurveyId).Distinct().ToList();

        // The denominator: completed responses per survey. Completed only, and the
        // numerator below is restricted to the same population -- mixing a partial-inclusive
        // numerator with a completed-only denominator is how a response rate comes back
        // above 100%.
        var askedBySurvey = await db.Responses
            .Where(r => surveyIds.Contains(r.SurveyId) && r.IsComplete)
            .GroupBy(r => r.SurveyId)
            .Select(g => new { SurveyId = g.Key, Count = g.Count() })
            .ToDictionaryAsync(x => x.SurveyId, x => x.Count, cancellationToken);

        var answeredByQuestion = await db.QuestionResponses
            .Where(qr => questionIds.Contains(qr.QuestionId))
            .Join(db.Responses, qr => qr.ResponseId, r => r.Id, (qr, r) => new { qr.QuestionId, qr.TimeSpentSeconds, r.IsComplete })
            .Where(x => x.IsComplete)
            .GroupBy(x => x.QuestionId)
            .Select(g => new
            {
                QuestionId = g.Key,
                Answered = g.Count(),
                TimeTotal = g.Sum(x => (long?)x.TimeSpentSeconds),
                TimeCount = g.Count(x => x.TimeSpentSeconds != null),
            })
            .ToDictionaryAsync(x => x.QuestionId, x => x, cancellationToken);

        foreach (var group in copies.GroupBy(c => c.QuestionBankItemId))
        {
            var asked = 0;
            var answered = 0;
            long timeTotal = 0;
            var timeCount = 0;

            foreach (var copy in group)
            {
                // Per COPY, not per survey: an item picked twice into one survey really was
                // asked twice, and collapsing to the survey would under-count it.
                asked += askedBySurvey.TryGetValue(copy.SurveyId, out var surveyAsked) ? surveyAsked : 0;

                if (!answeredByQuestion.TryGetValue(copy.QuestionId, out var stats))
                {
                    continue;
                }

                answered += stats.Answered;
                timeTotal += stats.TimeTotal ?? 0;
                timeCount += stats.TimeCount;
            }

            var rate = asked == 0 ? 0d : Math.Round(answered * 100d / asked, 2);

            result[group.Key] = new QuestionBankMetricsDto(
                QuestionBankItemId: group.Key,
                SurveysUsedIn: group.Select(c => c.SurveyId).Distinct().Count(),
                QuestionsCreated: group.Count(),
                TimesAsked: asked,
                TimesAnswered: answered,
                ResponseRate: rate,
                // Derived from the rate rather than counted separately, so the two can never
                // disagree by a rounding step.
                SkipRate: asked == 0 ? 0d : Math.Round(100d - rate, 2),
                AverageTimeSpentSeconds: timeCount == 0 ? null : Math.Round((double)timeTotal / timeCount, 2),
                LastUsedAt: group.Max(c => c.SurveyCreatedAt));
        }

        return result;
    }

    public static QuestionBankMetricsDto Empty(Guid itemId)
        => new(itemId, 0, 0, 0, 0, 0d, 0d, null, null);

    private sealed record QuestionCopy(Guid QuestionBankItemId, Guid QuestionId, Guid SurveyId, DateTimeOffset SurveyCreatedAt);
}
