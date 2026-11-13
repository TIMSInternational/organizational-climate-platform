import { useMemo, useState } from 'react'
import { Alert, AlertDescription, Button, Checkbox, CheckboxField, TextField, TextareaField } from '../../../../components/ui'
import { useTranslation } from '../../../../i18n'
import type { User } from '../../../org-structure/api/users'
import { matchPaste, searchPeople, withPeople, type Choosable } from './peopleTargets'

/** Rows drawn at once. A search narrows the rest; "choose all results" still reaches every match. */
export const PEOPLE_LIST_LIMIT = 200

/**
 * "Personas específicas" on the builder's audience step (G14): find people by name, email or
 * department and tick them, choose every result at once, or paste a list of addresses and see,
 * before adding, which of them name nobody active in the company.
 *
 * It holds no copy of the selection: `chosen` is the form's `userIds`, so a restored draft's
 * people are the ones drawn ticked, and the count is always the count that will be sent.
 */
export function PeoplePicker({
  people,
  users,
  chosen,
  onChange,
}: {
  /** The company's active people, or null when the directory could not be read. */
  people: readonly Choosable[] | null
  /** The whole directory, inactive accounts included, so a paste can say WHY an address missed. */
  users: readonly User[]
  chosen: readonly string[]
  onChange: (ids: string[]) => void
}) {
  const { t } = useTranslation()
  const copy = (key: string, vars?: Record<string, string | number>) => t(`surveys.next.builder.audience.${key}`, vars)
  const [query, setQuery] = useState('')
  const [onlyChosen, setOnlyChosen] = useState(false)
  const [paste, setPaste] = useState('')

  const chosenSet = useMemo(() => new Set(chosen), [chosen])
  const activeIds = useMemo(() => new Set((people ?? []).map((person) => person.id)), [people])
  const results = useMemo(() => {
    const found = searchPeople(people ?? [], query)
    return onlyChosen ? found.filter((person) => chosenSet.has(person.id)) : found
  }, [chosenSet, onlyChosen, people, query])
  const pasted = useMemo(() => (paste.trim() === '' ? null : matchPaste(paste, users)), [paste, users])

  if (people === null) {
    return (
      <Alert variant="destructive" role="alert">
        <AlertDescription>{copy('peopleUnreadable')}</AlertDescription>
      </Alert>
    )
  }

  const resultIds = results.map((person) => person.id)
  const unchosenResults = resultIds.filter((id) => !chosenSet.has(id)).length
  const chosenResults = resultIds.length - unchosenResults
  const stale = chosen.filter((id) => !activeIds.has(id))
  const pastedNew = pasted === null ? 0 : pasted.matchedIds.filter((id) => !chosenSet.has(id)).length

  return (
    <div className="flex flex-col gap-3" data-testid="people-picker">
      <p className="m-0 text-sm" data-testid="people-chosen-count" aria-live="polite">
        <span className="font-mono tabular-nums text-fg-primary">{chosen.length}</span>{' '}
        {copy(chosen.length === 1 ? 'chosenOne' : 'chosenMany')}
      </p>

      {stale.length > 0 && (
        <Alert variant="destructive" role="alert">
          <AlertDescription>
            {copy('peopleInactive', { count: stale.length })}{' '}
            <Button type="button" variant="link" size="sm" onClick={() => onChange(withPeople(chosen, stale, false))}>
              {copy('removeInactive', { count: stale.length })}
            </Button>
          </AlertDescription>
        </Alert>
      )}

      <TextField label={copy('searchLabel')} description={copy('searchHelp')} value={query} onChange={setQuery} />
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={unchosenResults === 0}
          onClick={() => onChange(withPeople(chosen, resultIds, true))}
        >
          {copy('chooseResults', { count: unchosenResults })}
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={chosenResults === 0}
          onClick={() => onChange(withPeople(chosen, resultIds, false))}
        >
          {copy('unchooseResults', { count: chosenResults })}
        </Button>
        <CheckboxField label={copy('onlyChosen')} checked={onlyChosen} onChange={setOnlyChosen} />
      </div>

      {results.length === 0 ? (
        <p className="m-0 text-sm text-fg-secondary">{copy(people.length === 0 ? 'nobodyActive' : 'noResults')}</p>
      ) : (
        <ul
          className="m-0 flex max-h-80 list-none flex-col overflow-y-auto rounded-md border border-line-default p-0"
          aria-label={copy('resultsLabel', { count: results.length })}
          data-testid="people-results"
        >
          {results.slice(0, PEOPLE_LIST_LIMIT).map((person) => (
            <li key={person.id} className="mb-0 border-b border-line-default px-3 py-2 last:border-b-0">
              <label className="mb-0 flex min-w-0 items-start gap-2.5 font-normal">
                <Checkbox
                  className="mt-0.5"
                  checked={chosenSet.has(person.id)}
                  onCheckedChange={(checked) => onChange(withPeople(chosen, [person.id], checked === true))}
                  aria-label={person.name}
                />
                <span className="flex min-w-0 flex-col">
                  <span className="text-sm text-fg-primary">{person.name}</span>
                  {/* Only the address may break anywhere: a department name broken mid-word at
                      390px read as two words. */}
                  <span className="text-xs text-fg-secondary">
                    <span className="break-all">{person.email}</span>
                    {person.department !== '' && (
                      <>
                        {' · '}
                        <span className="whitespace-nowrap">{person.department}</span>
                      </>
                    )}
                  </span>
                </span>
              </label>
            </li>
          ))}
        </ul>
      )}
      {results.length > PEOPLE_LIST_LIMIT && (
        <p className="m-0 text-xs text-fg-secondary">{copy('listCapped', { shown: PEOPLE_LIST_LIMIT, count: results.length })}</p>
      )}

      <div className="flex flex-col gap-2 rounded-md bg-surface-icon-box px-3.5 py-3" data-testid="people-paste">
        <TextareaField label={copy('pasteLabel')} description={copy('pasteHelp')} rows={4} value={paste} onChange={setPaste} />
        {pasted !== null && (
          <div className="flex flex-col gap-2 text-sm" data-testid="paste-preview">
            <p className="m-0">
              {copy('pasteMatched', { matched: pasted.matchedIds.length, count: pasted.addresses })}
            </p>
            {pasted.unmatched.length > 0 && (
              <div>
                <p className="m-0 font-medium text-fg-primary">{copy('pasteUnmatched', { count: pasted.unmatched.length })}</p>
                <ul className="m-0 mt-1 flex list-none flex-col gap-0.5 p-0" data-testid="paste-unmatched">
                  {pasted.unmatched.map(({ email, reason }) => (
                    <li key={email} className="mb-0">
                      <span className="break-all font-mono text-xs text-fg-primary">{email}</span>{' '}
                      <span className="text-fg-secondary">— {copy(reason === 'inactive' ? 'reasonInactive' : 'reasonUnknown')}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={pastedNew === 0}
                // The paste stays: the addresses that matched nobody are still listed after the add.
                onClick={() => onChange(withPeople(chosen, pasted.matchedIds, true))}
              >
                {copy('pasteAdd', { count: pastedNew })}
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
