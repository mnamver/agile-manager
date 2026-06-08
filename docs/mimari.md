# Mimari Yapı

## Genel Mimari

```
┌─────────────────────────────────────────────────────────────┐
│                        Tarayıcı                             │
│  ┌─────────────────────────────────────────────────────┐   │
│  │           Client Components (React)                  │   │
│  │  ProjectsBoard.tsx  │  ProjectDetail.tsx             │   │
│  └──────────────┬──────────────────────────────────────┘   │
└─────────────────│───────────────────────────────────────────┘
                  │ Server Actions / API Routes
┌─────────────────▼───────────────────────────────────────────┐
│                    Next.js Server                           │
│  ┌──────────────────────┐  ┌──────────────────────────┐    │
│  │   Server Actions     │  │     API Routes            │    │
│  │   actions/actions.ts │  │  app/api/jira/[key]/      │    │
│  └──────────┬───────────┘  └──────────────────────────┘    │
│             │                                               │
│  ┌──────────▼───────────────────────────────────────────┐  │
│  │                    lib/                               │  │
│  │   db.ts         gemini.ts          jira.ts           │  │
│  │   (SQLite)      (AI Client)        (Jira Client)     │  │
│  └──────────┬──────────────┬──────────────┬────────────┘  │
└─────────────│──────────────│──────────────│────────────────┘
              │              │              │
     ┌────────▼───┐  ┌───────▼──────┐ ┌───▼──────────────┐
     │  SQLite DB │  │  Gemini API  │ │  Jira Server/DC  │
     │ data/      │  │  (Google)    │ │  (On-premise)    │
     │ planning.db│  │              │ │                  │
     └────────────┘  └──────────────┘ └──────────────────┘
```

---

## Klasör Yapısı ve Sorumluluklar

### `app/` — Next.js App Router

```
app/
├── layout.tsx              # HTML shell, global stil import
├── page.tsx                # / → Proje listesi (Server Component)
├── ProjectsBoard.tsx       # Proje kartları grid (Client Component)
└── projects/[id]/
    ├── page.tsx            # /projects/[id] → Proje detay (Server Component)
    │                       # Veriyi çekip ProjectDetail'a prop geçer
    └── ProjectDetail.tsx   # Tüm tab'lar ve state yönetimi (Client Component)
```

**Server Component'ler** (`page.tsx`) veriyi DB'den çekip Client Component'lere prop olarak iletir. Bu sayede ilk yüklemede hydration gerekmez.

**Client Component'ler** (`'use client'`) state yönetimi, Server Action çağrıları ve tüm interaktiviteyi üstlenir.

---

### `actions/actions.ts` — Server Actions

Next.js'in `'use server'` direktifi ile işaretlenmiş tüm sunucu tarafı işlemler burada toplanır. Client Component'ler doğrudan bu fonksiyonları çağırabilir — HTTP endpoint tanımlamaya gerek yoktur.

#### Action Grupları

| Grup | Fonksiyonlar |
|------|-------------|
| **Proje CRUD** | `getProjects`, `getProject`, `createProject`, `updateProjectStatus` |
| **Ekip & Notlar** | `getTeamMembers`, `addNote`, `deleteNote` |
| **Jira Issues** | `getJiraIssues`, `refreshJiraIssues`, `refreshBoardIssues` |
| **Backlog** | `loadBacklog`, `estimateBacklogItem` |
| **AI Tahmin** | `estimateIssuePoints`, `estimateAllIssuePoints` |
| **AI Kırılım** | `decomposeIssue`, `getSubtasks`, `getProjectDecompositions` |
| **Raporlama** | `generateProjectReport`, `getLatestReport`, `getSprintMetrics` |
| **Sprint Planı** | `getSprintTasks`, `importSprintTasksFromJson`, `enrichSprintTasksFromJira`, `assignRandomIctToSprintTasks` |
| **Blokaj AI** | `getBlokCozumOnerisi` |
| **Chaos to Clarity** | `parseChaosText` |

---

### `lib/db.ts` — Veritabanı Katmanı

SQLite singleton bağlantısı ve şema yönetimi.

#### Şema

```sql
projects          -- Proje kayıtları (title, status, jira_key, board_id)
team_members      -- Ekip üyeleri (project_id FK)
project_notes     -- Proje notları (project_id FK)
jira_issues_cache -- Jira issue cache (project_id FK, story_points)
subtasks          -- AI görev kırılımı sonuçları (issue_id FK)
ai_reports        -- AI sprint raporları (project_id FK)
sprint_tasks      -- Sprint plan verisi (project_id FK)
                  -- Kolonlar: no, backlog_giris_tarihi, sprint_no,
                  --           sprint_baslangic, sprint_bitis,
                  --           tamamlanma_tarihi, blok_nedeni,
                  --           ict_buyukluk, ict_sp, description
```

#### Migration Stratejisi

`initSchema()` her uygulama başlangıcında çalışır:
1. `CREATE TABLE IF NOT EXISTS` ile idempotent tablo oluşturma
2. `PRAGMA table_info()` ile mevcut kolonları kontrol etme
3. `ALTER TABLE ADD COLUMN` ile eksik kolonları ekleme

Bu sayede mevcut veritabanları veri kaybetmeden yeni kolonlara kavuşur.

---

### `lib/gemini.ts` — AI Katmanı

