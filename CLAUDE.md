# jama-visual-abstract — CLAUDE.md

Bu dosya Claude Code'a projeyi tanıtır. Her oturumda buradaki kurallar geçerlidir.

---

## Proje Özeti

JAMA Visual Abstract formatı için JSON üreten **npm paketi**. Klinik çalışma verisini (yapılandırılmış JSON veya ham metin) alır; kelime limiti doğrulaması, sayısal koruma ve blok bağımsızlığı ile işler. Detaylı arka plan: `IDEA.md`.

---

## Dil ve Stack

- **JavaScript — kesindir. TypeScript, Python, Go önerilmez, yazılmaz.**
- Bağımlılıklar: `ajv` (schema), `commander` (CLI), `esbuild` (build), `jest` (test), `concurrently` (dev)
- Node.js sürümü: ≥ 18

---

## Kırılamaz Kurallar

1. `src/tokenizer/`, `src/parser/`, `src/blocks/`, `src/assembler.js`, `src/index.js` — `require('fs')`, `require('path')`, `process.env` **yasak**. Node.js API yalnızca `src/cli.js` ve `src/io.js`'te kullanılır.
2. Sayısal değerler (`mean`, `SD`, `p_value`, `n`) hiçbir koşulda kesilmez, değiştirilmez, yuvarlanmaz.
3. Her blok bağımsızdır — bir bloğun üretimi başka blokların girdisine bağlı olamaz.
4. Çıktı daima JSON'dur. SVG, PNG, PDF üretme kodu bu pakete girmez.

---

## JAMA Kelime Limitleri (Referans)

| Blok | Limit |
|---|---|
| title | ≤ 20 kelime |
| population | ≤ 25 kelime |
| intervention | ≤ 40 kelime (her kol ≤ 20) |
| settings | ≤ 15 kelime |
| primary_outcome | ≤ 25 kelime |
| findings | ≤ 50 kelime |
| citation | Bibliyografik format |

---

## Tokenizer Kuralları (Özet)

- Sayı+birim tek token: `62.6 y`, `214 patients`
- İstatistik ifadesi tek token: `P=.01`, `P<.001`
- `mean (SD), 3.3 (3.6) d` → 3 token
- Kısaltmalar tek token: `BPPV`, `RCT`
- `60°` tek token

---

## Dizin Yapısı

```
src/
  tokenizer/jama-tokenizer.js   ← paketin çekirdeği
  parser/text-parser.js         ← ham metin → JSON
  blocks/                       ← 7 blok modülü
  validator/schema.js           ← ajv schema
  assembler.js                  ← blokları birleştirir
  index.js                      ← browser/ESM entry
  io.js                         ← fs/path izole
  cli.js                        ← commander CLI
test/
  tokenizer/
  parser/
  blocks/
  integration/
fixtures/
  study/                        ← girdi fixture'ları
  expected/                     ← beklenen çıktılar
scripts/
  check-node-api.js             ← Node.js API sızma kontrolü
template/
  jama-va.html                  ← boş HTML template (renderVisualAbstract(data) API)
  generate-html.js              ← JSON → standalone HTML generator (render katmanı)
build.js                        ← esbuild config
```

---

## Geliştirme Komutları

```bash
npm install               # bağımlılıkları kur
npm run dev               # jest --watch + build --watch paralel
npm test                  # tüm testler bir kez
npm run test:watch        # watch mode (sadece testler)
npm run test:tokenizer    # tokenizer testleri verbose
npm run test:coverage     # coverage raporu
npm run build             # dist/ üret
npm run lint:no-node-api  # Node.js API sızma taraması
npm run render -- --input fixtures/study/valid-study.json --output output/va.html
                          # JSON → görsel HTML üret (tarayıcıda aç)
```

---

## Test Stratejisi

- **Tokenizer unit testleri:** Her kural için en az 1 test. `test/tokenizer/jama-tokenizer.test.js`
- **Blok testleri:** Her blok için limit aşımı + normal + edge case. `test/blocks/*.test.js`
- **TextParser golden-set:** JSON ve metin girdisi aynı `content` üretmeli. `test/parser/text-parser.test.js`
- **Integration:** `golden-set.test.js` (20 vaka), `browser-bundle.test.js` (Node.js API taraması)
- Coverage threshold: branches ≥ 80%, functions/lines ≥ 90%

---

## Exit Code Sözleşmesi

| Code | Durum |
|---|---|
| 0 | Başarı |
| 1 | Genel hata (eksik argüman, dosya yok, eksik zorunlu alan) |
| 2 | Format/validasyon hatası (limit aşımı, TRUNCATION_IMPOSSIBLE) |
| 3 | Schema hatası |

---

## Çalışma Tarzı

- Kod değişikliği önce test yazılarak başlar (tokenizer ve bloklar için).
- Her blok bağımsız test edilir; integration test sonraya bırakılır.
- `hard_lock` mantığına dokunan her değişiklik ST-04 ve ST-05 senaryolarıyla doğrulanır.
- Browser bundle değişikliği sonrası `npm run validate:bundle` çalıştırılır.
- `fixtures/study/valid-study.json` ve `valid-study.txt` golden-set referans dosyalarıdır; değiştirilmez, yeni fixture eklenir.
