# The app-wide climate mean is 3,65, not 3,67

**Ruled 2026-09-14. Owner: Federico.** Settled — no open question in this file.

Two numbers were in circulation for one survey. The screens print **3,65 (+0,29)**; the
artboards print **3,67 (+0,32)**. The screens are right and the artboards are the side that
changes.

## The two rules, and the arithmetic that separates them

Grupo Meridiano's Encuesta de Clima Q3, the whole-company row, as
`GET /surveys/climate-trends` answers it (`web/scripts/shot-fixtures/redesign-meridiano.json`,
group `__company__`):

| | Pertenencia | Crecimiento | Seguridad psicológica | Reconocimiento | Confianza | Carga de trabajo |
|---|---|---|---|---|---|---|
| mean | 4 | 3,79 | 3,75 | 3,38 | 3,67 | 3,33 |
| as printed | 4,0 | 3,8 | 3,8 | 3,4 | 3,7 | 3,3 |

- **Mean of the unrounded means** — `21,92 / 6 = 3,6533` → prints **3,65**
- Mean of the one-decimal readings — `22,0 / 6 = 3,6667` → prints **3,67**

Against Q2 (`20,16 / 6 = 3,36` unrounded; `20,1 / 6 = 3,35` as printed) the two rules give
**+0,29** and **+0,32** respectively.

## The ruling

**The app-wide mean is the mean of the UNROUNDED dimension means, on every screen that shows
it.** 3,65 and +0,29.

Why this side:

1. **It is already what every screen does** — the Panel de Control, Tendencias de Clima, the
   survey list and the results screen all read the unrounded means. Choosing 3,67 would have
   changed five screens to match two artboards.
2. **Averaging already-rounded numbers compounds rounding error**, and the error grows with the
   number of dimensions. The unrounded mean is the one that stays correct as the instrument
   changes shape.
3. **It is the figure the data supports.** 3,67 is an artefact of display precision, not a
   property of the responses.

## The *move* follows a different rule, deliberately

`printedMove` (`web/src/features/dashboard/next/derive.ts`) differences the two readings **as
printed**, never the rounding of the difference. At the two decimals the mean is printed at,
`3,65 − 3,36 = +0,29`.

This is not an inconsistency with the above, and it exists so a reader who subtracts the two
numbers **on screen** gets the number **on screen**. The same rule already governs per-dimension
moves: Confianza's `3,33 → 3,67` prints "3,3" and "3,7" and therefore moves "+0,3", never the
raw "+0,34" — which beside two printed numbers a reader can subtract to 0,4 would simply look
wrong.

## What this obliges

- **The artboards are wrong and get amended**, not the code. `ClimateTrends.dc.html` prints
  `3,67`, and the Panel de Control board prints `3,67 / +0,32`. Until they are amended, a
  fidelity check against those two boards will flag this figure — **that flag is expected and
  must not be "fixed" in the code.** This file is the reason.
- Nothing in the application changes behaviour. This ruling is a fence around behaviour that
  was already correct but undefended and mis-documented.

## How it is defended

| Guard | What it pins |
|---|---|
| `web/src/features/dashboard/next/derive.test.ts` | `latestAverage` / `waveAverage` / `previousAverage` give 3,6533, and `printedMove(…, 2)` gives +0,29 — with inputs that separate the rules |
| `web/src/features/surveys/next/trends/derive.test.ts` | `waveMean` gives 3,6533 and explicitly `not.toBe(3.67)` |
| `web/src/features/surveys/next/deriveTarget.test.ts` | `companyMean` is `3.65`; predates this ruling and already named 3,67 as the rejected rule |

**Both new guards were mutation-proved on 2026-09-14**: switching the implementation to average
the one-decimal readings compiles cleanly (`tsc -b` exit 0) and turns them red, reporting
exactly `3.6666…` and `0.32` — the artboards' two figures. The pre-existing `waveMean` case
stayed green under that same mutation, because its inputs were already at one decimal and
therefore could never tell the two rules apart. That is why a new case was added rather than the
old one extended.

## The comment this corrects

`web/src/features/dashboard/next/derive.ts`'s header used to read "the mockup's **3,67**,
**+0,32** … are all outputs of these". They were not, and never had been. The file now states
the rule and names the artboards as the side that is wrong.
