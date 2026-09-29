namespace ClimateProject.Application.OrgStructure.Intake;

/// <summary>
/// How a client's file maps onto this platform: which sheet and header row, what each column
/// is, and how each distinct job title, area and demographic answer translates.
///
/// <para>It is the model's answer, the template's fixed answer, or an admin's correction of
/// either — the three are the same record, and <see cref="IntakeMappingApplier"/> treats them
/// identically. That is what makes the AI replaceable and its output reviewable: nothing
/// downstream knows or cares who wrote the mapping.</para>
/// </summary>
public sealed record IntakeMapping(
    string Sheet,
    int HeaderRow,
    IReadOnlyList<IntakeColumnMapping> Columns,
    string NameOrder,
    string DefaultRole,
    IReadOnlyList<IntakeValueMapping> RoleValues,
    IReadOnlyList<IntakeDepartmentMapping> DepartmentValues,
    IReadOnlyList<IntakeDemographicValueMapping> DemographicValues,
    string? Summary);

/// <param name="Target">One of <see cref="IntakeTargetFields"/>.</param>
/// <param name="DemographicField">The demographic field's key when <paramref name="Target"/> is <c>demographic</c>.</param>
/// <param name="Confidence"><c>high</c>, <c>medium</c> or <c>low</c>.</param>
public sealed record IntakeColumnMapping(
    int Column,
    string Header,
    string Target,
    string? DemographicField,
    string Confidence,
    string? Reason);

/// <param name="Target">A platform role: <c>employee</c>, <c>leader</c> or <c>supervisor</c>.</param>
public sealed record IntakeValueMapping(string Source, string Target, string Confidence, string? Reason);

/// <param name="Department">
/// An existing department's exact name, or — when <paramref name="CreateNew"/> — the name the
/// department would be created with on approval.
/// </param>
public sealed record IntakeDepartmentMapping(
    string Source,
    string? Department,
    bool CreateNew,
    string Confidence,
    string? Reason);

/// <param name="Target">The option value to store, or null when no option fits.</param>
public sealed record IntakeDemographicValueMapping(string Field, string Source, string? Target, string Confidence);

public static class IntakeTargetFields
{
    public const string Name = "name";
    public const string FirstName = "first_name";
    public const string LastName = "last_name";
    public const string Email = "email";
    public const string Role = "role";
    public const string Department = "department";
    public const string Demographic = "demographic";
    public const string Ignore = "ignore";

    public static readonly string[] All = [Name, FirstName, LastName, Email, Role, Department, Demographic, Ignore];
}

/// <summary>What a file can be mapped onto for one company: its own departments and demographic fields.</summary>
public sealed record IntakeTargets(
    string CompanyName,
    string? EmailDomain,
    IReadOnlyList<string> Departments,
    IReadOnlyList<IntakeDemographicTarget> Demographics);

/// <param name="Type"><c>select</c>, <c>text</c>, <c>number</c> or <c>date</c>.</param>
/// <param name="Options">The allowed stored values, for a select field.</param>
/// <param name="OptionLabels">Each stored value's label in the reader's language ("san_jose" → "San José").</param>
public sealed record IntakeDemographicTarget(
    string Field,
    string? Label,
    string Type,
    IReadOnlyList<string>? Options,
    IReadOnlyDictionary<string, string>? OptionLabels = null);

/// <summary>
/// The model's answer, or why there is none. A failure is a code the screen translates, never
/// an exception message: the admin's recourse is the same in every case (map the columns by hand
/// or use the template), so the screen needs to know THAT it failed, not the provider's wording.
/// </summary>
/// <param name="FailureCode"><c>ai_unavailable</c>, <c>ai_failed</c> or <c>ai_refused</c>.</param>
public sealed record IntakeModelResult(
    IntakeMapping? Mapping,
    string? FailureCode,
    string? Model,
    long? InputTokens,
    long? OutputTokens)
{
    public static IntakeModelResult Failed(string code, string? model = null) => new(null, code, model, null, null);
}

/// <summary>
/// The model that reads an <see cref="IntakeProfile"/> and proposes an <see cref="IntakeMapping"/>.
/// Implemented against Claude in Infrastructure; a fake stands in for it in every test, so no
/// test depends on a network or spends money.
/// </summary>
public interface IIntakeMappingModel
{
    /// <summary>False when no credential is configured: the endpoint says so instead of trying.</summary>
    bool IsConfigured { get; }

    /// <param name="language"><c>es</c> or <c>en</c>: the language of the summary and the reasons, which the admin reads.</param>
    Task<IntakeModelResult> MapAsync(IntakeProfile profile, IntakeTargets targets, string language, CancellationToken cancellationToken);
}
