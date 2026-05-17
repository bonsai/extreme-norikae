# エクストリーム乗り換え　詳細設計書

Version: 1.0  
Date: 2026-05-16  
Stack: Go + Supabase(PostgreSQL) + Vite/React PWA + Render

---

## 1. システム構成

```
[ブラウザ PWA]
     │ HTTPS
     ▼
[Render Static Site]        vite build / dist
     │ VITE_API_URL
     ▼
[Render Web Service]        Go binary
     │ DATABASE_URL
     ▼
[Supabase]                  PostgreSQL
```

---

## 2. インフラ

| コンポーネント | サービス | プラン | 備考 |
|---|---|---|---|
| APIサーバー | Render Web Service | Free | スリープあり（15分） |
| 静的配信 | Render Static Site | Free | CDN配信 |
| DB | Supabase | Free | 500MB / 無期限 |

### 環境変数

| 変数名 | 設定箇所 | 値 |
|---|---|---|
| `DATABASE_URL` | Render API | Supabaseの接続文字列 |
| `PORT` | Render API | 自動（Renderが注入） |
| `VITE_API_URL` | Render Static | `https://<api>.onrender.com/api` |

---

## 3. データベース設計

### 3.1 stations

```sql
CREATE TABLE stations (
  id   TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  lat  REAL NOT NULL,
  lng  REAL NOT NULL
);
```

シードデータ（10駅）はマイグレーション時に INSERT。

---

### 3.2 runs

```sql
CREATE TABLE runs (
  id         TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  user_id    TEXT NOT NULL,
  from_id    TEXT NOT NULL REFERENCES stations(id),
  to_id      TEXT NOT NULL REFERENCES stations(id),
  sec        INTEGER NOT NULL CHECK (sec > 0),
  ran_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_runs_segment ON runs (
  LEAST(from_id, to_id),
  GREATEST(from_id, to_id)
);
```

`LEAST/GREATEST` で双方向の区間を同一視する。

---

### 3.3 segments（ビュー）

テーブルではなくビュー。runs から動的に集計。

```sql
CREATE VIEW segments AS
SELECT
  LEAST(from_id, to_id)    AS from_id,
  GREATEST(from_id, to_id) AS to_id,
  COUNT(*)                  AS run_count,
  MIN(sec)                  AS record_sec
FROM runs
GROUP BY 1, 2;
```

10人以上でフロントが「新線」として描画する。

---

### 3.4 マイグレーション方針

```
/backend/db/
  001_create_tables.sql
  002_seed_stations.sql
```

Supabase SQL Editor で手動実行（POCフェーズ）。  
本番化時は goose 等のマイグレーションツールを導入。

---

## 4. API設計

Base URL: `https://<api>.onrender.com/api`

---

### GET /api/stations

駅一覧を返す。

**Response**
```json
[
  { "id": "shibuya", "name": "渋谷", "lat": 35.658, "lng": 139.7016 },
  ...
]
```

---

### POST /api/runs

タイムを記録し、区間ランキングを返す。

**Request**
```json
{
  "user_id": "uuid-string",
  "from_id": "sangenjaya",
  "to_id":   "shimokitazawa",
  "sec":     1123
}
```

**Response**
```json
{
  "run": {
    "id":      "uuid",
    "user_id": "uuid-string",
    "from_id": "sangenjaya",
    "to_id":   "shimokitazawa",
    "sec":     1123,
    "ran_at":  "2026-05-16T00:00:00Z"
  },
  "is_record": true,
  "ranking": [
    { "rank": 1, "user_id": "uuid-string", "sec": 1123, "ran_at": "..." },
    { "rank": 2, "user_id": "other-uuid",  "sec": 1244, "ran_at": "..." }
  ]
}
```

`is_record` : 自分のタイムが区間1位かどうか。

---

### GET /api/ranking?from=&to=

区間ランキングを返す。上位10件。

**Response**
```json
[
  { "rank": 1, "user_id": "uuid", "sec": 1123, "ran_at": "..." },
  ...
]
```

---

### GET /api/segments

新線判定用。`run_count >= 10` の区間のみ返す。

**Response**
```json
[
  { "from_id": "sangenjaya", "to_id": "shimokitazawa", "run_count": 14, "record_sec": 1123 },
  ...
]
```

---

## 5. Goバックエンド構成

