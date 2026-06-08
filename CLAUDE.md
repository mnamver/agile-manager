@AGENTS.md

# Claude Code — Proje Talimatları

Bu dosya Claude Code'un bu projede nasıl davranması gerektiğini tanımlar.

## Proje Kimliği

Bu proje **Turkcell AI-Powered Agile Manager**'dır.  
Next.js 16 App Router + better-sqlite3 + Google Gemini AI + Jira Server/DC entegrasyonlu bir sprint planlama aracıdır.

## Kritik Kurallar

### Kod Yazımı
- TypeScript kullan, `any` tipinden kaç
- Server Action'lar `'use server'` direktifi ile başlar (`actions/actions.ts`)
- Client Component'ler `'use client'` direktifi ile başlar
- `useState(initialProp)` yalnızca ilk render'da başlatır — Server Action sonrası `setState(freshData)` ile güncelle
- DB işlemleri her zaman `getDb()` singleton'ı üzerinden yap

### Veritabanı
- SQLite şema değişikliği = hem `CREATE TABLE` içine ekle, hem `PRAGMA table_info()` migration bloğuna ekle
- Transaction kullan: `db.transaction(() => { ... })()`
- `SprintTask` tipi `lib/db.ts`'te tanımlıdır — yeni kolon eklince tipi de güncelle

### Jira Entegrasyonu
- On-premise Jira Server/DC — REST API v2 (`/rest/api/2/`) kullan, Cloud v3 değil
- SSL bypass: `fetchSprintTaskFields()` gibi düşük seviye çağrılarda `https` modülü + `rejectUnauthorized: false`
- Her Jira çağrısı try/catch + mock fallback içermeli

### AI (Gemini)
- Model: `gemini-2.5-flash` (`lib/gemini.ts` satır 4)
- Her AI fonksiyonunun bir mock fallback'i olmalı
- `extractJson<T>()` ile güvenli JSON parse et

### UI Kuralları
- Renk paleti: `bg-blue-950` zemin, `amber-400` accent, `blue-400` secondary
- Tailwind v4 kullanılıyor — eski v3 syntax'ı çalışmayabilir
- `w-px whitespace-nowrap` — fit-content kolon genişliği için

## Dosya Haritası

```
lib/db.ts          → SQLite bağlantı, şema, tipler
lib/gemini.ts      → AI fonksiyonları + mock fallback'ler
lib/jira.ts        → Jira API client + mock veriler
actions/actions.ts → Tüm Server Action'lar
app/projects/[id]/ProjectDetail.tsx → Ana UI (tüm tab'lar)
```

## Sık Yapılan Hatalar

1. `router.refresh()` state'i güncellemez → `setIssues(await getJiraIssues(id))` kullan
2. Edit tool'da tekrar eden string → daha geniş bağlam sağla
3. `LIMIT` bırakma — Overvibe 66 row içeriyor
4. Migration olmadan kolon ekleme — DB'yi bozar
