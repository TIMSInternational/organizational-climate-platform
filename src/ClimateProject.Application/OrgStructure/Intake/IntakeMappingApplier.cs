using System.Globalization;

namespace ClimateProject.Application.OrgStructure.Intake;

/// <summary>What applying a mapping to a sheet produced.</summary>
/// <param name="NewDepartments">Departments the rows point at that the mapping proposes to create.</param>
/// <param name="NamesNormalised">How many names were re-cased ("MARÍA JIMÉNEZ" → "María Jiménez").</param>
/// <param name="SkippedRows">
/// Rows under the header that describe no person — a "Total: 22" footer, a subtotal — skipped
/// and reported, never silently dropped.
/// </param>
public sealed record IntakeApplyResult(
    IReadOnlyList<ParsedImportRow> Rows,
    IReadOnlyList<string> NewDepartments,
    IReadOnlyList<IntakeParseProblem> Problems,
    int NamesNormalised,
    IReadOnlyList<int> SkippedRows);

/// <summary>
/// Applies an <see cref="IntakeMapping"/> to every row of a sheet — deterministically, on this
/// server, with no model involved. The model decided what the columns and the distinct values
/// mean from a masked profile; this is where that decision meets the actual people.
///
/// <para>It never rejects a row. A value the mapping has no answer for passes through as written,
/// so the review step's verdict (the same <c>ProcessRowsAsync</c> the approval runs) names it back
/// to the admin — "Rol no válido: «Pasante»" — instead of the row silently becoming somebody
/// else's role.</para>
/// </summary>
public static class IntakeMappingApplier
{
    public static IntakeApplyResult Apply(SheetGrid sheet, IntakeMapping mapping, IntakeTargets targets)
    {
        ArgumentNullException.ThrowIfNull(sheet);
        ArgumentNullException.ThrowIfNull(mapping);
        ArgumentNullException.ThrowIfNull(targets);

        var problems = new List<IntakeParseProblem>();
        int? Column(string target) => mapping.Columns.FirstOrDefault(c => c.Target == target)?.Column;

        var nameColumn = Column(IntakeTargetFields.Name);
        var firstColumn = Column(IntakeTargetFields.FirstName);
        var lastColumn = Column(IntakeTargetFields.LastName);
        var emailColumn = Column(IntakeTargetFields.Email);
        var roleColumn = Column(IntakeTargetFields.Role);
        var departmentColumn = Column(IntakeTargetFields.Department);
        var demographicColumns = mapping.Columns
            .Where(c => c.Target == IntakeTargetFields.Demographic && !string.IsNullOrWhiteSpace(c.DemographicField))
            .Select(c => (c.Column, Target: targets.Demographics.FirstOrDefault(d => d.Field == c.DemographicField)))
            .Where(c => c.Target is not null)
            .ToList();

        if (emailColumn is null)
        {
            problems.Add(new IntakeParseProblem(mapping.Sheet, "No column holds the email address.", "no_email_column"));
        }

        if (nameColumn is null && firstColumn is null && lastColumn is null)
        {
            problems.Add(new IntakeParseProblem(mapping.Sheet, "No column holds the name.", "no_name_column"));
        }

        var roleMap = Lookup(mapping.RoleValues.Select(v => (v.Source, v.Target)));
        var departmentMap = mapping.DepartmentValues
            .GroupBy(v => Key(v.Source))
            .ToDictionary(g => g.Key, g => g.First());
        var demographicMap = mapping.DemographicValues
            .GroupBy(v => (v.Field, Key(v.Source)))
            .ToDictionary(g => g.Key, g => g.First().Target);
        var knownDepartments = targets.Departments.ToDictionary(Key, d => d);

        var rows = new List<ParsedImportRow>();
        var newDepartments = new SortedSet<string>(StringComparer.Ordinal);
        var normalised = 0;
        var skipped = new List<int>();
        var columnCount = sheet.ColumnCount;

        for (var r = Math.Max(1, mapping.HeaderRow) + 1; r <= sheet.Rows.Count; r++)
        {
            if (Enumerable.Range(1, columnCount).All(c => sheet.Cell(r, c).Length == 0))
            {
                continue;
            }

            string Read(int? column) => column is int c ? sheet.Cell(r, c).Trim() : string.Empty;

            var rawName = nameColumn is not null
                ? Reorder(Read(nameColumn), mapping.NameOrder)
                : string.Join(' ', new[] { Read(firstColumn), Read(lastColumn) }.Where(p => p.Length > 0));
            var name = NormaliseCase(rawName);
            if (!string.Equals(name, rawName, StringComparison.Ordinal))
            {
                normalised++;
            }

            var email = Read(emailColumn).ToLowerInvariant();

            // A footer ("Total colaboradores: 22") or a subtotal: no letter in the name and no
            // address. Not a person, so not a row to review — but reported, so a file of 40
            // never quietly becomes 39.
            if (email.Length == 0 && !name.Any(char.IsLetter))
            {
                skipped.Add(r);
                continue;
            }

            var roleCell = Read(roleColumn);
            var role = roleColumn is null || roleCell.Length == 0
                ? mapping.DefaultRole
                : roleMap.GetValueOrDefault(Key(roleCell)) ?? IntakeWorkbook.ResolveRole(roleCell) ?? roleCell;

            string? department = null;
            var departmentCell = Read(departmentColumn);
            if (departmentCell.Length > 0)
            {
                if (departmentMap.TryGetValue(Key(departmentCell), out var mapped) && !string.IsNullOrWhiteSpace(mapped.Department))
                {
                    department = mapped.Department.Trim();
                    if (mapped.CreateNew && !knownDepartments.ContainsKey(Key(department)))
                    {
                        newDepartments.Add(department);
                    }
                    else if (knownDepartments.TryGetValue(Key(department), out var canonical))
                    {
                        department = canonical;
                    }
                }
                else
                {
                    department = knownDepartments.GetValueOrDefault(Key(departmentCell)) ?? departmentCell;
                }
            }

            Dictionary<string, string?>? demographics = null;
            foreach (var (column, target) in demographicColumns)
            {
                var cell = Read(column);
                if (cell.Length == 0)
                {
                    continue;
                }

                demographics ??= new Dictionary<string, string?>(StringComparer.Ordinal);
                demographics[target!.Field] = DemographicValue(target, cell, demographicMap);
            }

            rows.Add(new ParsedImportRow(r, name, email, role, department, demographics));
        }

        if (rows.Count == 0)
        {
            problems.Add(new IntakeParseProblem(mapping.Sheet, "The sheet has a header but no data rows.", "no_data_rows"));
        }

        return new IntakeApplyResult(rows, newDepartments.ToList(), problems, normalised, skipped);
    }

