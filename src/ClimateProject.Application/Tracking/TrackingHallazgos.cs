using ClimateProject.Application.Questions;
using ClimateProject.Application.Surveys;

namespace ClimateProject.Application.Tracking;

/// <summary>
/// Turns one survey's aggregate into the findings climate-tracking calls *hallazgos*.
///
/// **The mapping, in one sentence: a hallazgo is one (department x dimension) score of
/// one closed survey.** That is exactly the cell
/// <see cref="SurveyAggregation.SegmentDimensionScores"/> already produces for the
/// leader dashboard and the climate-over-time matrix, and this is its fourth caller
/// rather than a fourth derivation -- two derivations of one number is how a report and
/// a dashboard come to disagree in front of a client.
///
/// **Pure, and in Application, for the usual reason.** Everything interesting here --
/// the anonymity ruling, the id derivation, the scale normalisation -- is provable in a
/// unit test with no Docker. The endpoint's remaining job is to load the aggregate and
/// the departments.
///
/// **Closed surveys only, decided by the caller.** An open survey's scores move under
/// the reader between two loads, so a plan de accion written against one would be a
/// commitment to a number that had already changed. The same argument the leader
/// dashboard's team-climate panel makes, one service further out.
/// </summary>
public static class TrackingHallazgos
{
    /// <summary>
    /// Every finding of <paramref name="surveyId"/>, one per (department that answered) x
    /// (dimension the instrument asked about).
    /// </summary>
    /// <param name="aggregate">The survey's aggregate, from the one shared aggregation.</param>
    /// <param name="nodoIdByDepartmentId">
    /// <c>TrackingIdentifiers.ExternalNodoId</c> for each department of the owning company,
    /// so a hallazgo's <c>nodo_id</c> always joins to a nodo_id present in the
    /// <c>/api/internal/nodos</c> response for the same company.
    /// </param>
    public static IReadOnlyList<HallazgoInternalDto> ForSurvey(
        Guid surveyId,
        SurveyAggregate aggregate,
        IReadOnlyDictionary<Guid, string> nodoIdByDepartmentId)
    {
        ArgumentNullException.ThrowIfNull(aggregate);
        ArgumentNullException.ThrowIfNull(nodoIdByDepartmentId);

        // A survey below its OWN floor publishes nothing per-question, so it has neither
        // scores nor even a dimension list to name them with -- there is no finding to
        // report, not a withheld one. (SurveyAggregate.IsSuppressed empties Questions,
        // Dimensions and Breakdowns alike.)
        if (aggregate.IsSuppressed)
        {
            return [];
        }

        var dimensions = aggregate.Dimensions
            .Select(d => d.Dimension)
            .OrderBy(d => d, StringComparer.Ordinal)
            .ToList();

        if (dimensions.Count == 0)
        {
            return [];
        }

        var boundsByDimension = dimensions.ToDictionary(
            d => d,
            d => ScaleBounds(aggregate.Questions, d),
            StringComparer.Ordinal);

        var segments = aggregate.Breakdowns
            .FirstOrDefault(b => string.Equals(b.Dimension, SurveyClimateTrends.DepartmentGroup, StringComparison.Ordinal))
            ?.Segments ?? [];

        var hallazgos = new List<HallazgoInternalDto>();

        foreach (var segment in segments)
        {
            // The department breakdown keys segments on the department GUID. A key that
            // does not parse, or names a department outside the company we loaded, cannot
            // be given a nodo_id -- and a hallazgo whose nodo_id is absent from /nodos is
            // an unattachable finding, so it is dropped rather than invented.
            if (!Guid.TryParse(segment.Key, out var departmentId)
                || !nodoIdByDepartmentId.TryGetValue(departmentId, out var nodoId))
            {
                continue;
            }

            // THE ANONYMITY RULING (settled 2026-08-27, mirroring the leader climate view).
            //
            // A department below SurveyResultsPrivacy.MinimumSegmentRespondents still gets
            // its hallazgos -- with resultado_pct null. The finding must EXIST so a small
            // team can still be given an action plan; the number must never be published.
            // Emitting nothing would be the other failure: a five-person team would be
            // invisible in the tracking module, which reads as "nothing to work on" rather
            // than as "withheld".
            //
            // THE FLOOR IS THIS MODULE'S OWN SINCE 2026-10-15, and that is the whole point
            // of the next two lines.
            //
            // It used to read `segment.IsSuppressed` alone and inherit whatever the climate
            // aggregation had already applied. Then the 2026-10-15 ruling took the climate
            // product's single-dimension floor to 1, so nothing arrives suppressed any more and
            // inheriting it would have published a one-person department's score here --
            // silently, in a different client's module, under a ruling that was not about it.
            // Decided 2026-10-15: tracking keeps SurveyResultsPrivacy.MinimumSegmentRespondents
            // and the 2026-08-27 ruling above stands unchanged.
            //
            // `IsSuppressed` is still honoured beside the count, because a segment suppressed
            // for any other reason carries no questions at all and SegmentDimensionScores would
            // return an empty dictionary -- every dimension would then silently vanish from the
            // response instead of appearing with a null score, which is the failure the ruling
            // above exists to prevent.
            var scores = !segment.IsSuppressed
                    && SurveyResultsPrivacy.MeetsSegmentFloor(segment.RespondentCount)
                ? SurveyAggregation.SegmentDimensionScores(aggregate.Questions, segment)
                : new Dictionary<string, double?>(StringComparer.Ordinal);

            foreach (var dimension in dimensions)
            {
                decimal? resultado = scores.TryGetValue(dimension, out var score) && score is not null
                    ? AsFraction(score.Value, boundsByDimension[dimension])
                    : null;

                hallazgos.Add(new HallazgoInternalDto(
                    HallazgoId: TrackingIdentifiers.ExternalHallazgoId(surveyId, departmentId, dimension),
                    NodoId: nodoId,
                    Categoria: dimension,
                    ResultadoPct: resultado,
                    // v1 ships both null on purpose. A sector benchmark needs a benchmark
                    // source this platform does not have, and a prior-year figure needs a
                    // rule for which earlier survey counts as "the same instrument, a year
                    // ago" -- neither is a number this endpoint may guess at, and a guessed
                    // benchmark is one a client would plan against. Both are nullable in
                    // the contract precisely so v1 can decline them.
                    BenchmarkSectorPct: null,
                    ResultadoAnioAnteriorPct: null,
                    CicloId: surveyId.ToString()));
            }
        }

        return hallazgos;
    }

