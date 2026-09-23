# Decision: the palette is navy, not purple — RULED 2026-09-22

**Status: RULED. Federico asked for it and chose the hue.** He said *"let's change the color
scheme of the application, purple is not professional."* Shown four luminance-matched
candidates he chose **corporate navy, hue 220**; asked what becomes of the red primary
button he chose **the primary action joins the shell hue, and red is reserved for
destructive and error**; asked how far to carry it he chose **everything, including the
neutrals**. Owner: Federico.

## The method, which is the whole reason this was safe

A WCAG contrast ratio is a function of **relative luminance alone** — hue and saturation do
not enter it. So every colour in the violet band was re-solved at **hue 220 holding its
relative luminance constant**, and every measured ratio in the repository survived by
construction rather than by luck.

The transform is: read the token, convert to HSL, keep the saturation, set the hue to 220,
then binary-search the lightness for the original relative luminance and pick the integer
RGB triple in the local neighbourhood that minimises the luminance error.

That last clause is not a flourish. Rounding each channel independently drifted luminance by
up to 2.5e-3, and **that was enough to break two real guards**:

- `--admin-accent-green-ink` on `--admin-bg-icon-box` landed at **4.4980:1** against a 4.5
  floor. It had been sitting at 4.5006:1.
- `--admin-font-light` in dark landed at **2.9981:1** against a 3.0 floor, on
  `--admin-bg-active` over `--admin-bg-card`. The comment beside it recorded it as
  *"3.00:1"* — it had been resting exactly **on** the floor.

The neighbourhood search fixed the first. The second was lifted deliberately to **3.0782:1**
so the next revalue has somewhere to land, and the comment beside the token now says so.

## What moved

| | |
|---|---|
| `web/src/styles/tokens.css` | 70 tokens — the shell, the raised rail, every neutral, the borders, the inks, the accent and its tints |
| `web/src/styles/storefront.css` | 18 tokens — a **second palette** the brief did not mention, and the public-facing one |
| `web/public/maintenance.html` | 7 literals, a hand-kept mirror of `storefront.css` |
| 5 `features/` components | `#6a6ece` and `#b9b6cc`, hardcoded chart line and target-rule colours |

**The brief called this "close to a one-file change". It was not.** `tokenDiscipline.test.ts`
guards `ui/`, `charts/` and `layout/` only, so `features/` carried raw hexes, and
`storefront.css` is a whole separate palette outside every one of those guards.

## What deliberately did NOT move

**The categorical chart palette.** `--admin-chart-series-1..6` is colourblind-validated **as
a set**, with measured adjacent separations; series 4 is already `#1d4ed8`. Rotating series 2
(`#a21caf`) and 6 (`#7c3aed`) to navy would collide with it and destroy the separation that
makes the set readable. In a categorical palette **hue is the information channel**, not
chrome. The sequential ramp is teal and was never purple.

**The status red** `#dd0c15`. It keeps its value and gains its meaning back — see below.

## The primary action, and why red was doing two jobs

`--admin-accent-blue-fill` was `#dd0c15`. A red *"Nueva encuesta"* button and a red
*"Eliminar"* button were the same colour, so nothing distinguished a primary action from a
destructive one. The fill is now navy at the **same relative luminance as the red it
replaces**, which is why the whole `accentContrast` contract held without a single number
being re-derived: white-on-fill still clears AA, the identity accent still deliberately does
not, hover still moves further from the panel than the resting fill.

`--admin-accent-purple` could not simply become navy: it is one of four category markers on
`RecommendationCard` (alert / action / prediction / insight) and the second glow on the auth
stage, so collapsing it into the identity accent would have flattened both. It went to **hue
192**, a cyan-blue that harmonises with the chart teal. Measured, OKLab, worst pair in the
four-marker set:

| | light | dark |
|---|---|---|
| before | 0.1184 | 0.0648 |
| after | 0.1155 | **0.0933** |

Essentially unchanged in light, and **44% better separated in dark**.

## The guards, and the fact that they earned their keep

Fourteen contrast suites re-derive their numbers from `tokens.css` and assert floors, so
they adapt to a revalue. Three files instead **pin exact hexes** as a tripwire —
`tokens.test.ts` says so in its own comment: *"this one catches a value changing AT ALL,
those catch a value changing into something unreadable."* Those pins were updated
deliberately, and the prose that called the palette *"violet"* and *"lavender"* was updated
with them, because a pin whose sentence lies is worse than no pin.

**These guards are not decorative.** They caught six failures during this change, two of
them genuine sub-floor contrast regressions that no screenshot would have revealed.

`palette.test.ts` holds the diverging midpoint's channel spread within **12**, not the
16 that the comment beside the token claimed. Hue 220 needs slightly less saturation than
the old violet to stay inside it, so the midpoint lands at a spread of 11 rather than back
on the limit. The comment has been corrected.

## Why the app changed before the canvas, given the 22 Sep instruction

Federico asked that the UI be changed *"on the artifact design first."* For a **palette**
that order is not available, and the reason is a standing ruling rather than a preference:
every artboard on the canvas is a real `npm run shot` capture, because
`feedback_a_mockup_must_be_the_real_shell` forbids re-implementing the UI inside an
artifact. A palette cannot be shown on the canvas until it exists in `tokens.css`. So the
sequence is: change the tokens, re-shoot, publish the canvas, and **he rules on the
screens** — which is the approval step his instruction was protecting.

## Still open

- **The primary blue reads bright.** It inherited the red's saturation, so it is vivid
  rather than deep. A more conservative `#1d4ed8`-family value is available and would need
  the `accentContrast` contract re-derived rather than preserved. Federico's call, from the
  screens.
- **Red still marks "open" states** on the cycle timeline. Under the new rule that red means
  destructive or error, an open survey closing on a date is neither. Not touched here.
- **~80 comments across `src/` quote old hexes.** They are historical records of what the
  artboards drew; the ones that stated a *current* value in files this change touched were
  corrected, the rest were left rather than silently rewritten.
