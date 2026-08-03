using ClimateProject.Application.Notifications;

namespace ClimateProject.UnitTests.Notifications;

/// <summary>
/// #73. The legacy evaluator called new Function('return ' + condition)() on
/// strings a Company Admin could edit. These tests pin the replacement's two
/// guarantees: the one condition that exists in legacy data still works, and
/// injection attempts are *rejected* rather than evaluated.
/// </summary>
public class NotificationConditionParserTests
{
    // The only personalization-rule condition in the entire legacy codebase
    // (src/lib/seedNotificationTemplates.ts:210). If the safe grammar could not
    // express this, the design would have been wrong.
    [Fact]
    public void Parses_the_only_condition_present_in_legacy_data()
    {
        Assert.True(NotificationConditionParser.TryParse("reminderCount >= 3", out var condition));

        Assert.Equal("reminderCount", condition.Field);
        Assert.Equal(ConditionOperator.GreaterThanOrEqual, condition.Operator);
        Assert.Equal("3", condition.Value);
    }

    [Theory]
    // Straightforward code execution.
    [InlineData("reminderCount >= 3 && process.exit(1)")]
    [InlineData("1; require('child_process').execSync('id')")]
    [InlineData("(function(){return true})()")]
    // The escape a keyword denylist would miss: no "Function", no "eval", and yet
    // constructor.constructor is the Function constructor.
    [InlineData("reminderCount.constructor.constructor('return 1')()")]
    // Prototype pollution rather than direct execution.
    [InlineData("__proto__.polluted = 1")]
    // Comment-terminated, to defeat naive suffix validation.
    [InlineData("reminderCount >= 3 // ) ; anything")]
    // Assorted shapes outside the grammar.
    [InlineData("reminderCount >= 3 || true")]
    [InlineData("a.b.c === 1")]
    [InlineData("`${reminderCount}` === '3'")]
    [InlineData("reminderCount")]
    [InlineData("reminderCount >=")]
    [InlineData(">= 3")]
    [InlineData("reminderCount >= someOtherVariable")]
    [InlineData("reminderCount => 3")]
    [InlineData("")]
    [InlineData("   ")]
    [InlineData(null)]
    public void Rejects_anything_that_is_not_a_single_comparison(string? condition)
    {
        Assert.False(NotificationConditionParser.TryParse(condition, out var parsed));
        Assert.Null(parsed);
    }

    [Fact]
    public void Rejected_conditions_evaluate_false_rather_than_executing()
    {
        var variables = new Dictionary<string, string?> { ["reminderCount"] = "5" };

        // Would be true if the "reminderCount >= 3" prefix were evaluated at all.
        Assert.False(NotificationConditionParser.Evaluate(
            "reminderCount >= 3 && process.exit(1)", variables));
    }

    [Theory]
    [InlineData("reminderCount >= 3", "3", true)]
    [InlineData("reminderCount >= 3", "4", true)]
    [InlineData("reminderCount >= 3", "2", false)]
    [InlineData("reminderCount > 3", "3", false)]
    [InlineData("reminderCount < 3", "2", true)]
    [InlineData("reminderCount <= 3", "3", true)]
    [InlineData("reminderCount == 3", "3", true)]
    [InlineData("reminderCount === 3", "3", true)]
    [InlineData("reminderCount != 3", "4", true)]
    [InlineData("reminderCount !== 3", "3", false)]
    public void Evaluates_numeric_comparisons(string condition, string actual, bool expected)
    {
        var variables = new Dictionary<string, string?> { ["reminderCount"] = actual };

        Assert.Equal(expected, NotificationConditionParser.Evaluate(condition, variables));
    }

    [Theory]
    [InlineData("role == 'admin'", "admin", true)]
    [InlineData("role == 'admin'", "employee", false)]
    [InlineData("role === \"admin\"", "admin", true)]
    [InlineData("role != 'admin'", "employee", true)]
    public void Evaluates_string_equality(string condition, string actual, bool expected)
    {
        var variables = new Dictionary<string, string?> { ["role"] = actual };

        Assert.Equal(expected, NotificationConditionParser.Evaluate(condition, variables));
    }

    // Ordering on non-numeric operands is false, not an ordinal string comparison:
    // "role > 'admin'" reads as sensible and would not be.
    [Fact]
    public void Ordering_comparisons_on_non_numeric_operands_are_false()
    {
        var variables = new Dictionary<string, string?> { ["role"] = "employee" };

        Assert.False(NotificationConditionParser.Evaluate("role > 'admin'", variables));
        Assert.False(NotificationConditionParser.Evaluate("role < 'admin'", variables));
    }

    // Matches the legacy behaviour, which substituted unknown identifiers to
    // `undefined` and caught any resulting throw, returning false.
    [Fact]
    public void Unresolvable_field_is_false_not_an_error()
    {
        var empty = new Dictionary<string, string?>();

        Assert.False(NotificationConditionParser.Evaluate("reminderCount >= 3", empty));
        Assert.False(NotificationConditionParser.Evaluate(
            "reminderCount >= 3", new Dictionary<string, string?> { ["reminderCount"] = null }));
    }

    [Fact]
    public void Dotted_field_names_are_supported_for_legacy_shapes()
    {
        Assert.True(NotificationConditionParser.TryParse("user.role == 'admin'", out var condition));
        Assert.Equal("user.role", condition.Field);

        var variables = new Dictionary<string, string?> { ["user.role"] = "admin" };
        Assert.True(condition.Evaluate(variables));
    }

    // Guard the guard: a grammar that accepted nothing would pass every rejection
    // test above vacuously. This asserts the accept side is non-trivial.
    [Theory]
    [InlineData("reminderCount >= 3")]
    [InlineData("role == 'admin'")]
    [InlineData("score <= -1.5")]
    [InlineData("enabled == true")]
    [InlineData("user.role != \"employee\"")]
    public void Accepts_the_whole_intended_grammar(string condition)
    {
        Assert.True(NotificationConditionParser.TryParse(condition, out _));
    }
}
