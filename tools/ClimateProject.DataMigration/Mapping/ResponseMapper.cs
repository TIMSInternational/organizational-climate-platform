using System.Globalization;
using ClimateProject.Application.Surveys;
using ClimateProject.DataMigration.Legacy;
using ClimateProject.DataMigration.Reporting;
using ClimateProject.Domain.Entities;
using MongoDB.Bson;

namespace ClimateProject.DataMigration.Mapping;

/// <summary>A mapped response and its answer/demographic fan-out.</summary>
public sealed record MappedResponse(
    Response Response,
    IReadOnlyList<QuestionResponse> Answers,
    IReadOnlyList<ResponseDemographic> Demographics);

/// <summary>
/// The volume driver (design doc load-order row 9), sequenced after the survey slice
/// on purpose: the 2026-08-04 addendum forbids loading answers before question
/// options exist, because <c>question_responses.response_value</c> must hold the
/// option's stable value. Slice 2 made that value the legacy option text verbatim
/// (trimmed, truncated by the same named rule), so a legacy answer string IS the
/// stable value after the identical transform - and every payload is encoded through
/// <see cref="SurveyResponseValues"/>, the app's one encoding for the jsonb column.
///
/// Question identity: an answer carries the survey-scoped question id string, and its
/// target Guid is re-derived via <see cref="MigrationIds.ForChild"/> from
/// (survey <c>_id</c>, that string) - the contract slice 2's pinned vectors fixed.
/// A derivation that lands outside the migrated question set (the survey mapper
/// dropped or never saw that question) is reported and NOT written:
/// <c>question_id</c> is a Restrict FK and a miss would abort the batch.
///
/// <c>Response.Language</c> (#195) records the locale the respondent was served;
/// legacy recorded nothing, so it is attributed by Company.language and reported per
/// response, like every other attribution this pipeline guesses.
/// </summary>
public static class ResponseMapper
{
    public const string Collection = "responses";

