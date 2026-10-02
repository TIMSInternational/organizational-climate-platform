namespace ClimateProject.Application.OrgStructure.Intake;

/// <summary>
/// The model's mapping is <b>input, not instruction</b>. Structured output guarantees its shape;
/// nothing guarantees its content. So before a single row is touched, every reference in it is
/// checked against what actually exists:
///
/// <list type="bullet">
/// <item>the sheet is one of the file's sheets, the header row is inside it, each column index
/// is a real column, and each target is one this platform has;</item>
/// <item>a role is one of the three an import may assign — never <c>company_admin</c> or
/// <c>super_admin</c>, whatever a job title says (the same exclusion <c>ProcessRowsAsync</c>
/// enforces, applied earlier so the review screen never proposes it);</item>
/// <item>an "existing" department exists (canonical spelling restored), and a new one is only
/// new when the model said so;</item>
/// <item>a demographic answer is one of the field's stored option values.</item>
/// </list>
///
/// Anything that fails becomes <i>unmapped</i> rather than an error: the value then passes through
/// as written and the review step's verdict names it to the admin.
/// </summary>
public static class IntakeMappingSanitizer
{
    private static readonly string[] Confidences = ["high", "medium", "low"];

    public static IntakeMapping Sanitize(IntakeMapping raw, IReadOnlyList<SheetGrid> sheets, IntakeTargets targets)
    {
        ArgumentNullException.ThrowIfNull(raw);
        ArgumentNullException.ThrowIfNull(sheets);
        ArgumentNullException.ThrowIfNull(targets);

        var sheet = sheets.FirstOrDefault(s => s.Name == raw.Sheet) ?? sheets.First(s => s.Rows.Count > 0);
        var headerRow = raw.HeaderRow >= 1 && raw.HeaderRow <= sheet.Rows.Count ? raw.HeaderRow : IntakeProfiler.GuessHeaderRow(sheet);
        var fields = targets.Demographics.ToDictionary(d => d.Field, StringComparer.Ordinal);

        var columns = new List<IntakeColumnMapping>();
        var seen = new HashSet<int>();
        var taken = new HashSet<string>(StringComparer.Ordinal);
        foreach (var column in raw.Columns.OrderBy(c => c.Column))
        {
            if (column.Column < 1 || column.Column > sheet.ColumnCount || !seen.Add(column.Column))
            {
                continue;
            }

            var target = IntakeTargetFields.All.Contains(column.Target) ? column.Target : IntakeTargetFields.Ignore;
            var demographic = target == IntakeTargetFields.Demographic && column.DemographicField is { } key && fields.ContainsKey(key) ? key : null;
            if (target == IntakeTargetFields.Demographic && demographic is null)
            {
                target = IntakeTargetFields.Ignore;
            }

            var slot = target == IntakeTargetFields.Demographic ? "demographic:" + demographic : target;
            if (target != IntakeTargetFields.Ignore && !taken.Add(slot))
            {
                target = IntakeTargetFields.Ignore;
                demographic = null;
            }

            columns.Add(column with
            {
                Header = sheet.Cell(headerRow, column.Column) is { Length: > 0 } h ? h : column.Header,
                Target = target,
                DemographicField = demographic,
                Confidence = Confidence(column.Confidence),
            });
        }

        // Every column appears, mapped or ignored, so the admin's editor lists the whole file.
        for (var c = 1; c <= sheet.ColumnCount; c++)
        {
            if (seen.Add(c))
            {
                var header = sheet.Cell(headerRow, c);
                columns.Add(new IntakeColumnMapping(c, header.Length > 0 ? header : $"(columna {c})", IntakeTargetFields.Ignore, null, "low", null));
            }
        }

        var roles = raw.RoleValues
            .Where(v => IntakeWorkbook.OfferedRoles.Contains(v.Target))
            .Select(v => v with { Confidence = Confidence(v.Confidence) })
            .ToList();

        var existing = targets.Departments.ToDictionary(IntakeMappingApplier.Key, d => d);
        var departments = raw.DepartmentValues
            .Select(v =>
            {
                var name = v.Department?.Trim();
                if (string.IsNullOrWhiteSpace(name))
                {
                    return v with { Department = null, CreateNew = false, Confidence = Confidence(v.Confidence) };
                }

                if (existing.TryGetValue(IntakeMappingApplier.Key(name), out var canonical))
                {
                    return v with { Department = canonical, CreateNew = false, Confidence = Confidence(v.Confidence) };
                }

                return v.CreateNew && name.Length <= 100
                    ? v with { Department = name, Confidence = Confidence(v.Confidence) }
                    : v with { Department = null, CreateNew = false, Confidence = "low" };
            })
            .ToList();

        var demographics = raw.DemographicValues
            .Where(v => fields.TryGetValue(v.Field, out var field) && field.Type == "select")
            .Select(v =>
            {
                var options = fields[v.Field].Options ?? [];
                var target = options.FirstOrDefault(o => string.Equals(o, v.Target, StringComparison.Ordinal))
                    ?? options.FirstOrDefault(o => IntakeMappingApplier.Key(o) == IntakeMappingApplier.Key(v.Target));
                return v with { Target = target, Confidence = target is null ? "low" : Confidence(v.Confidence) };
            })
            .ToList();

        return new IntakeMapping(
            sheet.Name,
            headerRow,
            columns,
            raw.NameOrder == "last_first" ? "last_first" : "first_last",
            IntakeWorkbook.OfferedRoles.Contains(raw.DefaultRole) ? raw.DefaultRole : IntakeWorkbook.OfferedRoles[0],
            roles,
            departments,
            demographics,
            string.IsNullOrWhiteSpace(raw.Summary) ? null : raw.Summary.Trim());
    }

    private static string Confidence(string? value) => Confidences.Contains(value) ? value! : "low";
}