    /// <summary>
    /// The dimension's score as a fraction of its scale, which is what <c>resultado_pct</c>
    /// means: climate-tracking stores these in <c>numeric(5,4)</c> beside
    /// <c>PorcentajeAvance</c>, whose export column is literally named
    /// <c>FraccionAvance</c>, and the name it shares with <c>benchmark_sector_pct</c>
    /// settles the unit. Shipping the raw scale mean -- a 3.87 on a 1-5 Likert -- into a
    /// field called "pct" would be a number that reads as correct and is off by a factor
    /// nobody could see.
    ///
    /// Null when the dimension has no single scale to normalise against: no numeric-scale
    /// question in it at all (a category of multiple-choice questions is a real dimension
    /// with no score), or two questions configured with different bounds, where the pooled
    /// mean is already a mixture and no one normalisation is honest. Null rather than a
    /// best guess, for the same reason the two benchmark fields are null.
    ///
    /// Clamped to [0,1] and rounded to the 4 decimals the consumer's column holds.
    /// </summary>
    private static decimal? AsFraction(double score, (int Min, int Max)? bounds)
    {
        if (bounds is not { } scale || scale.Max <= scale.Min)
        {
            return null;
        }

        var fraction = (score - scale.Min) / (scale.Max - scale.Min);

        return Math.Round((decimal)Math.Clamp(fraction, 0d, 1d), 4, MidpointRounding.AwayFromZero);
    }

    /// <summary>
    /// The one scale every numeric question in <paramref name="dimension"/> is answered on,
    /// or null when there is not exactly one. Bounds come from the question's own columns,
    /// falling back to <see cref="SurveyAnswerValidation.DefaultScaleMin"/> /
    /// <see cref="SurveyAnswerValidation.DefaultScaleMax"/> -- the same defaults the
    /// validator applied when the answer was accepted, so the range used to score an answer
    /// is the range used to normalise it.
    /// </summary>
    private static (int Min, int Max)? ScaleBounds(IReadOnlyList<SurveyQuestionResult> questions, string dimension)
    {
        var scales = questions
            .Where(q => string.Equals(q.Category, dimension, StringComparison.Ordinal)
                        && QuestionTypes.NumericScale.Contains(q.Type, StringComparer.Ordinal))
            .Select(q => (
                Min: q.ScaleMin ?? SurveyAnswerValidation.DefaultScaleMin,
                Max: q.ScaleMax ?? SurveyAnswerValidation.DefaultScaleMax))
            .Distinct()
            .ToList();

        return scales.Count == 1 ? scales[0] : null;
    }
}