    public static MappedResponse? Map(LegacyResponse doc, MappingContext context)
    {
        var report = context.Report;
        var legacyId = doc.Id.ToString();
        MapperHelpers.ReportExtras(report, Collection, doc.Id, ("", doc.Extra));

        var surveyRef = ReferenceResolver.Classify(SurveyMapper.Collection, doc.SurveyId, context.Surveys);
        if (surveyRef.Kind != ReferenceKind.Resolved)
        {
            report.Skip(
                surveyRef.Kind == ReferenceKind.Malformed
                    ? MigrationRules.MalformedReference
                    : MigrationRules.DanglingReference,
                Collection, legacyId,
                $"survey_id '{doc.SurveyId}' is {surveyRef.Kind}; answers cannot outlive their survey",
                "survey_id");
            return null;
        }

        var companyRef = ReferenceResolver.Classify(CompanyMapper.Collection, doc.CompanyId, context.Companies);
        if (companyRef.Kind != ReferenceKind.Resolved)
        {
            report.Skip(
                companyRef.Kind == ReferenceKind.Malformed
                    ? MigrationRules.MalformedReference
                    : MigrationRules.DanglingReference,
                Collection, legacyId,
                $"company_id '{doc.CompanyId}' is {companyRef.Kind}; the column is a non-nullable FK",
                "company_id");
            return null;
        }

        // Resolved above, so the reference parses; this re-parse is what ForChild needs.
        var surveyOid = ObjectId.Parse(doc.SurveyId!.Trim());

        // Anonymity constraint: absent user_id on an anonymous response is the design,
        // not a defect - only dangling/malformed references degrade.
        Guid? userId = null;
        var userRef = ReferenceResolver.Classify(UserMapper.Collection, doc.UserId, context.Users);
        switch (userRef.Kind)
        {
            case ReferenceKind.Resolved:
                userId = userRef.TargetId;
                break;
            case ReferenceKind.Absent:
                break;
            default:
                report.Degraded(
                    userRef.Kind == ReferenceKind.Malformed
                        ? MigrationRules.MalformedReference
                        : MigrationRules.DanglingReference,
                    Collection, legacyId, "user_id",
                    $"user_id '{doc.UserId}' is {userRef.Kind}; loaded as NULL");
                break;
        }

        Guid? departmentId = null;
        var departmentRef = ReferenceResolver.Classify(DepartmentMapper.Collection, doc.DepartmentId, context.Departments);
        switch (departmentRef.Kind)
        {
            case ReferenceKind.Resolved:
                departmentId = departmentRef.TargetId;
                break;
            case ReferenceKind.Absent:
                break;
            default:
                report.Degraded(
                    departmentRef.Kind == ReferenceKind.Malformed
                        ? MigrationRules.MalformedReference
                        : MigrationRules.DanglingReference,
                    Collection, legacyId, "department_id",
                    $"department_id '{doc.DepartmentId}' is {departmentRef.Kind}; loaded as NULL");
                break;
        }

        // session_id is NOT NULL in the target, but a response missing one still holds
        // answers nobody can re-collect - so it gets a synthetic, clearly-marked key
        // rather than a whole-row skip. Deterministic (from the _id), so re-runs agree.
        var sessionId = MapperHelpers.Truncated(doc.SessionId, 200, Collection, legacyId, "session_id", report);
        if (sessionId is null)
        {
            sessionId = $"legacy:{legacyId}";
            report.Normalisation(MigrationRules.ResponseSessionIdFabricated, Collection, legacyId, "session_id",
                "document carries no session_id; the target column is NOT NULL, so a marked synthetic key is used");
        }

        var companyId = companyRef.TargetId!.Value;
        var language = context.LanguageOf(companyId);
        report.Attribution(Collection, legacyId, "language", language);

        var response = new Response
        {
            Id = MigrationIds.For(Collection, doc.Id),
            SurveyId = surveyRef.TargetId!.Value,
            UserId = userId,
            SessionId = sessionId,
            CompanyId = companyId,
            DepartmentId = departmentId,
            Language = language,
            IsComplete = doc.IsComplete ?? false,
            IsAnonymous = doc.IsAnonymous ?? false,
            StartTime = MapperHelpers.Timestamp(doc.StartTime, doc.Id, Collection, "start_time", report),
            CompletionTime = doc.CompletionTime is { } completion
                ? new DateTimeOffset(DateTime.SpecifyKind(completion, DateTimeKind.Utc))
                : null,
            TotalTimeSeconds = doc.TotalTimeSeconds,
            IpAddress = MapperHelpers.Truncated(doc.IpAddress, 64, Collection, legacyId, "ip_address", report),
            UserAgent = MapperHelpers.Truncated(doc.UserAgent, 500, Collection, legacyId, "user_agent", report),
            CreatedAt = MapperHelpers.Timestamp(doc.CreatedAt, doc.Id, Collection, "created_at", report),
            UpdatedAt = MapperHelpers.Timestamp(doc.UpdatedAt, doc.Id, Collection, "updated_at", report),
        };

        return new MappedResponse(
            response,
            MapAnswers(doc, response.Id, surveyOid, legacyId, context),
            MapDemographics(doc, response.Id, legacyId, report));
    }

    private static List<QuestionResponse> MapAnswers(
        LegacyResponse doc, Guid responseId, ObjectId surveyOid, string legacyId, MappingContext context)
    {
        var report = context.Report;
        var answers = new List<QuestionResponse>();
        var seen = new HashSet<Guid>();
        for (var index = 0; index < (doc.Responses?.Count ?? 0); index++)
        {
            var item = doc.Responses![index];
            var field = $"responses[{index}]";
            MapperHelpers.ReportExtras(report, Collection, doc.Id, (field, item.Extra));

            var questionKey = MapperHelpers.Trimmed(item.QuestionId);
            if (questionKey is null)
            {
                report.Normalisation(MigrationRules.ResponseAnswerQuestionUnresolved, Collection, legacyId,
                    $"{field}.question_id", "answer carries no question_id; not migrated");
                continue;
            }

            var questionId = MigrationIds.ForChild(
                SurveyMapper.Collection, surveyOid, SurveyMapper.QuestionScope, questionKey);
            if (!context.Questions.Contains(questionId))
            {
                report.Normalisation(MigrationRules.ResponseAnswerQuestionUnresolved, Collection, legacyId,
                    $"{field}.question_id",
                    $"'{questionKey}' names no migrated question of this survey; question_id is a Restrict FK, so not migrated");
                continue;
            }

            // Legacy's own reader took the FIRST match for a question id, so first in
            // array order wins here too; the PK would refuse the second row anyway.
            if (!seen.Add(questionId))
            {
                report.Normalisation(MigrationRules.ResponseAnswerDuplicateQuestion, Collection, legacyId,
                    $"{field}.question_id",
                    $"another answer in this response already covers question '{questionKey}'");
                continue;
            }

            if (EncodeAnswerValue(item.ResponseValue, legacyId, field, report) is not { } responseValue)
            {
                seen.Remove(questionId);
                continue;
            }

            answers.Add(new QuestionResponse
            {
                ResponseId = responseId,
                QuestionId = questionId,
                ResponseValue = responseValue,
                ResponseText = MapperHelpers.Trimmed(item.ResponseText),
                TimeSpentSeconds = item.TimeSpentSeconds,
            });
        }

        return answers;
    }

