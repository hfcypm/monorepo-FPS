import { useEffect, useState } from 'react'
import { add } from '@my-monorepo/shared'
import './App.css'

interface ServerStatus {
  message: string
}

function App() {
  const [serverMsg, setServerMsg] = useState('loading...')
  const [error, setError] = useState('')

  useEffect(() => {
    fetch('/api/hello')
      .then((res) => res.json())
      .then((data: ServerStatus) => setServerMsg(data.message))
      .catch(() => setError('Backend unreachable'))
  }, [])

  return (
    <div className="container">
      <h1>My Monorepo</h1>
      <div className="status">
        <span className="dot" />
        Service Running
      </div>
      <div className="info-card">
        <div className="info-row">
          <span className="label">Client Port</span>
          <span className="value">3000</span>
        </div>
        <div className="info-row">
          <span className="label">Server Port</span>
          <span className="value">3001</span>
        </div>
        <div className="info-row">
          <span className="label">Framework</span>
          <span className="value">React + Vite</span>
        </div>
        <div className="info-row">
          <span className="label">Runtime</span>
          <span className="value">Bun</span>
        </div>
        <div className="info-row">
          <span className="label">Shared calc</span>
          <span className="value">add(40, 2) = {add(40, 2)}</span>
        </div>
        <div className="info-row">
          <span className="label">API Response</span>
          <span className="value">{error || serverMsg}</span>
        </div>
      </div>
    </div>
  )
}

export default App
