using System.Globalization;
using ClosedXML.Excel;

namespace ClimateProject.Application.Exports;

/// <summary>One survey's line on the summary sheet.</summary>
/// <param name="CodesSent">People holding a code for the survey.</param>
/// <param name="SignedIn">Of those, people who have signed in with it — proof the code reached them.</param>
/// <param name="NotDelivered">Of those who have NOT signed in, people whose latest mail failed.</param>
public sealed record DeliveryAuditSurvey(string Title, int CodesSent, int SignedIn, int NotDelivered);

/// <summary>One person whose mail failed after their current code was sent.</summary>
/// <param name="SignedIn">They got in anyway — through another channel, or a later mail.</param>
public sealed record DeliveryAuditFailure(
    string Name,
    string Email,
    string Survey,
    DateTimeOffset CodeSentAt,
    string EventType,
    string? BounceType,
    string? Diagnostic,
    DateTimeOffset OccurredAt,
    bool SignedIn);

/// <summary>
/// The delivery audit: for each survey that hands out codes, how many codes went out, how many
/// people got in, and who never received the email and why — the receiving server's own reply.
/// </summary>
/// <remarks>
/// <para>
/// <b>Internal to TIMS.</b> It names people and carries what their mail server answered; the
/// client receives the status workbook, never this one (ruled 26 Oct 2026, carried over from the
/// script this replaces, <c>esph-auditoria-envio.py</c>). The first sheet says so in words.
/// </para>
/// <para>
/// <b>What "not delivered" means here.</b> The latest bounce, complaint or rejection SES reported
/// for the person's address happened AFTER their current code was sent, and they have not signed
/// in since. A code reissued to a new address after a bounce clears the line, as it should.
/// Signing in is the only proof of receipt a code has, so a person who got in is never counted as
/// not delivered — they are listed with "Sí" so the failure is still visible.
/// </para>
/// <para>
/// <b>What it cannot see.</b> Events from before the webhook was connected, and mail that was
/// accepted and then filtered into spam or quarantine by the receiving organisation: to SES that
/// is a delivery. "Sin señal" on the summary is exactly those people — no bounce, no sign-in.
/// </para>
/// </remarks>
public static class DeliveryAuditWorkbook
{
    private const string HeaderFill = "E1E0D9";
    private const string NotReceivedFill = "F6D9D9";

    public static byte[] Build(
        string companyName,
        IReadOnlyList<DeliveryAuditSurvey> surveys,
        IReadOnlyList<DeliveryAuditFailure> failures,
        DateOnly generatedOn,
        DateTimeOffset? recordingSince,
        bool spanish)
    {
        ArgumentNullException.ThrowIfNull(surveys);
        ArgumentNullException.ThrowIfNull(failures);

        using var book = new XLWorkbook();
        WriteSummary(book.AddWorksheet(spanish ? "Resumen" : "Summary"), companyName, surveys, generatedOn, recordingSince, spanish);
        WriteFailures(book.AddWorksheet(spanish ? "No entregados" : "Not delivered"), failures, spanish);

        using var stream = new MemoryStream();
        book.SaveAs(stream);
        return stream.ToArray();
    }

    private static void WriteSummary(
        IXLWorksheet sheet, string companyName, IReadOnlyList<DeliveryAuditSurvey> surveys,
        DateOnly generatedOn, DateTimeOffset? recordingSince, bool spanish)
    {
        sheet.Cell(1, 1).Value = (spanish ? "Auditoría de envíos — " : "Delivery audit — ") + companyName;
        sheet.Cell(1, 1).Style.Font.Bold = true;
        sheet.Cell(1, 1).Style.Font.FontSize = 14;
        sheet.Cell(2, 1).Value = (spanish ? "Al " : "As at ") + generatedOn.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);
        sheet.Cell(3, 1).Value = spanish
            ? "Uso interno de TIMS: no se envía al cliente."
            : "Internal to TIMS: not for the client.";
        sheet.Cell(3, 1).Style.Font.Bold = true;
        sheet.Cell(3, 1).Style.Font.FontColor = XLColor.FromHtml("#9C0006");
        sheet.Cell(4, 1).Value = recordingSince is { } since
            ? (spanish
                ? $"Los rebotes se registran desde el {since.UtcDateTime:yyyy-MM-dd} (UTC); los anteriores no aparecen."
                : $"Bounces are recorded since {since.UtcDateTime:yyyy-MM-dd} (UTC); earlier ones do not appear.")
            : (spanish
                ? "Todavía no se ha registrado ningún rebote: o no ha habido, o el aviso de rebotes no está conectado."
                : "No bounce has been recorded yet: either there has been none, or the bounce notice is not connected.");

        const int headerRow = 6;
        string[] headers = spanish
            ? ["Encuesta", "Códigos enviados", "Entraron", "Correo no entregado", "Sin señal todavía"]
            : ["Survey", "Codes sent", "Signed in", "Mail not delivered", "No signal yet"];
        Header(sheet, headerRow, headers);

