using System.Globalization;
using ClimateTracking.Application.Export;
using ClimateTracking.Domain.Entities;
using ClosedXML.Excel;

namespace ClimateTracking.UnitTests.Export;

/// <summary>
/// The structure contract of Procomer acceptance criterion 7, asserted by opening the produced
/// bytes as a workbook and reading cells out of it. Deliberately not by inspecting the byte
/// array: a zip header is not a worksheet, and "la misma estructura" is a claim about the sheet
/// the client opens, not about the file's first four bytes.
/// </summary>
public class TrackingSheetExportTests
{
    private static readonly SemaforoThresholdConfig Config = new();

    private const string Nodo = "ND-014";
    private const string Lider = "PER-0231";
    private const string Responsable = "PER-0450";

    /// <summary>Column numbers, 1-based as the sheet counts them, in the template's order.</summary>
    private const int NoCol = 1;
    private const int NodoCol = 2;
    private const int LiderCol = 3;
    private const int HallazgoCol = 4;
    private const int QueCol = 5;
    private const int ComoCol = 6;
    private const int ResponsableCol = 7;
    private const int FechaCompromisoCol = 8;
    private const int AvanceCol = 9;
    private const int EstadoCol = 10;
    private const int CorreosCol = 11;
    private const int UltimaActualizacionCol = 12;
    private const int ComentariosCol = 13;

    private const int HeaderRow = 1;
    private const int FirstDataRow = 2;

    private static PlanDeAccion Plan(
        string planCode = "PA-2026-00001",
        string nodo = Nodo,
        string lider = Lider,
        string responsable = Responsable,
        string? hallazgo = null,
        string que = "Implementar un programa mensual de reconocimiento",
        string como = "Nominacion por formulario simple",
        DateOnly? creacion = null,
        DateOnly? compromiso = null) => new()
        {
            PlanCode = planCode,
            NodoExternalId = nodo,
            LiderExternalId = lider,
            ResponsableEjecucionExternalId = responsable,
            HallazgoExternalId = hallazgo,
            DescripcionQue = que,
            MetodologiaComo = como,
            FechaCreacion = creacion ?? new DateOnly(2026, 1, 1),
            FechaCompromiso = compromiso ?? new DateOnly(2026, 6, 30),
        };

    private static TrackingSheetLookups Lookups(
        (string Id, string Nombre)[]? nodos = null,
        (string Id, string Nombre, string Correo)[]? personas = null,
        (string Id, string Categoria)[]? hallazgos = null) => new(
            (nodos ?? []).ToDictionary(n => n.Id, n => n.Nombre, StringComparer.Ordinal),
            (personas ?? []).ToDictionary(
                p => p.Id,
                p => new PersonaCache
                {
                    ExternalId = p.Id,
                    NombreCompleto = p.Nombre,
                    Correo = p.Correo,
                    NodoExternalId = Nodo,
                },
                StringComparer.Ordinal),
            (hallazgos ?? []).ToDictionary(h => h.Id, h => h.Categoria, StringComparer.Ordinal));

    /// <summary>
    /// The bytes, read back with the library. <see cref="XLWorkbook"/> reads the whole stream in
    /// its constructor, so the caller owns only the workbook.
    /// </summary>
    private static XLWorkbook Open(byte[] bytes)
    {
        using var stream = new MemoryStream(bytes);
        return new XLWorkbook(stream);
    }

    private static XLWorkbook Export(TrackingSheetLookups lookups, params PlanDeAccion[] planes) =>
        Open(TrackingSheetExport.Build(planes, lookups));

    private static XLWorkbook Export(params PlanDeAccion[] planes) =>
        Export(TrackingSheetLookups.Empty, planes);

    [Fact]
    public void The_export_is_a_workbook_and_opens_as_one()
    {
        // The assertion is that the line above it did not throw: anything that is not an
        // Office Open XML package cannot be opened by this constructor at all.
        using var workbook = Export();

        Assert.Equal(1, workbook.Worksheets.Count);
    }

    [Fact]
    public void The_only_worksheet_is_named_exactly_Tracking()
    {
        using var workbook = Export(Plan());

        // The literal, not TrackingSheetExport.SheetName: the client's template names the sheet
        // "Tracking" and a test that reads the name out of the code under test asserts nothing.
        Assert.Equal("Tracking", workbook.Worksheet(1).Name);
        Assert.Equal(1, workbook.Worksheets.Count);
    }

