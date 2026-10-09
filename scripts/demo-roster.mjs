/**
 * The two facts both demo seeders have to agree about: WHICH of a department's people make up
 * a respondent roster, and WHICH demographic values each of them carries.
 *
 * ## Why this is its own file
 *
 * `seed-surveys.mjs` needs the ordering and `seed-demo-company.mjs` needs it too, and the first
 * attempt had the former import it from the latter. That breaks outright: both scripts call
 * `parseArgs` at module scope, `parseArgs` throws on an unknown option by default, and
 * `seed-demo-company.mjs` does not declare `--email` — so `node scripts/seed-surveys.mjs
 * --email …` died inside an import with `ERR_PARSE_ARGS_UNKNOWN_OPTION` before either script
 * had done anything. A module shared between two CLIs must have no top-level side effects, and
 * reading `process.argv` is one.
 *
 * Nothing here touches the network, so the test can assert the resulting cohort sizes without a
 * server.
 */

/**
 * A department's employees in the order a respondent roster is taken in.
 *
 * `seed-surveys.mjs` takes the first `respondents` of this list; `seed-demo-company.mjs`
 * assigns `puesto: gerencia` to the first `gerencia` of the SAME list. "5 of the 10 who
 * answered are gerencia" is therefore true by construction rather than by luck — but only
 * while there is one ordering, which is the reason this function is not written twice.
 *
 * Sorted by id, a random GUID: the subset is arbitrary but stable across runs. Ordering by
 * creation instead would make a roster "the first N hired", a different bias and not the one
 * `seed-surveys.mjs` documents.
 *
 * `fede.` is excluded for the reason that account exists: the local super admin belongs to no
 * department's team and must not answer anybody's survey.
 */
export function orderedEmployeesOf(users, departmentId) {
  return users
    .filter((u) => u.isActive && u.departmentId === departmentId && u.role === 'employee' && !u.email.startsWith('fede.'))
    .sort((a, b) => a.id.localeCompare(b.id))
}

/**
 * The demographic values the employee at `index` in that ordering carries.
 *
 * `antiguedad` is round-robin on the same index: an even spread needs no randomness, and a
 * deterministic one is what lets this month's screenshot be compared with last month's.
 */
export function demographicsFor(index, gerenciaCount) {
  return {
    puesto: index < gerenciaCount ? 'gerencia' : 'colaborador',
    antiguedad: ['0-1', '1-4', '5+'][index % 3],
  }
}

/**
 * The cohort sizes a profile's numbers actually produce, as
 * `{ perDepartment: { dept: { puesto: n } }, perPuesto: { puesto: { dept: n } } }`.
 *
 * Both views are needed because `SurveyResultsFilter.MayDisclose` tests each selector against
 * the scope the OTHER selectors define, so `puesto:P + department:D` asks two different
 * questions: "inside D, how big is each puesto cohort" and "inside P, how big is each
 * department cohort". A number that satisfies one and not the other discloses nothing.
 */
export function cohortsOf(respondentsByDepartment, gerenciaByDepartment) {
  const perDepartment = {}
  const perPuesto = { gerencia: {}, colaborador: {} }
  for (const [department, respondents] of Object.entries(respondentsByDepartment)) {
    const gerencia = Math.min(gerenciaByDepartment[department] ?? 0, respondents)
    const counts = { gerencia, colaborador: respondents - gerencia }
    perDepartment[department] = counts
    for (const [puesto, n] of Object.entries(counts)) {
      if (n > 0) perPuesto[puesto][department] = n
    }
  }
  return { perDepartment, perPuesto }
}

/**
 * Whether every cohort in `counts` is disclosable under the floor — each one either absent or
 * at or above it, so the complement rule has no subtractable remainder to withhold against.
 *
 * This is `MayDisclose`'s condition restated over counts rather than over responses: that
 * method withholds the smallest disclosed cohort while the undisclosed remainder sits between
 * 1 and the floor, so a set whose members are all 0 or >= floor leaves a remainder of exactly
 * 0 and nothing is withheld.
 */
export function allCohortsDisclose(counts, floor = 5) {
  return Object.values(counts).every((n) => n === 0 || n >= floor)
}
