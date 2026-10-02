using ClimateProject.Application.Auth;

namespace ClimateProject.Application.OrgStructure.Intake;

/// <summary>
/// A mapping built from header words alone — no model. Two jobs:
///
/// <list type="bullet">
/// <item><b>Our own template.</b> Its headers are ours, so reading it needs no intelligence and
/// costs nothing; <see cref="IsTemplate"/> says when that is what arrived.</item>
/// <item><b>The fallback.</b> When the model is unavailable, fails or declines, the admin gets
/// this best effort in the same editable mapping card instead of a dead end. A file headed
/// "Nombre / Correo / Puesto / Área" maps well enough by words to be corrected in a minute.</item>
/// </list>
/// </summary>
public static class IntakeHeuristicMapping
{
    private static readonly string[] FirstNameWords = ["nombre", "nombres", "primer nombre", "first name", "given name"];
    private static readonly string[] LastNameWords = ["apellido", "apellidos", "last name", "surname", "family name", "primer apellido"];
    private static readonly string[] FullNameWords = ["nombre completo", "full name", "colaborador", "empleado", "persona", "name"];

    public static bool IsTemplate(SheetGrid sheet)
    {
        ArgumentNullException.ThrowIfNull(sheet);
        if (!string.Equals(sheet.Name, IntakeWorkbook.PeopleSheet, StringComparison.Ordinal))
        {
            return false;
        }

        var header = IntakeProfiler.GuessHeaderRow(sheet);
        var headers = Enumerable.Range(1, sheet.ColumnCount).Select(c => IntakeWorkbook.NormaliseHeader(sheet.Cell(header, c))).ToHashSet();
        return IntakeWorkbook.PeopleColumns.Values.All(synonyms => synonyms.Any(headers.Contains));
    }

    public static IntakeMapping Build(SheetGrid sheet, IntakeTargets targets)
    {
        ArgumentNullException.ThrowIfNull(sheet);
        ArgumentNullException.ThrowIfNull(targets);

        var header = IntakeProfiler.GuessHeaderRow(sheet);
        var columns = new List<IntakeColumnMapping>();
        var taken = new HashSet<string>();
        var hasSeparateLastName = Enumerable.Range(1, sheet.ColumnCount)
            .Any(c => LastNameWords.Contains(IntakeWorkbook.NormaliseHeader(sheet.Cell(header, c))));

        for (var c = 1; c <= sheet.ColumnCount; c++)
        {
            var raw = sheet.Cell(header, c);
            var normalised = IntakeWorkbook.NormaliseHeader(raw);
            var target = Classify(normalised, hasSeparateLastName, targets, out var demographicField);

            // One column per target: a second "Correo" (personal vs institutional) is left for the
            // admin to choose rather than silently overwriting the first.
            if (target != IntakeTargetFields.Ignore && target != IntakeTargetFields.Demographic && !taken.Add(target))
            {
                target = IntakeTargetFields.Ignore;
            }

            if (target == IntakeTargetFields.Demographic && !taken.Add("demographic:" + demographicField))
            {
                target = IntakeTargetFields.Ignore;
                demographicField = null;
            }

            columns.Add(new IntakeColumnMapping(
                c,
                raw.Length > 0 ? raw : $"(columna {c})",
                target,
                target == IntakeTargetFields.Demographic ? demographicField : null,
                // Header words are a guess either way, so "medium" throughout. An ignored column is
                // not flagged "low": telling the admin to double-check leaving out a cédula or a
                // phone number trains them to skim the warning that matters.
                "medium",
                null));
        }

        IReadOnlyList<string> Distinct(string target, string? field = null)
        {
            var column = columns.FirstOrDefault(c => c.Target == target && (field is null || c.DemographicField == field));
            return column is null
                ? []
                : Enumerable.Range(header + 1, Math.Max(0, sheet.Rows.Count - header))
                    .Select(r => sheet.Cell(r, column.Column).Trim())
                    .Where(v => v.Length > 0)
                    .Distinct(StringComparer.OrdinalIgnoreCase)
                    .ToList();
        }

        var roles = Distinct(IntakeTargetFields.Role).Select(GuessRole).ToList();
        var departments = Distinct(IntakeTargetFields.Department).Select(v => GuessDepartment(v, targets.Departments)).ToList();
        var demographics = columns
            .Where(c => c.Target == IntakeTargetFields.Demographic)
            .Select(c => targets.Demographics.First(d => d.Field == c.DemographicField))
            .Where(d => d.Type == "select")
            .SelectMany(d => Distinct(IntakeTargetFields.Demographic, d.Field).Select(v => GuessOption(d, v)))
            .ToList();

        return new IntakeMapping(sheet.Name, header, columns, "first_last", Roles.Employee, roles, departments, demographics, null);
    }

    // Header words' counterpart for VALUES: a deterministic best guess the admin corrects in the
    // same editor — never as good as the model, always better than every row arriving unmapped.

    private static readonly string[] LeaderWords =
        ["gerente", "gerenta", "director", "directora", "jefe", "jefa", "jefatura", "lider", "head", "chief", "vp", "presidente", "ceo", "cfo", "cto", "coo"];

    private static readonly string[] SupervisorWords =
        ["supervisor", "supervisora", "coordinador", "coordinadora", "encargado", "encargada", "capataz", "lead", "turno"];

