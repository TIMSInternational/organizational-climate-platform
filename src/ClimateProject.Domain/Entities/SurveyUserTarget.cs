namespace ClimateProject.Domain.Entities;

/// <summary>
/// One person a survey is aimed at, when a department cannot express the audience.
///
/// <para>
/// Departments were the only targeting the product had, and a person has exactly one. That
/// is enough for "everyone in Operaciones" and useless for a roster that cuts across the
/// org: ESPH's 240 teletrabajadores sit in all eight of its departments, so every
/// department-based audience resolved to all 625 — 402 of whom are not teletrabajadores and
/// would have seen, and been able to answer, a survey that is not theirs.
/// </para>
/// <para>
/// Deliberately additive. A survey with NO targets of either kind is still company-wide, and
/// a survey with department targets behaves exactly as before. The two combine as a union:
/// the audience is "my department is targeted OR I am targeted".
/// </para>
/// </summary>
public class SurveyUserTarget
{
    public Guid SurveyId { get; set; }
    public Guid UserId { get; set; }
}
