# ui/ primitives

Ported from `climate-project/src/components/ui/` — shadcn/ui, i.e. Radix primitives
plus `class-variance-authority` and `tailwind-merge`. Batch 1 of three (#75): the 15
that unblock form-heavy pages.

## Using them

```tsx
import { Button, TextField, Card, CardHeader, CardTitle } from '../../components/ui'
```

Copy is not the primitives' business — pass translated strings in. See
`src/i18n/README.md`.

## What the port changed, and why

### `outline-none` is not ported

Every legacy primitive killed the outline and rebuilt a focus ring from
`focus-visible:ring-*` against shadcn's `--ring` token. This app has one focus
indicator already — `:focus-visible { outline: 2px solid var(--admin-focus-ring) }`
in `index.css`, applied globally. Porting `outline-none` would have deleted the
app's only focus indicator and replaced it with a ring pointing at a token that
does not exist here. `button.test.tsx` asserts the class is absent.

### Button sizes are remapped onto control-height tokens

Legacy sizes were raw `h-8` / `h-9` / `h-10`. `index.css` records that the legacy
admin surface used `size="sm"` (32px) 49 times and the 36px default never — so 32px
is *the* admin button and is now the default.

| | legacy | here |
|---|---|---|
| `sm` | 32px | 28px (`h-control-md`, matches a nav row) |
| `default` | 36px | **32px** (`h-control-lg`) |
| `lg` | 40px | 40px |
| `icon` | 36px square | 32px square |

**A ported call site should drop its `size="sm"`** — the default is now that size.

### Badge variants use soft accent fills

The legacy variants were solid saturated fills. Here they are the token layer's
`--admin-accent-bg-*` over `--admin-accent-border-*`, which is what the legacy admin
status pills actually looked like and what stays legible in both themes.
`destructive` keeps a solid fill.

### `Form` and the `FormField` Controller are not ported

The legacy `form.tsx` was shadcn's `react-hook-form` binding. Nothing in this app
uses react-hook-form — all twelve pages and every existing form component are plain
controlled inputs. Porting the binding would add a dependency and a second form
paradigm for no current caller.

What is ported is the part that is easy to get wrong by hand: `FormItem` mints the
ids, `FormControl` attaches `aria-describedby` / `aria-invalid`, `FormLabel` points
at the control. That works for controlled inputs and would still work under
react-hook-form later.

### framer-motion is not ported

Legacy `FormField.tsx` imported it to fade in the error message. `index.css` already
ships `--animate-fade-in` and honours `prefers-reduced-motion`, so `animate-fade-in`
does the same thing with no dependency.

### Typography is 10 variants, not 25

The legacy file was 450 lines because it also carried the marketing scale
(`BodyLarge`, `Lead`, `Quote`, `DataTextLarge`, `LabelLarge`, `Caption` variants) and
four layout helpers. Dropped: the marketing ramp, and `Container` / `Section` /
`Grid` / `Flex` — `<div className="flex gap-inline">` is clearer than
`<Flex gap="inline">` and needs no maintaining.

### The radio dot is a dot

Legacy used a lucide `Circle` icon inside a 14px control, which renders as a smudge.
A filled `<span>` needs no glyph.

## Rules the tests enforce

- **`tokenDiscipline.test.ts`** — no hex/rgb colour, no stock Tailwind palette
  colour, no `text-white`/`bg-black`, and no arbitrary `[...]` value anywhere in
  `ui/`. If a value has no token, add it to `styles/theme.css`, not here.
- **`cn.test.ts`** — `src/lib/cn.ts` extends `tailwind-merge` with this project's
  named scales. Without that, `cn('h-control-lg', 'h-10')` keeps *both* classes and
  the winner is decided by Tailwind's layer order rather than by the caller, so
  `<Button className="h-10">` would not reliably be 40px.
- One behavioural test per primitive — interaction and accessibility, not snapshots.

## Known environment limit

`radio-group.test.tsx` verifies arrow-key roving focus but not
selection-follows-focus. Radix implements the latter by tracking arrow keydown on
`document` and reading that flag in the item's focus handler; happy-dom dispatches
focus asynchronously relative to the flag being cleared, so the selection never
lands. The failure is environmental, not a component bug — noted in the test.
