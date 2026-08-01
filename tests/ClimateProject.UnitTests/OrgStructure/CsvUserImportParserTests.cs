using ClimateProject.Application.OrgStructure;

namespace ClimateProject.UnitTests.OrgStructure;

public class CsvUserImportParserTests
{
    [Fact]
    public void Parses_valid_rows_with_header()
    {
        var csv = "name,email,role,department\nJane Doe,jane@example.test,employee,Engineering\nJohn Roe,john@example.test,supervisor,";

        var rows = CsvUserImportParser.Parse(csv);

        Assert.Equal(2, rows.Count);
        Assert.Equal("Jane Doe", rows[0].Name);
        Assert.Equal("jane@example.test", rows[0].Email);
        Assert.Equal("employee", rows[0].Role);
        Assert.Equal("Engineering", rows[0].Department);
        Assert.Null(rows[1].Department);
        Assert.Equal(2, rows[0].RowNumber);
        Assert.Equal(3, rows[1].RowNumber);
    }

    [Fact]
    public void Skips_blank_lines()
    {
        var csv = "name,email,role,department\nJane Doe,jane@example.test,employee,\n\n\nJohn Roe,john@example.test,employee,";

        var rows = CsvUserImportParser.Parse(csv);

        Assert.Equal(2, rows.Count);
    }

    [Fact]
    public void Trims_whitespace_around_each_field()
    {
        var csv = "name,email,role,department\n  Jane Doe  ,  jane@example.test  ,  employee  ,  Engineering  ";

        var rows = CsvUserImportParser.Parse(csv);

        Assert.Equal("Jane Doe", rows[0].Name);
        Assert.Equal("jane@example.test", rows[0].Email);
    }

    [Fact]
    public void A_single_data_row_with_no_header_line_is_still_parsed_not_silently_dropped()
    {
        var csv = "Jane Doe,jane@example.test,employee,Engineering";

        var rows = CsvUserImportParser.Parse(csv);

        Assert.Single(rows);
        Assert.Equal("Jane Doe", rows[0].Name);
        Assert.Equal("jane@example.test", rows[0].Email);
        Assert.Equal(1, rows[0].RowNumber);
    }

    [Fact]
    public void Multiple_data_rows_with_no_header_line_are_all_parsed()
    {
        var csv = "Jane Doe,jane@example.test,employee,\nJohn Roe,john@example.test,supervisor,";

        var rows = CsvUserImportParser.Parse(csv);

        Assert.Equal(2, rows.Count);
        Assert.Equal(1, rows[0].RowNumber);
        Assert.Equal(2, rows[1].RowNumber);
    }

    [Fact]
    public void A_header_line_is_still_recognized_and_skipped_case_insensitively()
    {
        var csv = "Name,Email,Role,Department\nJane Doe,jane@example.test,employee,";

        var rows = CsvUserImportParser.Parse(csv);

        Assert.Single(rows);
        Assert.Equal("Jane Doe", rows[0].Name);
    }

    [Fact]
    public void An_empty_file_parses_to_zero_rows()
    {
        var rows = CsvUserImportParser.Parse("");

        Assert.Empty(rows);
    }
}
