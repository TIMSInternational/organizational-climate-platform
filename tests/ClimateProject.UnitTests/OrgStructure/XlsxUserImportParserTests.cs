using ClimateProject.Application.Auth;
using ClimateProject.Application.OrgStructure;
using ClosedXML.Excel;

namespace ClimateProject.UnitTests.OrgStructure;

public class XlsxUserImportParserTests
{
    private const string Company = "Grupo Meridiano S.A.";
    private static readonly string[] Departments = ["Ingeniería", "Operaciones"];

    /// <summary>
    /// A workbook with the given header labels at <paramref name="headerRow"/> and the given
    /// rows under it. Takes the labels verbatim so a test can spell a header the way a client
    /// would rather than the way the template does.
    /// </summary>
    private static MemoryStream Workbook(
        string[] headers,
        IEnumerable<string?[]> rows,
        int headerRow = 1,
        string sheetName = IntakeWorkbook.PeopleSheet)
    {
        using var workbook = new XLWorkbook();
        var sheet = workbook.Worksheets.Add(sheetName);

        for (var i = 0; i < headers.Length; i++)
        {
            sheet.Cell(headerRow, i + 1).Value = headers[i];
        }

        var rowNumber = headerRow + 1;
        foreach (var row in rows)
        {
            for (var i = 0; i < row.Length; i++)
            {
                if (row[i] is not null)
                {
                    sheet.Cell(rowNumber, i + 1).Value = row[i];
                }
            }

            rowNumber++;
        }

        var buffer = new MemoryStream();
        workbook.SaveAs(buffer);
        buffer.Position = 0;
        return buffer;
    }

    [Theory]
    [InlineData("Departamento", "departamento")]
    [InlineData("  DEPARTAMENTO  ", "departamento")]
    [InlineData("Correo electrónico", "correo electronico")]
    [InlineData("E-mail", "e mail")]
    [InlineData("Nombre  Completo", "nombre completo")]
    [InlineData("Correo:", "correo")]
    [InlineData(null, "")]
    public void NormaliseHeader_folds_case_accents_and_punctuation(string? raw, string expected)
        => Assert.Equal(expected, IntakeWorkbook.NormaliseHeader(raw));

    [Theory]
    [InlineData("Colaborador", Roles.Employee)]
    [InlineData("colaboradora", Roles.Employee)]
    [InlineData("Empleado", Roles.Employee)]
    [InlineData("employee", Roles.Employee)]
    [InlineData("Líder", Roles.Leader)]
    [InlineData("lider", Roles.Leader)]
    [InlineData("LIDER", Roles.Leader)]
    [InlineData("Supervisor", Roles.Supervisor)]
    public void ResolveRole_accepts_the_words_the_workbook_offers(string cell, string expected)
        => Assert.Equal(expected, IntakeWorkbook.ResolveRole(cell));

    /// <summary>
    /// The two roles bulk import refuses are not merely invalid here, they are unknown: see the
    /// note on <see cref="IntakeWorkbook.RoleSynonyms"/>. If this ever passes, a workbook could
    /// name a company_admin and only the endpoint would stop it.
    /// </summary>
    [Theory]
    [InlineData("administrador")]
    [InlineData("company_admin")]
    [InlineData("super_admin")]
    [InlineData("Gerente")]
    [InlineData("")]
    public void ResolveRole_rejects_admin_roles_and_unknown_words(string cell)
        => Assert.Null(IntakeWorkbook.ResolveRole(cell));

    [Fact]
    public void Reads_rows_under_a_header_that_is_not_the_first_row()
    {
        // A title and a blank spacer above the table, which is what comes back from an HR
        // department and what the template itself writes.
        using var stream = Workbook(
            ["Nombre", "Correo", "Rol", "Departamento"],
            [["Ana Rojas", "ana@meridiano.test", "Colaborador", "Ingeniería"]],
            headerRow: 4);

        var result = XlsxUserImportParser.Parse(stream);

        Assert.Empty(result.Problems);
        var row = Assert.Single(result.Rows);
        Assert.Equal("Ana Rojas", row.Name);
        Assert.Equal("ana@meridiano.test", row.Email);
        Assert.Equal(Roles.Employee, row.Role);
        Assert.Equal("Ingeniería", row.Department);
        // The row number is the one in the admin's own file, so an error can be found in it.
        Assert.Equal(5, row.RowNumber);
    }

    [Fact]
    public void Maps_columns_by_header_not_by_position()
    {
        using var stream = Workbook(
            ["Departamento", "Rol", "Correo", "Nombre"],
            [["Operaciones", "Supervisor", "luis@meridiano.test", "Luis Mora"]]);

        var row = Assert.Single(XlsxUserImportParser.Parse(stream).Rows);

        Assert.Equal("Luis Mora", row.Name);
        Assert.Equal("luis@meridiano.test", row.Email);
        Assert.Equal(Roles.Supervisor, row.Role);
        Assert.Equal("Operaciones", row.Department);
    }

