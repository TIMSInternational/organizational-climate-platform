import { useState } from 'react'
import { bulkImportUsers, type BulkImportResponse } from '../api/bulkImport'

interface BulkImportPanelProps {
  baseUrl: string
  companyId: string
  onImported: () => void
}

export default function BulkImportPanel({ baseUrl, companyId, onImported }: BulkImportPanelProps) {
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
      setError(err instanceof Error ? err.message : 'Preview failed')
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
      setError(err instanceof Error ? err.message : 'Import failed')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div>
      {error && <p role="alert">{error}</p>}
      <p>CSV columns: name, email, role, department. Embedded commas inside a field are not supported.</p>
      <input type="file" accept=".csv" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
      <button onClick={handlePreview} disabled={!file || submitting}>Preview</button>
      <button onClick={handleConfirm} disabled={!file || submitting}>Import</button>
      {result && (
        <table>
          <thead>
            <tr><th>Row</th><th>Name</th><th>Email</th><th>Status</th><th>Errors</th></tr>
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
        </table>
      )}
    </div>
  )
}
