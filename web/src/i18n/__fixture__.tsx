/**
 * Fixture for noHardcodedStrings.test.ts — deliberately contains the two things
 * the guard must catch, plus the shapes it must NOT flag.
 *
 * It lives under src/i18n/ so the guard's own EXEMPT list skips it during the
 * repo-wide sweep; the test points at it explicitly instead.
 */
import { useState } from 'react'
import { useTranslation } from './useTranslation'

export default function Fixture() {
  const { t } = useTranslation()

  // Must NOT be flagged: a generic type argument is not JSX text. A regex over
  // `>...<` reads the `>>(` here as copy.
  const [values, setValues] = useState<Record<string, string>>({})
  const [ids] = useState<Array<number>>([])
  void values

  return (
    <div>
      {/* Must be flagged: literal JSX text. */}
      <button onClick={() => setValues({})}>Delete user</button>

      {/* Must be flagged: literal user-facing prop. */}
      <input placeholder="Search users" />

      {/* Must be flagged: a ternary of literals rendered as a child. */}
      <span>{ids.length > 0 ? 'Has rows' : 'Empty'}</span>

      {/* Must be flagged: copy passed through a custom prop. */}
      <Child submitLabel="Create field" />

      {/* Must NOT be flagged: translated copy, however it is passed. */}
      <span>{t('common.save')}</span>
      <Child submitLabel={t('common.create')} />

      {/* Must NOT be flagged: style objects contain token strings, not copy. */}
      <span style={{ padding: 'var(--admin-space-4)', color: 'var(--admin-font-primary)' }} />

      {/* Must NOT be flagged: technical attribute values. */}
      <input type="text" className="field" id="search" />

      {/* Must NOT be flagged: an id reference, despite matching /label$/. */}
      <input aria-labelledby="search-heading" />

      {/* Must NOT be flagged: a non-user-facing prop, and a symbol-only node. */}
      <span data-testid="count">{ids.length}</span>
      <span>&middot;</span>
    </div>
  )
}

function Child({ submitLabel }: { submitLabel: string }) {
  return <span>{submitLabel}</span>
}