#### Akış

```
İstek → askGemini(prompt) → extractJson<T>(text) → TypedResult
                                    ↓ hata
                              mock fallback
```

#### Mock Fallback Sistemi

Her AI fonksiyonunun bir mock karşılığı vardır:

| AI Fonksiyon | Mock Fonksiyon | Tetikleyici |
|-------------|----------------|-------------|
| `estimateStoryPoints` | `mockStoryPoints(title)` | Keyword analizi |
| `decomposeTask` | `mockDecompose(title, desc, members)` | Keyword + rastgele alan seçimi |
| `generateSprintReport` | `mockSprintReport(title, issues)` | İstatistik bazlı |
| `chaosToClarity` | `mockChaosToClarity(text, members)` | Cümle bölme |
| `suggestBlokCozum` | `mockBlokCozum(nedeni)` | Sabit öneri haritası |

#### Decompose Alan Seçimi

```
description var mı?
  ─── EVET ──→ keyword eşleştirme (6 alan havuzu × N anahtar kelime)
               eşleşen alan sayısı < 2 ise rastgele tamamla
  ─── HAYIR ─→ 6 alandan rastgele 2–4 seç
```

---

### `lib/jira.ts` — Jira API Katmanı

#### SSL Bypass

Turkcell'in on-premise Jira instance'ı self-signed sertifika kullanır. `fetchSprintTaskFields()` fonksiyonu Node.js `https` modülünü doğrudan kullanarak `rejectUnauthorized: false` ile bağlantı kurar:

```typescript
function httpsGet(url, headers): Promise<string> {
  // rejectUnauthorized: false
  // Node.js https.request() ile düşük seviye HTTP
}
```

Diğer Jira fonksiyonları standard `fetch()` kullanır (Next.js tarafında genellikle çalışır).

#### Mock Veri Stratejisi

```
try {
  return await fetchFromJira(...)
} catch {
  return getMockData(...)   // Her zaman çalışır
}
```

---

## Veri Akışı — Sprint Planı

```
Overvibe_Tasklar_Enriched.json
         │
         ▼
importSprintTasksFromJson(projectId)
  ├─ Sizing Tarihi override (Overvibe_Tasklar_now_2.xlsx)
  ├─ Blok Nedeni: geç tamamlananlar için 7 kategoriden rastgele
  └─ ICT Büyüklük: XS–XXL rastgele Fibonacci atama
         │
         ▼
sprint_tasks tablosu (SQLite)
         │
         ▼
getSprintTasks(projectId)
         │
         ▼
SprintPlanView (Client Component)
  ├─ Sprint filtresi
  ├─ Tamamlanma tarih filtresi
  ├─ Geç satır kırmızı vurgu
  ├─ ICT Büyüklük badge
  └─ Blok Nedeni → AI modal
```

---

## Veri Akışı — AI Story Point Tahmini

```
Kanban/Liste görünümü → "SP Tahmin Et" butonu
         │
         ▼
estimateIssuePoints(issueId, projectId) [Server Action]
  ├─ jira_issues_cache'den issue bilgisi al
  ├─ sprint_tasks'dan description al (eşleşen jira_id ile)
  └─ estimateStoryPoints(summary, description) [Gemini]
         │
         ├─── Başarılı ──→ JSON parse → DB güncelle → UI güncelle
         └─── Hata ──────→ mockStoryPoints(title) → DB güncelle → UI güncelle
```

---

## State Yönetimi

`ProjectDetail.tsx` tamamen React state ile yönetilir. Global state (Redux, Zustand vb.) kullanılmaz.

```typescript
// View state
view: 'kanban' | 'list' | 'backlog' | 'rapor' | 'plan'

// Data state
issues, notes, sprintTasks, backlogItems, decompositions

// Loading state
refreshing, estimatingAll, estimatingId, planLoading, generatingReport, ...

// Modal state
decomposeModal, chaosModal, blokModal
```

**Önemli**: `useState(initialProp)` yalnızca ilk render'da başlatır. Server'dan yeni veri geldiğinde (Server Action sonrası) explicit `setState(freshData)` çağrısı gerekir — `router.refresh()` tek başına yeterli değildir.

---

## Sprint Health Score Algoritması

```
healthScore = C1 + C2 + C3 + C4   (max: 100)

C1 = SP Tamamlanma (0–40)
     = (doneSP / plannedSP) × 40

C2 = Momentum (0–25)
     = ((doneSP + inProgressSP × 0.5) / plannedSP) × 25

C3 = Öncelik Yönetimi (0–20)
     = (criticalHighDone / criticalHighTotal) × 20

C4 = Ekip Dengesi (0–15)
     = 15 × (1 − min(imbalanceRatio / 2, 1))
     imbalanceRatio = (maxLoad / avgLoad) − 1
```

| Skor | Etiket |
|------|--------|
| 80–100 | Mükemmel |
| 60–79 | İyi |
| 40–59 | Orta |
| 0–39 | Zayıf |

---

## Güvenlik Notları

- Jira token yalnızca server-side'da kullanılır (`lib/jira.ts`, `actions/actions.ts`)
- Client Component'lere token asla gönderilmez
- `.env.local` dosyası `.gitignore`'a dahildir
- `rejectUnauthorized: false` yalnızca iç ağ Jira bağlantısı için kullanılır
