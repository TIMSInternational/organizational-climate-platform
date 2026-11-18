namespace ClimateProject.Application.Email;

/// <summary>
/// A calendar day the way the respondent screens print one inside a sentence -- what
/// <c>Intl.DateTimeFormat(locale, { dateStyle: 'long' })</c> renders: "27 de octubre de 2026"
/// and "October 27, 2026".
/// </summary>
/// <remarks>
/// Spelled here rather than by <c>CultureInfo("es-CR")</c>, for the reason
/// <c>SurveyExportCopy</c> gives: a culture's month names come from whatever ICU the host
/// carries, and a container built with invariant globalization would silently print English.
/// This is deterministic and testable. The caller passes a DAY already converted to the
/// company's zone; an instant read in UTC is the R2 defect (audit 2026-10-22).
/// </remarks>
public static class EmailDays
{
    public static string Long(DateOnly day, bool spanish)
        => spanish
            ? $"{day.Day} de {SpanishMonths[day.Month - 1]} de {day.Year}"
            : $"{EnglishMonths[day.Month - 1]} {day.Day}, {day.Year}";

    private static readonly string[] SpanishMonths =
    [
        "enero", "febrero", "marzo", "abril", "mayo", "junio",
        "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
    ];

    private static readonly string[] EnglishMonths =
    [
        "January", "February", "March", "April", "May", "June",
        "July", "August", "September", "October", "November", "December",
    ];
}