```
backend/
  main.go          エントリポイント・ルーティング
  db/
    db.go          DB接続・初期化
    stations.go    駅クエリ
    runs.go        run INSERT・ランキング集計
    segments.go    セグメントビュークエリ
  go.mod
  go.sum
```

### 依存パッケージ

```
github.com/lib/pq          PostgreSQLドライバ
```

これだけ。フレームワークなし。

### DB接続

```go
// db/db.go
import (
  "database/sql"
  _ "github.com/lib/pq"
  "os"
)

func Open() (*sql.DB, error) {
  return sql.Open("postgres", os.Getenv("DATABASE_URL"))
}
```

### ランキングSQL

```sql
SELECT
  ROW_NUMBER() OVER (ORDER BY sec ASC) AS rank,
  user_id,
  sec,
  ran_at
FROM runs
WHERE
  LEAST(from_id, to_id)    = LEAST($1, $2)
  AND GREATEST(from_id, to_id) = GREATEST($1, $2)
ORDER BY sec ASC
LIMIT 10;
```

---

## 6. フロントエンド構成

```
frontend/
  src/
    App.tsx          画面ルーティング（3画面）
    api.ts           fetch ラッパー
    types.ts         型定義
    index.css        スタイル
  vite.config.ts
  package.json
```

### api.ts

```typescript
const BASE = import.meta.env.VITE_API_URL ?? '/api'

export const getStations = () =>
  fetch(`${BASE}/stations`).then(r => r.json())

export const postRun = (body: RunRequest) =>
  fetch(`${BASE}/runs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }).then(r => r.json())

export const getRanking = (from: string, to: string) =>
  fetch(`${BASE}/ranking?from=${from}&to=${to}`).then(r => r.json())

export const getSegments = () =>
  fetch(`${BASE}/segments`).then(r => r.json())
```

---

## 7. 画面設計

### START画面

```
┌─────────────────┐
│ EX乗換           │
│ 駅から駅へ。      │
│                 │
│ 出発駅 [select] │
│ 到着駅 [select] │
│                 │
│ 🏆 区間レコード  │  ← 駅選択後に表示
│    18:24        │
│                 │
│ [    GO    ]    │
└─────────────────┘
```

### RUN画面

```
┌─────────────────┐
│ 🏃              │
│                 │
│   00:18:43      │  ← 500ms更新
│                 │
│ 三軒茶屋→下北沢  │
│ レコード 18:24   │
│ あと +0:19      │  ← 超えたら赤
│                 │
│ [ゴール着いた]   │
└─────────────────┘
```

### RESULT画面

```
┌─────────────────┐
│ 三軒茶屋        │
│ ↓               │
│ 下北沢          │
│                 │
│   18:05         │
│ 🏆 区間レコード！│
│                 │
│ 1位 18:05 あなた│
│ 2位 18:24 #a3f2 │
│ 3位 19:11 #b7c1 │
│                 │
│ [シェア]        │
│ [もう一回]      │
└─────────────────┘
```

---

## 8. Render デプロイ設定

### render.yaml

```yaml
services:
  - type: web
    name: extreme-norikae-api
    runtime: go
    rootDir: backend
    buildCommand: go build -o server .
    startCommand: ./server
    envVars:
      - key: DATABASE_URL
        sync: false          # Renderダッシュボードで手動設定

  - type: web
    name: extreme-norikae-app
    runtime: static
    rootDir: frontend
    buildCommand: npm install && npm run build
    staticPublishPath: dist
    envVars:
      - key: VITE_API_URL
        value: https://extreme-norikae-api.onrender.com/api
```

---

## 9. デプロイ手順

```
1. Supabaseでプロジェクト作成
   → Settings > Database > Connection string をコピー

2. Supabase SQL Editorでマイグレーション実行
   001_create_tables.sql
   002_seed_stations.sql

3. GitHubにpush

4. Render → New → Blueprint
   render.yaml を検出

5. extreme-norikae-api の環境変数に DATABASE_URL をセット

6. 両サービスをデプロイ

7. 動作確認
   curl https://extreme-norikae-api.onrender.com/api/stations
```

---

## 10. 開発ロードマップ

| フェーズ | 内容 | 状態 |
|---|---|---|
| P0 | Go stdlib + JSON store POC | ✅ 完了 |
| P1 | PostgreSQL（Supabase）移行 | 👈 いまここ |
| P2 | Render デプロイ | 次 |
| P3 | 地図に新線を描画 | 以降 |
| P4 | 駅データ拡充（全国） | 以降 |
