using ClimateTracking.Domain.Entities;
using ClimateTracking.Domain.Enums;
using ClosedXML.Excel;

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
/// "los datos se pueden exportar a Excel con la misma estructura" as their Plantilla_Tracking).
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
/// <b>Columns.</b> All thirteen columns of the client's template, in the template's order, on
/// one worksheet named exactly as the template names it. The client's technical document maps
/// only eleven of them — it silently drops "No." and "Comentarios" — but the functional
/// acceptance criterion asks for "la misma estructura" as the template, so the template wins
/// and this emits the superset.
/// </para>
/// <para>
/// <b>A workbook, and why the cheaper option will not do.</b> The criterion is about structure,
/// and a delimited text file carrying the same thirteen headers has no worksheet to give it: no
/// sheet name, no cell types, and so none of the structure being asked for. The format also
/// decides how this client's text survives. A cell in a delimited file declares no type, so the
/// program opening it decides on its behalf, and text beginning with <c>=</c>, <c>+</c>,
/// <c>-</c> or <c>@</c> is taken for a formula unless it is defused with a literal leading
/// apostrophe — which the reader then sees sitting in the cell. That lands badly here, because
/// "Plan de acción" and "Comentarios" are Spanish free text that routinely opens with a dash as
/// a bullet: defused, they would read <c>'- Capacitar al personal</c>. In a workbook every cell
/// declares its own type and a cell written as text is never evaluated, so every value below is
/// written verbatim and needs no guard at all. See <see cref="SetText"/> for the one leading
/// character the format still has an opinion about.
/// </para>
/// </remarks>
public static class TrackingSheetExport
{
    /// <summary>
    /// The worksheet's name, verbatim from the client's Plantilla_Tracking. Part of "la misma
    /// estructura": their macros and their own reports address the sheet by this name.
    /// </summary>
    public const string SheetName = "Tracking";

    /// <summary>The IANA media type of an Office Open XML workbook.</summary>
    public const string ContentType = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

    /// <summary>The extension that goes with <see cref="ContentType"/>.</summary>
    public const string FileExtension = ".xlsx";

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
    /// ISO-8601, in Excel's number-format vocabulary. Unambiguous in every locale the sheet
    /// might be opened in, which "01/02/2026" is not. The cell underneath is a real date, so a
    /// reader who prefers their own locale can reformat the column and get their dates, which a
    /// text cell could never offer.
    /// </summary>
    private const string DateFormat = "yyyy-mm-dd";

    /// <summary>
    /// One writer per column, in <see cref="Columns"/>' order, so the header row and the data
    /// rows cannot drift apart: <see cref="ToWorkbook"/> refuses to write a sheet whose column
    /// count does not match this list.
    /// </summary>
    private static readonly IReadOnlyList<Action<IXLCell, TrackingSheetRow>> CellWriters =
    [
        static (cell, row) => cell.Value = row.Numero,
        static (cell, row) => SetText(cell, row.Nodo),
        static (cell, row) => SetText(cell, row.LiderResponsable),
        static (cell, row) => SetText(cell, row.Hallazgo),
        static (cell, row) => SetText(cell, row.PlanQue),
        static (cell, row) => SetText(cell, row.Como),
        static (cell, row) => SetText(cell, row.ResponsableEjecucion),
        static (cell, row) => SetFecha(cell, row.FechaCompromiso),
        static (cell, row) => SetPorcentaje(cell, row.FraccionAvance),
        static (cell, row) => SetText(cell, Estado(row.Estado)),
        static (cell, row) => SetText(cell, string.Join(CorreoSeparator, row.CorreosInvolucrados)),
        static (cell, row) => SetFecha(cell, row.UltimaActualizacion),
        static (cell, row) => SetText(cell, row.Comentarios),
    ];

    /// <summary>
    /// The whole workbook's bytes: one worksheet, the header row, then one row per plan in the
    /// order given.
    /// </summary>
    public static byte[] Build(IEnumerable<PlanDeAccion> planes, TrackingSheetLookups lookups) =>
        ToWorkbook(BuildRows(planes, lookups));

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

