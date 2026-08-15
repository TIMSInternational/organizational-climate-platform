using ClimateProject.Application.Localization;
using ClimateProject.Application.Surveys;
using ClimateProject.Domain.Entities;
using ClimateProject.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace ClimateProject.Api.Endpoints;

/// <summary>
/// Loads one survey's rows and projects them into <see cref="SurveyAggregation.Compute"/>'s
/// inputs -- the query half of the boundary settled with #88.
///
/// Extracted from <see cref="SurveyResultsEndpoints"/> so that report generation
/// (<see cref="ReportEndpoints"/>) runs the SAME queries feeding the SAME aggregation as
/// the results screens, rather than a second projection that drifts from this one row
/// shape by row shape. The aggregation itself stays pure in Application; what this class
/// owns is faithfully getting rows to it -- including the rule that answer and
/// demographic payloads are passed through as raw jsonb, because
/// <c>SurveyAggregation</c> owns the encoding and a second decoder here is how the two
/// surfaces would drift.
///
/// Cost: streams every answer of every completed response -- O(completed responses x
/// answered questions) narrow rows. Fine for a page load or a report generation; not a
/// poll path. The poll endpoint (<c>/real-time-stats</c>) deliberately does not use this.
/// </summary>
internal static class SurveyAggregateLoader
{
    /// <summary>
    /// Loads and aggregates <paramref name="survey"/>.
    /// </summary>
    /// <param name="locale">The locale question text and option labels are resolved for.</param>
    /// <param name="fallbackFields">Collects the fields that fell back to the other locale, exactly as the results routes report them.</param>
    public static async Task<SurveyAggregate> ComputeAsync(
        ClimateProjectDbContext db,
        Survey survey,
        string locale,
        List<string> fallbackFields,
        CancellationToken cancellationToken)
    {
        var questions = await db.Questions
            .AsNoTracking()
            .Where(q => q.SurveyId == survey.Id)
            .OrderBy(q => q.Order)
            .ToListAsync(cancellationToken);

        var optionsByQuestion = await SurveyContent.LoadOptionsAsync(
            db, questions.Select(q => q.Id).ToList(), cancellationToken);

        var aggregationQuestions = questions.Select(question =>
        {
            var path = $"questions[{question.Order}]";
            optionsByQuestion.TryGetValue(question.Id, out var options);
            return new AggregationQuestion(
                question.Id,
                question.Order,
                question.Type,
                SurveyContent.Resolve(question.TextEn, question.TextEs, locale, survey.Language, $"{path}.text", fallbackFields),
                question.Category,
                question.ScaleMin,
                question.ScaleMax,
                ToAggregationOptions(options, locale, survey.Language, path, fallbackFields));
        }).ToList();

        var responseRows = await db.Responses
            .AsNoTracking()
            .Where(r => r.SurveyId == survey.Id)
            .Select(r => new
            {
                r.Id,
                r.Language,
                r.DepartmentId,
                r.IsComplete,
                r.StartTime,
                r.CompletionTime,
                r.TotalTimeSeconds,
            })
            .ToListAsync(cancellationToken);

        // Answers and demographics of COMPLETED responses only. The aggregation ignores
        // anything else anyway; filtering here keeps the rows off the wire.
        var answerRows = await db.QuestionResponses
            .AsNoTracking()
            .Where(qr => db.Responses.Any(r => r.Id == qr.ResponseId && r.SurveyId == survey.Id && r.IsComplete))
            .Select(qr => new { qr.ResponseId, qr.QuestionId, qr.ResponseValue, qr.ResponseText })
            .ToListAsync(cancellationToken);

        var demographicRows = await db.ResponseDemographics
            .AsNoTracking()
            .Where(rd => db.Responses.Any(r => r.Id == rd.ResponseId && r.SurveyId == survey.Id && r.IsComplete))
            .Select(rd => new { rd.ResponseId, rd.Field, rd.Value })
            .ToListAsync(cancellationToken);

        var demographicsByResponse = new Dictionary<Guid, Dictionary<string, string>>();
        foreach (var row in demographicRows)
        {
            // Passed through RAW. response_demographics.value is jsonb exactly like
            // response_value, so the stored payload is a JSON string rather than a bare
            // one -- but this layer deliberately does not decode it. SurveyAggregation
            // owns the encoding, and a second decoder here is how the two drift.
            var value = row.Value;
            if (string.IsNullOrWhiteSpace(value))
            {
                continue;
            }

            if (!demographicsByResponse.TryGetValue(row.ResponseId, out var map))
            {
                map = new Dictionary<string, string>(StringComparer.Ordinal);
                demographicsByResponse[row.ResponseId] = map;
            }

            map[row.Field] = value;
        }

        var empty = new Dictionary<string, string>(StringComparer.Ordinal);
        var aggregationResponses = responseRows
            .Select(r => new AggregationResponse(
                r.Id,
                r.Language,
                r.DepartmentId,
                r.IsComplete,
                r.StartTime,
                r.CompletionTime,
                r.TotalTimeSeconds,
                demographicsByResponse.TryGetValue(r.Id, out var demographics) ? demographics : empty))
            .ToList();

        var aggregationAnswers = answerRows
            .Select(a => new AggregationAnswer(a.ResponseId, a.QuestionId, a.ResponseValue, a.ResponseText))
            .ToList();

        var departments = await LoadDepartmentsAsync(db, survey.CompanyId, cancellationToken);

        return SurveyAggregation.Compute(
            aggregationQuestions,
            aggregationResponses,
            aggregationAnswers,
            departments,
            survey.TargetAudienceCount);
    }