        var row = headerRow + 1;
        foreach (var survey in surveys)
        {
            sheet.Cell(row, 1).Value = survey.Title;
            sheet.Cell(row, 2).Value = survey.CodesSent;
            sheet.Cell(row, 3).Value = survey.SignedIn;
            sheet.Cell(row, 4).Value = survey.NotDelivered;
            // Neither in nor bounced: the mail was accepted and nobody has used it. Spam,
            // quarantine, or simply not yet -- the one group this file cannot tell apart.
            sheet.Cell(row, 5).Value = survey.CodesSent - survey.SignedIn - survey.NotDelivered;
            if (survey.NotDelivered > 0)
            {
                sheet.Cell(row, 4).Style.Fill.BackgroundColor = XLColor.FromHtml("#" + NotReceivedFill);
            }

            row++;
        }

        sheet.Columns(1, headers.Length).AdjustToContents(headerRow, Math.Max(row - 1, headerRow));
    }

    private static void WriteFailures(IXLWorksheet sheet, IReadOnlyList<DeliveryAuditFailure> failures, bool spanish)
    {
        string[] headers = spanish
            ? ["Nombre", "Correo", "Encuesta", "Código enviado", "Fecha del aviso", "Tipo", "Respuesta del servidor", "¿Entró después?", "Qué hacer"]
            : ["Name", "Email", "Survey", "Code sent", "Notice date", "Type", "Server reply", "Signed in since?", "What to do"];
        Header(sheet, 1, headers);

        // Still stuck first: those are the only rows anybody can act on.
        var ordered = failures
            .OrderBy(f => f.SignedIn)
            .ThenByDescending(f => f.OccurredAt)
            .ThenBy(f => f.Name, StringComparer.Ordinal)
            .ToList();

        var row = 2;
        foreach (var failure in ordered)
        {
            sheet.Cell(row, 1).Value = failure.Name;
            sheet.Cell(row, 2).Value = failure.Email;
            sheet.Cell(row, 3).Value = failure.Survey;
            sheet.Cell(row, 4).Value = failure.CodeSentAt.UtcDateTime;
            sheet.Cell(row, 4).Style.NumberFormat.Format = "yyyy-mm-dd hh:mm";
            sheet.Cell(row, 5).Value = failure.OccurredAt.UtcDateTime;
            sheet.Cell(row, 5).Style.NumberFormat.Format = "yyyy-mm-dd hh:mm";
            sheet.Cell(row, 6).Value = KindLabel(failure.EventType, failure.BounceType, spanish);
            // Written as text, never as a formula, whatever the server put in its reply.
            sheet.Cell(row, 7).SetValue(failure.Diagnostic ?? "");
            sheet.Cell(row, 8).Value = failure.SignedIn ? (spanish ? "Sí" : "Yes") : "No";
            sheet.Cell(row, 9).Value = Advice(failure.EventType, failure.BounceType, spanish);
            if (!failure.SignedIn)
            {
                sheet.Range(row, 1, row, 3).Style.Fill.BackgroundColor = XLColor.FromHtml("#" + NotReceivedFill);
            }

            row++;
        }

        if (row > 2)
        {
            sheet.Range(1, 1, row - 1, headers.Length).SetAutoFilter();
        }

        sheet.Columns(1, headers.Length).AdjustToContents(1, Math.Max(row - 1, 1), 8d, 70d);
        sheet.SheetView.Freeze(1, 1);
    }

    /// <summary>The kind of failure in words a non-technical reader acts on.</summary>
    public static string KindLabel(string eventType, string? bounceType, bool spanish) => (eventType, bounceType) switch
    {
        ("bounce", "Permanent") => spanish ? "Rebote permanente" : "Permanent bounce",
        ("bounce", "Transient") => spanish ? "Rebote temporal" : "Temporary bounce",
        ("bounce", _) => spanish ? "Rebote" : "Bounce",
        ("complaint", _) => spanish ? "Lo marcó como spam" : "Marked as spam",
        ("reject", _) => spanish ? "Rechazado antes de salir" : "Rejected before sending",
        _ => eventType,
    };

    /// <summary>What an operator does next, per kind.</summary>
    public static string Advice(string eventType, string? bounceType, bool spanish) => (eventType, bounceType) switch
    {
        ("bounce", "Permanent") => spanish
            ? "La dirección no existe o rechaza el correo: pedir al cliente la dirección correcta, cambiarla y reenviar el código."
            : "The address does not exist or refuses mail: ask the client for the right address, change it and resend the code.",
        ("bounce", "Transient") => spanish
            ? "Buzón lleno o servidor ocupado: pedir que libere espacio, o dar otra dirección, y reenviar."
            : "Mailbox full or server busy: ask them to free space or give another address, then resend.",
        ("complaint", _) => spanish
            ? "La persona marcó el correo como spam: confirmar con ella antes de volver a escribirle."
            : "The person marked the mail as spam: confirm with them before writing again.",
        _ => spanish
            ? "Revisar la dirección y reenviar el código."
            : "Check the address and resend the code.",
    };

    private static void Header(IXLWorksheet sheet, int row, IReadOnlyList<string> headers)
    {
        for (var c = 0; c < headers.Count; c++)
        {
            var cell = sheet.Cell(row, c + 1);
            cell.Value = headers[c];
            cell.Style.Font.Bold = true;
            cell.Style.Fill.BackgroundColor = XLColor.FromHtml("#" + HeaderFill);
        }
    }
}
