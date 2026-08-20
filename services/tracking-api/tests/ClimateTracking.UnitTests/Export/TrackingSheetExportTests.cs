using System.Text;
using ClimateTracking.Application.Export;
using ClimateTracking.Domain.Entities;

namespace ClimateTracking.UnitTests.Export;

/// <summary>
/// The column contract of Procomer acceptance criterion 7, asserted through a real CSV parse
/// rather than against the raw string: a test that greps the file for "35" would pass on a file
/// Excel cannot open, and the point of this export is that Excel opens it.
/// </summary>
public class TrackingSheetExportTests
{
    private static readonly SemaforoThresholdConfig Config = new();

    private const string Nodo = "ND-014";
    private const string Lider = "PER-0231";
    private const string Responsable = "PER-0450";

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

    /// <summary>Column indexes, as the client's template orders them.</summary>
    private const int No = 0;
    private const int NodoCol = 1;
    private const int LiderCol = 2;
    private const int HallazgoCol = 3;
    private const int QueCol = 4;
    private const int ComoCol = 5;
    private const int ResponsableCol = 6;
    private const int FechaCompromisoCol = 7;
    private const int AvanceCol = 8;
    private const int EstadoCol = 9;
    private const int CorreosCol = 10;
    private const int UltimaActualizacionCol = 11;
    private const int ComentariosCol = 12;