    [Fact]
    public void Header_row_is_the_thirteen_template_columns_in_order()
    {
        using var workbook = Export();
        var sheet = workbook.Worksheet(1);

        var headers = Enumerable.Range(1, 13).Select(column => sheet.Cell(HeaderRow, column).GetText()).ToList();

        Assert.Equal(
            [
                "No.",
                "Nodo / Área",
                "Líder responsable",
                "Hallazgo (tema de la encuesta)",
                "Plan de acción (Qué)",
                "Cómo",
                "Responsable de ejecución (Quién)",
                "Fecha compromiso",
                "% Avance",
                "Estado",
                "Involucrados a notificar (correos)",
                "Última actualización",
                "Comentarios",
            ],
            headers);
    }

    [Fact]
    public void Nothing_is_written_past_the_thirteenth_column()
    {
        using var workbook = Export(Plan());
        var sheet = workbook.Worksheet(1);

        Assert.True(sheet.Cell(HeaderRow, 14).IsEmpty());
        Assert.True(sheet.Cell(FirstDataRow, 14).IsEmpty());
        Assert.Equal(13, TrackingSheetExport.Columns.Count);
    }

    /// <summary>
    /// The guarantee the choice of format rests on. A cell in a typeless format has to defuse a
    /// value opening with a dash by prepending a leading apostrophe, which the client then reads
    /// in the cell; a workbook cell declares itself as text, so what the user wrote is what the
    /// sheet holds.
    /// </summary>
    [Fact]
    public void A_bulleted_spanish_sentence_keeps_its_dash_and_gains_no_apostrophe()
    {
        const string que = "- Capacitar al personal en manejo de conflictos";
        const string comentario = "-  pendiente de aprobación por la jefatura";

        var plan = Plan(que: que, como: "+ Sesiones quincenales");
        plan.RegistrarAvance(0.2m, Lider, comentario, new DateOnly(2026, 2, 1), Config);

        using var workbook = Export(plan);
        var sheet = workbook.Worksheet(1);

        foreach (var (column, expected) in new[]
        {
            (QueCol, que),
            (ComoCol, "+ Sesiones quincenales"),
            (ComentariosCol, comentario),
        })
        {
            var cell = sheet.Cell(FirstDataRow, column);
            Assert.Equal(expected, cell.GetText());
            Assert.Equal(XLDataType.Text, cell.DataType);
            // A leading apostrophe is stored as this flag rather than as a character, so
            // asserting on the text alone would not notice a formula guard being introduced.
            Assert.False(cell.Style.IncludeQuotePrefix);
        }
    }

    /// <summary>
    /// The other half of the same guarantee: writing these values with no formula guard must not
    /// hand the client a sheet that runs something when they open it.
    /// </summary>
    [Fact]
    public void Text_that_looks_like_a_formula_stays_text_and_is_not_evaluated()
    {
        const string que = "=HYPERLINK(\"http://evil.test\",\"pago\")";
        var plan = Plan(que: que, como: "@promedio de asistencia");

        using var workbook = Export(plan);
        var cell = workbook.Worksheet(1).Cell(FirstDataRow, QueCol);

        Assert.False(cell.HasFormula);
        Assert.Equal(XLDataType.Text, cell.DataType);
        Assert.Equal(que, cell.GetText());
        Assert.False(cell.Style.IncludeQuotePrefix);
        Assert.Equal("@promedio de asistencia", workbook.Worksheet(1).Cell(FirstDataRow, ComoCol).GetText());
    }

    /// <summary>
    /// The mirror image: the format itself consumes one leading apostrophe, so a comentario that
    /// genuinely starts with one must not arrive a character short either.
    /// </summary>
    [Fact]
    public void Text_that_genuinely_begins_with_an_apostrophe_keeps_it()
    {
        const string que = "'Cero papel' como meta del trimestre";

        using var workbook = Export(Plan(que: que));

        Assert.Equal(que, workbook.Worksheet(1).Cell(FirstDataRow, QueCol).GetText());
    }

