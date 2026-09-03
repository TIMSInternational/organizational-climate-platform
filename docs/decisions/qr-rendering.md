# Decision: the QR code is rendered in the browser, by `qrcode-generator`, with nothing added to the API (CLIMA-005)

Recorded 2026-09-03 against `835bcee`, with the code that implements it
(`web/src/features/surveys/components/ShareLinkQr.tsx`).

## What was missing

CLIMA-005 promises "URL + QR distribution". The URL half has shipped for a long time: the
server mints `/s/<token>` into `survey_distributions.public_url`, `PublicSurveyLinkPage`
answers it, and `ShareLinkPanel` lets an admin reveal, replace and revoke it.

The QR half did not exist anywhere in the product. The comment at
`src/ClimateProject.Api/Endpoints/SurveyDistributionEndpoints.cs:226` says so, and says
what the column holds instead:

> `QrCodeUrl` is NOT NULL, and there is no QR renderer in this repository yet. Storing the
> URL the QR code *encodes* is the honest value: it is what any renderer would need, it is
> correct today, and it does not fabricate the path of an image nobody generates. The three
> `qr_code_{svg,png,pdf}_url` columns stay NULL until something actually produces those
> files.

So the field is not wrong and does not need to change. What was absent was the renderer.

## The choice: client-side, not server-side

**Chosen: `qrcode-generator@2.0.4`, pinned exactly, in the web bundle.** The distribution
page builds the matrix, draws it as inline SVG, and rasterises that SVG to a PNG through a
`<canvas>` when the admin asks for a download. No request leaves the browser.

**Rejected: a server-side renderer** (a new `GET /surveys/{id}/distribution/qr.png`
endpoint, and the three `qr_code_*_url` columns filled in).

The repository has already settled the general form of this question once, in the opposite
direction and for a reason that does not apply here. `docs/decisions/pdf-rendering.md`
rejected a PDF package and hand-wrote a PDF 1.4 serialiser, and its stated reason was a
licence threshold:

> **Rejected: a PDF package.** QuestPDF is royalty-free only below a revenue threshold,
> which is a licence question a government client's procurement will ask and somebody will
> have to answer with a number.

That is the cost that made a hand-rolled serialiser cheaper than a dependency: not the code,
the *answer somebody has to give procurement*. `qrcode-generator` has no threshold to answer
for — it is MIT, `node_modules/qrcode-generator/package.json` line `"license": "MIT"`, with
the licence text repeated at the head of every shipped file — and `npm view
qrcode-generator@2.0.4 dependencies` reports no dependencies at all, so there is no
transitive licence surface either. The trade the PDF decision was refusing is simply not on
offer here.

Three further reasons the client side is the right side of the boundary:

1. **Nothing server-side changes.** The API already stores the exact string a QR code has to
   encode. A server renderer would add an image-producing endpoint, a caching question, and
   three columns that then have to be kept truthful across every regenerate and revoke — to
   deliver a file the browser can make from data it already holds.
2. **A QR image is a bearer credential in a scannable form.** An endpoint that serves one is
   another authenticated surface to get right; a component that draws one is not a surface at
   all.
3. **The origin problem solves itself in the browser and does not on the server.**
   `SurveyAccessTokens.PublicLinkPrefix` documents that `public_url` is stored site-relative
   *on purpose*, because the column is uniquely indexed and "baking a host into it would mean
   the same link stored under two different origins (staging and production, or before and
   after a domain change) is two different rows and one broken index", and adds "nothing here
   may ever concatenate a host." A camera has no page to resolve a relative path against, so
   a QR must carry an absolute URL. In the browser that absolute URL is
   `window.location.origin` — the origin the admin is actually looking at, so staging
   produces a staging code and production a production one, with no configuration to get
   wrong. On the server it would be one more configured base URL to keep in step with
   `Email__AppBaseUrl`, and P4/P6 of `docs/runbooks/cutover.md` are open precisely because
   that class of value is not yet settled.

