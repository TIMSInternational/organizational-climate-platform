using ClimateProject.Application.OrgStructure;

namespace ClimateProject.UnitTests.OrgStructure;

// #193 replaced the users/user_invitations `demographics` jsonb blobs with rows
// keyed by demographic_fields. The blob accepted anything -- these tests pin the
// validation that normalisation makes possible, and each rejection has a
// companion case proving the rule still lets the legitimate value through.
public class DemographicValueValidationTests
{
    private static readonly Guid GenderFieldId = Guid.Parse("11111111-1111-1111-1111-111111111111");
    private static readonly Guid TenureFieldId = Guid.Parse("22222222-2222-2222-2222-222222222222");
    private static readonly Guid HeadcountFieldId = Guid.Parse("33333333-3333-3333-3333-333333333333");
    private static readonly Guid StartDateFieldId = Guid.Parse("44444444-4444-4444-4444-444444444444");

    private static DemographicFieldDefinition Select(bool required = false, bool isActive = true)
        => new(GenderFieldId, "gender", "select", ["female", "male", "non_binary"], required, isActive);

    private static DemographicFieldDefinition Text(bool required = false, bool isActive = true)
        => new(TenureFieldId, "tenure", "text", null, required, isActive);

    private static DemographicFieldDefinition Number(bool required = false, bool isActive = true)
        => new(HeadcountFieldId, "reports", "number", null, required, isActive);

    private static DemographicFieldDefinition Date(bool required = false, bool isActive = true)
        => new(StartDateFieldId, "start_date", "date", null, required, isActive);

    private static DemographicValueValidationResult Validate(
        Dictionary<string, string?> submitted,
        IReadOnlyList<DemographicFieldDefinition> definitions,
        bool enforceRequired = false)
        => DemographicValueValidation.Validate(submitted, definitions, enforceRequired);

    [Fact]
    public void Resolves_a_valid_value_to_its_demographic_field_id()
    {
        var result = Validate(new() { ["gender"] = "female" }, [Select()]);

        Assert.True(result.IsValid);
        var value = Assert.Single(result.Values);
        Assert.Equal(GenderFieldId, value.FieldId);
        Assert.Equal("gender", value.Field);
        Assert.Equal("female", value.Value);
    }

    [Fact]
    public void Rejects_a_select_value_that_is_not_one_of_the_configured_options()
    {
        var result = Validate(new() { ["gender"] = "unspecified" }, [Select()]);

        Assert.False(result.IsValid);
        Assert.Empty(result.Values);
        Assert.Contains(result.Errors, e => e.Contains("unspecified") && e.Contains("gender"));
    }

    [Fact]
    public void Rejects_a_select_field_that_has_no_options_configured()
    {
        var noOptions = new DemographicFieldDefinition(GenderFieldId, "gender", "select", null, false, true);

        var result = Validate(new() { ["gender"] = "female" }, [noOptions]);

        Assert.False(result.IsValid);
        Assert.Contains(result.Errors, e => e.Contains("no configured options"));
    }

    [Fact]
    public void Rejects_a_field_key_the_company_has_not_defined()
    {
        // The exact failure the blob allowed: a typo'd key persisted silently and
        // then never appeared under any dashboard filter.
        var result = Validate(new() { ["gendre"] = "female" }, [Select()]);

        Assert.False(result.IsValid);
        Assert.Empty(result.Values);
        Assert.Contains(result.Errors, e => e.Contains("Unknown demographic field: 'gendre'"));
    }

    [Fact]
    public void Field_keys_are_matched_case_sensitively()
    {
        // demographic_fields has a UNIQUE (company_id, field) index with no case
        // folding, so "Gender" really is a different key from "gender" -- accepting
        // it here would silently write the answer under the wrong definition.
        var result = Validate(new() { ["Gender"] = "female" }, [Select()]);

        Assert.False(result.IsValid);
        Assert.Contains(result.Errors, e => e.Contains("Unknown demographic field: 'Gender'"));
    }

    [Fact]
    public void Trims_whitespace_around_keys_and_values()
    {
        var result = Validate(new() { ["  gender  "] = "  female  " }, [Select()]);

        Assert.True(result.IsValid);
        var value = Assert.Single(result.Values);
        Assert.Equal("gender", value.Field);
        Assert.Equal("female", value.Value);
    }

    [Fact]
    public void Rejects_a_value_for_a_deactivated_field()
    {
        var result = Validate(new() { ["gender"] = "female" }, [Select(isActive: false)]);

        Assert.False(result.IsValid);
        Assert.Contains(result.Errors, e => e.Contains("is not active"));
    }

    [Fact]
    public void A_blank_value_clears_the_answer_instead_of_storing_an_empty_string()
    {
        var result = Validate(new() { ["gender"] = "   " }, [Select()]);

        Assert.True(result.IsValid);
        Assert.Empty(result.Values);
    }

    [Fact]
    public void A_missing_required_field_fails_when_the_submission_is_a_full_profile_update()
    {
        var result = Validate(new() { ["tenure"] = "2 years" }, [Select(required: true), Text()], enforceRequired: true);

        Assert.False(result.IsValid);
        Assert.Contains(result.Errors, e => e.Contains("'gender' is required"));
    }

    [Fact]
    public void A_blank_value_for_a_required_field_fails_the_same_way_as_omitting_it()
    {
        // Companion to the case above: clearing a required answer must not be a
        // back door around the required check.
        var result = Validate(new() { ["gender"] = "" }, [Select(required: true)], enforceRequired: true);

        Assert.False(result.IsValid);
        Assert.Contains(result.Errors, e => e.Contains("'gender' is required"));
    }