    private static List<AggregationOption> ToAggregationOptions(
        List<QuestionOption>? options,
        string locale,
        string contentLanguage,
        string fieldPathPrefix,
        List<string> fallbackFields)
    {
        if (options is null || options.Count == 0)
        {
            return [];
        }

        var mapped = new List<AggregationOption>(options.Count);
        foreach (var option in options)
        {
            var label = LocalizedContent.Resolve(option.LabelEn, option.LabelEs, locale, contentLanguage);
            if (label.IsFallback)
            {
                fallbackFields.Add($"{fieldPathPrefix}.options[{option.Order}].label");
            }

            // Value carries the stable key the distribution groups on; Label is display
            // only and is attached after grouping.
            mapped.Add(new AggregationOption(option.Order, option.Value, label.Text));
        }

        return mapped;
    }

    public static async Task<List<AggregationDepartment>> LoadDepartmentsAsync(
        ClimateProjectDbContext db,
        Guid companyId,
        CancellationToken cancellationToken)
    {
        var departments = await db.Departments
            .AsNoTracking()
            .Where(d => d.CompanyId == companyId)
            .Select(d => new { d.Id, d.Name })
            .ToListAsync(cancellationToken);

        // One grouped statement rather than a count per department, so the work here does
        // not grow with the org chart. The population is `DepartmentHeadcount.Population`
        // and not a predicate written out again: this count is the DENOMINATOR of
        // per-department participation, the Departments page prints the same number as
        // EMPLOYEES ASSIGNED, and a hand-written copy here is exactly how the two came to
        // disagree about deactivated members. (This landed as a merge resolution: #320
        // extracted this method from SurveyResultsEndpoints before #323 fixed the
        // predicate there, so the extraction had preserved the very copy #323 removed.)
        var headcounts = await DepartmentHeadcount
            .Population(db.Users.AsNoTracking(), companyId)
            .GroupBy(u => u.DepartmentId)
            .Select(g => new { DepartmentId = g.Key, Count = g.Count() })
            .ToListAsync(cancellationToken);

        var headcountById = headcounts
            .Where(h => h.DepartmentId is not null)
            .ToDictionary(h => h.DepartmentId!.Value, h => h.Count);

        return departments
            .Select(d => new AggregationDepartment(d.Id, d.Name, headcountById.GetValueOrDefault(d.Id)))
            .ToList();
    }
}
