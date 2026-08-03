# i18n

Ports the legacy bilingual layer from `climate-project` into the monorepo frontend (#78).

## Layout

| File | Role |
|---|---|
| `en.json`, `es.json` | the catalogues, 896 keys each, at exact parity |
| `translate.ts` | pure `createTranslator` — no React, no storage, no globals |
| `locale.ts` | catalogues, detection, persistence |
| `context.ts` | the context object, kept apart so the provider file exports only a component |
| `TranslationProvider.tsx` | mounts the active catalogue, sets `<html lang>` |
| `useTranslation.ts` | the hook, optionally namespace-scoped |
| `LanguageSwitcher.tsx` | native `<select>` locale picker for the shell |
| `hardcodedStringsBaseline.json` | the ratchet for untranslated component copy |

## Decisions

### A lightweight context, not `react-i18next`

The catalogues need dot-path lookup and `{name}` interpolation, and nothing else:
across 896 keys there are 13 placeholders total and no ICU plural or gender
machinery. `react-i18next` would add a dependency and a much larger API surface to
deliver the ~40 lines in `translate.ts`. The legacy app reached the same conclusion
with its own `TranslationContext`, so the contract also stays familiar.

Revisit this if genuine pluralisation or date/number localisation arrives — an
interpolated `{count}` is not the same thing as a plural rule, and Spanish and
English differ on more than the word.

### Locale lives in preferences, not the URL

The legacy app routed locale through a Next.js `[locale]` App Router segment. That
does not carry over: the equivalent in react-router means either duplicating every
route under a `:locale` prefix or wrapping the whole tree in a param-aware layout,
and every `<Link>` in the app then has to preserve the segment or silently drop the
user back to the default language.

The trade-off is deliberate. A URL locale buys shareable per-language links and
crawlable per-language pages. Neither applies here: every route except the
anonymous microclimate respond page sits behind authentication, and the app is not
indexed. So locale is a user preference, persisted to `localStorage` under
`preferredLocale` — the legacy key, so an existing preference carries over.

The one route where a shareable per-language link would genuinely matter is
`/microclimates/:id/respond`, which an anonymous respondent reaches from an
invitation. If that becomes a requirement, add a `?lang=` query parameter read by
`detectLocale`, rather than restructuring the router.

### Detection order

1. an explicit stored choice
2. the browser's `navigator.languages`, matched on the base tag, so `es-CR` → `es`
3. English

The legacy app defaulted flatly to English, which is wrong for a Spanish-facing
Procomer deployment. Honouring the browser rather than hardcoding `es` keeps both
audiences working.

### Missing keys fall back to English, then to the key

The legacy `es.json` was missing 8 `surveys.*` keys that `en.json` had, so a Spanish
user saw raw key paths. Those are now translated and `catalogues.test.ts` enforces
parity in both directions, but the runtime fallback means the next such gap is
merely imperfect rather than broken.

## Adding copy

Use `t()`. `noHardcodedStrings.test.ts` walks the TypeScript AST of every `.tsx`
file and fails on literal JSX text, literal user-facing props, literal copy-shaped
props such as `submitLabel`, and literal ternaries rendered as children.

**Every page and every feature component is translated.** #78 did the pages and left
the 24 components on a ratcheted baseline of 157 literals; #176 drained that baseline
to zero and deleted it. The check is now absolute — there is no baseline to add an
exception to. If a literal genuinely is not translatable copy, add it to `ALLOWED` in
the test with a reason.

Two patterns worth copying when you add copy:

- **Never split a sentence around a JSX expression.** `{n} row(s) succeeded, {e}
  error(s), out of {t} row(s) read.` was three fragments; Spanish cannot keep that
  word order, so it is one key with three placeholders (`users.bulkImportSummary`).
  A *label* followed by its value is fine — `microclimates.responsesLabel` stays a
  label, because `Responses: 12` is word-order stable.
- **Reuse a key before adding one.** 40 of the 100 component strings already had
  keys. The exception is when the existing copy is genuinely worse: `users.searchUsers`
  was `Search users...`, which drops the hint about *which* fields are searchable, so
  `users.searchByNameOrEmail` was added rather than flattening onto it.
