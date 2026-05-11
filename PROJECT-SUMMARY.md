# JAMA Visual Abstract Generator - Proje Özeti

## Proje Amacı
Klinik araştırma makalelerinin (PDF) yapılandırılmış özetlerinden **JAMA Visual Abstract** formatında görsel özet üreten bir araç. Tamamen **kural tabanlı (rule-based)** metin işleme kullanır - makine öğrenmesi veya LLM kullanmaz.

---

## Mimari

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│   PDF Upload    │ ──► │   Text Parser    │ ──► │  Visual Abstract│
│   (Browser)     │     │   (Rule-based)   │     │  (HTML/Canvas)  │
└─────────────────┘     └──────────────────┘     └─────────────────┘
```

### Dosya Yapısı

```
src/
├── parser/
│   └── text-parser.js    # Ana metin işleme motoru (2800+ satır)
├── tokenizer/
│   └── jama-tokenizer.js # Token bazlı metin parçalama
├── blocks/               # Her VA bloğu için modüller
├── validator/
│   └── schema.js         # JSON schema doğrulama
├── index.js              # Browser/ESM entry point
└── cli.js                # Komut satırı arayüzü

template/
└── app.html              # Tek dosyalık browser uygulaması (PDF.js + Canvas)

dist/
├── index.iife.js         # Browser bundle (app.html bunu kullanır)
├── index.cjs.js          # Node.js CommonJS
└── index.esm.js          # ES Modules
```

---

## Kural Tabanlı Parser Yaklaşımı

### Temel Prensipler
1. **Regex Pattern Matching**: Her veri türü için özel regex pattern'ları
2. **Cascading Fallbacks**: Bir pattern tutmazsa sonraki denenir
3. **Confidence Scores**: Her çıkarım güven skoru ile döner
4. **Genellenebilirlik**: Tek bir makaleye özel kod yok, tüm pattern'lar genel

### Çıkarılan Veri Blokları

| Blok | İçerik | Kelime Limiti |
|------|--------|---------------|
| `study_type` | RCT, Cohort, Meta-analysis vb. | - |
| `population` | n_male, n_female, age, description | ≤25 |
| `intervention` | arms (label, n, description) | ≤40 |
| `settings` | Lokasyon, klinik sayısı | ≤15 |
| `primary_outcome` | Birincil sonlanım + ölçek bilgisi | ≤25 |
| `findings` | Özet + chart_data | ≤50 |
| `citation` | DOI, journal, authors | - |

---

## Önemli Fonksiyonlar

### 1. Population Tespiti
```javascript
detectPopulation(text)
// Pattern örnekleri:
// "1193 male [67.2%]" → n_male: 1193, n_female: 582
// "median age 19 (IQR 18-22)" → median_age: "19 y", age_range: "18-22"
// "155 women were randomized" → n_female: 155
```

### 2. Intervention Arms
```javascript
extractInterventionDetails(text)
// Pattern örnekleri:
// "865 intervention and 910 control" → 2 arm
// "6 weekly sessions of CBT" → therapy description
// "oral upadacitinib 30 mg daily" → drug + dose + frequency
```

### 3. Kısaltma Açma
```javascript
expandConditionAbbreviations(cond)
// "ACS" → "acute coronary syndrome (ACS)"
// "MI" → "myocardial infarction (MI)"
// 40+ tıbbi kısaltma desteklenir
```

### 4. Klinik Ölçek Zenginleştirme
```javascript
enrichOutcomeWithScaleInfo(outcome)
// "aPHQ-9 score" → "Adapted Patient Health Questionnaire-9 (aPHQ-9) score.
//                   Score range, 0-27, with higher scores indicating more
//                   severe depressive symptoms"
// 17 klinik ölçek desteklenir (PHQ-9, GAD-7, MMSE, EASI, vb.)
```

### 5. Findings Temizleme
```javascript
cleanFindingsSummary(text)
// - "Key Points Question..." gibi PDF noise'unu temizler
// - 50 kelime limitine göre cümle sınırında keser
// - Anlamsız kesmeyi önler
```

---

## Örnek Çıktı

### Girdi (PDF'den çıkarılan metin)
```
Among 1775 patients with ACS (865 intervention and 910 control;
1193 male [67.2%])... Heart Matters community ACS education campaign...
Community education sessions, mailouts, handouts...
The control period did not include any educational campaign.
```

### Çıktı (JSON)
```json
{
  "study_type": "RCT",
  "population": {
    "n_male": 1193,
    "n_female": 582,
    "description": "Patients with acute coronary syndrome (ACS) in areas with elevated cardiovascular risk"
  },
  "intervention": {
    "total_n": 1775,
    "arms": [
      {
        "n": 910,
        "label": "Control",
        "description": "No education campaign"
      },
      {
        "n": 865,
        "label": "Heart Matters community ACS education campaign",
        "description": "Community education sessions, mailouts, handouts, opportunistic media, geotargeted social media campaign"
      }
    ]
  }
}
```

---

## Kullanım

### Browser'da (app.html)
1. `template/app.html` dosyasını tarayıcıda aç
2. PDF yükle veya metin yapıştır
3. Visual Abstract otomatik oluşturulur

### Node.js'de
```javascript
const { parseText } = require('./dist/index.cjs.js');
const result = parseText(pdfText);
console.log(result);
```

### Build
```bash
npm install
npm run build    # dist/ klasörüne bundle üretir
npm test         # Jest testleri çalıştırır
```

---

## Kritik Kurallar

1. **Node.js API Yasak**: `src/parser/`, `src/tokenizer/` içinde `require('fs')`, `require('path')` kullanılmaz - browser uyumluluğu için
2. **Sayısal Koruma**: mean, SD, p_value, n değerleri asla yuvarlanmaz/değiştirilmez
3. **Blok Bağımsızlığı**: Her blok diğerlerinden bağımsız parse edilir
4. **Kural Tabanlı**: Hardcoded değer yok, tüm pattern'lar genellenebilir

---

## Geliştirme İpuçları

### Yeni Pattern Ekleme
1. `src/parser/text-parser.js` içinde ilgili `detect*` fonksiyonunu bul
2. Mevcut pattern'lara benzer yeni regex ekle
3. Fallback sırasını koru (spesifik → genel)
4. `npm run build` ile bundle'ı yenile
5. Test et

### Debug
```javascript
// app.html içinde debug çıktıları:
console.log('[DEBUG] Extracted text:', text.substring(0, 3000));
console.log('[DEBUG] parseText result:', JSON.stringify(result, null, 2));
```

---

## Repository
https://github.com/yusuf7855/jama-visual-abstract
