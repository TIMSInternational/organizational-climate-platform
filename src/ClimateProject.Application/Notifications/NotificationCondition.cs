using System.Globalization;

namespace ClimateProject.Application.Notifications;

public enum ConditionOperator
{
    Equal,
    NotEqual,
    GreaterThan,
    GreaterThanOrEqual,
    LessThan,
    LessThanOrEqual,
}

/// <summary>
/// A notification personalization-rule condition, in typed form.
///
/// The legacy implementation stored conditions as free-form strings and handed
/// them to the JavaScript Function constructor -- arbitrary code execution driven
/// by input a Company Admin could edit (legacy
/// src/models/NotificationTemplate.ts:274; the exact line is quoted in the design
/// doc). This type exists so the condition is *data*, never code: it is parsed
/// once by <see cref="NotificationConditionParser"/> and evaluated by comparison
/// only.
///
/// The literal legacy expression is deliberately not repeated here, so that
/// #73's enforcement check -- grep for code-generation constructs across src/ --
/// stays clean without needing to strip comments.
///
/// Design and rationale:
/// docs/superpowers/specs/2026-08-03-notification-condition-evaluator-design.md (#73).
/// </summary>
public sealed record NotificationCondition(string Field, ConditionOperator Operator, string Value)
{
    /// <summary>
    /// Evaluates the condition against render-time template variables.
    ///
    /// Deliberately total: an unresolvable field, or an ordering comparison on
    /// non-numeric operands, yields <c>false</c> rather than throwing. That
    /// matches the legacy method, which substituted unknown identifiers to
    /// <c>undefined</c> and wrapped the whole evaluation in
    /// <c>catch { return false }</c>, so porting does not silently change the
    /// meaning of any existing template.
    /// </summary>
    public bool Evaluate(IReadOnlyDictionary<string, string?> variables)
    {
        ArgumentNullException.ThrowIfNull(variables);

        if (!variables.TryGetValue(Field, out var actual) || actual is null)
        {
            return false;
        }

        // Both parses run unconditionally: short-circuiting the second leaves
        // expectedNumber unassigned as far as flow analysis is concerned.
        var actualIsNumber =
            double.TryParse(actual, NumberStyles.Float, CultureInfo.InvariantCulture, out var actualNumber);
        var expectedIsNumber =
            double.TryParse(Value, NumberStyles.Float, CultureInfo.InvariantCulture, out var expectedNumber);
        var bothNumeric = actualIsNumber && expectedIsNumber;

        switch (Operator)
        {
            case ConditionOperator.Equal:
                return bothNumeric
                    ? actualNumber.Equals(expectedNumber)
                    : string.Equals(actual, Value, StringComparison.Ordinal);

            case ConditionOperator.NotEqual:
                return bothNumeric
                    ? !actualNumber.Equals(expectedNumber)
                    : !string.Equals(actual, Value, StringComparison.Ordinal);

            // Ordering operators are numeric-only on purpose. Comparing arbitrary
            // strings by ordinal ordering would give conditions like
            // "role > 'admin'" a meaning that reads as sensible and is not.
            case ConditionOperator.GreaterThan:
                return bothNumeric && actualNumber > expectedNumber;

            case ConditionOperator.GreaterThanOrEqual:
                return bothNumeric && actualNumber >= expectedNumber;

            case ConditionOperator.LessThan:
                return bothNumeric && actualNumber < expectedNumber;

            case ConditionOperator.LessThanOrEqual:
                return bothNumeric && actualNumber <= expectedNumber;

            default:
                return false;
        }
    }
}
