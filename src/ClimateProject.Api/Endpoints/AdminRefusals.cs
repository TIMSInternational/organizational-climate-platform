namespace ClimateProject.Api.Endpoints;

/// <summary>
/// The stable <c>code</c>s carried by the refusals an ADMINISTRATOR can trigger from a screen
/// and fix by changing what they typed or chose.
/// </summary>
/// <remarks>
/// <para>
/// Why: every admin screen says a failed request through <c>web/src/api/describeApiError.ts</c>,
/// which never shows the server's English <c>message</c> (G30, #636). Without a code it falls
/// back to a sentence chosen by the STATUS, so "Department with this name already exists at
/// this level" reached a Spanish administrator as "Revise los datos". A code is what lets the
/// screen say the specific refusal in the reader's language.
/// </para>
/// <para>
/// Additive only: each site keeps its <c>message</c> word for word and gains a <c>code</c>
/// beside it, the shape <c>survey_ended_audience_frozen</c> and <c>not_mass_invite</c> already
/// use. Every value here has a sentence in <c>describeApiError</c>'s code map in both
/// catalogues; <c>web/src/api/adminRefusalCodes.test.ts</c> reads this file and fails if one
/// does not.
/// </para>
/// <para>
/// Respondent, employee and sign-in refusals are deliberately NOT here: while a survey is
/// live, what a respondent receives must not change, not even additively.
/// </para>
/// </remarks>
internal static class AdminRefusals
{
    // Org structure
    public const string DepartmentNameTaken = "department_name_taken";
    public const string DemographicFieldKeyTaken = "demographic_field_key_taken";
    public const string DemographicFieldKeyReserved = "demographic_field_key_reserved";
    public const string DemographicFieldOptionsRequired = "demographic_field_options_required";
    public const string UserOwnManager = "user_own_manager";
    public const string CompanyDomainTaken = "company_domain_taken";
    public const string CompanyDomainInvalid = "company_domain_invalid";

    // Survey authoring, schedule and lifecycle
    public const string SurveyDatesOutOfOrder = "survey_dates_out_of_order";
    public const string SurveyContentLocked = "survey_content_locked";
    public const string SurveyContentHasResponses = "survey_content_has_responses";
    public const string SurveyScheduleFrozen = "survey_schedule_frozen";
    public const string SurveyStartFrozen = "survey_start_frozen";
    public const string SurveyRevertHasResponses = "survey_revert_has_responses";
    public const string SurveyNoQuestions = "survey_no_questions";
    public const string SurveyMissingTranslations = "survey_missing_translations";
    public const string SurveyDeleteHasResponses = "survey_delete_has_responses";
    public const string QuestionTextRequired = "question_text_required";
    public const string QuestionOptionDuplicate = "question_option_duplicate";
    public const string QuestionOptionsTooFew = "question_options_too_few";

    // Survey distribution
    public const string SurveyNotDistributable = "survey_not_distributable";
    public const string SurveyWindowClosed = "survey_window_closed";
    public const string SurveyRemindersOff = "survey_reminders_off";
    public const string SurveyNotCollecting = "survey_not_collecting";

    // Microclimates (admin)
    public const string MicroclimateWindowOutOfOrder = "microclimate_window_out_of_order";
    public const string MicroclimateClosedWindow = "microclimate_closed_window";
    public const string MicroclimateNotDraft = "microclimate_not_draft";
    public const string MicroclimateWindowElapsed = "microclimate_window_elapsed";
    public const string MicroclimateMissingTranslations = "microclimate_missing_translations";
    public const string MicroclimateInviteWindowClosed = "microclimate_invite_window_closed";

    // Reports and the question bank
    public const string ReportScheduleStartPast = "report_schedule_start_past";
    public const string QuestionBankItemInUse = "question_bank_item_in_use";
    public const string QuestionBankItemHasVariations = "question_bank_item_has_variations";
}