    [Fact]
    public void Numero_fecha_and_avance_are_real_cell_types_not_text()
    {
        var plan = Plan(compromiso: new DateOnly(2026, 3, 4));
        plan.RegistrarAvance(0.35m, Lider, null, new DateOnly(2026, 2, 9), Config);

        using var workbook = Export(plan);
        var sheet = workbook.Worksheet(1);

        Assert.Equal(XLDataType.Number, sheet.Cell(FirstDataRow, NoCol).DataType);
        Assert.Equal(1, sheet.Cell(FirstDataRow, NoCol).GetDouble());

        Assert.Equal(XLDataType.DateTime, sheet.Cell(FirstDataRow, FechaCompromisoCol).DataType);
        Assert.Equal(new DateTime(2026, 3, 4, 0, 0, 0, DateTimeKind.Unspecified), sheet.Cell(FirstDataRow, FechaCompromisoCol).GetDateTime());
        Assert.Equal("yyyy-mm-dd", sheet.Cell(FirstDataRow, FechaCompromisoCol).Style.DateFormat.Format);

        Assert.Equal(XLDataType.DateTime, sheet.Cell(FirstDataRow, UltimaActualizacionCol).DataType);
        Assert.Equal(new DateTime(2026, 2, 9, 0, 0, 0, DateTimeKind.Unspecified), sheet.Cell(FirstDataRow, UltimaActualizacionCol).GetDateTime());

        Assert.Equal(XLDataType.Number, sheet.Cell(FirstDataRow, AvanceCol).DataType);
        // Excel's built-in General (number-format id 0). What that renders is asserted below,
        // in Porcentaje_avance_renders_as_a_bare_number, which is the assertion that matters.
        Assert.Equal(0, sheet.Cell(FirstDataRow, AvanceCol).Style.NumberFormat.NumberFormatId);
    }

    /// <summary>
    /// The "% Avance" column as the client reads it, asserted on the string the cell renders
    /// rather than on the number-format code that produces it.
    /// </summary>
    /// <remarks>
    /// Excel's format grammar is not .NET's, and the difference is invisible in a review: in a
    /// format code the "." is a literal that is always emitted and "#" suppresses a digit but
    /// never the separator before it, so a picture format such as "0.##" — which
    /// <c>ToString("0.##")</c> renders as "35" — puts a trailing point on every whole
    /// percentage in this column ("0.", "25.", "35.", "100."). Asserting the format code
    /// cannot see that; asserting the rendered string can. Rendered through the invariant
    /// culture so the separator a locale would use is not what is under test here.
    /// </remarks>
    [Theory]
    [InlineData("0", 0)]
    [InlineData("7.5", 0.075)]
    [InlineData("25", 0.25)]
    [InlineData("33.33", 0.3333)]
    [InlineData("35", 0.35)]
    [InlineData("50", 0.5)]
    [InlineData("75", 0.75)]
    [InlineData("100", 1)]
    public void Porcentaje_avance_renders_as_a_bare_number(string expected, double fraccion)
    {
        var plan = Plan();
        plan.RegistrarAvance((decimal)fraccion, Lider, null, new DateOnly(2026, 2, 1), Config);

        using var workbook = Export(plan);

        Assert.Equal(
            expected,
            workbook.Worksheet(1).Cell(FirstDataRow, AvanceCol).GetFormattedString(CultureInfo.InvariantCulture));
    }

    [Theory]
    [InlineData(0, 0)]
    [InlineData(35, 0.35)]
    [InlineData(33.33, 0.3333)]
    [InlineData(7.5, 0.075)]
    [InlineData(100, 1)]
    public void Porcentaje_avance_is_the_stored_fraction_multiplied_by_one_hundred(
        double expected, double fraccion)
    {
        var plan = Plan();
        plan.RegistrarAvance((decimal)fraccion, Lider, null, new DateOnly(2026, 2, 1), Config);

        using var workbook = Export(plan);

        Assert.Equal(expected, workbook.Worksheet(1).Cell(FirstDataRow, AvanceCol).GetDouble(), 10);
    }