    private static string DemographicValue(
        IntakeDemographicTarget target,
        string cell,
        IReadOnlyDictionary<(string Field, string Source), string?> map)
    {
        switch (target.Type)
        {
            case "select":
                if (map.TryGetValue((target.Field, Key(cell)), out var mapped) && !string.IsNullOrWhiteSpace(mapped))
                {
                    return mapped;
                }

                // The stored value itself, in any case, is its own answer.
                return target.Options?.FirstOrDefault(o => Key(o) == Key(cell)) ?? cell;
            case "number":
                var numeric = cell.Replace(',', '.');
                return double.TryParse(numeric, NumberStyles.Number, CultureInfo.InvariantCulture, out var n)
                    ? n.ToString(CultureInfo.InvariantCulture)
                    : cell;
            case "date":
                string[] formats = ["yyyy-MM-dd", "dd/MM/yyyy", "d/M/yyyy", "dd-MM-yyyy", "yyyy/MM/dd"];
                return DateTime.TryParseExact(cell, formats, CultureInfo.InvariantCulture, DateTimeStyles.None, out var date)
                    ? date.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture)
                    : cell;
            default:
                return cell;
        }
    }

    /// <summary>"Rojas Pérez, Ana María" → "Ana María Rojas Pérez" when the file writes surnames first.</summary>
    private static string Reorder(string name, string nameOrder)
    {
        if (nameOrder != "last_first")
        {
            return name;
        }

        var comma = name.IndexOf(',');
        return comma > 0 ? $"{name[(comma + 1)..].Trim()} {name[..comma].Trim()}".Trim() : name;
    }

    /// <summary>
    /// A name written entirely in capitals or entirely in lower case — how HR systems export —
    /// is re-cased; a name with any mixed case was written by a person and is left alone
    /// ("McDonald", "de la Cruz").
    /// </summary>
    public static string NormaliseCase(string name)
    {
        var letters = name.Where(char.IsLetter).ToList();
        if (letters.Count == 0 || (!letters.All(char.IsUpper) && !letters.All(char.IsLower)))
        {
            return name;
        }

        string[] particles = ["de", "del", "la", "las", "los", "y", "da", "van", "von"];
        var words = name.ToLower(CultureInfo.GetCultureInfo("es-CR")).Split(' ', StringSplitOptions.RemoveEmptyEntries);
        return string.Join(' ', words.Select((word, index) =>
            index > 0 && particles.Contains(word) ? word : char.ToUpper(word[0], CultureInfo.GetCultureInfo("es-CR")) + word[1..]));
    }

    private static Dictionary<string, string> Lookup(IEnumerable<(string Source, string Target)> pairs) =>
        pairs.GroupBy(p => Key(p.Source)).ToDictionary(g => g.Key, g => g.First().Target);

    /// <summary>Case-, accent- and spacing-insensitive: "Jefe de Área" and "JEFE DE AREA" are one value.</summary>
    public static string Key(string? value) => IntakeWorkbook.NormaliseHeader(value);
}
