import { useState } from 'react'
import { bulkImportUsers, type BulkImportResponse } from '../api/bulkImport'
import { useTranslation } from '../../../i18n'
import { Table } from '../../../components/ui'

interface BulkImportPanelProps {
  baseUrl: string
  companyId: string
  onImported: () => void
}

export default function BulkImportPanel({ baseUrl, companyId, onImported }: BulkImportPanelProps) {
  const { t } = useTranslation()
  const [file, setFile] = useState<File | null>(null)
  const [result, setResult] = useState<BulkImportResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  async function handlePreview() {
    if (!file) return
    setError(null)
    setSubmitting(true)
    try {
      const response = await bulkImportUsers(baseUrl, companyId, file, true)
      setResult(response)
    } catch (err) {
      setError(err instanceof Error ? err.message : t('errors.generic'))
    } finally {
      setSubmitting(false)
    }
  }

  async function handleConfirm() {
    if (!file) return
    setError(null)
    setSubmitting(true)
    try {
      const response = await bulkImportUsers(baseUrl, companyId, file, false)
      setResult(response)
      onImported()
    } catch (err) {
      setError(err instanceof Error ? err.message : t('errors.generic'))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div>
      {error && <p role="alert">{error}</p>}
      <p>{t('users.csvColumnsHint')}</p>
      <input type="file" accept=".csv" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
      <button onClick={handlePreview} disabled={!file || submitting}>{t('common.preview')}</button>
      <button onClick={handleConfirm} disabled={!file || submitting}>{t('common.import')}</button>
      {result && result.rows.length === 0 && (
        // Previously an empty result rendered as just an empty table with column
        // headers and no message -- indistinguishable from "the file had zero
        // rows to report on because everything succeeded". Now that the parser
        // recognizes a missing header, this mainly guards a genuinely empty file,
        // but never leave a zero-row result unexplained.
        <p role="alert">
          {t('users.noRowsFound')}
        </p>
      )}
      {result && result.rows.length > 0 && (
        <>
          <p>
            {t('users.bulkImportSummary', {
              succeeded: result.successCount,
              errors: result.errorCount,
              total: result.rows.length,
            })}
          </p>
          <Table>
            <thead>
              <tr>
                <th>{t('users.row')}</th>
                <th>{t('users.name')}</th>
                <th>{t('users.email')}</th>
                <th>{t('common.status')}</th>
                <th>{t('users.errors')}</th>
              </tr>
            </thead>
            <tbody>
              {result.rows.map((row) => (
                <tr key={row.rowNumber}>
                  <td>{row.rowNumber}</td>
                  <td>{row.name}</td>
                  <td>{row.email}</td>
                  <td>{row.status}</td>
                  <td>{row.errors.join('; ')}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        </>
      )}
    </div>
  )
}
