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
    public const string SurveyLiveEditOutOfScope = "survey_live_edit_out_of_scope";
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

    /// <summary>
    /// The survey's audience was never chosen (<c>Survey.AudienceNotChosen</c>, a questions-only
    /// duplicate): nothing that mails or admits people runs, and it cannot be scheduled or
    /// activated, until «Editar audiencia» saves one. 409 on every such route.
    /// </summary>
    public const string SurveyAudienceNotChosen = "survey_audience_not_chosen";
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

    // TIMS operations ruled 2026-11-08: reopen, exclude a response, delete a company
    public const string SurveyNotClosed = "survey_not_closed";
    public const string SurveyReopenEndTooSoon = "survey_reopen_end_too_soon";
    public const string SurveyReopenReasonRequired = "survey_reopen_reason_required";
    public const string ExclusionReasonRequired = "exclusion_reason_required";
    public const string ExclusionNoResponse = "exclusion_no_response";
    public const string CompanyNameMismatch = "company_name_mismatch";
    public const string CompanyHasResponses = "company_has_responses";
    public const string CompanyHoldsSuperAdmins = "company_holds_super_admins";
    public const string CompanyPeopleReferenced = "company_people_referenced";

    // Paper questionnaires and wording corrections, ruled 2026-11-19 (PaperResponseEndpoints).
    public const string PaperResponseAlreadyCompleted = "paper_response_already_completed";
    public const string PaperResponseNotInPopulation = "paper_response_not_in_population";
    public const string PaperResponseSurveyArchived = "paper_response_survey_archived";
    public const string PaperResponseNotCollecting = "paper_response_not_collecting";
    public const string PaperResponseSuperAdminOnly = "paper_response_super_admin_only";
    public const string SurveyWordingStructureChanged = "survey_wording_structure_changed";
    public const string SurveyWordingQuestionsMismatch = "survey_wording_questions_mismatch";
    public const string SurveyWordingSuperAdminOnly = "survey_wording_super_admin_only";

    // What a client reads, ruled 2026-11-19 (docs/decisions/editable-respondent-content.md).
    // The PUT's refusals carry `key`, `locale`, `placeholder`, `maxLength` and `allowed` beside
    // the code, so a screen can point at the field; the code's sentence says what kind of problem.

    /// <summary>An archived survey's respondent texts cannot be changed, by anybody. 409.</summary>
    public const string RespondentContentArchived = "respondent_content_archived";

    /// <summary>A company admin past «active»: only a super admin edits a closed survey's texts. 409.</summary>
    public const string RespondentContentLocked = "respondent_content_locked";

    public const string RespondentContentUnknownLocale = "respondent_content_unknown_locale";
    public const string RespondentContentLocaleMismatch = "respondent_content_locale_mismatch";

    /// <summary>At the survey level, a text set in a language the survey is not written in. 400; <c>allowed</c> names the survey's locales.</summary>
    public const string RespondentContentLocaleNotOffered = "respondent_content_locale_not_offered";
    public const string RespondentContentUnknownKey = "respondent_content_unknown_key";
    public const string RespondentContentTooLong = "respondent_content_too_long";
    public const string RespondentContentUnknownPlaceholder = "respondent_content_unknown_placeholder";
    public const string RespondentContentValueNotAllowed = "respondent_content_value_not_allowed";
}
