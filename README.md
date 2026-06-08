# Turkcell AI-Powered Agile Manager

Turkcell ekipleri için geliştirilmiş, yapay zeka destekli sprint planlama ve yönetim aracı. Scrum Master'ların ve Takım Liderlerinin sprint döngüsünde harcadığı 5–8 saatlik manuel planlama yükünü otomatize eder.

---

## İçindekiler

- [Özellikler](#özellikler)
- [Ekran Görüntüleri](#ekran-görüntüleri)
- [Teknoloji Yığını](#teknoloji-yığını)
- [Kullanılan AI Araçları](#kullanılan-ai-araçları)
- [Entegre API'ler](#entegre-apiler)
- [Kurulum](#kurulum)
- [Ortam Değişkenleri](#ortam-değişkenleri)
- [Çalıştırma](#çalıştırma)
- [Proje Yapısı](#proje-yapısı)
- [Deploy](#deploy)

---

## Özellikler

### Kanban Board
- Jira Server/DC entegrasyonu — canlı issue durumlarını Kanban kolonlarında gösterir
- Board ve proje bazlı görünüm desteği
- Inline story point tahmini (tek issue veya toplu)

### Sprint Planı
- `Overvibe_Tasklar_Enriched.json` verisini otomatik içe aktarır
- Sprint no, başlangıç/bitiş tarihleri, tamamlanma tarihi gösterimi
- Geç tamamlanan görevler kırmızı vurgulanır
- **Blok Nedeni**: 7 kategoriden rastgele atanır; tıklandığında AI çözüm önerileri sunar
- **ICT Büyüklük**: XS/S/M/L/XL/XXL (Fibonacci: 1/2/3/5/8/13) — renk kodlu SP badge'leri

### AI Görev Kırılımı (Decompose)
- Seçilen issue için description analizine göre gerçekten gerekli teknik alanları belirler (Frontend, Backend, Database, Test, DevOps, Design)
- Description yoksa rastgele 2–4 alan seçilir
- Takım üyelerine rastgele atama yapar
- Sonuçlar Rapor sekmesinde "Görev Kırılım Raporu" olarak görünür

### Story Point Tahmini
- Fibonacci skalası (1, 2, 3, 5, 8, 13, 21)
- Issue başlığı + description birlikte analiz edilir
- Gemini API kotası aşılırsa keyword tabanlı mock fallback devreye girer

### Sprint Health Score
- 0–100 skalasında sprint sağlık skoru
- 4 bileşen: SP Tamamlanma (40p) + Momentum (25p) + Öncelik Yönetimi (20p) + Ekip Dengesi (15p)
- SVG gauge ring ile görsel sunum

### AI Sprint Raporu
- Tüm sprint metriklerini analiz ederek yöneticiye sunulabilir metin üretir
- Başarılar, velocity analizi, riskler ve sonraki sprint önerisi
- Tek tıkla panoya kopyalama

### Chaos to Clarity
- Ham metin (Slack mesajı, e-posta) → yapılandırılmış sprint backlog'u
- Her göreve otomatik story point, öncelik ve atama önerisi

### Görev Kırılım Raporu (Rapor Sekmesi)
- Parçalanan tüm issue'ları tablo halinde listeler
- Tip bazlı renk kodlu badge'ler, atanan kişi avatarları, tahmini saatler
- Açılır/kapanır satır detayları

---

## Ekran Görüntüleri

> Ekran görüntüleri `docs/screenshots/` klasörüne eklenecektir.

| Görünüm | Açıklama |
|---------|----------|
| Kanban Board | Jira statüslerine göre kolonlanmış issue kartları |
| Sprint Planı | ICT Büyüklük, Blok Nedeni ve tarih bazlı filtreleme |
| Rapor & Dashboard | Health Score gauge, kişi/durum/öncelik grafikleri, AI rapor |
| Görev Kırılımı Modalı | Alt görevler, tip badge'leri, atama önerileri |
| Görev Kırılım Raporu | Tüm parçalanan issue'ların özeti |

---

## Teknoloji Yığını

| Katman | Teknoloji | Versiyon |
|--------|-----------|----------|
| Framework | Next.js (App Router) | 16.2.7 |
| UI | React | 19.2.4 |
| Dil | TypeScript | ^5 |
| Stil | Tailwind CSS | ^4 |
| Veritabanı | better-sqlite3 (SQLite) | ^12.10.0 |
| AI SDK | @google/generative-ai | ^0.24.1 |
| Excel İşleme | xlsx | ^0.18.5 |
| Paket Yöneticisi | npm | — |

---

## Kullanılan AI Araçları

### Geliştirme Sürecinde

| Araç | Model | Kullanım |
|------|-------|----------|
| **Claude Code** (Anthropic) | claude-sonnet-4-6 | Tüm kod geliştirme, mimari kararlar, hata ayıklama |

Claude Code, bu projenin **tamamı** kodlanırken kullanılmıştır. Aşağıdaki görevler Claude Code ile gerçekleştirildi:
- Next.js App Router yapısının kurulumu
- SQLite şema tasarımı ve migration yönetimi
- Jira Server/DC REST API entegrasyonu
- Tüm Server Action'ların yazılması
- Sprint Health Score algoritması
- Kanban, Backlog, Sprint Plan, Rapor UI bileşenleri
- AI prompt mühendisliği (Gemini entegrasyonu)
- Mock fallback sistemleri

### Üretimde (Runtime)

| Araç | Model | Kullanım |
|------|-------|----------|
| **Google Gemini** | gemini-2.5-flash | Story point tahmini, görev kırılımı, sprint raporu, blokaj çözümleri, Chaos to Clarity |

#### Gemini Kullanım Noktaları

```
estimateStoryPoints()  → Issue başlığı + description → Fibonacci SP tahmini
decomposeTask()        → Task analizi → teknik alt görevler + atama
generateSprintReport() → Sprint metrikleri → yönetici raporu
suggestBlokCozum()     → Blok nedeni → çözüm önerileri
chaosToClarity()       → Ham metin → yapılandırılmış backlog
```

#### Mock Fallback Sistemi
Gemini API kotası (ücretsiz: 20 req/gün) aşıldığında otomatik keyword tabanlı mock fonksiyonlar devreye girer. Kullanıcı deneyimi kesintisiz devam eder.

### MCP (Model Context Protocol)
Bu projede MCP server kullanılmamaktadır.

---

## Entegre API'ler

### Jira Server / Data Center REST API

| Özellik | Detay |
|---------|-------|
| Instance | `https://jira.turkcell.com.tr` (On-premise) |
| API Versiyonu | REST API v2 (`/rest/api/2/`) |
| Agile API | `/rest/agile/1.0/` |
| Auth | Personal Access Token (Bearer) |
| SSL | Self-signed sertifika — `rejectUnauthorized: false` (Node.js https modülü) |

Kullanılan endpoint'ler:

```
GET /rest/api/2/search          → JQL ile issue sorgulama
GET /rest/api/2/field           → Custom field ID keşfi
GET /rest/agile/1.0/board/{id}/issue  → Board issue'ları
GET /rest/agile/1.0/board/{id}/backlog → Board backlog'u
POST /rest/api/2/project        → Proje oluşturma
GET /rest/api/2/myself          → Oturum bilgisi
```

Jira erişilememesi durumunda tüm endpoint'ler mock veriye düşer — demo sırasında sistem çökmez.

### Google Gemini AI API
- **Endpoint**: `generativelanguage.googleapis.com`
- **SDK**: `@google/generative-ai`
- **Model**: `gemini-2.5-flash`

---

## Kurulum

### Gereksinimler
- Node.js >= 18.0.0
- npm >= 9.0.0

### Adımlar

```bash
# Repoyu klonla
git clone <repo-url>
cd turkcell-planning-tool

# Bağımlılıkları yükle
npm install

# Ortam değişkenlerini ayarla
cp .env.example .env.local
# .env.local dosyasını kendi değerlerinizle doldurun

# Geliştirme sunucusunu başlat
npm run dev
```

Uygulama `http://localhost:3000` adresinde açılır.

### Veritabanı
SQLite veritabanı `data/planning.db` konumunda otomatik oluşturulur. Herhangi bir migration komutu çalıştırmaya gerek yoktur — şema uygulama başlangıcında otomatik kurulur ve örnek verilerle doldurulur.

### Sprint Verisi (Opsiyonel)
Overvibe sprint verisi için aşağıdaki dosyaları proje kök dizinine koyun:
```
Overvibe_Tasklar_Enriched.json   ← Sprint görevleri
Overvibe_Tasklar_now_2.xlsx      ← Sizing Tarihi overrides
```

---

## Ortam Değişkenleri

`.env.example` dosyasını kopyalayarak `.env.local` oluşturun:

```bash
cp .env.example .env.local
```

| Değişken | Açıklama | Zorunlu |
|----------|----------|---------|
| `JIRA_BASE_URL` | Jira instance URL'i | Hayır* |
| `JIRA_TOKEN` | Jira Personal Access Token | Hayır* |
| `GEMINI_API_KEY` | Google Gemini API anahtarı | Hayır* |

\* Tanımlı değilse mock veri kullanılır, uygulama yine çalışır.

---

## Çalıştırma

```bash
# Geliştirme modu (hot reload)
npm run dev

# Production build
npm run build
npm start

# Lint kontrolü
npm run lint
```

---

## Proje Yapısı

```
turkcell-planning-tool/
├── app/
│   ├── layout.tsx                    # Root layout
│   ├── page.tsx                      # Ana sayfa — proje listesi
│   ├── ProjectsBoard.tsx             # Proje kartları bileşeni
│   ├── api/
│   │   └── jira/[projectKey]/        # Jira proxy API route
│   └── projects/[id]/
│       ├── page.tsx                  # Proje detay sayfası (Server Component)
│       └── ProjectDetail.tsx         # Ana UI bileşeni (Client Component)
├── actions/
│   └── actions.ts                    # Tüm Server Action'lar
├── lib/
│   ├── db.ts                         # SQLite bağlantısı, şema, tipler
│   ├── gemini.ts                     # Gemini AI entegrasyonu + mock fallback'ler
│   └── jira.ts                       # Jira API client + mock veriler
├── scripts/
│   └── enrich-tasks.js               # Jira enrichment CLI scripti
├── data/
│   └── planning.db                   # SQLite veritabanı (git'e dahil değil)
├── docs/                             # Proje dokümantasyonu
│   ├── plan.md
│   ├── gelistirme-fazlari.md
│   └── mimari.md
├── public/                           # Statik dosyalar
├── .env.example                      # Örnek ortam değişkenleri
└── .env.local                        # Gerçek ortam değişkenleri (git'e dahil değil)
```

---

## Deploy

Proje şu an yerel geliştirme ortamında çalışmaktadır. Production deploy için önerilen platform:

### Vercel (Önerilen)
```bash
npm i -g vercel
vercel --prod
```

> **Not**: better-sqlite3 binary bağımlılığı nedeniyle Vercel'de Node.js runtime seçilmelidir. SQLite yerine Turso veya PlanetScale gibi edge-uyumlu bir veritabanına geçiş production için önerilir.

### Self-Hosted
```bash
npm run build
npm start
# veya PM2 ile:
pm2 start npm --name "agile-manager" -- start
```

---

## Geliştirici Notları

- Gemini API ücretsiz kotası günde 20 istek ile sınırlıdır. Kota aşıldığında mock fallback devreye girer.
- Jira self-signed SSL sertifikası için `lib/jira.ts`'de `rejectUnauthorized: false` kullanılmaktadır.
- SQLite WAL modu etkin — eşzamanlı okuma/yazma performansı optimize edilmiştir.
- Tüm Server Action'lar `'use server'` direktifi ile Next.js App Router'da çalışır.

---

*Bu proje Turkcell Hackathon kapsamında geliştirilmiştir.*
