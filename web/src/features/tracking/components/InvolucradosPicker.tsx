import { useId, useMemo, useState } from 'react'
import { X } from 'lucide-react'
import { Badge, Button, CheckboxField, Input, Label, ScrollArea } from '../../../components/ui'
import { useTranslation } from '../../../i18n'
import type { PersonaPickerItem } from '../api/trackingPickers'

/**
 * The involucrados control: **many** people, not one.
 *
 * A parked follow-up on this module recorded that the legacy screen used a single
 * `<select>` here, which cannot express what the domain plainly supports —
 * `CreatePlanRequest.Involucrados` is an `IReadOnlyList<string>` and
 * `PlanDeAccion.AgregarInvolucrado` appends to a list that de-duplicates itself.
 * So this is a filterable checkbox list with a running summary of what is chosen,
 * and it reports a `string[]`.
 *
 * ## Why a checkbox list rather than a combobox
 *
 * Spec §7's audience — 30+ years' tenure, low digital literacy. A combobox hides
 * its options until you interact with it and hides the chosen set behind a token
 * strip; a checkbox list shows every name, shows a tick against the chosen ones,
 * and can be driven with nothing but Tab and Space. The filter box narrows it when
 * a company is large, but the list is never *only* reachable by typing.
 *
 * Every control is a `ui/` primitive — `CheckboxField`, `Input`, `Button`. A bare
 * `<input>` or `<button>` would escape the caps and the focus ring `index.css`
 * applies in `@layer base`, which is invisible to a happy-dom test and obvious in
 * a screenshot.
 *
 * ## Nothing here removes an involucrado
 *
 * `AgregarInvolucradoAsync` is the only involucrados endpoint on the service;
 * there is no DELETE, and `PlanDeAccion` has no `QuitarInvolucrado`. So people
 * already on the plan arrive in `locked` and render ticked, disabled and badged
 * rather than as checkboxes that would appear to work and then not. The `X` on a
 * chip un-picks something *this session* chose and has not yet submitted.
 */
export interface InvolucradosPickerProps {
  label: string
  description?: string
  /** Everyone selectable. Empty renders the "no directory" note. */
  personas: readonly PersonaPickerItem[]
  /** Currently chosen external ids. */
  value: readonly string[]
  onChange: (value: string[]) => void
  disabled?: boolean
  /** Ids already on the plan — fixed, because the service cannot remove one. */
  locked?: readonly string[]
}

export default function InvolucradosPicker({
  label,
  description,
  personas,
  value,
  onChange,
  disabled = false,
  locked = [],
}: InvolucradosPickerProps) {
  const { t } = useTranslation()
  const [query, setQuery] = useState('')
  const filterId = useId()
  const listId = useId()

  const lockedSet = useMemo(() => new Set(locked), [locked])
  const selected = useMemo(() => new Set(value), [value])

  const visible = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase()
    if (needle === '') return [...personas]
    return personas.filter(
      (persona) =>
        persona.name.toLocaleLowerCase().includes(needle) ||
        persona.email.toLocaleLowerCase().includes(needle),
    )
  }, [personas, query])

  function toggle(id: string) {
    if (lockedSet.has(id)) return
    onChange(selected.has(id) ? value.filter((item) => item !== id) : [...value, id])
  }

  return (
    <div className="flex max-w-field flex-col gap-2">
      {/* `Label` and a plain paragraph rather than `FormLabel`/`FormDescription`:
          those call `useFormField()`, which throws outside a `FormItem`, and this
          control is a LIST of checkboxes rather than the single labelled control a
          `FormItem` wires up. Each row inside is its own `CheckboxField`, which does
          get that wiring. */}
      <Label htmlFor={filterId}>{label}</Label>
      {description && <p className="text-sm text-fg-tertiary">{description}</p>}

      {personas.length === 0 ? (
        <p className="text-sm text-fg-tertiary">{t('tracking.involucrados.noDirectory')}</p>
      ) : (
        <>
          <Input
            id={filterId}
            type="search"
            value={query}
            disabled={disabled}
            placeholder={t('tracking.involucrados.filterPlaceholder')}
            aria-controls={listId}
            onChange={(event) => setQuery(event.target.value)}
          />

          <ScrollArea className="max-h-64 rounded-md border border-line-default">
            <ul id={listId} className="m-0 flex list-none flex-col gap-2 p-2">
              {visible.length === 0 && (
                <li className="px-1 py-2 text-sm text-fg-tertiary">
                  {t('tracking.involucrados.noMatches')}
                </li>
              )}
              {visible.map((persona) => {
                const isLocked = lockedSet.has(persona.id)
                return (
                  <li key={persona.id} className="flex items-center gap-inline">
                    <CheckboxField
                      label={persona.name}
                      description={persona.email}
                      checked={isLocked || selected.has(persona.id)}
                      disabled={disabled || isLocked}
                      onChange={() => toggle(persona.id)}
                    />
                    {isLocked && (
                      <Badge variant="secondary">{t('tracking.involucrados.alreadyOnPlan')}</Badge>
                    )}
                  </li>
                )
              })}
            </ul>
          </ScrollArea>
        </>
      )}

      <p className="text-xs text-fg-tertiary" aria-live="polite">
        {t('tracking.involucrados.selectedCount', { count: value.length })}
      </p>

      {value.length > 0 && (
        <ul className="m-0 flex list-none flex-wrap gap-inline p-0">
          {value.map((id) => {
            const persona = personas.find((item) => item.id === id)
            const name = persona ? persona.name : id
            return (
              <li key={id}>
                <span className="inline-flex items-center gap-1 rounded-md border border-line-default bg-surface-input px-2 py-1 text-xs text-fg-secondary">
                  {name}
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={disabled}
                    aria-label={t('tracking.involucrados.remove', { name })}
                    onClick={() => toggle(id)}
                  >
                    <X className="size-3" />
                  </Button>
                </span>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
