export type Station = { id: string; name: string; lat: number; lng: number }
export type RankEntry = { rank: number; user_id: string; sec: number; ran_at: string }
export type Segment = { from_id: string; to_id: string; run_count: number; record_sec: number }
export type RunRequest = { user_id: string; from_id: string; to_id: string; sec: number }
export type RunResponse = { run: Run; is_record: boolean; ranking: RankEntry[] }
export type Run = { id: string; user_id: string; from_id: string; to_id: string; sec: number; ran_at: string }