    [Fact]
    public void Header_is_the_thirteen_template_columns_in_order()
    {
        var records = Parse(TrackingSheetExport.Build([], TrackingSheetLookups.Empty));

        Assert.Single(records);
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
            records[0]);
    }

    [Fact]
    public void File_opens_as_utf8_in_excel_because_it_starts_with_a_byte_order_mark()
    {
        var bytes = TrackingSheetExport.Build([], TrackingSheetLookups.Empty);

        Assert.Equal<byte>([0xEF, 0xBB, 0xBF], bytes[..3]);
    }

    [Theory]
    [InlineData("0", 0)]
    [InlineData("35", 0.35)]
    [InlineData("33.33", 0.3333)]
    [InlineData("7.5", 0.075)]
    [InlineData("100", 1)]
    public void Porcentaje_avance_is_the_stored_fraction_multiplied_by_one_hundred(
        string expected, double fraccion)
    {
        var plan = Plan();
        plan.RegistrarAvance((decimal)fraccion, Lider, null, new DateOnly(2026, 2, 1), Config);

        Assert.Equal(expected, Row(plan, TrackingSheetLookups.Empty)[AvanceCol]);
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

        Assert.Equal("Rojo", Row(rojo, TrackingSheetLookups.Empty)[EstadoCol]);
        Assert.Equal("Amarillo", Row(amarillo, TrackingSheetLookups.Empty)[EstadoCol]);
        Assert.Equal("Verde", Row(verde, TrackingSheetLookups.Empty)[EstadoCol]);
    }

    [Fact]
    public void Ids_are_resolved_to_the_names_the_client_reads()
    {
        var plan = Plan(hallazgo: "HAL-7");
        plan.AgregarInvolucrado("PER-9001");
        plan.AgregarInvolucrado("PER-9002");

        var row = Row(plan, Lookups(
            nodos: [(Nodo, "Comercial Exterior")],
            personas:
            [
                (Lider, "Ana Rojas", "ana.rojas@procomer.test"),
                (Responsable, "Luis Mora", "luis.mora@procomer.test"),
                ("PER-9001", "Carla Vega", "carla.vega@procomer.test"),
                ("PER-9002", "Diego Solis", "diego.solis@procomer.test"),
            ],
            hallazgos: [("HAL-7", "Comunicación interna")]));

        Assert.Equal("Comercial Exterior", row[NodoCol]);
        Assert.Equal("Ana Rojas", row[LiderCol]);
        Assert.Equal("Luis Mora", row[ResponsableCol]);
        Assert.Equal("Comunicación interna", row[HallazgoCol]);
        Assert.Equal("carla.vega@procomer.test; diego.solis@procomer.test", row[CorreosCol]);
    }

    [Fact]
    public void Unresolved_ids_fall_back_to_the_id_except_in_the_correos_column()
    {
        var plan = Plan(hallazgo: "HAL-7");
        plan.AgregarInvolucrado("PER-9001");
        plan.AgregarInvolucrado("PER-MISSING");

        var row = Row(plan, Lookups(
            personas: [("PER-9001", "Carla Vega", "carla.vega@procomer.test")]));

        Assert.Equal(Nodo, row[NodoCol]);
        Assert.Equal(Lider, row[LiderCol]);
        Assert.Equal("HAL-7", row[HallazgoCol]);
        // An external id is not an address, so it is left out rather than written into a
        // column headed "correos".
        Assert.Equal("carla.vega@procomer.test", row[CorreosCol]);
    }

    [Fact]
    public void A_plan_with_no_hallazgo_has_an_empty_hallazgo_cell()
    {
        Assert.Equal(string.Empty, Row(Plan(hallazgo: null), TrackingSheetLookups.Empty)[HallazgoCol]);
    }

    [Fact]
    public void Dates_are_iso_and_numero_follows_the_order_the_plans_arrive_in()
    {
        var first = Plan(planCode: "PA-2026-00001", compromiso: new DateOnly(2026, 3, 4));
        first.RegistrarAvance(0.5m, Lider, null, new DateOnly(2026, 2, 9), Config);
        var second = Plan(planCode: "PA-2026-00002");

        var records = Parse(TrackingSheetExport.Build([first, second], TrackingSheetLookups.Empty));

        Assert.Equal("1", records[1][No]);
        Assert.Equal("2", records[2][No]);
        Assert.Equal("2026-03-04", records[1][FechaCompromisoCol]);
        Assert.Equal("2026-02-09", records[1][UltimaActualizacionCol]);
    }

    [Fact]
    public void Comentarios_is_the_most_recent_bitacora_comment()
    {
        var plan = Plan();
        plan.RegistrarAvance(0.2m, Lider, "Primer taller realizado", new DateOnly(2026, 2, 1), Config);
        plan.RegistrarAvance(0.5m, Lider, "Segundo taller realizado", new DateOnly(2026, 3, 1), Config);
        // A silent avance must not blank the cell.
        plan.RegistrarAvance(0.6m, Lider, null, new DateOnly(2026, 4, 1), Config);

        Assert.Equal("Segundo taller realizado", Row(plan, TrackingSheetLookups.Empty)[ComentariosCol]);
    }

    [Fact]
    public void Free_text_holding_commas_quotes_and_newlines_survives_the_round_trip()
    {
        var que = "Reuniones \"1 a 1\", mensuales,\r\ncon acta firmada";
        var plan = Plan(que: que, como: "Agenda, minuta y seguimiento");

        var row = Row(plan, TrackingSheetLookups.Empty);

        Assert.Equal(que, row[QueCol]);
        Assert.Equal("Agenda, minuta y seguimiento", row[ComoCol]);
        Assert.Equal(13, row.Count);
    }

    [Fact]
    public void Text_that_a_spreadsheet_would_run_as_a_formula_is_neutralised()
    {
        var plan = Plan(que: "=HYPERLINK(\"http://evil.test\",\"pago\")", como: "-1+1 de arranque");

        var row = Row(plan, TrackingSheetLookups.Empty);

        Assert.StartsWith("'=", row[QueCol], StringComparison.Ordinal);
        Assert.StartsWith("'-", row[ComoCol], StringComparison.Ordinal);
    }

    [Fact]
    public void Every_row_has_exactly_thirteen_cells()
    {
        var plan = Plan(hallazgo: "HAL-7");
        plan.AgregarInvolucrado("PER-9001");

        var records = Parse(TrackingSheetExport.Build([plan, Plan(planCode: "PA-2026-00002")], TrackingSheetLookups.Empty));

        Assert.Equal(3, records.Count);
        Assert.All(records, record => Assert.Equal(TrackingSheetExport.Columns.Count, record.Count));
    }

    private static IReadOnlyList<string> Row(PlanDeAccion plan, TrackingSheetLookups lookups)
    {
        var records = Parse(TrackingSheetExport.Build([plan], lookups));
        Assert.Equal(2, records.Count);
        return records[1];
    }

    /// <summary>
    /// A deliberately independent RFC 4180 reader: quoting is one of the guarantees under test,
    /// so it is not enough to split the file on commas the way the writer wrote them.
    /// </summary>
    private static List<List<string>> Parse(byte[] bytes)
    {
        var text = Encoding.UTF8.GetString(bytes);
        if (text.StartsWith('﻿'))
        {
            text = text[1..];
        }

        var records = new List<List<string>>();
        var record = new List<string>();
        var field = new StringBuilder();
        var inQuotes = false;

        for (var i = 0; i < text.Length; i++)
        {
            var c = text[i];
            if (inQuotes)
            {
                if (c != '"')
                {
                    field.Append(c);
                }
                else if (i + 1 < text.Length && text[i + 1] == '"')
                {
                    field.Append('"');
                    i++;
                }
                else
                {
                    inQuotes = false;
                }
            }
            else if (c == '"')
            {
                inQuotes = true;
            }
            else if (c == ',')
            {
                record.Add(field.ToString());
                field.Clear();
            }
            else if (c == '\r' && i + 1 < text.Length && text[i + 1] == '\n')
            {
                i++;
                record.Add(field.ToString());
                field.Clear();
                records.Add(record);
                record = [];
            }
            else
            {
                field.Append(c);
            }
        }

        if (field.Length > 0 || record.Count > 0)
        {
            record.Add(field.ToString());
            records.Add(record);
        }

        return records;
    }
}
