using System.Globalization;
using ClimateProject.Application.Auth;
using ClimateProject.Application.Exports;
using ClimateProject.Application.Reports.Rendering;

namespace ClimateProject.Application.Surveys;

/// <summary>
/// The roster on <c>/surveys/{id}/distribution</c> ("Quién ya respondió") as a file: one row per
/// person, the columns the screen draws and no others (audit gap G20).
/// </summary>
/// <remarks>
/// <para>
/// ESPH asked for this twice on 21 Oct 2026 and both times it was built by hand from
/// <c>GET /surveys/{id}/participation</c> with a script. The rows here ARE that endpoint's
/// roster -- the export reads it through the same loader -- so the file and the screen cannot
/// disagree about anybody.
/// </para>
/// <para>
/// <b>Exactly the screen's columns.</b> Persona (name and email), Rol, Usuario, the two
/// per-survey key columns when the survey hands out per-survey keys, Estado and Última
/// actividad. The demographics the screen folds away behind "+" are NOT here: the October
/// scripts dropped them on purpose, and a list of who has not answered does not need a
/// person's age band to be useful. Never an answer, because the roster carries none.
/// </para>
/// <para>
/// The words are the screen's words (<c>surveys.next.roster.*</c> and
/// <c>superadmin.next.users.roles.*</c> in the web catalogues), so the admin reading the file
/// sees "No ha entrado" where the screen said "No ha entrado". An absent value is an empty
/// cell rather than the screen's "Sin código" / "Sin actividad": a spreadsheet filters and
/// sorts on an empty cell, and on a sentence it cannot. Dates are ISO days, which every
/// spreadsheet reads as a date in any locale.
/// </para>
/// </remarks>
public static class SurveyRosterCsv
{
    /// <summary>Whether the company's language is Spanish -- the only one besides English.</summary>
    public static bool IsSpanish(string? companyLanguage)
        => companyLanguage is not null && companyLanguage.Trim().StartsWith("es", StringComparison.OrdinalIgnoreCase);

    /// <summary>The header row, in the order the screen draws its columns.</summary>
    public static string[] Headers(bool spanish, bool perSurvey, bool showState)
    {
        var headers = new List<string>
        {
            spanish ? "Nombre" : "Name",
            spanish ? "Correo" : "Email",
            spanish ? "Rol" : "Role",
            spanish ? "Usuario" : "Username",
        };
        if (perSurvey)
        {
            headers.Add(spanish ? "Código enviado" : "Code sent");
            headers.Add(spanish ? "Último ingreso con el código" : "Last signed in with the code");
        }

        if (showState)
        {
            headers.Add(spanish ? "Estado" : "State");
            headers.Add(spanish ? "Última actividad" : "Last activity");
        }

        return [.. headers];
    }

    /// <summary>One person's cells, aligned with <see cref="Headers"/>.</summary>
    public static string?[] Fields(SurveyRosterRow row, bool spanish, bool perSurvey, bool showState)
    {
        ArgumentNullException.ThrowIfNull(row);

        var fields = new List<string?>
        {
            row.Name,
            row.Email,
            RoleLabel(row.Role, spanish),
            // The screen's Usuario column: a per-survey person signs in with THIS survey's key,
            // never an account username (the account was imported keyless).
            perSurvey ? row.SurveyUsername : row.Username,
        };
        if (perSurvey)
        {
            fields.Add(Day(row.CredentialIssuedOn));
            // Only meaningful once a key exists, which is also how the screen draws it.
            fields.Add(row.CredentialIssuedOn is null ? null : Day(row.LastSignInOn));
        }

        if (showState)
        {
            fields.Add(StatusLabel(row.Status, spanish));
            fields.Add(Day(row.LastActivityOn));
        }

        return [.. fields];
    }

    /// <summary>The whole document, UTF-8 with a BOM so Excel reads the accents.</summary>
    public static byte[] Build(IEnumerable<SurveyRosterRow> roster, bool spanish, bool perSurvey, bool showState)
    {
        ArgumentNullException.ThrowIfNull(roster);

        var csv = new CsvWriter(Headers(spanish, perSurvey, showState));
        foreach (var row in roster)
        {
            csv.AppendRow(Fields(row, spanish, perSurvey, showState));
        }

        return csv.ToBytes();
    }

    /// <summary>
    /// "estado-clima-organizacional-esph-2026-2026-10-22.csv": the survey's title, transliterated
    /// to ASCII and capped by the rule a report's download name uses, then the day -- appended
    /// AFTER the cap, so a long title can never cut the date off.
    /// </summary>
    public static string FileName(string? surveyTitle, Guid surveyId, DateOnly day, bool spanish)
    {
        // Never the id fallback: the prefix alone always leaves a slug.
        var named = ReportFormats.FileName($"{(spanish ? "estado" : "status")} {surveyTitle}", surveyId, csv: true);
        return $"{named[..^".csv".Length]}-{day.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture)}.csv";
    }

    /// <summary>The screen's chip words (<c>surveys.next.roster.status*</c>).</summary>
    public static string StatusLabel(string status, bool spanish) => status switch
    {
        SurveyParticipantStatuses.Completed => spanish ? "Terminó" : "Finished",
        SurveyParticipantStatuses.Started => spanish ? "Empezó" : "Started",
        SurveyParticipantStatuses.NotStarted => spanish ? "No ha entrado" : "Not opened",
        SurveyParticipantStatuses.NotCompleted => spanish ? "Sin terminar" : "Not finished",
        // A state this build has not heard of is printed as itself rather than dropped: an
        // empty Estado cell would read as "nothing to report" about somebody.
        _ => status,
    };

    /// <summary>The screen's role words (<c>superadmin.next.users.roles.*</c>).</summary>
    public static string RoleLabel(string role, bool spanish) => role switch
    {
        Roles.SuperAdmin => spanish ? "Super administrador" : "Super administrator",
        Roles.CompanyAdmin => spanish ? "Administrador de empresa" : "Company administrator",
        Roles.Leader => spanish ? "Líder" : "Leader",
        Roles.Supervisor => "Supervisor",
        Roles.Employee => spanish ? "Empleado" : "Employee",
        _ => role,
    };

    private static string? Day(DateOnly? day)
        => day?.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);
}