    /// <summary>
    /// SurveyResponseValues is the app's single encoding for the jsonb column: JSON
    /// string of the stable value, JSON array of them for a ranking, numerics as the
    /// string of their value. Legacy Mixed adds one shape the target vocabulary never
    /// had - a raw boolean - which codes to the yes/no stable values the target's
    /// yes_no questions already compare against, as a named rule.
    /// </summary>
    private static string? EncodeAnswerValue(
        BsonValue? value, string legacyId, string field, DataQualityReport report)
    {
        switch (value?.BsonType)
        {
            case BsonType.Boolean:
                report.Normalisation(MigrationRules.ResponseAnswerBooleanCoded, Collection, legacyId,
                    $"{field}.response_value",
                    $"legacy boolean answer coded to '{(value.AsBoolean ? "yes" : "no")}'");
                return SurveyResponseValues.Single(value.AsBoolean ? "yes" : "no");
            case BsonType.Array:
                var items = new List<string>();
                foreach (var element in value.AsBsonArray)
                {
                    if (ScalarOf(element) is not { } scalar)
                    {
                        report.Normalisation(MigrationRules.ResponseAnswerValueInvalid, Collection, legacyId,
                            $"{field}.response_value",
                            $"ranking answer contains a non-scalar {element.BsonType} entry; answer not migrated");
                        return null;
                    }

                    items.Add(scalar);
                }

                return SurveyResponseValues.Ordered(items);
            default:
                if (ScalarOf(value) is { } single)
                {
                    return SurveyResponseValues.Single(single);
                }

                report.Normalisation(MigrationRules.ResponseAnswerValueInvalid, Collection, legacyId,
                    $"{field}.response_value",
                    $"value of type {value?.BsonType.ToString() ?? "absent"} is not the schema's string, number or string[]; answer not migrated");
                return null;
        }
    }

    private static string? ScalarOf(BsonValue? value) => value?.BsonType switch
    {
        BsonType.String => MapperHelpers.Trimmed(value.AsString),
        BsonType.Int32 => value.AsInt32.ToString(CultureInfo.InvariantCulture),
        BsonType.Int64 => value.AsInt64.ToString(CultureInfo.InvariantCulture),
        BsonType.Double => value.AsDouble.ToString(CultureInfo.InvariantCulture),
        _ => null,
    };

    private static List<ResponseDemographic> MapDemographics(
        LegacyResponse doc, Guid responseId, string legacyId, DataQualityReport report)
    {
        var demographics = new List<ResponseDemographic>();
        var seen = new HashSet<string>(StringComparer.Ordinal);
        for (var index = 0; index < (doc.Demographics?.Count ?? 0); index++)
        {
            var item = doc.Demographics![index];
            var field = $"demographics[{index}]";
            MapperHelpers.ReportExtras(report, Collection, doc.Id, (field, item.Extra));

            var key = MapperHelpers.Truncated(item.Field, 100, Collection, legacyId, $"{field}.field", report);
            var value = ScalarOf(item.Value);
            if (key is null || value is null)
            {
                report.Normalisation(MigrationRules.ResponseDemographicInvalid, Collection, legacyId, field,
                    key is null
                        ? "demographic answer has no field name; pair not migrated"
                        : $"value of type {item.Value?.BsonType.ToString() ?? "absent"} is not the schema's string-or-number; pair not migrated");
                continue;
            }

            if (!seen.Add(key))
            {
                report.Normalisation(MigrationRules.ResponseDemographicDuplicateField, Collection, legacyId,
                    $"{field}.field", $"another demographic answer already covers '{key}'");
                continue;
            }

            demographics.Add(new ResponseDemographic
            {
                ResponseId = responseId,
                Field = key,
                // The write path's encoding at SurveyResponseEndpoints: the jsonb
                // column takes the JSON string of the value, same as answers.
                Value = SurveyResponseValues.Single(value),
            });
        }

        return demographics;
    }
}
