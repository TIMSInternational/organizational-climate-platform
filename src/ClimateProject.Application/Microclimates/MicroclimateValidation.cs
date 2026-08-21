using ClimateProject.Application.Questions;

namespace ClimateProject.Application.Microclimates;

public static class MicroclimateValidation
{
    /// <summary>
    /// The status vocabulary.
    /// </summary>
    /// <remarks>
    /// Derived from <see cref="MicroclimateStatuses.All"/> rather than written as its own
    /// literal list. It used to be the literal <c>["draft", "active", "closed"]</c> and was
    /// the ONLY check <c>PUT /microclimates/{id}</c> applied to a status change -- membership
    /// of this array, with no notion of what the microclimate's current status was. #131 put
    /// the transition map behind it; binding the vocabulary to the same class stops the two
    /// from ever disagreeing about which strings exist. Same reasoning as
    /// <see cref="ValidQuestionTypes"/> below.
    /// </remarks>
    public static readonly string[] ValidStatuses = MicroclimateStatuses.All;

    /// <summary>
    /// Derived from <see cref="QuestionTypes.ForMicroclimate"/> rather than written
    /// as its own literal list. The previous independent list
    /// (<c>["multiple_choice", "open_text", "rating", "yes_no"]</c>) had drifted from
    /// every other vocabulary in the product -- see #196 and
    /// <see cref="QuestionTypes"/> for what changed and why.
    /// </summary>
    public static readonly string[] ValidQuestionTypes = QuestionTypes.ForMicroclimate;

    /// <summary>Close a microclimate: <c>draft</c> or <c>active</c> to <c>closed</c>.</summary>
    public const string BulkActionClose = "close";

    /// <summary>Open a draft for responses. The bulk form of <c>POST /{id}/activate</c>.</summary>
    public const string BulkActionActivate = "activate";

    /// <summary>
    /// The bulk vocabulary.
    /// </summary>
    /// <remarks>
    /// Deliberately shorter than <c>SurveyValidation.BulkActions</c>, which also has
    /// <c>delete</c> and <c>archive</c>. Neither has a counterpart here: this vocabulary has
    /// no <c>archived</c> status, and <c>DELETE /microclimates/{id}</c> does not exist on
    /// this surface at all -- adding a destructive operation in its bulk form first, with no
    /// single-item route to mirror its rules, is exactly the shape of bug the survey bulk
    /// handler's "bulk is a loop, never a bypass" comment warns about.
    /// </remarks>
    public static readonly string[] BulkActions = [BulkActionActivate, BulkActionClose];
}