    [Fact]
    public void Skips_wholly_blank_rows_but_keeps_incomplete_ones()
    {
        using var stream = Workbook(
            ["Nombre", "Correo", "Rol", "Departamento"],
            [
                ["Ana Rojas", "ana@meridiano.test", "Colaborador", "Ingeniería"],
                [null, null, null, null],
                // Named but no email: kept, so the admin sees it is missing rather than
                // approving an import that silently dropped somebody.
                ["Sin Correo", null, "Colaborador", "Ingeniería"],
            ]);

        var result = XlsxUserImportParser.Parse(stream);

        Assert.Equal(2, result.Rows.Count);
        Assert.Equal("Ana Rojas", result.Rows[0].Name);
        Assert.Equal("Sin Correo", result.Rows[1].Name);
        Assert.Equal(string.Empty, result.Rows[1].Email);
        // Row 4 in the file, not row 3 of the data: the blank row still occupies a line.
        Assert.Equal(4, result.Rows[1].RowNumber);
    }

    [Fact]
    public void Passes_an_unrecognised_role_through_so_the_endpoint_can_name_it()
    {
        using var stream = Workbook(
            ["Nombre", "Correo", "Rol", "Departamento"],
            [["Ana Rojas", "ana@meridiano.test", "Gerente", "Ingeniería"]]);

        var row = Assert.Single(XlsxUserImportParser.Parse(stream).Rows);

        Assert.Equal("Gerente", row.Role);
    }

    [Fact]
    public void Reports_a_missing_sheet_rather_than_throwing()
    {
        using var stream = Workbook(["Nombre", "Correo"], [], sheetName: "Hoja1");

        var result = XlsxUserImportParser.Parse(stream);

        Assert.Empty(result.Rows);
        var problem = Assert.Single(result.Problems);
        Assert.Equal(IntakeWorkbook.PeopleSheet, problem.Sheet);
        Assert.Contains(IntakeWorkbook.PeopleSheet, problem.Message, StringComparison.Ordinal);
    }

    [Fact]
    public void Reports_a_missing_role_column_once_for_the_file()
    {
        using var stream = Workbook(
            ["Nombre", "Correo"],
            [
                ["Ana Rojas", "ana@meridiano.test"],
                ["Luis Mora", "luis@meridiano.test"],
            ]);

        var result = XlsxUserImportParser.Parse(stream);

        Assert.Equal(2, result.Rows.Count);
        // Once, not once per row.
        Assert.Single(result.Problems, p => p.Code == "missing_column" && p.Value == "Rol" && p.Message.Contains("Rol", StringComparison.Ordinal));
    }

    [Fact]
    public void Reports_a_header_with_no_data_rows()
    {
        using var stream = Workbook(["Nombre", "Correo", "Rol", "Departamento"], []);

        var result = XlsxUserImportParser.Parse(stream);

        Assert.Empty(result.Rows);
        Assert.Single(result.Problems, p => p.Code == "no_data_rows" && p.Message.Contains("no data rows", StringComparison.Ordinal));
    }

    [Fact]
    public void Reports_a_sheet_with_no_recognisable_header()
    {
        using var stream = Workbook(["Persona", "Contacto"], [["Ana", "ana@meridiano.test"]]);

        var result = XlsxUserImportParser.Parse(stream);

        Assert.Empty(result.Rows);
        Assert.Single(result.Problems, p => p.Code == "no_header" && p.Message.Contains("No header row", StringComparison.Ordinal));
    }

    /// <summary>
    /// The contract test the two halves exist for: the template's own columns, at the template's
    /// own header row, parse back. A template that writes a header the parser does not recognise
    /// is invisible until a client has filled the file in.
    /// </summary>
    [Fact]
    public void The_template_this_repository_hands_out_parses_back()
    {
        var templateBytes = IntakeTemplateWorkbook.Build(Company, Departments);

        using var filled = new MemoryStream();
        using (var input = new MemoryStream(templateBytes))
        using (var workbook = new XLWorkbook(input))
        {
            var sheet = workbook.Worksheet(IntakeWorkbook.PeopleSheet);
            // The first row under the header the template wrote.
            sheet.Cell(5, 1).Value = "Ana Rojas";
            sheet.Cell(5, 2).Value = "ana@meridiano.test";
            sheet.Cell(5, 3).Value = "Colaborador";
            sheet.Cell(5, 4).Value = "Ingeniería";
            workbook.SaveAs(filled);
        }

        filled.Position = 0;
        var result = XlsxUserImportParser.Parse(filled);

        Assert.Empty(result.Problems);
        var row = Assert.Single(result.Rows);
        Assert.Equal("Ana Rojas", row.Name);
        Assert.Equal("ana@meridiano.test", row.Email);
        Assert.Equal(Roles.Employee, row.Role);
        Assert.Equal("Ingeniería", row.Department);
    }

    [Fact]
    public void The_template_offers_every_role_bulk_import_accepts_and_no_others()
    {
        // Roles.All minus the two BulkImportEndpoints refuses.
        string[] importable = [Roles.Leader, Roles.Supervisor, Roles.Employee];

        Assert.Equal(importable.Order(), IntakeWorkbook.OfferedRoles.Order());
        Assert.DoesNotContain(Roles.SuperAdmin, IntakeWorkbook.OfferedRoles);
        Assert.DoesNotContain(Roles.CompanyAdmin, IntakeWorkbook.OfferedRoles);
    }

    [Fact]
    public void The_template_builds_for_a_company_with_no_departments()
    {
        // A brand-new company is the first thing an intake wizard meets, and a data validation
        // over an empty range throws rather than producing an empty dropdown.
        var bytes = IntakeTemplateWorkbook.Build("Nueva Empresa", []);

        using var stream = new MemoryStream(bytes);
        using var workbook = new XLWorkbook(stream);
        Assert.True(workbook.Worksheets.Contains(IntakeWorkbook.PeopleSheet));
    }
}
