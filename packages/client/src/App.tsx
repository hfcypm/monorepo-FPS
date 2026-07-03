import { useEffect, useState } from 'react'
import { add } from '@my-monorepo/shared'

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
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-[#0f0f1a] to-[#1a1a2e] text-[#e0e0e0]">
      <div className="rounded-2xl border border-white/10 bg-white/5 px-12 py-12 text-center backdrop-bl-xl min-w-[360px]">
        <h1 className="mb-3 text-3xl font-semibold text-[#f0f0f0]">WEB</h1>

        <div className="mb-6 inline-flex items-center gap-2 rounded-full bg-green-500/15 px-5 py-2 font-semibold text-green-400">
          <span className="inline-block h-2.5 w-2.5 animate-pulse rounded-full bg-green-400" />
          Service Running
        </div>

        <div className="rounded-xl bg-white/[0.03] px-6 py-5 text-left">
          <Row label="Client Port" value="3000" />
          <Row label="Server Port" value="3001" />
          <Row label="Framework" value="React + Vite" />
          <Row label="Runtime" value="Bun" />
          <Row label="Shared calc" value={`add(40, 2) = ${add(40, 2)}`} />
          <Row last label="API Response" value={error || serverMsg} />
        </div>
      </div>
    </div>
  )
}

function Row({ label, value, last }: { label: string; value: string; last?: boolean }) {
  return (
    <div className={`flex justify-between py-2 ${last ? '' : 'border-b border-white/5'}`}>
      <span className="text-sm text-[#888]">{label}</span>
      <span className="text-sm font-medium text-[#ccc]">{value}</span>
    </div>
  )
}

export default App
