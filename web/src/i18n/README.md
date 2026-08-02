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
file and fails on literal JSX text, literal user-facing props, and literal
copy-shaped props such as `submitLabel`.

Every page is translated. The 24 feature components are not — their 157 literals are
recorded in `hardcodedStringsBaseline.json`, which is a ratchet, not an allowlist:

- new copy anywhere fails, including in files already in the baseline
- pages are held at zero unconditionally
- a baseline entry that no longer exists also fails, so the file can only shrink

Translate a component, then regenerate:

```sh
UPDATE_I18N_BASELINE=1 npx vitest run src/i18n/noHardcodedStrings.test.ts
```

Deriving the baseline any other way loses fidelity — multi-line JSX text and
embedded quotes have to round-trip exactly.
