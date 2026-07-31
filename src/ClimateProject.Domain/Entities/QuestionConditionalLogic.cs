namespace ClimateProject.Domain.Entities;

// 1:1-per-question, nullable shape: absence of a row means "no conditional logic".
// Not an EF owned type — owned types in this codebase are reserved for always-present
// shapes, and this one also needs its own FK relationships to other Question rows.
public class QuestionConditionalLogic
{
    public Guid QuestionId { get; set; }
    public Guid? ConditionQuestionId { get; set; }
    public string? ConditionOperator { get; set; }
    public string? ConditionValue { get; set; }
    public string? Action { get; set; }
    public Guid? TargetQuestionId { get; set; }
}
