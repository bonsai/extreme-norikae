import { useState, useEffect, useRef } from 'react'
import { getStations, postRun, getRanking } from './api'
import type { Station, RankEntry } from './types'

type Screen = 'start' | 'running' | 'result'

function fmtTime(sec: number) {
  const m = Math.floor(sec / 60).toString().padStart(2, '0')
  const s = (sec % 60).toString().padStart(2, '0')
  return `${m}:${s}`
}

function getUserId() {
  let id = localStorage.getItem('uid')
  if (!id) { id = crypto.randomUUID(); localStorage.setItem('uid', id) }
  return id
}

export default function App() {
  const [stations, setStations] = useState<Station[]>([])
  const [fromId, setFromId] = useState('')
  const [toId, setToId] = useState('')
  const [screen, setScreen] = useState<Screen>('start')
  const [elapsed, setElapsed] = useState(0)
  const [ranking, setRanking] = useState<RankEntry[]>([])
  const [isRecord, setIsRecord] = useState(false)
  const [finalSec, setFinalSec] = useState(0)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const startRef = useRef(0)

  useEffect(() => {
    getStations().then(setStations)
  }, [])

  const fromStation = stations.find(s => s.id === fromId)
  const toStation = stations.find(s => s.id === toId)

  function startRun() {
    if (!fromId || !toId || fromId === toId) return
    setElapsed(0)
    startRef.current = Date.now()
    timerRef.current = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startRef.current) / 1000))
    }, 500)
    setScreen('running')
  }

  async function finishRun() {
    if (timerRef.current) clearInterval(timerRef.current)
    const sec = Math.floor((Date.now() - startRef.current) / 1000)
    setFinalSec(sec)
    const res = await postRun({ from_id: fromId, to_id: toId, sec, user_id: getUserId() })
    setRanking(res.ranking ?? [])
    setIsRecord(res.is_record ?? false)
    setScreen('result')
  }

  function reset() {
    setScreen('start')
    setElapsed(0)
    setRanking([])
    setIsRecord(false)
  }

  const recordSec = ranking[0]?.sec ?? 0

  if (screen === 'start') return (
    <div className="screen">
      <h1>EX<span className="accent">乗換</span></h1>
      <p className="sub">駅から駅へ。タイムを刻め。</p>

      <div className="card">
        <label>出発駅</label>
        <select value={fromId} onChange={e => setFromId(e.target.value)}>
          <option value="">えらぶ</option>
          {stations.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>

        <label>到着駅</label>
        <select value={toId} onChange={e => setToId(e.target.value)}>
          <option value="">えらぶ</option>
          {stations.filter(s => s.id !== fromId).map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
      </div>

      {fromId && toId && <RankingPreview fromId={fromId} toId={toId} />}

      <button className="go-btn" disabled={!fromId || !toId || fromId === toId} onClick={startRun}>
        GO
      </button>
    </div>
  )

  if (screen === 'running') return (
    <div className="screen center">
      <div className="runner">🏃</div>
      <div className="big-time">{fmtTime(elapsed)}</div>
      <div className="route-label">
        {fromStation?.name} → {toStation?.name}
      </div>
      {recordSec > 0 && (
        <div className={`record-chase ${elapsed > recordSec ? 'over' : 'under'}`}>
          レコード {fmtTime(recordSec)}
          {elapsed <= recordSec
            ? ` ／ あと ${fmtTime(recordSec - elapsed)}`
            : ` ／ +${fmtTime(elapsed - recordSec)}`}
        </div>
      )}
      <button className="goal-btn" onClick={finishRun}>ゴール着いた</button>
    </div>
  )

  if (screen === 'result') return (
    <div className="screen center">
      <div className="route-label large">
        {fromStation?.name}<br />↓<br />{toStation?.name}
      </div>
      <div className="big-time">{fmtTime(finalSec)}</div>
      {isRecord && <div className="record-badge">🏆 区間レコード更新！</div>}

      <div className="ranking-box">
        {ranking.slice(0, 5).map(r => (
          <div key={r.user_id + r.ran_at} className={`rank-row ${r.user_id === getUserId() ? 'me' : ''}`}>
            <span className="rank-num">{r.rank}</span>
            <span className="rank-time">{fmtTime(r.sec)}</span>
            <span className="rank-user">{r.user_id === getUserId() ? 'あなた' : `#${r.user_id.slice(0, 6)}`}</span>
          </div>
        ))}
      </div>

      <button className="share-btn" onClick={() => {
        const txt = `${fromStation?.name} → ${toStation?.name}\nエクストリーム乗り換え ${fmtTime(finalSec)}${isRecord ? ' 🏆区間レコード' : ''}\n#エクストリーム乗り換え`
        navigator.share?.({ text: txt }) ?? navigator.clipboard.writeText(txt)
      }}>シェア</button>

      <button className="reset-btn" onClick={reset}>もう一回</button>
    </div>
  )
}

function RankingPreview({ fromId, toId }: { fromId: string; toId: string }) {
  const [top, setTop] = useState<RankEntry | null>(null)
  useEffect(() => {
    getRanking(fromId, toId).then((data: RankEntry[]) => setTop(data[0] ?? null))
  }, [fromId, toId])
  if (!top) return <p className="no-record">この区間は未踏</p>
  return <p className="current-record">🏆 区間レコード {fmtTime(top.sec)}</p>
}
