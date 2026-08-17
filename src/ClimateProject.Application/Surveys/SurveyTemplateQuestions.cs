using ClimateProject.Application.Questions;
using ClimateProject.Domain.Entities;

namespace ClimateProject.Application.Surveys;

/// <summary>One validated template question and the option rows it owns.</summary>
public sealed record PreparedTemplateQuestion(
    TemplateQuestion Question,
    IReadOnlyList<TemplateQuestionOption> Options);

/// <summary>
/// The write-side validation for a template's questions, as a pure function.
///
/// Deliberately mirrors <c>SurveyEndpoints.PrepareQuestion</c> rule for rule -- a
/// template that could hold a question a survey would reject is a template whose only
/// purpose (being instantiated) fails at the point of use, and the failure would surface
/// on the survey, naming a question the admin never typed. Living in Application rather
/// than beside the endpoint makes those rules assertable without a database.
/// </summary>
public static class SurveyTemplateQuestions
{
    /// <param name="language">
    /// The language the payload is authored in, used only to attribute bare strings.
    /// 'both' means every localized field must arrive locale-keyed.
    /// </param>
    /// <param name="newQuestionId">
    /// Id factory, injected so a test can assert option-to-question wiring against
    /// predictable ids rather than by elimination.
    /// </param>
    public static bool TryPrepare(
        IReadOnlyList<CreateSurveyTemplateQuestionInput>? inputs,
        Guid templateId,
        string language,
        Func<Guid> newQuestionId,
        out IReadOnlyList<PreparedTemplateQuestion> prepared,
        out string? error)
    {
        ArgumentNullException.ThrowIfNull(newQuestionId);

        prepared = [];
        error = null;

        var results = new List<PreparedTemplateQuestion>();
        foreach (var input in inputs ?? [])
        {
            if (!TryPrepareOne(input, templateId, language, newQuestionId(), out var one, out error))
            {
                return false;
            }

            results.Add(one!);
        }

        var duplicateOrder = results.GroupBy(r => r.Question.Order).FirstOrDefault(g => g.Count() > 1);
        if (duplicateOrder is not null)
        {
            error = $"Two questions share order {duplicateOrder.Key}";
            return false;
        }

        prepared = results;
        return true;
    }

    private static bool TryPrepareOne(
        CreateSurveyTemplateQuestionInput input,
        Guid templateId,
        string language,
        Guid questionId,
        out PreparedTemplateQuestion? prepared,
        out string? error)
    {
        prepared = null;
        var path = $"questions[{input.Order}]";

        if (!SurveyValidation.ValidQuestionTypes.Contains(input.Type, StringComparer.Ordinal))
        {
            error = $"Invalid question type: {input.Type}. Expected one of: {string.Join(", ", SurveyValidation.ValidQuestionTypes)}";
            return false;
        }

        if (input.Text is null)
        {
            error = $"Question {input.Order} requires text";
            return false;
        }

        if (!input.Text.TryResolve(language, $"{path}.text", out var textEn, out var textEs, out error))
        {
            return false;
        }

        if (string.IsNullOrWhiteSpace(textEn) && string.IsNullOrWhiteSpace(textEs))
        {
            error = $"Question {input.Order} requires text";
            return false;
        }

        string? scaleLabelMinEn = null;
        string? scaleLabelMinEs = null;
        if (input.ScaleLabelMin is not null
            && !input.ScaleLabelMin.TryResolve(language, $"{path}.scaleLabelMin", out scaleLabelMinEn, out scaleLabelMinEs, out error))
        {
            return false;
        }

        string? scaleLabelMaxEn = null;
        string? scaleLabelMaxEs = null;
        if (input.ScaleLabelMax is not null
            && !input.ScaleLabelMax.TryResolve(language, $"{path}.scaleLabelMax", out scaleLabelMaxEn, out scaleLabelMaxEs, out error))
        {
            return false;
        }

        string? commentPromptEn = null;
        string? commentPromptEs = null;
        if (input.CommentPrompt is not null
            && !input.CommentPrompt.TryResolve(language, $"{path}.commentPrompt", out commentPromptEn, out commentPromptEs, out error))
        {
            return false;
        }

        if (input.ScaleMin.HasValue && input.ScaleMax.HasValue && input.ScaleMin.Value >= input.ScaleMax.Value)
        {
            error = $"Question {input.Order}: ScaleMin must be less than ScaleMax";
            return false;
        }

        var options = new List<TemplateQuestionOption>();
        var order = 0;
        foreach (var optionInput in input.Options ?? [])
        {
            string? labelEn = null;
            string? labelEs = null;
            if (optionInput.Label is not null
                && !optionInput.Label.TryResolve(language, $"{path}.options[{order}].label", out labelEn, out labelEs, out error))
            {
                return false;
            }

            var value = SurveyValidation.DeriveOptionValue(optionInput.Value, labelEn, labelEs);
            if (value is null)
            {
                error = $"Option {order} of question {input.Order} needs a value or a label";
                return false;
            }

            if (options.Any(o => string.Equals(o.Value, value, StringComparison.Ordinal)))
            {
                // Caught here rather than by the unique index so it is a 400 naming the
                // option instead of an opaque DbUpdateException. A duplicate value makes a
                // stored answer ambiguous -- the exact failure the stable value prevents --
                // and a template propagates it to every survey made from it.
                error = $"Question {input.Order} has duplicate option value '{value}'";
                return false;
            }

            options.Add(new TemplateQuestionOption
            {
                TemplateQuestionId = questionId,
                Order = order,
                Value = value,
                LabelEn = labelEn,
                LabelEs = labelEs,
            });
            order++;
        }

        if (input.Type == QuestionTypes.MultipleChoice && options.Count < 2)
        {
            error = $"Question {input.Order}: multiple_choice questions require at least 2 options";
            return false;
        }

        var question = new TemplateQuestion
        {
            Id = questionId,
            TemplateId = templateId,
            TextEn = textEn?.Trim(),
            TextEs = textEs?.Trim(),
            Type = input.Type,
            ScaleMin = input.ScaleMin,
            ScaleMax = input.ScaleMax,
            ScaleLabelMinEn = scaleLabelMinEn,
            ScaleLabelMinEs = scaleLabelMinEs,
            ScaleLabelMaxEn = scaleLabelMaxEn,
            ScaleLabelMaxEs = scaleLabelMaxEs,
            CommentRequired = input.CommentRequired,
            Required = input.Required,
            Order = input.Order,
            Category = input.Category,
        };

        // A prompt exists only when the caller wrote one; omitting it leaves the
        // question promptless and the respond UI renders no comment box. Null still
        // means "said nothing" rather than "clear it", so an update omitting the
        // field cannot erase an authored prompt.
        if (commentPromptEn is not null) question.CommentPromptEn = commentPromptEn;
        if (commentPromptEs is not null) question.CommentPromptEs = commentPromptEs;

        prepared = new PreparedTemplateQuestion(question, options);
        error = null;
        return true;
    }
}
