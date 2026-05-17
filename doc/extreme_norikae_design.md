# エクストリーム乗り換え — 詳細設計書

> Version 0.1 / MVP フェーズ対象

---

## 1. アーキテクチャ概観

```
Browser (SvelteKit PWA)
    │  REST / WebSocket
    ▼
Rails API (Cloud Run or Fly.io)
    │
    ├─ PostgreSQL + PostGIS  ← 駅・路線・地区マスタ
    ├─ Redis                 ← セッション / キャッシュ
    └─ Sidekiq               ← 人流シミュレーション非同期実行
```

---

## 2. データモデル

### 2.1 stations

| カラム | 型 | 備考 |
|---|---|---|
| id | uuid | PK |
| name | text | 駅名 |
| location | geometry(Point,4326) | PostGIS |
| operator | text | 事業者名 |
| passenger_base | integer | 基本乗降客数/日 |
| congestion | float | 0.0〜1.0（動的） |
| created_at | timestamptz | |

### 2.2 transfers

| カラム | 型 | 備考 |
|---|---|---|
| id | uuid | PK |
| from_station_id | uuid | FK → stations |
| to_station_id | uuid | FK → stations |
| type | enum | `walk / underground / arcade / overpass` |
| walk_time_sec | integer | 基本徒歩時間 |
| cost_modifier | float | 信号・坂・雨係数の積 |
| flow | integer | 現在通過人数/時 |
| owner_id | uuid | FK → players（nullable） |
| name | text | プレイヤー命名（nullable） |
| status | enum | `proposed / active / suspended` |
| created_at | timestamptz | |

> **インデックス**: `from_station_id`, `to_station_id`, `owner_id`, `(from_station_id, to_station_id)` UNIQUE

### 2.3 districts

| カラム | 型 | 備考 |
|---|---|---|
| id | uuid | PK |
| boundary | geometry(Polygon,4326) | PostGIS |
| name | text | |
| population | integer | |
| commerce_score | float | 0.0〜1.0 |
| growth_rate | float | 毎ターン変動 |
| updated_at | timestamptz | |

### 2.4 players

| カラム | 型 | 備考 |
|---|---|---|
| id | uuid | PK |
| handle | text | 表示名 |
| balance | integer | ゲーム内通貨 |
| revenue_total | integer | 累計収益 |

### 2.5 flow_snapshots（時系列ログ）

| カラム | 型 | 備考 |
|---|---|---|
| id | bigserial | PK |
| transfer_id | uuid | FK → transfers |
| recorded_at | timestamptz | |
| flow | integer | |
| congestion | float | |

> Sidekiq が 5 分ごとに挿入。長期は集約して削除。

---

## 3. API エンドポイント

### 地図・グラフ

| Method | Path | 説明 |
|---|---|---|
| GET | `/api/v1/stations` | bbox パラメータでフィルタ |
| GET | `/api/v1/stations/:id` | 駅詳細＋隣接 transfers |
| GET | `/api/v1/transfers` | 路線一覧 |
| POST | `/api/v1/transfers` | 新線提案（要認証） |
| PATCH | `/api/v1/transfers/:id` | 命名・ステータス変更 |

### シミュレーション

| Method | Path | 説明 |
|---|---|---|
| GET | `/api/v1/flow/current` | リアルタイム人流スナップショット |
| POST | `/api/v1/flow/simulate` | 特定 transfer 追加時の影響試算 |

### プレイヤー

| Method | Path | 説明 |
|---|---|---|
| GET | `/api/v1/players/:id` | プロフィール＋収益 |
| GET | `/api/v1/players/:id/transfers` | 所有路線一覧 |

---

## 4. ORエンジン（Pure Ruby / MVP）

### 4.1 グラフ構造

```ruby
# StationGraph
# nodes: { station_id => { lat:, lng: } }
# edges: { station_id => [ { to:, weight: } ] }

class StationGraph
  def initialize(stations, transfers)
    @adj = Hash.new { |h, k| h[k] = [] }
    transfers.each do |t|
      w = effective_cost(t)
      @adj[t.from_station_id] << { to: t.to_station_id, weight: w, transfer: t }
      @adj[t.to_station_id]   << { to: t.from_station_id, weight: w, transfer: t }
    end
  end
end
```

### 4.2 徒歩コスト計算

```ruby
def effective_cost(transfer)
  base  = transfer.walk_time_sec
  mod   = transfer.cost_modifier  # 信号・坂・雨・地下 etc.
  flow  = transfer.flow
  # 混雑ペナルティ: 200人/時 超えると+10%/100人
  congestion_penalty = [1.0, 1.0 + (flow - 200).clamp(0, Float::INFINITY) / 1000.0].max
  (base * mod * congestion_penalty).round
end
```

