using ClimateProject.Application.Analytics;

namespace ClimateProject.UnitTests.Analytics;

public class SnapshotEntryValuesTests
{
    [Fact]
    public void Reserved_columns_and_custom_attributes_flatten_into_one_map()
    {
        var values = SnapshotEntryValues.Flatten(
            "Engineering", "employee", "1-2 years", "Bogota", null, null,
            """{"work_mode":"remote","shift":"night"}""");

        Assert.Equal("Engineering", values["department"]);
        Assert.Equal("employee", values["role"]);
        Assert.Equal("1-2 years", values["tenure"]);
        Assert.Equal("Bogota", values["location"]);
        Assert.Equal("remote", values["work_mode"]);
        Assert.Equal("night", values["shift"]);
        Assert.False(values.ContainsKey("team"));
        Assert.False(values.ContainsKey("level"));
    }

    [Fact]
    public void A_custom_attribute_cannot_shadow_a_reserved_column()
    {
        var values = SnapshotEntryValues.Flatten(
            "Engineering", "employee", "1-2 years", null, null, null,
            """{"department":"Sales"}""");

        Assert.Equal("Engineering", values["department"]);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    [InlineData("not json at all")]
    [InlineData("[1,2,3]")]
    [InlineData("\"a bare string\"")]
    public void A_custom_attributes_column_that_is_not_a_flat_object_is_treated_as_absent(string? json)
    {
        // jsonb accepts any shape, so a row written by the ETL or an older tool can hold
        // something this code does not model -- a read path must not 500 over it.
        var values = SnapshotEntryValues.Flatten("Engineering", "employee", "1-2 years", null, null, null, json);

        Assert.Equal(3, values.Count);
    }

    [Fact]
    public void Non_string_scalars_survive_the_round_trip_as_text()
    {
        var values = SnapshotEntryValues.Flatten(
            "Engineering", "employee", "1-2 years", null, null, null,
            """{"headcount":12,"remote":true,"nested":{"x":1}}""");

        Assert.Equal("12", values["headcount"]);
        Assert.Equal("true", values["remote"]);
        Assert.False(values.ContainsKey("nested"));
    }

    [Fact]
    public void Blank_optional_columns_are_omitted_rather_than_stored_as_empty()
    {
        var values = SnapshotEntryValues.Flatten("Engineering", "employee", "1-2 years", "", "  ", null, null);

        Assert.False(values.ContainsKey("location"));
        Assert.False(values.ContainsKey("team"));
    }

    [Fact]
    public void ToCustomAttributesJson_drops_the_reserved_keys()
    {
        var json = SnapshotEntryValues.ToCustomAttributesJson(new Dictionary<string, string>(StringComparer.Ordinal)
        {
            ["department"] = "Engineering",
            ["role"] = "employee",
            ["tenure"] = "1-2 years",
            ["location"] = "Bogota",
            ["team"] = "Platform",
            ["level"] = "senior",
            ["work_mode"] = "remote",
        });

        Assert.Equal("""{"work_mode":"remote"}""", json);
    }

    [Fact]
    public void ToCustomAttributesJson_is_deterministic()
    {
        var demographics = new Dictionary<string, string>(StringComparer.Ordinal)
        {
            ["zeta"] = "1",
            ["alpha"] = "2",
        };

        Assert.Equal("""{"alpha":"2","zeta":"1"}""", SnapshotEntryValues.ToCustomAttributesJson(demographics));
    }

    [Fact]
    public void ToCustomAttributesJson_returns_null_when_there_is_nothing_custom()
        => Assert.Null(SnapshotEntryValues.ToCustomAttributesJson(new Dictionary<string, string>(StringComparer.Ordinal)
        {
            ["department"] = "Engineering",
        }));

    [Fact]
    public void Written_custom_attributes_read_back_identically()
    {
        var demographics = new Dictionary<string, string>(StringComparer.Ordinal)
        {
            ["department"] = "Engineering",
            ["work_mode"] = "remote",
            ["cohort"] = "2024-Q1",
        };

        var json = SnapshotEntryValues.ToCustomAttributesJson(demographics);
        var values = SnapshotEntryValues.Flatten("Engineering", "employee", "1-2 years", null, null, null, json);

        Assert.Equal("remote", values["work_mode"]);
        Assert.Equal("2024-Q1", values["cohort"]);
    }

    [Fact]
    public void Every_reserved_field_is_recognised_as_reserved()
        => Assert.All(SnapshotEntryValues.ReservedFields, f => Assert.True(SnapshotEntryValues.IsReserved(f)));

    [Fact]
    public void A_company_defined_field_is_not_reserved()
        => Assert.False(SnapshotEntryValues.IsReserved("work_mode"));
}
