namespace ClimateProject.Application.OrgStructure;

// Simple comma-split parser -- does NOT handle embedded commas inside quoted
// fields. Acceptable for this slice's scope (name/email/role/department are
// all comma-free in practice); do not extend this to richer CSV without
// switching to a real CSV parsing approach.
public static class CsvUserImportParser
{
    public static IReadOnlyList<ParsedImportRow> Parse(string csv)
    {
        var lines = csv.Replace("\r\n", "\n").Split('\n');
        var rows = new List<ParsedImportRow>();

        for (var i = 1; i < lines.Length; i++) // skip header row
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
                RowNumber: i + 1, // 1-based, header is row 1
                Name: name,
                Email: email,
                Role: role,
                Department: string.IsNullOrEmpty(department) ? null : department));
        }

        return rows;
    }
}
