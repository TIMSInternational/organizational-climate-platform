namespace ClimateProject.Application.OrgStructure;

// Simple comma-split parser -- does NOT handle embedded commas inside quoted
// fields. Acceptable for this slice's scope (name/email/role/department are
// all comma-free in practice); do not extend this to richer CSV without
// switching to a real CSV parsing approach.
public static class CsvUserImportParser
{
    // The only header shape this feature documents/supports (see BulkImportPanel.tsx:
    // "CSV columns: name, email, role, department"). Used to detect whether line 0 is
    // actually a header before unconditionally skipping it -- a one-line file with no
    // header (a single data row) used to be silently treated as "just the header" and
    // parsed into zero rows, with no error surfaced anywhere.
    private static readonly string[] ExpectedHeaderColumns = ["name", "email", "role", "department"];

    public static IReadOnlyList<ParsedImportRow> Parse(string csv)
    {
        var lines = csv.Replace("\r\n", "\n").Split('\n');
        var rows = new List<ParsedImportRow>();
        if (lines.Length == 0)
        {
            return rows;
        }

        var startIndex = LooksLikeHeader(lines[0]) ? 1 : 0;

        for (var i = startIndex; i < lines.Length; i++)
        {
            var line = lines[i];
            if (string.IsNullOrWhiteSpace(line))
            {
                continue;
            }

            var parts = line.Split(',');
            var name = parts.Length > 0 ? parts[0].Trim() : string.Empty;
            var email = parts.Length > 1 ? parts[1].Trim() : string.Empty;
            var role = parts.Length > 2 ? parts[2].Trim() : string.Empty;
            var department = parts.Length > 3 ? parts[3].Trim() : string.Empty;

            rows.Add(new ParsedImportRow(
                RowNumber: i + 1, // 1-based; if there's a header it's row 1, so the first
                                  // data row is row 2 -- if there's no header, the first
                                  // data row is (correctly) row 1.
                Name: name,
                Email: email,
                Role: role,
                Department: string.IsNullOrEmpty(department) ? null : department));
        }

        return rows;
    }

    private static bool LooksLikeHeader(string line)
    {
        var columns = line.Split(',').Select(c => c.Trim().ToLowerInvariant()).ToArray();
        return columns.Length >= 2 && columns[0] == ExpectedHeaderColumns[0] && columns[1] == ExpectedHeaderColumns[1];
    }
}
