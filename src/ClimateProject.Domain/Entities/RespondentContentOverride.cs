namespace ClimateProject.Domain.Entities;

/// <summary>
/// One overridden respondent text, in one locale, at one level: a company's own wording
/// (<see cref="SurveyId"/> null) or one survey's (<see cref="SurveyId"/> set). Ruled 2026-11-19,
/// <c>docs/decisions/editable-respondent-content.md</c>: «survey → company → product default».
/// </summary>
/// <remarks>
/// <para>
/// <see cref="Key"/> is an entry of <c>RespondentContentRegistry</c> and nothing else -- the set of
/// overridable texts is fixed in code, never "any catalogue key". A row whose key the registry no
/// longer names is ignored by the resolver rather than shown.
/// </para>
/// <para>
/// The survey-level texts that already had columns (<c>SurveySettings.RespondentIntro*</c>,
/// <c>ClosingMessage*</c>, <c>InvitationCustomSubject*</c>, <c>InvitationCustomMessage*</c>) stay
/// in those columns and are never duplicated here: the PUT writes the column, and the resolver
/// reads it between this table's survey row and its company row.
/// </para>
/// </remarks>
public class RespondentContentOverride
{
    public Guid Id { get; set; }

    /// <summary>Always set, also on a survey row, so a company's whole wording goes with it.</summary>
    public Guid CompanyId { get; set; }

    /// <summary>Null for the company's own wording; the survey's id for that survey's.</summary>
    public Guid? SurveyId { get; set; }

    /// <summary>A <c>RespondentContentRegistry</c> key, e.g. <c>demographics.intro</c>.</summary>
    public required string Key { get; set; }

    /// <summary><c>es</c> or <c>en</c>; <c>*</c> for a locale-independent display key.</summary>
    public required string Locale { get; set; }

    /// <summary>The text, trimmed, never blank: clearing a value deletes its row.</summary>
    public required string Value { get; set; }

    /// <summary>Who last wrote it; null once that person is deleted.</summary>
    public Guid? UpdatedBy { get; set; }

    public DateTimeOffset UpdatedAt { get; set; }
}
