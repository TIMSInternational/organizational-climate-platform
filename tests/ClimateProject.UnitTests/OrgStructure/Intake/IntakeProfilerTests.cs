using System.Text;
using System.Text.Json;
using ClimateProject.Application.OrgStructure.Intake;
using ClosedXML.Excel;

namespace ClimateProject.UnitTests.OrgStructure.Intake;

/// <summary>
/// The profile is everything the model is shown. These tests pin the privacy promise the demo
/// makes out loud — "the AI never sees your people's names or emails" — against the actual
/// serialised bytes, not against a description of them.
/// </summary>
public class IntakeProfilerTests
{
    private static readonly string[][] Roster =
    [
        ["Planilla de personal — Grupo Meridiano 2026", "", "", "", "", "", ""],
        ["", "", "", "", "", "", ""],
        ["Nombre completo", "Correo institucional", "Cédula", "Puesto", "Área", "Sede", "Fecha de nacimiento"],
        ["Rojas Pérez, Ana María", "ana.rojas@meridiano.cr", "112340567", "Gerente de Finanzas", "Finanzas", "San José", "1984-03-12"],
        ["Jiménez Mora, Carlos", "carlos.jimenez@meridiano.cr", "203450678", "Analista Financiero", "Finanzas", "San José", "1990-07-01"],
        ["Solano Vega, Diego", "diego.solano@meridiano.cr", "304560789", "Desarrollador", "TI", "Heredia", "1995-11-23"],
        ["Vargas Castro, Sofía", "sofia.vargas@meridiano.cr", "105670891", "Supervisora de Turno", "Operaciones", "Heredia", "1988-02-14"],
        ["Mora Quesada, Luis", "luis.mora@meridiano.cr", "206780912", "Operario", "Operaciones", "Heredia", "1999-09-09"],
        ["Chaves León, Paula", "paula.chaves@meridiano.cr", "307891023", "Analista Financiero", "Finanzas", "San José", "1992-05-30"],
    ];

    private static SheetGrid Grid(string[][] rows, string name = "Personal") =>
        new(name, rows.Select(r => (IReadOnlyList<string>)r).ToList());

    [Fact]
    public void The_serialised_profile_carries_no_name_email_identity_number_or_birth_date()
    {
        var profile = IntakeProfiler.Build([Grid(Roster)]);
        var json = JsonSerializer.Serialize(profile);

        foreach (var row in Roster.Skip(3))
        {
            Assert.DoesNotContain(row[0], json, StringComparison.Ordinal);             // full name
            Assert.DoesNotContain(row[0].Split(',')[0], json, StringComparison.Ordinal); // surnames alone
            Assert.DoesNotContain(row[1], json, StringComparison.Ordinal);             // email
            Assert.DoesNotContain(row[1].Split('@')[0], json, StringComparison.Ordinal); // local part
            Assert.DoesNotContain(row[2], json, StringComparison.Ordinal);             // cédula
            Assert.DoesNotContain(row[6], json, StringComparison.Ordinal);             // birth date
        }
    }

    [Fact]
    public void Organisational_categories_are_shared_as_values_with_counts()
    {
        var sheet = IntakeProfiler.Build([Grid(Roster)]).Sheets.Single();

        var area = sheet.Columns.Single(c => c.Header == "Área");
        Assert.Equal("category", area.Kind);
        Assert.Contains(new ValueCount("Finanzas", 3), area.Values!);
        Assert.Contains(new ValueCount("TI", 1), area.Values!);

        var puesto = sheet.Columns.Single(c => c.Header == "Puesto");
        Assert.Equal("category", puesto.Kind);
        Assert.Contains(puesto.Values!, v => v.Value == "Supervisora de Turno");
    }

    [Fact]
    public void Personal_columns_are_shared_only_as_masked_shapes()
    {
        var sheet = IntakeProfiler.Build([Grid(Roster)]).Sheets.Single();

        var name = sheet.Columns.Single(c => c.Header == "Nombre completo");
        Assert.Null(name.Values);
        Assert.Equal("Ro*** Pé***, An*** Ma***", name.MaskedSamples![0]);

        var email = sheet.Columns.Single(c => c.Header == "Correo institucional");
        Assert.Equal("email", email.Kind);
        Assert.Equal("a***@meridiano.cr", email.MaskedSamples![0]);

        Assert.Equal("1984-**-**", sheet.Columns.Single(c => c.Header == "Fecha de nacimiento").MaskedSamples![0]);
        Assert.Equal("#########", sheet.Columns.Single(c => c.Header == "Cédula").MaskedSamples![0]);
    }

    [Fact]
    public void The_header_row_is_found_below_a_title_and_a_blank_spacer()
    {
        Assert.Equal(3, IntakeProfiler.GuessHeaderRow(Grid(Roster)));
        Assert.Equal(6, IntakeProfiler.Build([Grid(Roster)]).Sheets.Single().RowCount);
    }

