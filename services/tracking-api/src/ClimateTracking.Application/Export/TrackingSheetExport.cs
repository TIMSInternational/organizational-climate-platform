using System.Globalization;
using System.Text;
using ClimateTracking.Domain.Entities;
using ClimateTracking.Domain.Enums;

namespace ClimateTracking.Application.Export;

/// <summary>
/// The external ids a row needs resolved into the human-readable values the client's
/// spreadsheet shows.
/// </summary>
/// <remarks>
/// Passed in rather than looked up here so this class stays free of EF Core and of the
/// climate-project HTTP client: everything below is a pure function of these three maps,
/// which is what makes the whole column contract unit-testable without a database.
/// A key that is absent is not an error — see <see cref="TrackingSheetExport"/> for what
/// each column falls back to.
/// </remarks>
public sealed record TrackingSheetLookups(
    IReadOnlyDictionary<string, string> NombrePorNodo,
    IReadOnlyDictionary<string, PersonaCache> PersonaPorExternalId,
    IReadOnlyDictionary<string, string> CategoriaPorHallazgo)
{
    public static TrackingSheetLookups Empty { get; } = new(
        new Dictionary<string, string>(StringComparer.Ordinal),
        new Dictionary<string, PersonaCache>(StringComparer.Ordinal),
        new Dictionary<string, string>(StringComparer.Ordinal));
}

/// <summary>One spreadsheet row, with every id already resolved but nothing yet formatted.</summary>
public sealed record TrackingSheetRow(
    int Numero,
    string Nodo,
    string LiderResponsable,
    string Hallazgo,
    string PlanQue,
    string Como,
    string ResponsableEjecucion,
    DateOnly FechaCompromiso,
    decimal FraccionAvance,
    EstadoSemaforo Estado,
    IReadOnlyList<string> CorreosInvolucrados,
    DateOnly UltimaActualizacion,
    string Comentarios);

