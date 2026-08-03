# Notification personalization conditions (#73) — required approach

**Binding constraint on #96.** The safe design is a *different* design, not a patch on the
legacy one, which is why this is settled before #96 is planned rather than during it.

## The vulnerability being avoided

Legacy `src/models/NotificationTemplate.ts:250-278` evaluates personalization-rule conditions
like this:

```js
NotificationTemplateSchema.methods.evaluateCondition = function (condition, variables) {
  // ... string-substitutes variable references into the condition text ...
  return new Function('return ' + evaluableCondition)();   // line 274
};
```

`condition` is a free-form string. It reaches the database through
`src/app/api/notifications/templates/route.ts:45`, whose Zod schema is `condition: z.string()`,
and the Mongoose schema (`NotificationTemplate.ts:138`) only says `type: String, required: true`.
There is **no validation anywhere on the path from an admin's HTTP request to `new Function()`**.

So: any Company Admin can execute arbitrary JavaScript in the notification-rendering process,
with whatever privileges that process holds. In a multi-tenant product that is a tenant-to-host
escape, not merely a bad practice.

The legacy code is aware of it. The comment on line 254 reads *"in production, use a proper
expression evaluator"*, and line 211 repeats it. It shipped anyway. Worth stating plainly
because it is the same shape as the `tailwind.config.js` incident: a known-unsafe construct left
in place because nothing forced the issue.

## What conditions are actually used

Enumerated across the whole legacy repository. The answer is unusually clear:

**One.** `src/lib/seedNotificationTemplates.ts:210`:

```js
condition: 'reminderCount >= 3',
```

That is the only personalization-rule condition in the codebase — one numeric comparison against
one variable. Every other seeded template ships `personalization_rules: []`. The `new Function()`
machinery exists to evaluate `reminderCount >= 3`.

(Searches: `condition:` across `src/` returns matches only in the schema/type declarations, this
one seed value, and two *unrelated* subsystems — `ai-feedback-loop.ts`, which uses typed objects,
and `workflow-state-manager.ts`, which uses real TypeScript predicates. Neither goes near
`new Function()`.)

## The design

A typed, non-executing condition. **No code generation, no interpretation of expression text at
evaluation time.**

This is not a novel invention — it is the pattern the legacy codebase *already* uses for exactly
this job elsewhere, in `src/lib/ai-feedback-loop.ts:36-41`:

```ts
export interface TriggerCondition {
  metric: string;
  operator: 'gt' | 'lt' | 'eq' | 'gte' | 'lte' | 'change_gt' | 'change_lt';
  value: number;
}
```

Applied to notifications:

```
NotificationCondition
  Field     : string     -- variable name; optionally one dot segment ("user.role")
  Operator  : enum       -- Eq | NotEq | Gt | Gte | Lt | Lte
  Value     : string     -- stored as text, compared according to operand types
```

Evaluation resolves `Field` against the render-time variables dictionary and applies `Operator`
as a plain comparison. Ordering operators (`Gt`/`Gte`/`Lt`/`Lte`) require both operands to parse
as numbers; if either does not, the condition evaluates **false** rather than throwing, matching
the legacy method's `catch → return false` behaviour so no template silently changes meaning.
`Eq`/`NotEq` compare numerically when both sides are numeric and by ordinal string equality
otherwise.

An unresolvable field is false, not an error — again matching legacy behaviour, where an unknown
identifier substituted to `undefined` and the comparison came out falsy.

### Storage and the legacy string form

`NotificationPersonalizationRule.Condition` already exists as a string column and the
notifications domain currently stores it opaquely
([2026-08-01-notifications-design.md](./2026-08-01-notifications-design.md), "Out of scope").
Rather than migrate the column, **parse the string into the typed form and reject anything that
does not fit**:

```
<field> <operator> <literal>
```

- `<field>`: identifier, optionally `identifier.identifier`
- `<operator>`: one of `==` `===` `!=` `!==` `>` `>=` `<` `<=`
- `<literal>`: a number, or a single- or double-quoted string, or `true`/`false`

Anything else — parentheses, `&&`, `||`, function calls, member chains deeper than one dot,
template literals, semicolons, comments, assignment — is a **validation failure at write time**.
The parse is a whitelist, not a sanitiser: it accepts a known-good shape rather than trying to
strip known-bad tokens. Rejecting is the whole point; there is deliberately no fallback path that
attempts to evaluate an unparseable condition.

`reminderCount >= 3` parses. Every injection string does not.

### Where the validation happens

Both at the boundary and at use:

1. **Write time** (#96's template CRUD): parse and reject with a 400 listing the offending
   condition. An invalid condition never reaches the database.
2. **Evaluation time**: parse again rather than trusting stored data. Rows predating this
   validation, or written by any other path, must not be able to reach an evaluator that assumes
   they were checked. A stored condition that fails to parse evaluates false and is logged.

Point 2 is what makes this robust rather than merely validated. Write-time validation alone is a
guard on one door of a database that has had other doors.

## Acceptance criteria mapping (#73)

- [x] **Legacy condition usage enumerated** — one condition, `reminderCount >= 3`; see above.
- [x] **Safe evaluator design recorded before M3 starts** — this document, linked from the
      notifications design doc.
- [x] **`grep -rn 'new Function\|eval(' src/` returns nothing in the notifications path** —
      verified clean after the evaluator landed. Note the evaluator's own source deliberately
      avoids quoting the legacy expression verbatim so this check passes without needing to
      strip comments; the exact legacy line is quoted in this document instead. (The repo's
      other lint-shaped guards, `tokenDiscipline` and `noHardcodedStrings`, *do* strip comments,
      for the documented reason that flagging documentation pushes comments out of the files
      that most need them — this file follows that spirit while keeping the grep literal-clean.)
- [x] **A test proves a code-injection condition string is rejected** —
      `tests/ClimateProject.UnitTests/Notifications/NotificationConditionParserTests.cs`, 41
      tests. Every string in the list below is asserted *rejected*, and one case additionally
      asserts that `reminderCount >= 3 && process.exit(1)` evaluates false rather than
      evaluating its true-looking prefix.

## Implementation — landed with this issue

The evaluator is a pure function with no dependencies, so it lives in
`ClimateProject.Application` rather than the endpoint layer, and shipped with #73 rather than
waiting for #96. Building it here is what turns this issue from a document into an enforced
constraint: the test asserting that an injection string is rejected cannot exist until the parser
does, and a design doc alone would not have stopped #96 from reaching for the legacy shape.

| File | What |
|---|---|
| `src/ClimateProject.Application/Notifications/NotificationCondition.cs` | the typed condition + `Evaluate` |
| `src/ClimateProject.Application/Notifications/NotificationConditionParser.cs` | the whitelist parser + `Evaluate(string, variables)` |
| `tests/ClimateProject.UnitTests/Notifications/NotificationConditionParserTests.cs` | 41 tests |

**What #96 still has to do:** call `TryParse` in the template create/update handlers and return
400 with the offending condition when it fails. The evaluation-time path is already safe without
that — `Evaluate` re-parses — so #96's remaining work is user-facing feedback, not security.

Injection strings the tests must reject (not merely evaluate to false):

```
reminderCount >= 3 && process.exit(1)
1; require('child_process').execSync('id')
(function(){return true})()
reminderCount.constructor.constructor('return 1')()
__proto__.polluted = 1
reminderCount >= 3 // ) ; anything
```

That fourth one is worth keeping in the suite specifically: `constructor.constructor` is the
standard escape from a naive "no `Function` keyword" denylist, and it is exactly what a
denylist-shaped fix would miss.
