namespace ClimateProject.Application.Surveys;

/// <summary>
/// The área a respondent with NO account declares about themselves, and how it reaches the
/// department climate map.
/// </summary>
/// <remarks>
/// <para>
/// <b>Stored as a demographic ANSWER, never as <c>responses.department_id</c></b>
/// (<c>docs/decisions/self-declared-demographics.md</c>, ruling 1). The column flows through
/// the write-time floor, which needs a population this respondent is not in. So the value
/// lives in <c>response_demographics</c> under <see cref="FieldKey"/>, holding the
/// department's id, and the floor of 5 is applied at READ time by the same
/// <c>SurveyResultsPrivacy.MeetsSegmentFloor</c> every department segment already passes.
/// </para>
/// <para>
/// <b>The key is reserved.</b> It is <see cref="SurveySegmentSelector.DepartmentField"/>, the
/// pseudo-field the results filter and every breakdown already use for the department, so an
/// admin-defined demographic field with this key would collide with the department dimension
/// twice over. <c>DemographicFieldEndpoints</c> refuses it, and the self-declared loader never
/// offers a legacy field that already holds it.
/// </para>
/// </remarks>
public static class SelfDeclaredDepartment
{
    /// <summary>The reserved <c>response_demographics.field</c> key.</summary>
    public const string FieldKey = SurveySegmentSelector.DepartmentField;

    /// <summary>Whether an admin-chosen demographic field key would collide with the reserved one.</summary>
    public static bool IsReservedKey(string? fieldKey)
        => string.Equals(fieldKey?.Trim(), FieldKey, StringComparison.OrdinalIgnoreCase);

    /// <summary>
    /// The department a response counts under: its own <c>department_id</c> when it has one,
    /// otherwise the self-declared one -- but only when that declared value names one of the
    /// tenant's own departments.
    /// </summary>
    /// <param name="storedDepartmentId"><c>responses.department_id</c>. Always wins.</param>
    /// <param name="declared">
    /// The DECODED value stored under <see cref="FieldKey"/>, or null. Decoding is the
    /// aggregation's job; this takes the plain string.
    /// </param>
    /// <param name="companyDepartmentIds">
    /// The response's own company's departments. A declared id outside it is ignored rather
    /// than counted: the submit path already refuses one, and a row that holds one anyway was
    /// not written by this product and must not move another tenant's map.
    /// </param>
    public static Guid? Effective(
        Guid? storedDepartmentId,
        string? declared,
        IReadOnlySet<Guid> companyDepartmentIds)
    {
        ArgumentNullException.ThrowIfNull(companyDepartmentIds);

        if (storedDepartmentId is not null)
        {
            return storedDepartmentId;
        }

        return Guid.TryParse(declared, out var id) && companyDepartmentIds.Contains(id)
            ? id
            : null;
    }
}
