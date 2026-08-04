using ClimateProject.Application.Questions;

namespace ClimateProject.Application.Microclimates;

public static class MicroclimateValidation
{
    public static readonly string[] ValidStatuses = ["draft", "active", "closed"];

    /// <summary>
    /// Derived from <see cref="QuestionTypes.ForMicroclimate"/> rather than written
    /// as its own literal list. The previous independent list
    /// (<c>["multiple_choice", "open_text", "rating", "yes_no"]</c>) had drifted from
    /// every other vocabulary in the product -- see #196 and
    /// <see cref="QuestionTypes"/> for what changed and why.
    /// </summary>
    public static readonly string[] ValidQuestionTypes = QuestionTypes.ForMicroclimate;
}
