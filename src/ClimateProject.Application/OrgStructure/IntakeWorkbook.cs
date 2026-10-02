using System.Globalization;
using System.Text;
using ClimateProject.Application.Auth;

namespace ClimateProject.Application.OrgStructure;

/// <summary>
/// The column contract of the intake workbook, shared by the reader
/// (<see cref="XlsxUserImportParser"/>) and the writer (<see cref="IntakeTemplateWorkbook"/>).
///
/// <para>One type so the two cannot drift: a template that emits a column the parser does not
/// recognise is the defect this feature exists to prevent, and it is invisible until somebody
/// fills the file in. <c>IntakeTemplateRoundTripTests</c> writes the template and parses its own
/// sample rows back, which is the test that keeps them honest.</para>
///
/// <para>Headers are Spanish because the people filling this in are the client's HR staff in
/// Costa Rica. <see cref="NormaliseHeader"/> strips accents and case so "Departamento",
/// "departamento" and "DEPARTAMENTO" are one column, and the English tokens are accepted too so
/// a file exported from the platform's own CSV can be pasted straight in.</para>
/// </summary>
public static class IntakeWorkbook
{
    public const string PeopleSheet = "Personas";

    /// <summary>
    /// Accepted spellings per column, first entry being the one the template writes.
    /// Compared after <see cref="NormaliseHeader"/>, so accents and case are already gone.
    /// </summary>
    public static readonly IReadOnlyDictionary<string, string[]> PeopleColumns =
        new Dictionary<string, string[]>(StringComparer.Ordinal)
        {
            ["name"] = ["nombre", "name", "nombre completo"],
            ["email"] = ["correo", "email", "correo electronico", "e mail"],
            ["role"] = ["rol", "role", "puesto"],
            ["department"] = ["departamento", "department", "area", "unidad"],
        };

    /// <summary>
    /// What a person may write in the "Rol" cell, mapped to the role the API stores.
    ///
    /// <para><see cref="Roles.SuperAdmin"/> and <see cref="Roles.CompanyAdmin"/> are deliberately
    /// absent. Bulk import refuses both (BulkImportEndpoints.cs), so accepting the word here
    /// would only move the refusal from "this column does not know that word" to a validation
    /// error two steps later, having first shown the admin a row that looked fine.</para>
    /// </summary>
    public static readonly IReadOnlyDictionary<string, string> RoleSynonyms =
        new Dictionary<string, string>(StringComparer.Ordinal)
        {
            ["colaborador"] = Roles.Employee,
            ["colaboradora"] = Roles.Employee,
            ["empleado"] = Roles.Employee,
            ["empleada"] = Roles.Employee,
            ["employee"] = Roles.Employee,
            ["lider"] = Roles.Leader,
            ["leader"] = Roles.Leader,
            ["jefatura"] = Roles.Leader,
            ["supervisor"] = Roles.Supervisor,
            ["supervisora"] = Roles.Supervisor,
        };

    /// <summary>The roles the template offers, in the order it lists them.</summary>
    public static readonly string[] OfferedRoles = [Roles.Employee, Roles.Leader, Roles.Supervisor];

    /// <summary>
    /// Case-folded, accent-stripped, whitespace-collapsed. Applied to headers and to role cells
    /// alike so "Líder", "lider" and " LIDER " are one value.
    ///
    /// <para>Decomposes to FormD and drops the combining marks rather than listing
    /// á/é/í/ó/ú/ñ: the list is the bug, because the one letter nobody thinks of is the one the
    /// client's file uses.</para>
    /// </summary>
    public static string NormaliseHeader(string? raw)
    {
        if (string.IsNullOrWhiteSpace(raw))
        {
            return string.Empty;
        }

        var decomposed = raw.Trim().ToLowerInvariant().Normalize(NormalizationForm.FormD);
        var builder = new StringBuilder(decomposed.Length);
        var lastWasSpace = false;
        foreach (var ch in decomposed)
        {
            if (CharUnicodeInfo.GetUnicodeCategory(ch) == UnicodeCategory.NonSpacingMark)
            {
                continue;
            }

            // Punctuation a spreadsheet picks up from a pasted header ("E-mail", "Correo:")
            // becomes a space, so it collapses away with the rest rather than splitting a word.
            var mapped = char.IsLetterOrDigit(ch) ? ch : ' ';
            if (mapped == ' ')
            {
                if (lastWasSpace || builder.Length == 0)
                {
                    continue;
                }

                lastWasSpace = true;
                builder.Append(' ');
                continue;
            }

            lastWasSpace = false;
            builder.Append(mapped);
        }

        return builder.ToString().TrimEnd().Normalize(NormalizationForm.FormC);
    }

    /// <summary>
    /// The canonical role for a cell, or <c>null</c> when the word is not one this import
    /// accepts. Returning null rather than echoing the raw value keeps the "Invalid role"
    /// message in one place: the endpoint's own validation, which every input shape shares.
    /// </summary>
    public static string? ResolveRole(string? cell)
    {
        var normalised = NormaliseHeader(cell);
        return normalised.Length > 0 && RoleSynonyms.TryGetValue(normalised, out var role) ? role : null;
    }
}
