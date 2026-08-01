namespace ClimateProject.Application.Microclimates;

public static class MicroclimateValidation
{
    public static readonly string[] ValidStatuses = ["draft", "active", "closed"];
    public static readonly string[] ValidQuestionTypes = ["multiple_choice", "open_text", "rating", "yes_no"];
}
