/**
 * A company's name without its legal form — `Acme Corporation` → `Acme`,
 * `Grupo Meridiano S.A.` → `Grupo Meridiano` — for a sentence that names a tenant in
 * passing: "Todos de Acme", "6 globales · 6 de Acme", "Ver las de Acme" (the per-role
 * canvas, 10 Sep). Tables, selects and headings keep the full registered name.
 *
 * Only a trailing legal form is dropped, once, and only when a name remains: a company
 * whose whole name is a legal word keeps it. No list of legal forms is complete, so an
 * unknown one simply stays — the full name is never wrong, only long.
 */
const LEGAL_FORMS = [
  'S.A. de C.V.',
  'S. de R.L.',
  'S.R.L.',
  'S.R.L',
  'S.A.',
  'S.A',
  'SA',
  'Ltda.',
  'Ltda',
  'Corporation',
  'Corp.',
  'Corp',
  'Incorporated',
  'Inc.',
  'Inc',
  'LLC',
  'Ltd.',
  'Ltd',
  'Limited',
  'GmbH',
  'Co.',
  'Co',
]

function escape(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

const TRAILING = new RegExp(`[,\\s]+(?:${LEGAL_FORMS.map(escape).join('|')})$`, 'i')

export function companyShortName(name: string): string {
  const trimmed = name.trim()
  const short = trimmed.replace(TRAILING, '').trim()
  return short === '' ? trimmed : short
}