    /// <summary>
    /// Three people means three distinct names — which looks exactly like a category of three
    /// by the values alone. The header decides, and it says "Nombre".
    /// </summary>
    [Fact]
    public void A_tiny_file_does_not_leak_names_as_a_category()
    {
        string[][] tiny =
        [
            ["Nombre", "Correo", "Área"],
            ["Ana Rojas", "ana@x.cr", "Finanzas"],
            ["Luis Mora", "luis@x.cr", "Ventas"],
        ];

        var json = JsonSerializer.Serialize(IntakeProfiler.Build([Grid(tiny)]));

        Assert.DoesNotContain("Ana Rojas", json, StringComparison.Ordinal);
        Assert.DoesNotContain("Luis Mora", json, StringComparison.Ordinal);
        // …while the area, named as a category by its header, is still shared.
        Assert.Contains("Finanzas", json, StringComparison.Ordinal);
    }

    /// <summary>
    /// Surnames repeat — Mora, Vargas and Rodríguez are among the most common in Costa Rica — so a
    /// separate surname column in a real roster LOOKS like a category by its values. Only the
    /// header says otherwise, and it must win.
    /// </summary>
    [Fact]
    public void A_surname_column_whose_values_repeat_is_still_masked()
    {
        string[][] rows =
        [
            ["Nombre", "Primer apellido", "Correo"],
            ["Ana", "Mora", "a@x.cr"], ["Luis", "Mora", "b@x.cr"], ["Carla", "Vargas", "c@x.cr"],
            ["Diego", "Vargas", "d@x.cr"], ["Sofía", "Mora", "e@x.cr"], ["Paula", "Rodríguez", "f@x.cr"],
            ["Jorge", "Rodríguez", "g@x.cr"], ["Elena", "Mora", "h@x.cr"],
        ];

        var json = JsonSerializer.Serialize(IntakeProfiler.Build([Grid(rows)]));

        Assert.DoesNotContain("Vargas", json, StringComparison.Ordinal);
        Assert.DoesNotContain("Rodríguez", json, StringComparison.Ordinal);
        Assert.DoesNotContain("\u0022Mora\u0022", json, StringComparison.Ordinal);
        Assert.DoesNotContain("\"Mora\"", json, StringComparison.Ordinal);
    }

    [Fact]
    public void A_job_title_header_that_contains_the_word_name_is_still_a_category()
    {
        string[][] rows =
        [
            ["Nombre del puesto", "Correo"],
            ["Analista", "a@x.cr"], ["Analista", "b@x.cr"], ["Gerente", "c@x.cr"], ["Analista", "d@x.cr"],
        ];

        var column = IntakeProfiler.Build([Grid(rows)]).Sheets.Single().Columns[0];

        Assert.Equal("category", column.Kind);
    }

    [Fact]
    public void A_workbook_is_read_sheet_by_sheet_with_dates_as_iso_and_hidden_sheets_skipped()
    {
        using var workbook = new XLWorkbook();
        var people = workbook.AddWorksheet("Personal");
        people.Cell(1, 1).Value = "Nombre";
        people.Cell(1, 2).Value = "Ingreso";
        people.Cell(1, 3).Value = "Años";
        people.Cell(2, 1).Value = "Ana";
        people.Cell(2, 2).Value = new DateTime(2019, 4, 1);
        people.Cell(2, 3).Value = 7;
        workbook.AddWorksheet("Listas").Visibility = XLWorksheetVisibility.Hidden;
        using var stream = new MemoryStream();
        workbook.SaveAs(stream);
        stream.Position = 0;

        var sheets = SpreadsheetReader.Read(stream, "personal.xlsx");

        var sheet = Assert.Single(sheets);
        Assert.Equal("2019-04-01", sheet.Cell(2, 2));
        Assert.Equal("7", sheet.Cell(2, 3));
    }

    /// <summary>What a Spanish-locale Excel "Save as CSV" actually produces: Windows-1252, semicolons.</summary>
    [Fact]
    public void A_latin1_semicolon_csv_reads_with_its_accents_and_quoted_commas_intact()
    {
        var text = "Nombre;Área\r\n\"Jiménez, Carlos\";Operaciones\r\n";
        var bytes = Encoding.Latin1.GetBytes(text);

        var sheet = Assert.Single(SpreadsheetReader.Read(new MemoryStream(bytes), "personal.csv"));

        Assert.Equal("Área", sheet.Cell(1, 2));
        Assert.Equal("Jiménez, Carlos", sheet.Cell(2, 1));
    }

    [Fact]
    public void A_file_that_is_neither_a_workbook_nor_text_is_refused()
    {
        var binary = new byte[] { 0x25, 0x50, 0x44, 0x46, 0x00, 0x01, 0x02 };

        Assert.Throws<InvalidDataException>(() => SpreadsheetReader.Read(new MemoryStream(binary), "scan.pdf"));
    }
}
