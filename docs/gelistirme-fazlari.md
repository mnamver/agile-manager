# Geliştirme Fazları

## Genel Bakış

Proje hackathon formatında **yaklaşık 3 saatlik** yoğun geliştirme süreci içinde şekillenmiştir. Aşağıdaki fazlar gerçek geliştirme kronolojisini yansıtmaktadır.

---

## Faz 1 — Temel Altyapı

**Süre:** ~45 dakika

### Yapılanlar

- Next.js 16 App Router projesi kurulumu
- SQLite şema tasarımı (`lib/db.ts`)
  - `projects`, `team_members`, `project_notes`
  - `jira_issues_cache`, `subtasks`
  - `sprint_tasks`, `ai_reports`
- 10 örnek Turkcell projesi ile seed verisi
- Proje listesi ana sayfası (grid kartlar)
- Proje detay sayfası temel yapısı

### Teknik Kararlar

- **better-sqlite3 seçimi**: Senkron API hackathon için idealdir. Async/await karmaşıklığı olmadan doğrudan sorgulama.
- **SQLite seçimi**: Kurulum gerektirmez, dosya tabanlı, demo için yeterli.
- **WAL modu**: Eşzamanlı okuma/yazma için etkin.

---

## Faz 2 — Jira Entegrasyonu

**Süre:** ~30 dakika

### Yapılanlar

- `lib/jira.ts` — Jira API client
  - `fetchJiraIssues()` — Proje bazlı issue çekme
  - `fetchBoardIssues()` — Board bazlı issue çekme
  - `fetchProjectBacklog()` — Backlog çekme + story point field keşfi
  - `createJiraProject()` — Yeni Jira projesi oluşturma
  - `getMockIssues()`, `getMockBacklog()` — Fallback mock veriler
- Jira API route (`app/api/jira/[projectKey]/route.ts`)
- Bearer token authentication (PAT)
- SSL sertifika bypass (`rejectUnauthorized: false`)

### Karşılaşılan Zorluklar

| Sorun | Çözüm |
|-------|-------|
| Self-signed SSL sertifikası | Node.js `https` modülü ile `rejectUnauthorized: false` |
| Story point custom field ID | `/rest/api/2/field` endpoint'i ile otomatik keşif |
| Ağ erişim problemi | try/catch → mock veri fallback |

---

## Faz 3 — AI Entegrasyonu (Gemini)

**Süre:** ~30 dakika

### Yapılanlar

- `lib/gemini.ts` — Gemini AI client
  - `estimateStoryPoints()` — Fibonacci SP tahmini
  - `decomposeTask()` — Teknik görev kırılımı
  - `generateSprintReport()` — Sprint raporu
  - `chaosToClarity()` — Ham metin → backlog
  - `suggestBlokCozum()` — Blokaj çözüm önerileri
- Mock fallback sistemi (kota aşımı için)
- `askGemini()` + `extractJson()` yardımcı fonksiyonları

### AI Prompt Mühendisliği

Her AI fonksiyonu için:
1. Türkçe yanıt zorunlu kılındı
2. JSON schema ile yapılandırılmış çıktı
3. `extractJson()` ile güvenli JSON parse (markdown code block veya düz JSON)
4. Tüm hatalar mock fallback'e düşer

---

## Faz 4 — Kanban & Liste Görünümleri

**Süre:** ~20 dakika

### Yapılanlar

- Kanban Board: Jira statüslerine göre dinamik kolonlar
- Liste görünümü: Öncelik, atanan, SP badge'leri
- Issue bazlı AI story point tahmini (inline buton)
- Toplu story point tahmini ("Tüm SP'leri Tahmin Et")
- Görev kırılımı modalı (Decompose)
  - Alt görev listesi: tip, atanan, süre
  - Risk notu

---

## Faz 5 — Backlog & Sprint Planı

**Süre:** ~25 dakika

### Yapılanlar

**Backlog:**
- Jira backlog entegrasyonu (board + proje bazlı)
- Sayfalama (50'şer yükleme)
- Çoklu seçim + toplu SP tahmini
- Öncelik filtresi

**Sprint Planı:**
- `Overvibe_Tasklar_Enriched.json` → SQLite import
- `Overvibe_Tasklar_now_2.xlsx` → Sizing Tarihi override (Excel serial date parsing)
- Sprint no, tarih kolonları
- Geç tamamlanma kırmızı vurgulaması (`tamamlanma_tarihi > sprint_bitis`)
- Blok Nedeni: 7 kategori, rastgele atama, DB'ye kayıt
- ICT Büyüklük: XS–XXL, Fibonacci SP mapping

---

## Faz 6 — Rapor & Dashboard

**Süre:** ~20 dakika

### Yapılanlar

- Sprint Health Score (0–100):
  - C1: SP Tamamlanma (0–40)
  - C2: Momentum (0–25)
  - C3: Öncelik Yönetimi (0–20)
  - C4: Ekip Dengesi (0–15)
- SVG gauge ring (CSS `strokeDasharray`)
- KPI kartları: toplam issue, planlanan SP, tamamlanan SP, tamamlanma %
- SP progress bar (done / in-progress / remaining)
- Durum dağılımı bar chart
- Kişi bazlı tamamlanma
- Öncelik bazlı tamamlanma
- AI Sprint Raporu (yöneticiye sunulabilir metin)

---

## Faz 7 — Görev Kırılım Raporu & AI İyileştirmeleri

**Süre:** ~30 dakika

### Yapılanlar

- `getProjectDecompositions()` — Proje genelinde tüm subtask'ları grouped olarak getirir
- Rapor sekmesine "Görev Kırılım Raporu" bölümü:
  - Accordeon (açılır/kapanır) satırlar
  - Tip bazlı renk kodlu badge'ler
  - Atanan kişi avatarları
  - Tahmini saat
- AI görev kırılımı iyileştirmeleri:
  - Description analizi ile gerçekten gerekli alanları seçme
  - Keyword tabanlı alan eşleştirme (6 alan havuzu)
  - Description yoksa rastgele 2–4 alan
  - Tamamen rastgele üye ataması

---

## Faz 8 — Blok Nedeni AI Çözümleri

**Süre:** ~15 dakika

### Yapılanlar

- Blok Nedeni badge'lerine tıklama → AI modal
- `suggestBlokCozum()` — 4 öneri + özet
- 7 kategori × 4 öneri mock fallback haritası
- Gemini API ile gerçek öneri üretimi

---

## Bug Düzeltmeleri & Optimizasyonlar

| Sorun | Kök Neden | Çözüm |
|-------|-----------|-------|
| "Tüm SP Tahmin Et" pasif | `!hasUnestimated` kontrolü hatalıydı | Koşul kaldırıldı |
| State güncellenmiyordu | `router.refresh()` `useState` başlangıç değerini güncellemiyor | `setIssues(fresh)` ile explicit güncelleme |
| Sprint task sayısı eksikti | `LIMIT 10` kısıtı | Kaldırıldı |
| Spinner görünmüyordu | Mock AI senkron döndürüyor | `Promise.all([..., setTimeout(700)])` |
| Edit tool çakışması | Tekrar eden string | Daha geniş bağlam sağlandı |

---

## Sürüm Geçmişi

| Versiyon | Tarih | İçerik |
|----------|-------|--------|
| v0.1.0 | 2026-06-08 | Hackathon MVP — tüm özellikler |
