# Complete TIMS + NEXA climate workbook

Open **Surveys → Import complete Excel** (`/surveys/import`). Download the branded template from that screen, complete it, upload it, review all sections, and approve **Create climate and send access**.

The workbook contains the questionnaire as well as the participant roster. No separate people workbook is required for this flow.

## Workbook contract

- **EMPRESA:** company name/domain, industry, country, company size, survey title, Spanish/English content language, opening/closing dates, IANA timezone, anonymity, and result display. The domain selects an existing company; only a super administrator can create a new company. Existing company profile metadata is retained; language, timezone, anonymity default and result bands are updated as disclosed in review. Contact, sender, expected count and department notes are planning references, not administrator-account or SMTP configuration. Leave the service/license cell blank; this flow does not provision licenses.
- **DESCRIPCION:** description in B6 and invitation in B10. An `Asunto:` line supplies the invitation subject. `[Empresa]` is replaced with the company name supplied in EMPRESA.
- **ESCALAS:** five answer labels with values 1–5; three contiguous result bands covering 1–5. The display can be 1–5 or 0–100; percent display uses the existing platform conversion (mean × 20). It does not turn the instrument into a 101-choice answer scale.
- **PREGUNTAS:** dimension headings in column B, followed by numbered question rows (A: order, B: statement). The `Preguntas abiertas` section contains optional free-text questions; other sections contain required five-choice questions. The template includes 40 questions across 10 sections. Titles and question wording are editable. Keep question numbering so a statement without final punctuation is recognized correctly.
- **DEMOGRAFICOS:** headers in row 5, people from row 6. Nombre, Correo and Área / Departamento are mandatory; Apellido is combined with Nombre. Rol accepts Colaborador, Líder or Supervisor. An omitted role is inferred from a leadership job title or defaults to employee. Puesto and other demographic columns become select fields with the distinct nonempty values in the file. Blank columns do not create fields. The review shows every participant and the effective role.
- **INICIO / CAMPOS:** instructions and reference, not additional configuration inputs.

Limits: XLSX only, 10 MB compressed / 64 MB expanded, 1,000 people, 200 questions, demographic columns through AD, questions through row 600. Formulas in imported values, duplicate emails (including across batches), invalid roles, missing required demographic values, incompatible existing fields, retired departments and conflicting survey titles are refused. Blank template rows are ignored.

## Approval and delivery

Preview performs no writes or sends. Approval uses the app's existing authenticated company, field, department, survey, bulk-account and invitation APIs. New accounts are validated before the first credential send and created in batches of 100. Invites target the listed account IDs in batches of 100. Distribution is configured for sign-in access, with no public share link.

New accounts receive generated credentials through the existing credentials sender. A separate survey invitation is queued through the existing notification delivery pipeline. Existing accounts retain their username, password and role; their name, department and supplied demographics are updated, preserving other demographic values. Reinviting an existing account does not reset or re-email its password.

The completion screen distinguishes account creation from credential-email failures and points to Distribution for delivery status. A queued message is not an inbox-delivery confirmation. Credentials that failed to send must be resent from Users.

## Interrupted imports

Keep the tab open during approval. Navigation is blocked while work runs and closing the tab triggers the browser's warning. This is a resumable sequence of authenticated resource calls, not a single database transaction: company, survey or accounts may already exist if a later step fails.

Review the same original workbook again before retrying. Matching company/survey/accounts are reused. Existing invites are skipped by the existing invitation endpoint. A conflicting title or changed questionnaire requires a new title, rather than rewriting a live instrument. Passwords are never stored in the workbook or browser. If an interruption loses a credentials-send result, inspect/resend access from Users; a retry deliberately does not reset existing accounts.

The feature does not send any invitation merely by downloading or reviewing a workbook. The administrator approves the concrete recipient list before emails begin.
