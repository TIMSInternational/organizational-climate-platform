import { useState } from 'react'
import RoleSelector from './RoleSelector'
import type { Invitation } from '../api/invitations'

interface ShareableLinkPanelProps {
  onCreate: (role: string) => Promise<Invitation>
}

export default function ShareableLinkPanel({ onCreate }: ShareableLinkPanelProps) {
  const [role, setRole] = useState('employee')
  const [link, setLink] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)

  async function handleCreate() {
    setError(null)
    setCreating(true)
    try {
      const invitation = await onCreate(role)
      setLink(`${window.location.origin}/accept-invitation/${invitation.token}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create link')
    } finally {
      setCreating(false)
    }
  }

  return (
    <div>
      {error && <p role="alert">{error}</p>}
      <RoleSelector value={role} onChange={setRole} />
      <button onClick={handleCreate} disabled={creating}>{creating ? 'Creating…' : 'Create shareable link'}</button>
      {link && <p>Link (accept-once): <code>{link}</code></p>}
    </div>
  )
}