    [Fact]
    public void A_missing_required_field_is_allowed_at_invitation_time()
    {
        // Invitations pre-assign whatever the imported roster knows; the member
        // completes the rest on acceptance, so enforceRequired is false there.
        var result = Validate(new() { ["tenure"] = "2 years" }, [Select(required: true), Text()], enforceRequired: false);

        Assert.True(result.IsValid);
        Assert.Single(result.Values);
    }

    [Fact]
    public void A_required_field_that_is_deactivated_is_not_demanded()
    {
        var result = Validate([], [Select(required: true, isActive: false)], enforceRequired: true);

        Assert.True(result.IsValid);
        Assert.Empty(result.Values);
    }

    [Fact]
    public void A_supplied_required_field_satisfies_the_required_check()
    {
        var result = Validate(new() { ["gender"] = "male" }, [Select(required: true)], enforceRequired: true);

        Assert.True(result.IsValid);
        Assert.Single(result.Values);
    }

    [Theory]
    [InlineData("0")]
    [InlineData("42")]
    [InlineData("-3")]
    [InlineData("2.5")]
    public void Accepts_numeric_values_for_a_number_field(string value)
    {
        var result = Validate(new() { ["reports"] = value }, [Number()]);

        Assert.True(result.IsValid);
        Assert.Equal(value, Assert.Single(result.Values).Value);
    }

    [Theory]
    [InlineData("many")]
    [InlineData("3 people")]
    [InlineData("2,5")]
    public void Rejects_non_numeric_values_for_a_number_field(string value)
    {
        var result = Validate(new() { ["reports"] = value }, [Number()]);

        Assert.False(result.IsValid);
        Assert.Contains(result.Errors, e => e.Contains("expects a number"));
    }

    [Fact]
    public void Accepts_an_iso_date_for_a_date_field()
    {
        var result = Validate(new() { ["start_date"] = "2026-08-05" }, [Date()]);

        Assert.True(result.IsValid);
        Assert.Equal("2026-08-05", Assert.Single(result.Values).Value);
    }

    [Theory]
    [InlineData("05/08/2026")]
    [InlineData("2026-13-01")]
    [InlineData("yesterday")]
    public void Rejects_a_non_iso_date_for_a_date_field(string value)
    {
        var result = Validate(new() { ["start_date"] = value }, [Date()]);

        Assert.False(result.IsValid);
        Assert.Contains(result.Errors, e => e.Contains("expects a date"));
    }

    [Fact]
    public void Accepts_arbitrary_text_for_a_text_field()
    {
        var result = Validate(new() { ["tenure"] = "18 months, on and off" }, [Text()]);

        Assert.True(result.IsValid);
        Assert.Equal("18 months, on and off", Assert.Single(result.Values).Value);
    }

    [Fact]
    public void Rejects_a_value_longer_than_the_column_allows()
    {
        var tooLong = new string('x', DemographicValueValidation.MaxValueLength + 1);

        var result = Validate(new() { ["tenure"] = tooLong }, [Text()]);

        Assert.False(result.IsValid);
        Assert.Contains(result.Errors, e => e.Contains("exceeds 500 characters"));
    }

    [Fact]
    public void Accepts_a_value_exactly_at_the_column_limit()
    {
        var atLimit = new string('x', DemographicValueValidation.MaxValueLength);

        var result = Validate(new() { ["tenure"] = atLimit }, [Text()]);

        Assert.True(result.IsValid);
        Assert.Equal(atLimit, Assert.Single(result.Values).Value);
    }

    [Fact]
    public void Rejects_a_blank_field_key()
    {
        var result = Validate(new() { ["   "] = "female" }, [Select()]);

        Assert.False(result.IsValid);
        Assert.Contains(result.Errors, e => e.Contains("cannot be blank"));
    }

    [Fact]
    public void Rejects_a_field_whose_stored_type_is_not_supported()
    {
        var retired = new DemographicFieldDefinition(TenureFieldId, "tenure", "multiselect", null, false, true);

        var result = Validate(new() { ["tenure"] = "a" }, [retired]);

        Assert.False(result.IsValid);
        Assert.Contains(result.Errors, e => e.Contains("unsupported type 'multiselect'"));
    }

    [Fact]
    public void Reports_every_problem_in_one_pass_rather_than_stopping_at_the_first()
    {
        var result = Validate(
            new() { ["gender"] = "unspecified", ["nope"] = "x", ["reports"] = "many" },
            [Select(), Number(), Text(required: true)],
            enforceRequired: true);

        Assert.False(result.IsValid);
        Assert.Equal(4, result.Errors.Count);
        Assert.Empty(result.Values);
    }

    [Fact]
    public void A_null_submission_is_valid_when_nothing_is_required()
    {
        var result = DemographicValueValidation.Validate(null, [Select(), Text()], enforceRequired: true);

        Assert.True(result.IsValid);
        Assert.Empty(result.Values);
    }

    [Fact]
    public void A_null_submission_still_fails_a_required_field()
    {
        var result = DemographicValueValidation.Validate(null, [Select(required: true)], enforceRequired: true);

        Assert.False(result.IsValid);
        Assert.Contains(result.Errors, e => e.Contains("'gender' is required"));
    }

    [Fact]
    public void Validating_against_no_configured_fields_rejects_everything_submitted()
    {
        // A company that has not configured any demographics cannot receive
        // demographic answers -- there is nowhere normalised to put them.
        var result = Validate(new() { ["gender"] = "female" }, []);

        Assert.False(result.IsValid);
        Assert.Contains(result.Errors, e => e.Contains("Unknown demographic field"));
    }
}