    /// <summary>
    /// The workbook: a single worksheet named <see cref="SheetName"/>, the thirteen headers in
    /// row 1, and one row per <paramref name="rows"/> underneath.
    /// </summary>
    public static byte[] ToWorkbook(IEnumerable<TrackingSheetRow> rows)
    {
        ArgumentNullException.ThrowIfNull(rows);

        if (CellWriters.Count != Columns.Count)
        {
            throw new InvalidOperationException(
                $"The tracking sheet has {Columns.Count} headers but {CellWriters.Count} cell writers.");
        }

        using var workbook = new XLWorkbook();
        var sheet = workbook.AddWorksheet(SheetName);

        for (var column = 0; column < Columns.Count; column++)
        {
            SetText(sheet.Cell(1, column + 1), Columns[column]);
        }

        // Bold and frozen, because the client's template is: thirteen columns is more than fits
        // on a screen and the row a reader scrolls away from is the one that says what they are
        // looking at. Deliberately not AdjustToContents(), which measures glyphs through
        // SixLabors.Fonts and therefore depends on the fonts installed wherever the API runs —
        // in this service's case a container that has none.
        sheet.Row(1).Style.Font.Bold = true;
        sheet.SheetView.FreezeRows(1);

        var rowNumber = 1;
        foreach (var row in rows)
        {
            rowNumber++;
            for (var column = 0; column < CellWriters.Count; column++)
            {
                CellWriters[column](sheet.Cell(rowNumber, column + 1), row);
            }
        }

        using var stream = new MemoryStream();
        workbook.SaveAs(stream);
        return stream.ToArray();
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
    /// One text cell, holding exactly the characters it was given.
    /// </summary>
    /// <remarks>
    /// No formula guard, deliberately. The cell declares itself as text in the file, so nothing
    /// in it — not <c>=</c>, not a leading dash — is ever evaluated, and the leading apostrophe
    /// that a typeless format needs would only put a visible apostrophe in front of every
    /// bulleted Spanish sentence the client writes.
    /// <para>
    /// The doubling below is the opposite problem, and the only leading character the format
    /// still has an opinion about. Excel's UI convention is that a typed leading apostrophe
    /// means "the rest is text", so ClosedXML consumes one from any value assigned to a cell
    /// and records it as the cell's quote-prefix flag instead. A comentario that genuinely
    /// begins with an apostrophe would therefore arrive one character short; doubling it means
    /// what survives the strip is what the user wrote. The flag is then cleared so the cell is
    /// indistinguishable from every other string cell in the column.
    /// </para>
    /// </remarks>
    private static void SetText(IXLCell cell, string? text)
    {
        // Nullable although every text column on TrackingSheetRow is a non-nullable string, and
        // not out of defensive habit: the values behind three of those columns come out of
        // climate-project's JSON, whose DTOs declare non-nullable strings while the deserializer
        // is not configured to enforce them — ClimateProjectClient's options set only
        // PropertyNamingPolicy, and RespectNullableAnnotations is off by default — so
        // {"categoria": null} arrives as a null sitting in a string-typed property. The lookup
        // in BuildRows cannot catch it either: GetValueOrDefault substitutes the fallback when
        // the key is ABSENT, and a key that is present with a null value hands back the null.
        // A whole export must not fail over one empty attribute of one finding, so a null is a
        // blank cell.
        var value = text ?? string.Empty;
        cell.Value = value.StartsWith('\'') ? "'" + value : value;
        cell.Style.IncludeQuotePrefix = false;
    }

    /// <summary>A real date cell, shown ISO-8601.</summary>
    private static void SetFecha(IXLCell cell, DateOnly fecha)
    {
        cell.Value = fecha.ToDateTime(TimeOnly.MinValue);
        cell.Style.DateFormat.Format = DateFormat;
    }

    /// <summary>
    /// A real number cell, carrying Excel's built-in General format (number-format id 0).
    /// </summary>
    /// <remarks>
    /// <para>
    /// <c>porcentaje_avance</c> is stored as a fraction (0–1, <c>numeric(5,4)</c>) and the
    /// sheet's "% Avance" column is a percentage, so it is multiplied by 100 here: 0.35 → 35.
    /// The header carries the unit, so the cell holds the bare figure.
    /// </para>
    /// <para>
    /// <b>General rather than a picture format such as "0.##", which is measurably wrong here.</b>
    /// Excel's number-format grammar is not .NET's: in a format code the "." is a literal that is
    /// always emitted, and "#" suppresses a digit but never the separator in front of it. Rendered
    /// through the format, every whole percentage grows a trailing point — 0 → "0.",
    /// 25 → "25.", 35 → "35.", 100 → "100." — and only a value with decimals, such as
    /// 33.33, looks right. The same string handed to .NET's own formatter yields "35", which is
    /// exactly the trap: the code reads as if it does what <c>ToString("0.##")</c> does, and it
    /// does not. General renders 0 → "0", 7.5 → "7.5", 33.33 → "33.33", 35 → "35",
    /// 100 → "100", which is what this column is supposed to show. Four stored decimals can
    /// produce at most two after the multiplication, so General never has more to show than that.
    /// </para>
    /// <para>
    /// Set explicitly rather than left alone. Id 0 is also a fresh cell's default, so this is
    /// idempotent today; it is written down so the column's format is a decision in the code
    /// rather than an accident of the default, and so a row or column style that acquires a
    /// number format later cannot silently reach this cell.
    /// </para>
    /// </remarks>
    private static void SetPorcentaje(IXLCell cell, decimal fraccion)
    {
        cell.Value = fraccion * 100m;
        cell.Style.NumberFormat.NumberFormatId = 0;
    }

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
}