    private static IntakeValueMapping GuessRole(string title)
    {
        if (IntakeWorkbook.ResolveRole(title) is { } exact)
        {
            return new IntakeValueMapping(title, exact, "high", null);
        }

        var key = IntakeMappingApplier.Key(title);
        // "Jefe de turno" supervises a shift; it does not head a unit — checked before "jefe".
        if (HasWord(key, SupervisorWords))
        {
            return new IntakeValueMapping(title, Roles.Supervisor, "medium", null);
        }

        return HasWord(key, LeaderWords)
            ? new IntakeValueMapping(title, Roles.Leader, "medium", null)
            : new IntakeValueMapping(title, Roles.Employee, "low", null);
    }

    /// <summary>Areas that are one unit under different names.</summary>
    private static readonly string[][] DepartmentSynonyms =
    [
        ["personas", "rrhh", "recursos humanos", "talento humano", "gestion humana", "people", "hr", "human resources"],
        ["ventas", "comercial", "sales", "negocios"],
        ["finanzas", "contabilidad", "finance", "accounting", "tesoreria"],
        ["ingenieria", "ti", "tecnologia", "sistemas", "it", "engineering", "desarrollo", "software"],
        ["operaciones", "operations", "produccion", "planta"],
    ];

    private static IntakeDepartmentMapping GuessDepartment(string source, IReadOnlyList<string> existing)
    {
        var key = IntakeMappingApplier.Key(source);
        var exact = existing.FirstOrDefault(d => IntakeMappingApplier.Key(d) == key);
        if (exact is not null)
        {
            return new IntakeDepartmentMapping(source, exact, false, "high", null);
        }

        // "Finanzas y Contabilidad" names Finanzas; "Ingeniería de Software" names Ingeniería.
        var contained = existing.FirstOrDefault(d => HasWord(key, IntakeMappingApplier.Key(d)));
        if (contained is not null)
        {
            return new IntakeDepartmentMapping(source, contained, false, "medium", null);
        }

        foreach (var group in DepartmentSynonyms)
        {
            if (group.Any(word => HasWord(key, word)))
            {
                var match = existing.FirstOrDefault(d => group.Contains(IntakeMappingApplier.Key(d)));
                if (match is not null)
                {
                    return new IntakeDepartmentMapping(source, match, false, "medium", null);
                }
            }
        }

        return new IntakeDepartmentMapping(source, source.Trim(), true, "low", null);
    }

    private static IntakeDemographicValueMapping GuessOption(IntakeDemographicTarget field, string source)
    {
        var key = IntakeMappingApplier.Key(source);
        string Name(string option) =>
            IntakeMappingApplier.Key(field.OptionLabels?.GetValueOrDefault(option) ?? option);

        var options = field.Options ?? [];
        var exact = options.FirstOrDefault(o => Name(o) == key || IntakeMappingApplier.Key(o) == key);
        if (exact is not null)
        {
            return new IntakeDemographicValueMapping(field.Field, source, exact, "high");
        }

        // "San José Centro", "Heredia - Zona Franca": the option is named inside the value.
        var contained = options.FirstOrDefault(o => HasWord(key, Name(o)));
        return new IntakeDemographicValueMapping(field.Field, source, contained, contained is null ? "low" : "medium");
    }

    private static bool HasWord(string header, params string[] words)
    {
        var padded = $" {header} ";
        return words.Any(word => padded.Contains($" {word} ", StringComparison.Ordinal));
    }

    private static string Classify(string header, bool hasSeparateLastName, IntakeTargets targets, out string? demographicField)
    {
        demographicField = null;
        if (header.Length == 0)
        {
            return IntakeTargetFields.Ignore;
        }

        if (IntakeWorkbook.PeopleColumns["email"].Contains(header) || header.Contains("correo", StringComparison.Ordinal) || header.Contains("email", StringComparison.Ordinal))
        {
            return IntakeTargetFields.Email;
        }

        if (LastNameWords.Contains(header))
        {
            return IntakeTargetFields.LastName;
        }

        if (FirstNameWords.Contains(header))
        {
            return hasSeparateLastName ? IntakeTargetFields.FirstName : IntakeTargetFields.Name;
        }

        if (FullNameWords.Contains(header) || IntakeWorkbook.PeopleColumns["name"].Contains(header))
        {
            return IntakeTargetFields.Name;
        }

        // Whole words inside longer headers too: "Departamento / Área", "Puesto actual".
        if (IntakeWorkbook.PeopleColumns["role"].Contains(header) || HasWord(header, "cargo", "puesto", "rol", "role", "position"))
        {
            return IntakeTargetFields.Role;
        }

        if (IntakeWorkbook.PeopleColumns["department"].Contains(header) || HasWord(header, "departamento", "department", "area", "unidad", "gerencia", "direccion"))
        {
            return IntakeTargetFields.Department;
        }

        var demographic = targets.Demographics.FirstOrDefault(d =>
            IntakeWorkbook.NormaliseHeader(d.Field) == header || IntakeWorkbook.NormaliseHeader(d.Label) == header);
        if (demographic is not null)
        {
            demographicField = demographic.Field;
            return IntakeTargetFields.Demographic;
        }

        return IntakeTargetFields.Ignore;
    }
}
