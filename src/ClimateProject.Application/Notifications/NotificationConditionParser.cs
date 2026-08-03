using System.Diagnostics.CodeAnalysis;
using System.Text.RegularExpressions;

namespace ClimateProject.Application.Notifications;

/// <summary>
/// Parses the legacy personalization-rule condition string form into a typed
/// <see cref="NotificationCondition"/>, rejecting anything that is not a single
/// comparison.
///
/// This is a **whitelist, not a sanitiser**. It admits exactly
/// <c>&lt;field&gt; &lt;operator&gt; &lt;literal&gt;</c> and refuses everything else --
/// there is deliberately no path that strips dangerous tokens and proceeds, and no
/// fallback that evaluates an unparseable condition. A denylist would be the wrong
/// shape here: <c>reminderCount.constructor.constructor('return 1')()</c> contains
/// no obviously dangerous keyword and is a complete escape.
///
/// Only one condition exists in the legacy data (<c>reminderCount &gt;= 3</c>), so
/// this grammar costs nothing in practice.
///
/// Design: docs/superpowers/specs/2026-08-03-notification-condition-evaluator-design.md (#73).
/// </summary>
public static partial class NotificationConditionParser
{
    // Anchored, and the operator alternation is longest-first so ">=" is not read
    // as ">" followed by a stray "=". RegexOptions.ExplicitCapture keeps the named
    // groups the only captures.
    [GeneratedRegex(
        """
        ^\s*
        (?<field>[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)?)
        \s*(?<op>===|!==|==|!=|>=|<=|>|<)\s*
        (?<value>
            -?\d+(?:\.\d+)?
          | '[^'\\]*'
          | "[^"\\]*"
          | true
          | false
        )
        \s*$
        """,
        RegexOptions.ExplicitCapture | RegexOptions.IgnorePatternWhitespace | RegexOptions.CultureInvariant)]
    private static partial Regex ConditionPattern();

    public static bool TryParse(string? condition, [NotNullWhen(true)] out NotificationCondition? result)
    {
        result = null;

        if (string.IsNullOrWhiteSpace(condition))
        {
            return false;
        }

        var match = ConditionPattern().Match(condition);
        if (!match.Success)
        {
            return false;
        }

        var op = match.Groups["op"].Value switch
        {
            "==" or "===" => ConditionOperator.Equal,
            "!=" or "!==" => ConditionOperator.NotEqual,
            ">" => ConditionOperator.GreaterThan,
            ">=" => ConditionOperator.GreaterThanOrEqual,
            "<" => ConditionOperator.LessThan,
            "<=" => ConditionOperator.LessThanOrEqual,
            _ => (ConditionOperator?)null,
        };

        if (op is null)
        {
            return false;
        }

        var rawValue = match.Groups["value"].Value;
        var value = rawValue.Length >= 2 && (rawValue[0] == '\'' || rawValue[0] == '"')
            ? rawValue[1..^1]
            : rawValue;

        result = new NotificationCondition(match.Groups["field"].Value, op.Value, value);
        return true;
    }

    /// <summary>
    /// Evaluates a stored condition string.
    ///
    /// Re-parses rather than trusting that the value was validated on write. Rows
    /// predating write-time validation, or written by any other path, must not
    /// reach an evaluator that assumes they were checked -- write-time validation
    /// alone is a guard on one door of a database that has had others. An
    /// unparseable condition is <c>false</c>, never executed.
    /// </summary>
    public static bool Evaluate(string? condition, IReadOnlyDictionary<string, string?> variables) =>
        TryParse(condition, out var parsed) && parsed.Evaluate(variables);
}
