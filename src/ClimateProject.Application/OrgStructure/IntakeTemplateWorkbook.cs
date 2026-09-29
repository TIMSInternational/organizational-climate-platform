using ClosedXML.Excel;

namespace ClimateProject.Application.OrgStructure;

/// <summary>
/// Writes the workbook the client fills in.
///
/// <para>Generated per company rather than served as a static file, so the "Departamento" column
/// is a dropdown of THAT company's departments. "Department not found" is the error a bulk import
/// produces most, and it is produced entirely by a human typing a department's name slightly
/// differently from the way it is stored; a dropdown removes the opportunity rather than
/// reporting the consequence.</para>
/// </summary>
public static class IntakeTemplateWorkbook
{
    /// <summary>Rows of the people sheet that carry validation, i.e. how many people one file may name.</summary>
    internal const int ValidatedRows = 1000;

    private const string ListsSheet = "Listas";

    public static byte[] Build(string companyName, IReadOnlyList<string> departmentNames)
    {
        ArgumentNullException.ThrowIfNull(departmentNames);

        using var workbook = new XLWorkbook();
        var people = workbook.Worksheets.Add(IntakeWorkbook.PeopleSheet);

        people.Cell(1, 1).Value = $"Personas de {companyName}";
        people.Cell(1, 1).Style.Font.Bold = true;
        people.Cell(1, 1).Style.Font.FontSize = 14;
        people.Cell(2, 1).Value =
            "Complete una fila por persona. No cambie los títulos de la fila 4. "
            + "Las columnas Rol y Departamento se eligen de la lista desplegable.";
        people.Range(2, 1, 2, 4).Merge();
        people.Row(2).Style.Alignment.WrapText = true;
        people.Row(2).Height = 30;

        // Row 4, not row 1: the title and the instruction live above it, which is exactly the
        // shape XlsxUserImportParser scans for rather than assuming.
        const int headerRow = 4;
        var headers = new[] { "name", "email", "role", "department" };
        for (var i = 0; i < headers.Length; i++)
        {
            var label = IntakeWorkbook.PeopleColumns[headers[i]][0];
            var cell = people.Cell(headerRow, i + 1);
            cell.Value = char.ToUpperInvariant(label[0]) + label[1..];
            cell.Style.Font.Bold = true;
            cell.Style.Fill.BackgroundColor = XLColor.FromArgb(0xE8, 0xEC, 0xF2);
            cell.Style.Border.BottomBorder = XLBorderStyleValues.Thin;
        }

        people.Column(1).Width = 28;
        people.Column(2).Width = 34;
        people.Column(3).Width = 16;
        people.Column(4).Width = 26;
        people.SheetView.FreezeRows(headerRow);

        // The lists the dropdowns point at. A separate sheet rather than an in-cell list
        // because Excel caps an inline list at 255 characters, which a real company's
        // department names exceed long before the list stops being useful.
        var lists = workbook.Worksheets.Add(ListsSheet);
        lists.Cell(1, 1).Value = "Rol";
        for (var i = 0; i < IntakeWorkbook.OfferedRoles.Length; i++)
        {
            // The Spanish word, which is what ResolveRole maps back. Writing "employee" into a
            // Spanish workbook would be the hardcoded-English defect in a new place.
            lists.Cell(i + 2, 1).Value = SpanishRoleLabel(IntakeWorkbook.OfferedRoles[i]);
        }

        lists.Cell(1, 2).Value = "Departamento";
        for (var i = 0; i < departmentNames.Count; i++)
        {
            lists.Cell(i + 2, 2).Value = departmentNames[i];
        }

        var firstDataRow = headerRow + 1;
        var lastDataRow = headerRow + ValidatedRows;

        people.Range(firstDataRow, 3, lastDataRow, 3).CreateDataValidation()
            .List(lists.Range(2, 1, 1 + IntakeWorkbook.OfferedRoles.Length, 1), true);

        if (departmentNames.Count > 0)
        {
            people.Range(firstDataRow, 4, lastDataRow, 4).CreateDataValidation()
                .List(lists.Range(2, 2, 1 + departmentNames.Count, 2), true);
        }

        // Hidden, not deleted: the dropdowns reference it, so a reader who deletes it breaks
        // the file. Hiding keeps it out of the way without inviting that.
        lists.Hide();

        using var buffer = new MemoryStream();
        workbook.SaveAs(buffer);
        return buffer.ToArray();
    }

    /// <summary>
    /// The label the template offers for a role. Deliberately a switch over the constants rather
    /// than a reverse lookup of <see cref="IntakeWorkbook.RoleSynonyms"/>: that map is
    /// many-to-one and its iteration order is not a contract, so a reverse lookup would pick an
    /// arbitrary synonym and the template's wording would change when a synonym is added.
    /// </summary>
    private static string SpanishRoleLabel(string role) => role switch
    {
        Auth.Roles.Employee => "Colaborador",
        Auth.Roles.Leader => "Líder",
        Auth.Roles.Supervisor => "Supervisor",
        _ => role,
    };
}