## The bundle cost, measured

`npm run build` in `web/`, before and after the dependency plus the component and its eight
i18n keys in both catalogues:

| Asset | Before | After | Delta |
|---|---|---|---|
| `dist/assets/index-*.js` | 1,739.58 kB (gzip 482.88 kB) | 1,765.05 kB (gzip 492.50 kB) | **+25.47 kB raw, +9.62 kB gzip** |
| `dist/assets/index-*.css` | 74.05 kB (gzip 14.85 kB) | 74.45 kB (gzip 14.92 kB) | +0.40 kB raw, +0.07 kB gzip |

That delta is the whole change, not the library alone: it includes `ShareLinkQr.tsx` and the
new catalogue keys. The library's own shipped ESM module is 51,907 bytes unminified
(`node_modules/qrcode-generator/dist/qrcode.mjs`); +9.62 kB gzip is what survives
minification and compression of the parts actually reached.

**It is not code-split, and that is a choice to revisit rather than a mistake to fix now.**
The bundle already emits one 1.7 MB `index-*.js` and warns about it on every build; a
dynamic `import()` around 9.6 kB of it would be the first lazy boundary in the app and would
buy roughly 2% of a chunk that needs a real code-splitting pass, not a special case. If that
pass happens, this module is a clean candidate: it is reached from exactly one screen.

## What the implementation commits to, and why

- **Error correction level M, type number `0`.** `0` asks for the smallest version that fits,
  so the grid stays as coarse as the payload allows. For a real token — `/s/` plus 43
  base64url characters, resolved against `https://climate.timsint.com` — that is 73
  characters and **37 modules (version 5)**. Both numbers are pinned in
  `ShareLinkQr.test.tsx`, because a change to either changes how every already-printed code
  scans.
- **A four-module quiet zone, inside the `viewBox`.** ISO/IEC 18004 requires it, and putting
  it in the geometry rather than in CSS padding means it survives every scale the SVG is
  drawn at *and* the PNG export. A downloaded code pasted onto a poster with no quiet zone is
  the classic unreadable QR.
- **The code never inverts with the theme.** ISO/IEC 18004 assumes dark modules on a light
  background. Some phone cameras cope with an inverted code; "some" is not a property to hand
  to a respondent standing in front of a printed poster, and a theme-following QR would be
  light-on-dark for every admin in dark mode and would export that way too. So the pair is
  taken from the two tokens this design system paints **identically in both palettes** rather
  than from a hardcoded black and white: modules `--color-accent-blue-fill` (`#dd0c15` at
  `web/src/styles/tokens.css:418` light and `:719` dark) on paper `--color-fg-on-accent`
  (`#ffffff` at `:363` and `:704`). `tokens.css:407-408` names that pair the one
  surface/ink combination in the system, measured at 5.47:1 with white in both themes by
  `styles/accentContrast.test.ts`. `ShareLinkQr.test.tsx` re-derives the pair from the
  component's own class names, resolves them through `theme.css`, and re-measures the
  contrast out of `tokens.css` in both palettes — so a later repaint of either token fails
  the suite instead of shipping an invisible code to half the users.
- **The QR is hidden until asked for.** This is the one place the implementation deliberately
  departs from "put it next to the link". `ShareLinkPanel` masks the link by default, and its
  own comment gives the reason: the failure mode is "the link sitting in plain sight while a
  distribution page is screen-shared into a stand-up, pasted into a status report, or
  captured in a screenshot filed against a ticket." A QR code is the same bearer credential
  in a form a **camera** lifts off a screen from across a room with nobody transcribing
  anything. Rendering it unconditionally beside a deliberately-masked link would hand back
  exactly the disclosure the mask exists to prevent, in the more dangerous of the two
  formats. One click, same rule, same reason. **If that trade is not wanted, the change is
  `useState(false)` → `useState(true)` in one place** — and the test named "does not put the
  code on screen until it is asked for" is what would then have to be deleted on purpose.