/// <summary>
/// Renders planes de acción as the client's "Tracking" sheet (Procomer acceptance criterion 7,
/// "los datos se pueden exportar a Excel con la estructura de columnas ya definida").
/// </summary>
/// <remarks>
/// <para>
/// <b>This export is one-way, by design, and there must never be an importer for it.</b> The
/// client's Excel template asks a human to pick "Estado" from a red/yellow/green dropdown; in
/// this system that column is <i>calculated</i> — <see cref="PlanDeAccion.RecalcularSemaforo"/>
/// derives it from the commitment date, the elapsed fraction of the plan's window and the days
/// since the last update, and <see cref="PlanDeAccion.EstadoSemaforo"/> has no public setter
/// precisely so nothing outside the domain can assert it. Reading this sheet back in would let
/// a filled-in dropdown overwrite a computed state, which is the one thing the semáforo exists
/// to prevent. The same goes for "% Avance" and "Última actualización", which are only ever
/// written through <c>RegistrarAvance</c> so that the bitácora records who moved them.
/// So: a spreadsheet leaves this service, and none is ever accepted by it.
/// </para>
/// <para>
/// <b>Confidentiality (módulo §7).</b> The sheet carries plans and their state only. No survey
/// answer, no respondent and no per-question result appears in any column — the closest it gets
/// is <c>Hallazgo</c>, which is the finding's <i>category</i> (an aggregate theme such as
/// "Comunicación"), never a score and never an individual response.
/// </para>
/// <para>
/// <b>Columns.</b> All thirteen columns of the client's template, in the template's order. The
/// client's technical document maps only eleven of them — it silently drops "No." and
/// "Comentarios" — but the functional acceptance criterion asks for "la misma estructura" as the
/// template, so the template wins and this emits the superset.
/// </para>
/// <para>
/// <b>CSV, not .xlsx.</b> The service has no spreadsheet library (see the csproj files) and this
/// is not worth taking one on: a UTF-8 CSV with a byte-order mark opens in Excel as a sheet with
/// the accented Spanish headers intact. The BOM is not optional — without it Excel on Windows
/// reads the file as the system code page and "Líder responsable" arrives mojibake.
/// </para>
/// </remarks>
public static class TrackingSheetExport
{
    /// <summary>
    /// The column headers, verbatim from the client's Plantilla_Tracking, sheet "Tracking".
    /// Order is part of the contract: the acceptance criterion is about structure, not just
    /// about which values are present.
    /// </summary>
    public static readonly IReadOnlyList<string> Columns =
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
    ];

    /// <summary>The separator the client's template uses inside the correos cell.</summary>
    public const string CorreoSeparator = "; ";

    /// <summary>
    /// RFC 4180's line ending. Deliberately not the "\n" the climate-project audit export uses:
    /// this file is opened by Excel rather than parsed by a tool, and a lone LF before a quoted
    /// field with an embedded newline is where Excel's own parser is least predictable.
    /// </summary>
    private const string RowSeparator = "\r\n";

    /// <summary>
    /// The leading characters a spreadsheet reads as the start of a formula rather than as text.
    /// Kept in step with climate-project's <c>AuditEndpoints.FormulaLeadingCharacters</c> — the
    /// same reasoning, deliberately duplicated rather than shared, because no assembly in this
    /// service may reference that one.
    /// </summary>
    private static readonly char[] FormulaLeadingCharacters = ['=', '+', '-', '@', '\t', '\r'];

    /// <summary>
    /// The whole sheet: BOM, header row, then one row per plan in the order given.
    /// </summary>
    public static byte[] Build(IEnumerable<PlanDeAccion> planes, TrackingSheetLookups lookups) =>
        ToCsv(BuildRows(planes, lookups));

    /// <summary>
    /// Resolves each plan into a row. "No." is the 1-based position in the sequence given, so
    /// the caller's ordering is the sheet's numbering.
    /// </summary>
    /// <remarks>
    /// Fallbacks when a lookup misses, which the cache sync worker makes rare but not
    /// impossible: identity columns (nodo, líder, responsable, hallazgo) fall back to the raw
    /// external id, because an id still tells the admin reading the sheet <i>which</i> record is
    /// missing from the cache. The correos column does not: an external id is not an address,
    /// and a cell in a column headed "correos" that holds something else is worse than a cell
    /// with one address fewer, so unresolved involucrados are omitted.
    /// </remarks>
    public static IReadOnlyList<TrackingSheetRow> BuildRows(
        IEnumerable<PlanDeAccion> planes, TrackingSheetLookups lookups)
    {
        ArgumentNullException.ThrowIfNull(planes);
        ArgumentNullException.ThrowIfNull(lookups);

        var rows = new List<TrackingSheetRow>();
        var numero = 0;

        foreach (var plan in planes)
        {
            numero++;
            rows.Add(new TrackingSheetRow(
                Numero: numero,
                Nodo: lookups.NombrePorNodo.GetValueOrDefault(plan.NodoExternalId, plan.NodoExternalId),
                LiderResponsable: NombreDe(plan.LiderExternalId, lookups),
                Hallazgo: plan.HallazgoExternalId is null
                    ? string.Empty
                    : lookups.CategoriaPorHallazgo.GetValueOrDefault(plan.HallazgoExternalId, plan.HallazgoExternalId),
                PlanQue: plan.DescripcionQue,
                Como: plan.MetodologiaComo,
                ResponsableEjecucion: NombreDe(plan.ResponsableEjecucionExternalId, lookups),
                FechaCompromiso: plan.FechaCompromiso,
                FraccionAvance: plan.PorcentajeAvance,
                Estado: plan.EstadoSemaforo,
                CorreosInvolucrados: plan.InvolucradosExternalIds
                    .Select(id => lookups.PersonaPorExternalId.GetValueOrDefault(id))
                    .Where(persona => persona is not null)
                    .Select(persona => persona!.Correo)
                    .ToList(),
                UltimaActualizacion: plan.FechaUltimaActualizacion,
                Comentarios: UltimoComentario(plan)));
        }

        return rows;
    }

    /// <summary>The sheet's bytes: UTF-8 BOM, header row, one row per <paramref name="rows"/>.</summary>
    public static byte[] ToCsv(IEnumerable<TrackingSheetRow> rows)
    {
        ArgumentNullException.ThrowIfNull(rows);

        var csv = new StringBuilder();
        csv.Append(string.Join(',', Columns.Select(Csv))).Append(RowSeparator);

        foreach (var row in rows)
        {
            csv.Append(string.Join(',', Cells(row).Select(Csv))).Append(RowSeparator);
        }

        // Encoding.UTF8's preamble rather than a literal "﻿" in the string: the BOM is a
        // property of the file's bytes, and prepending it as a character would also make it the
        // first character of the first header cell for any consumer that ignores preambles.
        return [.. Encoding.UTF8.GetPreamble(), .. Encoding.UTF8.GetBytes(csv.ToString())];
    }

    /// <summary>One row's thirteen cells, already transformed, in column order.</summary>
    private static IEnumerable<string> Cells(TrackingSheetRow row)
    {
        yield return row.Numero.ToString(CultureInfo.InvariantCulture);
        yield return row.Nodo;
        yield return row.LiderResponsable;
        yield return row.Hallazgo;
        yield return row.PlanQue;
        yield return row.Como;
        yield return row.ResponsableEjecucion;
        yield return Fecha(row.FechaCompromiso);
        yield return Porcentaje(row.FraccionAvance);
        yield return Estado(row.Estado);
        yield return string.Join(CorreoSeparator, row.CorreosInvolucrados);
        yield return Fecha(row.UltimaActualizacion);
        yield return row.Comentarios;
    }

    private static string NombreDe(string personaExternalId, TrackingSheetLookups lookups) =>
        lookups.PersonaPorExternalId.TryGetValue(personaExternalId, out var persona)
            ? persona.NombreCompleto
            : personaExternalId;

    /// <summary>
    /// The most recent bitácora comment, which is what the template's free-text "Comentarios"
    /// column is for.
    /// </summary>
    /// <remarks>
    /// Entries carry a <see cref="DateOnly"/> and nothing finer, so two comments made on the
    /// same day have no stored order; the tie is broken on <c>Id</c> purely so that two runs of
    /// the same export produce the same file. Entries without a comment are skipped rather than
    /// blanking the cell — an avance registered with no note should not hide the last note.
    /// </remarks>
    private static string UltimoComentario(PlanDeAccion plan) =>
        plan.Bitacora
            .Where(entry => !string.IsNullOrWhiteSpace(entry.Comentario))
            .OrderBy(entry => entry.Fecha)
            .ThenBy(entry => entry.Id)
            .LastOrDefault()?.Comentario ?? string.Empty;

    /// <summary>
    /// ISO-8601. Unambiguous in every locale the sheet might be opened in, which "01/02/2026"
    /// is not.
    /// </summary>
    private static string Fecha(DateOnly fecha) => fecha.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);

    /// <summary>
    /// <c>porcentaje_avance</c> is stored as a fraction (0–1, <c>numeric(5,4)</c>) and the sheet's
    /// "% Avance" column is a percentage, so it is multiplied by 100 here: 0.35 → "35".
    /// "0.##" rather than a fixed number of decimals so whole percentages arrive as "35" and not
    /// "35.00"; four stored decimals can produce at most two after the multiplication, so nothing
    /// is rounded away.
    /// </summary>
    private static string Porcentaje(decimal fraccion) =>
        (fraccion * 100m).ToString("0.##", CultureInfo.InvariantCulture);

    /// <summary>
    /// The template's Estado values are capitalised Spanish words. Written out rather than
    /// leaning on <c>Enum.ToString()</c>: the enum's names are an internal detail and the
    /// spreadsheet's vocabulary is a contract with the client.
    /// </summary>
    private static string Estado(EstadoSemaforo estado) => estado switch
    {
        EstadoSemaforo.Rojo => "Rojo",
        EstadoSemaforo.Amarillo => "Amarillo",
        EstadoSemaforo.Verde => "Verde",
        _ => throw new ArgumentOutOfRangeException(nameof(estado), estado, "Unmapped EstadoSemaforo."),
    };

    /// <summary>One CSV field, quoted and made inert.</summary>
    /// <remarks>
    /// The house style from climate-project's <c>AuditEndpoints.Csv</c>, for the same two
    /// reasons. Quoting unconditionally, with embedded quotes doubled, because these values are
    /// user-controlled — <c>DescripcionQue</c> and <c>MetodologiaComo</c> are 2000-character
    /// free text that can hold commas and newlines. And a leading apostrophe on anything that
    /// starts with a formula character, because quoting does not stop Excel evaluating a cell:
    /// a plan whose "Qué" begins with "=" would run as a formula on the machine of whoever opens
    /// the sheet, who is by definition an administrator of this tenant.
    /// </remarks>
    private static string Csv(string? value)
    {
        if (string.IsNullOrEmpty(value))
        {
            return "\"\"";
        }

        var escaped = value.Replace("\"", "\"\"", StringComparison.Ordinal);
        var inert = FormulaLeadingCharacters.Contains(value[0]) ? "'" + escaped : escaped;

        return $"\"{inert}\"";
    }
}
