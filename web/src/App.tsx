import { useEffect, useState } from 'react'
import { getHealth } from './api/health'
import './App.css'

function App() {
  const [status, setStatus] = useState<'loading' | 'ok' | 'error'>('loading')

  useEffect(() => {
    const baseUrl = import.meta.env.VITE_API_BASE_URL as string
    getHealth(baseUrl)
      .then(() => setStatus('ok'))
      .catch(() => setStatus('error'))
  }, [])

  return (
    <div className="App">
      <h1>Organizational Climate Platform</h1>
      <p>API status: {status}</p>
    </div>
  )
}

export default App
