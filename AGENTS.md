# AI Agent Kuralları — Turkcell Agile Manager

Bu dosya Claude Code ve diğer AI coding agent'larının bu projede uyması gereken kuralları tanımlar.

---

## Next.js Versiyonu

Bu projede **Next.js 16.2.7** kullanılmaktadır.

> **UYARI**: Bu sürümde API'ler, konvansiyonlar ve dosya yapısı eğitim verilerindekinden farklı olabilir.  
> Kod yazmadan önce `node_modules/next/dist/docs/` içindeki ilgili kılavuzu oku.  
> Deprecation uyarılarına uy.

---

## Mimari Kısıtlar

### Server / Client Ayrımı
- `app/*/page.tsx` → Server Component — veri çekme, prop geçme
- `app/*/ProjectDetail.tsx` → Client Component (`'use client'`) — state, event handler
- `actions/actions.ts` → Server Action (`'use server'`) — DB + AI + Jira çağrıları

### Yasak Örüntüler
```typescript
// ❌ Client Component içinde doğrudan DB erişimi
import { getDb } from '@/lib/db'; // YASAK

// ✅ Server Action çağrısı
import { getJiraIssues } from '@/actions/actions'; // DOĞRU
```

---

## Veritabanı Kuralları

### Migration Zorunluluğu
Yeni kolon eklerken **her iki yerde** de güncelle:

```typescript
// lib/db.ts — 1. CREATE TABLE içinde
CREATE TABLE IF NOT EXISTS sprint_tasks (
  ...
  yeni_kolon TEXT,  // ← buraya ekle
);

// lib/db.ts — 2. Migration bloğu
const cols = db.prepare('PRAGMA table_info(sprint_tasks)').all();
if (!cols.find(c => c.name === 'yeni_kolon')) {
  db.exec('ALTER TABLE sprint_tasks ADD COLUMN yeni_kolon TEXT');
}

// lib/db.ts — 3. TypeScript tipi
export type SprintTask = {
  ...
  yeni_kolon: string | null;  // ← buraya ekle
};
```

### Transaction Kullanımı
```typescript
// ✅ Toplu insert/update için transaction
db.transaction(() => {
  for (const row of rows) insert.run(row);
})();

// ❌ Döngüde bare insert — yavaş
for (const row of rows) db.prepare('INSERT...').run(row);
```

---

## Jira Entegrasyon Kuralları

- API: REST v2 (`/rest/api/2/`) — Cloud v3 (`/rest/api/3/`) **değil**
- Auth: `Authorization: Bearer <PAT>` header
- SSL: On-premise self-signed cert → `https` modülü + `rejectUnauthorized: false`
- Her Jira çağrısı `try/catch` içinde, `catch` bloğu mock veri döndürmeli

```typescript
// ✅ Doğru pattern
try {
  return await fetchFromJira(key);
} catch {
  return getMockData(key); // Her zaman çalışır
}
```

---

## AI (Gemini) Kuralları

- Model sabiti: `lib/gemini.ts:4` → `gemini-2.5-flash`
- Her AI fonksiyonu mock fallback içermeli (kota aşımı: 20 req/gün)
- Prompt'lar Türkçe yanıt zorunlu kılmalı
- Çıktı formatı: JSON schema ile yapılandırılmış

```typescript
// ✅ Doğru pattern
try {
  const text = await askGemini(prompt);
  return extractJson<ResultType>(text);
} catch {
  return mockFallback(input); // Kota aşıldığında
}
```

---

## UI / Stil Kuralları

- Tailwind CSS v4 — `@apply` direktifi farklı çalışabilir
- Renk paleti: `blue-950` zemin / `amber-400` accent / `blue-400` ikincil
- Tablo kolon genişliği fit-content: `className="w-px whitespace-nowrap"`
- Loading spinner: `animate-spin border-t-transparent rounded-full`
- Modal: `fixed inset-0 z-50 bg-black/70 backdrop-blur-sm`

---

## State Yönetimi Kuralları

```typescript
// ❌ Yanlış — router.refresh() useState'i güncellemez
await someServerAction();
router.refresh(); // initialState değişmez!

// ✅ Doğru — explicit state güncelleme
await someServerAction();
const fresh = await getUpdatedData();
setState(fresh);
```

---

## Kod Kalitesi

- Yorum ekleme (kod kendini açıklamalı)
- `any` tipi kullanma
- Gereksiz `console.log` bırakma
- Error boundary veya toast sistemi yoktur — hataları `console.error` ile logla
- Mock veri üretiminde deterministik değil rastgele değer kullan (demo etkisi için)