- **No QR for a link that is not live.** `null` `publicLink` renders nothing, and an
  `accessType` other than `public` renders nothing. The server already nulls `public_url` on
  revoke and on any move off `public` (`SurveyDistributionEndpoints.cs:342-348`), so the
  second condition should never be reached — it is there because "never render a QR for an
  inactive link" is the requirement, and a requirement enforced only by a value arriving
  `null` from somewhere else is enforced by accident.

## What the download cannot promise

The PNG is produced by serialising standalone SVG markup — with the plaque colours read back
out of the live cascade, because a `data:` URL SVG is parsed with no CSS context and a
Tailwind class or a `currentColor` in it would paint nothing — loading it into an `Image`,
drawing that onto a `<canvas>` at 1024x1024, and calling `toBlob(…, 'image/png')`.

Every step there is a step a browser can refuse. `qrPngBlob` therefore returns `null` rather
than throwing on all of them, and the component says so in both languages
(`surveys.distribution.qrDownloadFailed`) while leaving the code on screen, because the code
is still valid and still screenshottable.

**The successful path is not proved by the unit suite, and that is stated rather than
implied.** `happy-dom` answers `getContext('2d')` with `null` — measured in
`ShareLinkQr.test.tsx`, not assumed — so the real DOM in tests cannot produce a bitmap at
all. Two consequences, both written into the test file:

1. A `RasterDeps` seam lets one assertion drive a working canvas, which is what proves the
   blob's type is `image/png` and that the image is drawn before it is read.
2. The component-level failure notice is reached through the **colour-resolution** guard in
   that environment, not the canvas guard — so removing the canvas guard leaves that
   particular test green. The canvas guard is covered directly against `qrPngBlob`
   one test up.

Real pixels are proved in a browser, by the light and dark screenshots of
`/surveys/:id/distribution` attached to the PR.

## How the geometry is proved

Three of the four things that can be wrong here are invisible in a screenshot, so they are
asserted rather than looked at.

- **Orientation.** `qrPathData` reads `isDark(row, column)` and writes `M<column> <row>`.
  Transposing those two produces a picture with three finder squares in three corners that
  looks exactly like a QR code and encodes format bits where no scanner reads them. So the
  square set is compared against `qrcode-generator`'s **own** `createSvgTag({ cellSize: 1,
  margin: 4 })` — code this change did not write, in the same coordinate space, at the same
  default margin. Transposing row and column fails that test and only that test; every other
  assertion in the file stays green, which is the point of having it.
- **The payload.** `ShareLinkPanel` and `ShareLinkQr` are rendered together from the one
  `publicLink` the page hands both, both are revealed, and the path data is re-derived from
  the anchor's own visible text. Decoding the code would prove less: this compares what the
  encoder was given against what the reader is shown.
- **The version and the quiet zone**, pinned as numbers: 73 characters, 37 modules, a
  `viewBox` of `0 0 45 45`, and no module coordinate outside `[4, 41)`.

What is **not** proved by the suite: that a phone camera reads the rendered code. The
matrix comes from a reference implementation and agrees with that implementation's own
renderer, and the light/dark screenshots show crisp modules, an intact quiet zone and no
inversion — but nobody has pointed a phone at it. That is a UAT step, not a test.

## When to revisit

- **A QR on a server-rendered artefact** — a PDF poster, or an invitation email body. Neither
  can run this component, and that is the point at which the three `qr_code_*_url` columns
  earn a renderer. `docs/decisions/pdf-rendering.md` already names images as the trigger to
  revisit *that* decision rather than extend it; a QR in a PDF trips both at once.
- **A logo or custom colours in the middle of the code.** `survey_distributions` has a
  `qr_customization` object and the API validates it (`ValidateQrCustomization`), and nothing
  in it is honoured here. Honouring it means error-correction budgeting, which is a different
  and more careful job than drawing a grid.
- **The first real code-splitting pass on the web bundle**, per the bundle-cost note above.
