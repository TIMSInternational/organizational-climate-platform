# What still needs a developer, day to day — measured 2026-11-19

**Measured against `main` at `a44aa0d4`** (= production: web on Vercel from that merge, API
`/version` = `0e8fa64b`, the last API-touching commit). Additive, per the `docs/audits/`
convention: read beside `2026-11-08-operator-ui-walkthrough.md` (can an operator run a client
from the screen) and `2026-10-31-frontend-completeness.md` (does every route have a screen).

## The question

Not "is there a screen for every operation" — the three audits before this one answered that,
and the answer is now mostly yes. This one asks: **what does a client's ordinary request still
turn into a code change, a deploy, a script or a SQL file?** Every one of those costs a commit,
a 30-minute CI run, a deploy and a developer, and every one has, at least once, gone to every
client when it was meant for one.

## Method — three sources, every claim checked against the code

1. **The operations kit** (`~/Desktop/TIMS-NEXA-Clima`, 326 files): every script dated after the
   8 Nov walkthrough, reduced to the routes and SQL it calls, then each route checked for a
   caller in `web/src`.
2. **The history**: 66 non-merge commits since 2026-10-01 name ESPH, Eagle or PROCOMER. Those
   that changed *wording or content* rather than behaviour are the signal.
3. **An inventory** of every text a respondent or a client reads, sorted by where it lives:
   the survey, the company, or the code (the i18n catalogues and the C# copy classes).

## What is already editable — do not rebuild

| What | Where it is edited | Level |
|---|---|---|
| Title, welcome text (description), questions, dimension names, scale words, comment prompt, «Mantener al final» | builder · questions editor | survey |
| Anonymity paragraph, thank-you, **duration (minutes)** | Distribución → «Textos para quien responde» (`SurveySettings.RespondentIntro*`, `ClosingMessage*`, `EstimatedMinutes`, `Survey.cs:169-186`) | survey, draft/scheduled/active (`surveyInvitationCopy.ts:128`) |
| Personal-link email subject and message | Distribución → «Correo de invitación» (`PersonalLinkEmailComposer.cs:22-25`) | survey |
| Dates, reopen, audience, duplicate, exclude a response, reissue/remind/withdraw a key, delete an empty company or a person | survey page · roster (#643, #654–#657) | survey / person |
| Logo, colour, language, time zone, result bands and their names, privacy notice, licences | company settings | company |
| Report title, description, sections, crosses | Nuevo informe | report |

The October kit's operations are in the product: of the scripts written since 8 Nov, every API
route they call now has a button (exclusions → `ResponseExclusionDialog`, reissue/remind →
`SurveyRosterPanel`, role → the users views, close date → the survey page). What remains is
below.

## Gaps, ranked by how often they have cost a code change

### 1. Respondent texts exist per survey, but not per client — and three are not editable at all 🔴

**Seen:** the anonymity paragraph was changed **in code** three times in a month, each time for
every client: Eagle's wording on 20 Oct (then reverted to per-survey, #610), the small-group
sentence on 18 Nov (`60e95767`), PROCOMER's wording on 19 Nov (`51aeb4af`). The «Sobre usted»
intro needed code the same day (`8d9ed8e9`).

**Why:** a respondent text is either **global** (the catalogue — a change reaches ESPH, Eagle
and PROCOMER alike) or **per survey** (re-typed on every survey; templates do not carry it — no
reference to `respondentIntro`/`closingMessage` in any `SurveyTemplate*` file). There is no
**client** level in between. And three texts have no editor at all:

- «Sobre usted» intro — `SurveyRespondForm.tsx:1122` reads `t('demographics.intro')`.
- «Quién responde» intro (name and email screen) — `surveyRespond.identity.intro`.
- The participation clause under the anonymity box — `surveyRespond.participationBody`.

**Proposal:** one fallback chain — **survey → client → product** — for the anonymity paragraph,
the thank-you, the two intros above and the participation clause, edited in company settings
(«Textos para quien responde de esta empresa») and in the existing survey dialog. Empty at a
level means "inherit". A client's wording is then typed once, by TIMS, and reaches only that
client. **M.**

### 2. The texts and the invitation email cannot be set while creating a survey 🟠

**Seen:** the builder's six steps are basics · schedule · audience · questions · settings ·
review (`surveys.next.builder.stepLine`). «Textos para quien responde» and «Correo de
invitación» open only from Distribución (`SurveyDistributionNextPage.tsx:772-773`) — a page an
operator reaches after creating the survey, and only if they know to look.

**Proposal:** a «Textos y correo» section in *Revisión* (or a seventh step) that opens the same
two dialogs, with "predeterminado" shown where nothing is set. **S.**

### 3. Nobody can see the survey as a respondent will, without answering it 🟠

**Seen today:** checking PROCOMER's live link before it went out stopped at question 1 —
answers on a public link autosave into the client's results, so walking 57 questions, the two
pinned last and the thank-you would have added a response. The builder's preview is "a
picture, not a control" of question cards (`QuestionPreview.tsx:17`): no start page, no
anonymity box, no footer, no served order, no thank-you.

**Proposal:** «Ver como quien responde» on the survey page — the real respond screens, in the
order a respondent is served (shuffle and «Mantener al final» applied), with the survey's own
texts, ending on its thank-you, **saving nothing** (no session, no autosave, no submit).
Available in draft and live. It is the check every client review has asked for by
screenshot. **M.**

### 4. Two of the three survey emails are written in code 🟠

**Seen:** the username-and-password email (ESPH's mode) and the reminder are fixed copy —
`CredentialsEmailComposer.cs:164` and `SurveyReminderEmailComposer.cs:110-120` build the subject
from a constant prefix plus the survey and company names; the body is `CredentialsCopy` /
`ReminderCopy`. Only the personal-link email takes the survey's subject and message. History:
617 people nearly received «[Empresa]» as a subject (#586); «usted» across every email (`60177d0e`).

Separately, a notification-template API exists with list/create/update/preview
(`NotificationTemplateEndpoints.cs:31-37`) and **no screen**: its client module,
`web/src/features/notifications/api/notificationTemplates.ts`, has no importer.

**Proposal:** the credentials and reminder emails take the same optional survey subject and
paragraph the personal-link email does (empty = today's text). Decide whether the
notification-template API gets a screen or is retired. **M.**

### 5. "Only the people the client named" is still guarded by a script 🟠

**Seen:** after the 28 Oct mis-send, every ESPH send was gated by
`esph-verificar-lista-clima.py` against the client's spreadsheet (CLAUDE.md, "Never send
anything to someone the client did not name"). The product resolves an audience, which is not
the client's list (ESPH Clima: audience 633, list 617).

**Proposal:** an optional «Lista autorizada del cliente» per survey (paste or upload); while it
is set, a send, resend or reminder to anyone not on it is refused, and the roster marks them.
**M.**

### 6. A paper questionnaire is entered by re-pointing a real person's account ⚠️ ruling first

**Seen:** `esph-fisicas-10nov.sh` — "apuntar cada cuenta a un buzón de TIMS y reexpedir su
clave, para que TIMS pueda digitar las respuestas". It changes a real person's email and
mails a new key. The 31 Oct audit already listed "record a paper responder" as a ruling before
it is code.

**Proposal (for the ruling):** «Registrar respuesta en papel» on a roster row — TIMS types the
answers, the response is marked as entered by TIMS, the person's account is not touched. **M**,
after the decision on how such a response is labelled and audited.

### 7. Client-format deliverables and TIMS's own commentary are made outside the product 🟡

**Seen:** after the standard workbooks shipped (#646, #653), ESPH's deliverables on 12 Nov were
still built by `esph-respuestas-formato-2024.py`, `esph-respuestas-combinar.py` and
`esph-lista-con-resultados.py` (their 2024 layout); Eagle's by `eagle-formato-excel.py` and
`eagle-resultados-final.py` (results plus themes). The PDF report has data sections only
(`SurveyReportOptions.cs:37`) and takes a title and description (`ReportDtos.cs:244`) — no place
for TIMS's interpretation.

**Proposal:** «Notas de TIMS» on the report — an introduction, conclusions and recommendations
printed as their own pages (**S–M**). Client-specific workbook layouts: keep as scripts until a
second client asks for the same one.

### 8. A typo in a question cannot be fixed once one person has answered ⚠️ ruling first

**Seen today:** PROCOMER's question 55 reads «¿Hay **algun** comentario…». The survey has one
response, so the questions are frozen (`RefuseLiveEditAsync`, `SurveyEndpoints.cs:1590`), and the
only fix is a duplicate.

**Proposal (for the ruling):** let TIMS correct the *wording* of a question with answers — same
type, scale and options — recorded as a new version (the versioning that #657 uses already
snapshots content). Meaning-changing edits stay refused. **S** after the decision.

### 9. The respondent's buttons follow the browser, not the survey 🟡

**Seen today:** the PROCOMER link, opened by a browser set to English, said «Start answering»
over a Spanish-only survey. The interface language comes from `navigator.languages`
(`i18n/locale.ts:63`).

**Proposal:** a single-language survey sets the respondent interface to its language (the
picker still lets a visitor change it). **S.**

### 10. Presentation choices made for one client apply to all 🟢

Justified text with hyphenation (`51aeb4af`, `44a98168`) and the footer wording were PROCOMER's
requests and now apply to every client. Nobody has objected; if one does, it is a company
setting («Alineación del texto: justificado / izquierda»), not another code change. **S**, only
when asked.

## What should stay in code, deliberately

The privacy floor (3, and 1 for a single group seen by an administrator), what is stored
anonymously, who may read verbatim text, and the default estimate rule. These are guarantees,
not preferences: making them editable per client would make the promise on the screen depend
on who configured it. They change by ruling (`docs/decisions/`), as they do today.

## Suggested order

| | Gap | Size | Why first |
|---|---|---|---|
| 1 | #2 texts in the builder | S | removes "where is it?" from every new survey |
| 2 | #9 interface language follows the survey | S | seen on a live client link today |
| 3 | #1 client-level respondent texts + the three missing editors | M | the most frequent code change of the month |
| 4 | #3 «Ver como quien responde» | M | the review every client does by screenshot |
| 5 | #4 editable credentials and reminder emails | M | the next mass-invite client will ask |
| 6 | #5 authorized list | M | turns the 28 Oct rule into a guard the product enforces |
| — | #6 paper, #8 wording fixes | — | rulings first |
| — | #7 report notes | S–M | when the next report is delivered |
