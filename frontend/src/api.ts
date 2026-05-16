import type { Station, RankEntry, Segment, RunRequest, RunResponse } from './types'

const BASE = import.meta.env.VITE_API_URL ?? '/api'

export const getStations = (): Promise<Station[]> =>
  fetch(`${BASE}/stations`).then(r => r.json())

export const postRun = (body: RunRequest): Promise<RunResponse> =>
  fetch(`${BASE}/runs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }).then(r => r.json())

export const getRanking = (from: string, to: string): Promise<RankEntry[]> =>
  fetch(`${BASE}/ranking?from=${from}&to=${to}`).then(r => r.json())

export const getSegments = (): Promise<Segment[]> =>
  fetch(`${BASE}/segments`).then(r => r.json())