### 4.3 Dijkstra（最短経路）

```ruby
def shortest_path(from_id, to_id)
  dist = Hash.new(Float::INFINITY)
  prev = {}
  dist[from_id] = 0
  pq = [[0, from_id]]  # [cost, node]

  until pq.empty?
    cost, u = pq.min_by { |c, _| c }
    pq.delete([cost, u])
    break if u == to_id

    @adj[u].each do |edge|
      alt = dist[u] + edge[:weight]
      if alt < dist[edge[:to]]
        dist[edge[:to]] = alt
        prev[edge[:to]] = u
        pq << [alt, edge[:to]]
      end
    end
  end

  reconstruct_path(prev, from_id, to_id)
end
```

### 4.4 人流シミュレーション（Flow分配）

```ruby
# OD行列ベースの単純フロー分配
# 各 OD ペアの Dijkstra 経路に flow を加算
class FlowSimulator
  def run(od_matrix)
    od_matrix.each do |(origin, dest), demand|
      path = @graph.shortest_path(origin, dest)
      distribute(path, demand)
    end
  end

  private

  def distribute(path, demand)
    path.each_cons(2) do |a, b|
      edge = find_edge(a, b)
      edge[:flow] += demand
    end
  end
end
```

---

## 5. フロントエンド設計

### 5.1 画面構成

```
MapView（全画面）
├── StationLayer      ← PostGIS → GeoJSON → Leaflet or deck.gl
├── TransferLayer     ← 路線ライン（太さ = flow量）
├── DistrictLayer     ← ヒートマップ（commerce_score）
└── HUD
    ├── MiniStats     ← 収益 / 保有路線数
    ├── FlowPanel     ← 選択駅の流量グラフ
    └── BuildPanel    ← 新線提案UI
```

### 5.2 描画思想

「電流・血管・神経網」を実現するため：

| 要素 | 実装 |
|---|---|
| 路線ライン | 太さ = `flow / 50`px、グロー効果（CSS filter: blur） |
| 混雑色 | 緑→黄→赤 グラデーション（HSL） |
| 都市進化アニメ | Lottie or CSS animation（商業地活性化パルス） |
| フォント | monospace 系（回路図感） |

### 5.3 状態管理

```
stores/
├── graph.ts      ← 駅・路線グラフ（Svelte writable）
├── flow.ts       ← リアルタイム人流（WebSocket購読）
├── player.ts     ← 所有路線・残高
└── ui.ts         ← 選択状態・モーダル
```

---

## 6. 非同期処理（Sidekiq）

| ジョブ | 周期 | 内容 |
|---|---|---|
| `FlowSimulationJob` | 5分 | 全ODペアでフロー再計算 → flow_snapshots挿入 |
| `CongestionUpdateJob` | 1分 | stations.congestion 更新 |
| `DistrictEvolutionJob` | 1時間 | commerce_score / growth_rate 更新 |
| `RevenueJob` | 1日 | プレイヤー収益集計・balance加算 |

---

## 7. 収益モデル（ゲーム内）

```
日次収益 = Σ( transfer.flow × 単価 ) × 所有路線係数

単価:
  walk        : 0.5 / 人
  underground : 1.5 / 人
  overpass    : 1.0 / 人
  arcade      : 0.8 / 人
```

---

## 8. 環境・インフラ

| 環境 | 構成 |
|---|---|
| 開発 | Docker Compose（Rails + PostgreSQL/PostGIS + Redis） |
| CI | GitHub Actions（RSpec + Playwright） |
| 本番 | Cloud Run（Rails API） + Cloud SQL（PostgreSQL） + Upstash Redis |
| CDN | Cloudflare（SvelteKit 静的ビルド） |

---

## 9. MVP スコープ境界

### In

- 駅グラフ表示（固定データ 50 駅）
- 徒歩 transfer 手動作成
- Dijkstra 経路計算
- 簡易フロー分配
- 収益計算（日次バッチ）
- プレイヤー命名

### Out（v2 以降）

- AI 住民エージェント
- 現実人流データ連携
- 地価・再開発システム
- マルチプレイヤー競合
- マネタイズ（広告・プレミアム）

---

## 10. 開発フェーズ

| フェーズ | 期間 | 目標 |
|---|---|---|
| P0 | 2週 | 駅グラフ表示 + 徒歩 transfer CRUD |
| P1 | 2週 | Dijkstra + フロー分配 + 混雑表示 |
| P2 | 2週 | 収益システム + プレイヤー機能 |
| P3 | 2週 | 都市進化 + アニメーション |
