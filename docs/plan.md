# Proje Planı — Turkcell AI-Powered Agile Manager

## Problem Tanımı

Turkcell'deki Scrum Master'lar ve Takım Liderleri, her sprint döngüsünde planlama ve raporlama için **5–8 saat** harcıyor. Bu süre doğrudan yazılım geliştirmeden çalınan zamandır.

Temel sorunlar:

| Sorun | Etki |
|-------|------|
| Manuel story point tahminleri | Sübjektif, tartışmalı, tutarsız |
| Sprint sonu raporları elle hazırlanıyor | Zaman kaybı, hata riski |
| Görev dağılımı rol/kapasite gözetilmeden yapılıyor | Verimsiz ekip kullanımı |
| Ham taleplerin yapılandırılması | Slack/e-posta → backlog dönüşümü manuel |

---

## Hedef Kitle

- **Birincil**: Turkcell bünyesindeki Scrum Master'lar
- **İkincil**: Takım Liderleri, Product Owner'lar
- **Üçüncül**: Geliştiriciler (story point tahmini, görev kırılımı)

---

## Çözüm Yaklaşımı

Mevcut Jira altyapısıyla entegre çalışan, AI destekli bir web uygulaması. Üç temel değer önerisi:

### 1. Otomatik Story Point Tahmini
- Jira issue başlığı + açıklaması Gemini AI'a gönderilir
- Fibonacci skalasında (1–21) tahmin üretilir
- Gerekçe Türkçe olarak sunulur

### 2. Akıllı Görev Kırılımı
- Issue açıklaması analiz edilerek gerçekten gerekli teknik alanlar seçilir
- Frontend/Backend/Database/Test/DevOps/Design — ihtiyaca göre
- Takım üyelerine atama önerisi

### 3. Tek Tıkla Sprint Raporu
- Tüm sprint metrikleri (story point, durum, kişi bazlı tamamlanma) analiz edilir
- Yöneticiye sunulabilir Türkçe metin üretilir
- Kopyala-yapıştır hazır çıktı

---

## MVP Kapsamı

### Kesinlikle Dahil

- [x] Çoklu proje yönetimi
- [x] Jira entegrasyonu (Board + Project bazlı)
- [x] Kanban Board görünümü
- [x] Backlog görünümü
- [x] Sprint Planı (tarih, sprint no, tamamlanma durumu)
- [x] AI story point tahmini (tekli + toplu)
- [x] AI görev kırılımı (Decompose)
- [x] AI sprint raporu
- [x] Sprint Health Score (0–100)
- [x] Chaos to Clarity (ham metin → backlog)
- [x] Blok Nedeni + AI çözüm önerileri
- [x] ICT Tahmini Büyüklük (XS–XXL / Fibonacci)
- [x] Görev Kırılım Raporu (Rapor sekmesinde)

### Kapsam Dışı (Zaman Tuzağı)

- ❌ Kullanıcı kimlik doğrulama / authorization
- ❌ E-posta / push bildirimleri
- ❌ Multi-tenant yapı
- ❌ Grafik kütüphaneleri (Chart.js, D3 vb.) — CSS ile çözüldü
- ❌ Gerçek zamanlı WebSocket güncellemeleri
- ❌ Mobil uygulama

---

## Killer Özellik: Chaos to Clarity

**Demo senaryosu:**

> Kullanıcı bir Slack mesajını yapıştırır:
> *"Müşteri portalına SSO eklememiz lazım, ayrıca mobil uygulama çöküyor, dashboard da yavaş"*

**AI tek API çağrısıyla:**
1. 3 ayrı task otomatik ayrıştırılır
2. Her task için story point tahmini
3. Her task için teknik alt görevler
4. Takım kapasitesine göre atama önerisi
5. Sprint'e sığar mı kararı

Bu özellik hackathon jürisi için canlı demoda sergilenmek üzere tasarlanmıştır.

---

## Başarı Kriterleri

| Kriter | Hedef |
|--------|-------|
| Story point tahmini süresi | < 3 saniye (mock: anlık) |
| Sprint raporu üretimi | < 5 saniye |
| Görev kırılımı | 3–6 alt görev, description'a göre |
| Sistem kararlılığı | Jira/AI erişilmez olsa dahi çalışır (mock fallback) |
| UI yanıt süresi | Tüm view geçişleri < 500ms |