    [Fact]
    public void Estado_semaforo_is_capitalised_spanish()
    {
        // Vencido sin cumplir.
        var rojo = Plan(compromiso: new DateOnly(2026, 1, 10));
        rojo.RegistrarAvance(0.2m, Lider, null, new DateOnly(2026, 1, 20), Config);

        // 21 days from the commitment date with 10% done against 47.5% expected.
        var amarillo = Plan(compromiso: new DateOnly(2026, 2, 10));
        amarillo.RegistrarAvance(0.1m, Lider, null, new DateOnly(2026, 1, 20), Config);

        var verde = Plan();
        verde.MarcarCumplido(new DateOnly(2026, 2, 1), Lider);

        using var workbook = Export(rojo, amarillo, verde);
        var sheet = workbook.Worksheet(1);

        Assert.Equal("Rojo", sheet.Cell(FirstDataRow, EstadoCol).GetText());
        Assert.Equal("Amarillo", sheet.Cell(FirstDataRow + 1, EstadoCol).GetText());
        Assert.Equal("Verde", sheet.Cell(FirstDataRow + 2, EstadoCol).GetText());
    }

    [Fact]
    public void Ids_are_resolved_to_the_names_the_client_reads()
    {
        var plan = Plan(hallazgo: "HAL-7");
        plan.AgregarInvolucrado("PER-9001");
        plan.AgregarInvolucrado("PER-9002");

        using var workbook = Export(
            Lookups(
                nodos: [(Nodo, "Comercial Exterior")],
                personas:
                [
                    (Lider, "Ana Rojas", "ana.rojas@procomer.test"),
                    (Responsable, "Luis Mora", "luis.mora@procomer.test"),
                    ("PER-9001", "Carla Vega", "carla.vega@procomer.test"),
                    ("PER-9002", "Diego Solis", "diego.solis@procomer.test"),
                ],
                hallazgos: [("HAL-7", "Comunicación interna")]),
            plan);
        var sheet = workbook.Worksheet(1);

        Assert.Equal("Comercial Exterior", sheet.Cell(FirstDataRow, NodoCol).GetText());
        Assert.Equal("Ana Rojas", sheet.Cell(FirstDataRow, LiderCol).GetText());
        Assert.Equal("Luis Mora", sheet.Cell(FirstDataRow, ResponsableCol).GetText());
        Assert.Equal("Comunicación interna", sheet.Cell(FirstDataRow, HallazgoCol).GetText());
        Assert.Equal(
            "carla.vega@procomer.test; diego.solis@procomer.test",
            sheet.Cell(FirstDataRow, CorreosCol).GetText());
    }

    [Fact]
    public void Unresolved_ids_fall_back_to_the_id_except_in_the_correos_column()
    {
        var plan = Plan(hallazgo: "HAL-7");
        plan.AgregarInvolucrado("PER-9001");
        plan.AgregarInvolucrado("PER-MISSING");

        using var workbook = Export(
            Lookups(personas: [("PER-9001", "Carla Vega", "carla.vega@procomer.test")]),
            plan);
        var sheet = workbook.Worksheet(1);

        Assert.Equal(Nodo, sheet.Cell(FirstDataRow, NodoCol).GetText());
        Assert.Equal(Lider, sheet.Cell(FirstDataRow, LiderCol).GetText());
        Assert.Equal("HAL-7", sheet.Cell(FirstDataRow, HallazgoCol).GetText());
        // An external id is not an address, so it is left out rather than written into a
        // column headed "correos".
        Assert.Equal("carla.vega@procomer.test", sheet.Cell(FirstDataRow, CorreosCol).GetText());
    }

    [Fact]
    public void A_plan_with_no_hallazgo_has_an_empty_hallazgo_cell()
    {
        using var workbook = Export(Plan(hallazgo: null));

        Assert.Equal(string.Empty, workbook.Worksheet(1).Cell(FirstDataRow, HallazgoCol).GetText());
    }

    /// <summary>
    /// A lookup whose key is present but whose value is null must cost that cell and nothing
    /// else. The null is reachable: climate-project's DTOs declare non-nullable strings but its
    /// deserializer does not enforce them, and <c>GetValueOrDefault</c> substitutes the fallback
    /// only for an ABSENT key — a key present with a null value returns the null, which then
    /// reaches the cell writer.
    /// </summary>
    [Fact]
    public void A_lookup_that_is_present_but_null_leaves_a_blank_cell_instead_of_failing()
    {
        var plan = Plan(hallazgo: "HAL-7");
        plan.AgregarInvolucrado("PER-9001");

        var lookups = new TrackingSheetLookups(
            new Dictionary<string, string>(StringComparer.Ordinal) { [Nodo] = null! },
            new Dictionary<string, PersonaCache>(StringComparer.Ordinal)
            {
                [Lider] = new()
                {
                    ExternalId = Lider,
                    NombreCompleto = null!,
                    Correo = null!,
                    NodoExternalId = Nodo,
                },
                ["PER-9001"] = new()
                {
                    ExternalId = "PER-9001",
                    NombreCompleto = "Carla Vega",
                    Correo = null!,
                    NodoExternalId = Nodo,
                },
            },
            new Dictionary<string, string>(StringComparer.Ordinal) { ["HAL-7"] = null! });

        using var workbook = Export(lookups, plan);
        var sheet = workbook.Worksheet(1);

        Assert.Equal(string.Empty, sheet.Cell(FirstDataRow, NodoCol).GetText());
        Assert.Equal(string.Empty, sheet.Cell(FirstDataRow, LiderCol).GetText());
        Assert.Equal(string.Empty, sheet.Cell(FirstDataRow, HallazgoCol).GetText());
        Assert.Equal(string.Empty, sheet.Cell(FirstDataRow, CorreosCol).GetText());
        // The rest of the row is untouched: one null attribute costs one cell.
        Assert.Equal(1, sheet.Cell(FirstDataRow, NoCol).GetDouble());
        Assert.Equal("Implementar un programa mensual de reconocimiento", sheet.Cell(FirstDataRow, QueCol).GetText());
        // The responsable is simply absent from the lookup, so it still falls back to its id.
        Assert.Equal(Responsable, sheet.Cell(FirstDataRow, ResponsableCol).GetText());
    }

    [Fact]
    public void Numero_follows_the_order_the_plans_arrive_in()
    {
        var first = Plan(planCode: "PA-2026-00001", compromiso: new DateOnly(2026, 3, 4));
        first.RegistrarAvance(0.5m, Lider, null, new DateOnly(2026, 2, 9), Config);
        var second = Plan(planCode: "PA-2026-00002");

        using var workbook = Export(first, second);
        var sheet = workbook.Worksheet(1);

        Assert.Equal(1, sheet.Cell(FirstDataRow, NoCol).GetDouble());
        Assert.Equal(2, sheet.Cell(FirstDataRow + 1, NoCol).GetDouble());
        Assert.Equal(FirstDataRow + 1, sheet.LastRowUsed()!.RowNumber());
    }

    [Fact]
    public void Comentarios_is_the_most_recent_bitacora_comment()
    {
        var plan = Plan();
        plan.RegistrarAvance(0.2m, Lider, "Primer taller realizado", new DateOnly(2026, 2, 1), Config);
        plan.RegistrarAvance(0.5m, Lider, "Segundo taller realizado", new DateOnly(2026, 3, 1), Config);
        // A silent avance must not blank the cell.
        plan.RegistrarAvance(0.6m, Lider, null, new DateOnly(2026, 4, 1), Config);

        using var workbook = Export(plan);

        Assert.Equal(
            "Segundo taller realizado",
            workbook.Worksheet(1).Cell(FirstDataRow, ComentariosCol).GetText());
    }

    /// <summary>
    /// Commas, quotes and newlines are simply characters in a typed text cell — worth an
    /// assertion precisely because there is no escaping layer here that could mangle them.
    /// </summary>
    [Fact]
    public void Free_text_holding_commas_quotes_and_newlines_survives_the_round_trip()
    {
        const string que = "Reuniones \"1 a 1\", mensuales,\ncon acta firmada";
        var plan = Plan(que: que, como: "Agenda, minuta y seguimiento");

        using var workbook = Export(plan);
        var sheet = workbook.Worksheet(1);

        Assert.Equal(que, sheet.Cell(FirstDataRow, QueCol).GetText());
        Assert.Equal("Agenda, minuta y seguimiento", sheet.Cell(FirstDataRow, ComoCol).GetText());
    }

    [Fact]
    public void An_export_with_no_plans_is_still_the_template_with_no_rows_under_it()
    {
        using var workbook = Export();
        var sheet = workbook.Worksheet(1);

        Assert.Equal("Tracking", sheet.Name);
        Assert.Equal("No.", sheet.Cell(HeaderRow, NoCol).GetText());
        Assert.True(sheet.Cell(FirstDataRow, NoCol).IsEmpty());
    }
}
