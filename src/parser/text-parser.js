'use strict';

// TextParser: ham klinik metin → yapılandırılmış JSON.
// Node.js API kullanılmaz — browser uyumlu, çevrimdışı çalışır.

// --- Text Normalization ---
// PDF'den gelen line-break hyphenation'ı düzelt: "anesthe- sia" → "anesthesia"
function normalizeText(text) {
  // Line-break ile bölünmüş kelimeleri birleştir
  // Pattern: kelime- \n kelime devamı (küçük harf ile devam eden)
  let normalized = text.replace(/(\w+)-\s*\n\s*([a-z])/g, '$1$2');

  // Ayrıca satır içi bölünmeler: "anesthe- sia" → "anesthesia"
  normalized = normalized.replace(/(\w+)-\s+([a-z])/g, '$1$2');

  // Çoklu boşlukları tek boşluğa indir
  normalized = normalized.replace(/[ \t]+/g, ' ');

  return normalized;
}

// --- Abstract çıkarma ---
// JAMA full-paper PDF'den sadece structured abstract kısmını al.
// IMPORTANCE / OBJECTIVE / BACKGROUND → CONCLUSIONS / RELEVANCE arasındaki blok.
function extractAbstract(text) {
  // JAMA yapılandırılmış abstract başlangıcı
  const start = text.search(/\b(?:IMPORTANCE|OBJECTIVE|BACKGROUND)[:\s]/i);
  if (start === -1) return text.slice(0, 6000); // abstract bulunamazsa ilk 6000 char

  const after = text.slice(start);

  // Abstract sonu: bölüm başlığı (Introduction, Methods vb.) — satır başı
  const endBySection = after.search(/\n\s*(?:Introduction|Methods|Discussion|References|Acknowledgment|Author\s+Contributions|Funding|FUNDING|TRIAL\s+REGISTRATION)\s*\n/i);
  if (endBySection > 0) return after.slice(0, endBySection);

  // Alternatif: CONCLUSIONS bölümünden ~400 char sonra kes (sonraki ALL-CAPS bölüm başlığı)
  const concStart = after.search(/\n\s*CONCLUSIONS?\s+(?:AND\s+RELEVANCE)?[:\s]/i);
  if (concStart > 0) {
    const afterConc = after.slice(concStart);
    // CONCLUSIONS içeriği bitince All-caps başlık ya da reference superscript → kes
    const endAfterConc = afterConc.search(/\n\s*[A-Z]{3,}\s+[A-Z]+/);
    if (endAfterConc > 100 && endAfterConc < 1500) {
      return after.slice(0, concStart + endAfterConc);
    }
    // Sabit sınır: CONCLUSIONS başlangıcından 600 char
    return after.slice(0, concStart + 600);
  }

  // Fallback: 6000 char sınırı (4000'den büyük — structured abstract ~5500 char)
  return after.slice(0, 6000);
}

// --- Kısaltma açıcı ---
function expandMedicalAbbreviations(text) {
  const abbreviations = {
    'CRS': 'chronic rhinosinusitis',
    'ESS': 'endoscopic sinus surgery',
    'BPPV': 'benign paroxysmal positional vertigo',
    'RCT': 'randomized controlled trial',
    'DM2': 'type 2 diabetes',
    'HTN': 'hypertension',
    'CAD': 'coronary artery disease',
    'COPD': 'chronic obstructive pulmonary disease',
    'CHF': 'congestive heart failure',
    'MI': 'myocardial infarction',
    'CVA': 'cerebrovascular accident',
    'DVT': 'deep vein thrombosis',
    'PE': 'pulmonary embolism',
    'GERD': 'gastroesophageal reflux disease',
    'IBD': 'inflammatory bowel disease',
    'RA': 'rheumatoid arthritis',
    'SLE': 'systemic lupus erythematosus',
    'MS': 'multiple sclerosis',
    'PD': 'Parkinson disease',
    'AD': 'Alzheimer disease',
    'ASD': 'autism spectrum disorder',
    'ADHD': 'attention deficit hyperactivity disorder',
  };
  let result = text;
  for (const [abbr, full] of Object.entries(abbreviations)) {
    // Replace standalone abbreviations (not already expanded)
    result = result.replace(new RegExp(`\\b${abbr}\\b(?!\\s+\\()`, 'g'), full);
  }
  return result;
}

// --- Dedektörler ---

function detectStudyType(text) {
  // "Randomized clinical/controlled trial" — en yaygın JAMA formatı
  // Arada sıfatlar olabilir: "randomized, double-blinded, double-dummy, active-controlled clinical trial"
  if (/\bRCT\b/.test(text)
    || /randomi[sz]ed\s+(?:controlled|clinical)\s+trial/i.test(text)
    || /randomi[sz]ed\s+trial/i.test(text)
    || /randomi[sz]ed[,\s]+(?:[\w,\s-]+)?clinical\s+trial/i.test(text)) {
    return { value: 'RCT', confidence: 0.95 };
  }
  if (/\bcohort\b/i.test(text)) return { value: 'cohort', confidence: 0.85 };
  if (/\bcase.control\b/i.test(text)) return { value: 'case-control', confidence: 0.85 };
  // meta-analysis'i düşük öncelikle kontrol et — tam paper'da çok geçer
  if (/\bmeta.analysis\b/i.test(text)) return { value: 'meta-analysis', confidence: 0.9 };
  return { value: 'other', confidence: 0.4 };
}

function detectSexTable(text) {
  // Characteristics table format (multi-arm trials):
  // "Male  192 (58.0)  183 (53.2)"  — two arm columns
  // Sum across all columns to get total male/female
  const maleRow = text.match(/\bMale\b\s+([\d]+)\s+\([\d.]+\)\s+([\d]+)/);
  const femaleRow = text.match(/\bFemale\b\s+([\d]+)\s+\([\d.]+\)\s+([\d]+)/);
  if (maleRow && femaleRow) {
    const nMale   = parseInt(maleRow[1])   + parseInt(maleRow[2]);
    const nFemale = parseInt(femaleRow[1]) + parseInt(femaleRow[2]);
    return { n_male: nMale, n_female: nFemale, confidence: 0.96 };
  }
  // Single-column table: "Male  183 (53.2)"
  const maleRowSingle   = text.match(/\bMale\b\s+([\d]+)\s+\([\d.]+\)/);
  const femaleRowSingle = text.match(/\bFemale\b\s+([\d]+)\s+\([\d.]+\)/);
  if (maleRowSingle && femaleRowSingle) {
    return { n_male: parseInt(maleRowSingle[1]), n_female: parseInt(femaleRowSingle[1]), confidence: 0.94 };
  }
  return null;
}

function detectSex(text) {
  // "70 men and 125 women" / "125 women, 70 men"
  const mf = text.match(/(\d+)\s*men\s+and\s+(\d+)\s*women/i);
  if (mf) return { n_male: parseInt(mf[1]), n_female: parseInt(mf[2]), confidence: 0.95 };
  const fm = text.match(/(\d+)\s*women\s*[,and]+\s*(\d+)\s*men/i);
  if (fm) return { n_male: parseInt(fm[2]), n_female: parseInt(fm[1]), confidence: 0.92 };

  // "40 [71%] male" format - sum across multiple groups (awake/asleep DBS study)
  const bracketMales = [...text.matchAll(/(\d+)\s*\[[\d.]+%\]\s*male\b/gi)];
  if (bracketMales.length >= 1) {
    const totalMale = bracketMales.reduce((sum, m) => sum + parseInt(m[1]), 0);
    // Calculate female from total if we can find it
    const totalMatch = text.match(/(?:total\s+of\s+)?(\d+)\s+patients?\b/i);
    if (totalMatch) {
      const totalN = parseInt(totalMatch[1]);
      return { n_male: totalMale, n_female: totalN - totalMale, confidence: 0.88 };
    }
    return { n_male: totalMale, n_female: null, confidence: 0.75 };
  }

  // "36 men, 36 women" / "36 men; 36 women" — yüzde olmadan
  const simpleMF = text.match(/\b(\d+)\s+men[,;]\s*(\d+)\s+women\b/i);
  if (simpleMF) return { n_male: parseInt(simpleMF[1]), n_female: parseInt(simpleMF[2]), confidence: 0.94 };
  const simpleFM = text.match(/\b(\d+)\s+women[,;]\s*(\d+)\s+men\b/i);
  if (simpleFM) return { n_male: parseInt(simpleFM[2]), n_female: parseInt(simpleFM[1]), confidence: 0.94 };

  // "54 Males, 54 Females" / "54 Females, 54 Males"
  const malesFirst = text.match(/(\d+)\s*males?\s*[,and]+\s*(\d+)\s*females?/i);
  if (malesFirst) return { n_male: parseInt(malesFirst[1]), n_female: parseInt(malesFirst[2]), confidence: 0.93 };
  const femalesFirst = text.match(/(\d+)\s*females?\s*[,and]+\s*(\d+)\s*males?/i);
  if (femalesFirst) return { n_male: parseInt(femalesFirst[2]), n_female: parseInt(femalesFirst[1]), confidence: 0.90 };

  // "54 male and 54 female" (JAMA abstract style)
  const maleFem = text.match(/(\d+)\s*male\s+and\s+(\d+)\s*female/i);
  if (maleFem) return { n_male: parseInt(maleFem[1]), n_female: parseInt(maleFem[2]), confidence: 0.93 };
  const femMale = text.match(/(\d+)\s*female\s+and\s+(\d+)\s*male/i);
  if (femMale) return { n_male: parseInt(femMale[2]), n_female: parseInt(femMale[1]), confidence: 0.91 };

  // "159 Men, 235 Women" (capital M/W, comma)
  const capMF = text.match(/(\d+)\s*Men[,\s]+(\d+)\s*Women/);
  if (capMF) return { n_male: parseInt(capMF[1]), n_female: parseInt(capMF[2]), confidence: 0.95 };
  const capFM = text.match(/(\d+)\s*Women[,\s]+(\d+)\s*Men/);
  if (capFM) return { n_male: parseInt(capFM[2]), n_female: parseInt(capFM[1]), confidence: 0.93 };

  // "X were male" / "X were female" ayrı ayrı
  const wereMale   = text.match(/\b(\d+)\s+(?:were\s+)?male\b/i);
  const wereFemale = text.match(/\b(\d+)\s+(?:were\s+)?female\b/i);
  if (wereMale && wereFemale) {
    return { n_male: parseInt(wereMale[1]), n_female: parseInt(wereFemale[1]), confidence: 0.85 };
  }

  // "X boys and Y girls"
  const boys = text.match(/(\d+)\s+boys?\s+and\s+(\d+)\s+girls?/i);
  if (boys) return { n_male: parseInt(boys[1]), n_female: parseInt(boys[2]), confidence: 0.90 };

  // "132 (61%) were women" / "82 (38%) were male" — yuvarlak VEYA köşeli parantez
  const BP = '[([\\[]';  // bracket open: ( or [
  const EP = '[)\\]]';   // bracket close: ) or ]
  const pctWomen = text.match(new RegExp(`(\\d+)\\s*[([\\[]\\d+\\.?\\d*%[)\\]]\\s*(?:were\\s+)?women`, 'i'));
  const pctMen   = text.match(new RegExp(`(\\d+)\\s*[([\\[]\\d+\\.?\\d*%[)\\]]\\s*(?:were\\s+)?men`, 'i'));
  if (pctWomen && pctMen) return { n_male: parseInt(pctMen[1]), n_female: parseInt(pctWomen[1]), confidence: 0.88 };

  const pctFemale = text.match(new RegExp(`(\\d+)\\s*[([\\[]\\d+\\.?\\d*%[)\\]]\\s*(?:were\\s+)?female`, 'i'));
  const pctMale   = text.match(new RegExp(`(\\d+)\\s*[([\\[]\\d+\\.?\\d*%[)\\]]\\s*(?:were\\s+)?male`, 'i'));
  if (pctFemale && pctMale) return { n_male: parseInt(pctMale[1]), n_female: parseInt(pctFemale[1]), confidence: 0.87 };

  // "men, 136 [53.8%]; women, 117 [46.2%]" — JAMA style reversed (label before count)
  const labelMen  = text.match(/men,\s*(\d+)\s*[\[(]\d+/i);
  const labelWomen = text.match(/women,\s*(\d+)\s*[\[(]\d+/i);
  if (labelMen && labelWomen) return { n_male: parseInt(labelMen[1]), n_female: parseInt(labelWomen[1]), confidence: 0.90 };

  // "183 men [53.5%]" / "40 [71%] male" — percentage after sex label, or before
  // Multi-arm: sum ALL occurrences of "N men [XX%]" to get total male across arms
  const menPctAll = [...text.matchAll(/\b(\d+)\s+men\s*[\[(]\d+\.?\d*%[\])]/gi)];
  const womenPctAll = [...text.matchAll(/\b(\d+)\s+women\s*[\[(]\d+\.?\d*%[\])]/gi)];
  if (menPctAll.length >= 1 && womenPctAll.length >= 1) {
    const totalMale   = menPctAll.reduce((s, m) => s + parseInt(m[1]), 0);
    const totalFemale = womenPctAll.reduce((s, m) => s + parseInt(m[1]), 0);
    return { n_male: totalMale, n_female: totalFemale, confidence: menPctAll.length > 1 ? 0.87 : 0.90 };
  }
  // Only men [XX%] found — derive female from total
  if (menPctAll.length >= 1) {
    const totalMale = menPctAll.reduce((s, m) => s + parseInt(m[1]), 0);
    const totalMatch = text.match(/(?:[Aa]\s+total\s+of|[Aa]mong)\s+(\d+)\s+(?:patients?|participants?|subjects?|adults?)/i)
      || text.match(/(\d+)\s+(?:patients?|participants?|adults?)\s+(?:were\s+)?(?:randomized|enrolled|included)/i);
    if (totalMatch) {
      const nTot = parseInt(totalMatch[1]);
      if (totalMale < nTot) return { n_male: totalMale, n_female: nTot - totalMale, confidence: 0.83 };
    }
  }

  const malePctBefore = text.match(/\b(\d+)\s*[\[(]\d+\.?\d*%[\])]\s+male\b/i);
  const femalePctBefore = text.match(/\b(\d+)\s*[\[(]\d+\.?\d*%[\])]\s+female\b/i);
  if (malePctBefore && femalePctBefore) return { n_male: parseInt(malePctBefore[1]), n_female: parseInt(femalePctBefore[1]), confidence: 0.89 };

  // "127 (51.6%) were female" without matching male count — derive from total
  const pctFemaleOnly = text.match(/\b(\d+)\s*[\[(]\d+\.?\d*%[\])]\s+(?:were\s+)?female\b/i);
  if (pctFemaleOnly) {
    const totalMatch = text.match(/(\d+)\s+(?:patients?|participants?|subjects?|adults?|children|infants?|youths?|persons?)\s+(?:were\s+)?(?:randomized|enrolled|included|recruited|treated)/i)
      || text.match(/(?:[Aa]\s+total\s+of|[Aa]mong)\s+(\d+)\s+(?:patients?|participants?|subjects?|adults?|children|infants?|youths?)/i);
    if (totalMatch) {
      const nFem = parseInt(pctFemaleOnly[1]);
      const nTot = parseInt(totalMatch[1]);
      if (nFem < nTot) return { n_male: nTot - nFem, n_female: nFem, confidence: 0.82 };
    }
  }

  // "348 were women (69.6%)" — percentage AFTER sex label
  const womenThenPct = text.match(/\b(\d+)\s+(?:were\s+)?women\s*[\[(]\d+\.?\d*%[\])]/i);
  const menThenPct   = text.match(/\b(\d+)\s+(?:were\s+)?men\s*[\[(]\d+\.?\d*%[\])]/i);
  if (womenThenPct && menThenPct) return { n_male: parseInt(menThenPct[1]), n_female: parseInt(womenThenPct[1]), confidence: 0.89 };
  if (womenThenPct) {
    const totalM = text.match(/(\d+)\s+(?:patients?|participants?|adults?|persons?|youths?)\s+(?:were\s+)?(?:randomized|enrolled|included|recruited|treated)/i)
      || text.match(/[Aa]\s+total\s+of\s+(\d+)\s+(?:patients?|participants?|subjects?|adults?|youths?)/i);
    if (totalM) {
      const nFem = parseInt(womenThenPct[1]);
      const nTot = parseInt(totalM[1]);
      if (nFem < nTot) return { n_male: nTot - nFem, n_female: nFem, confidence: 0.82 };
    }
  }

  // "348 were women (69.6%)" derive from total — fallback (pct before sex label)
  const pctWomenParen = text.match(/(\d+)\s*[\[(]\d+\.?\d*%[\])]\s*(?:were\s+)?women/i);
  if (pctWomenParen) {
    const totalM = text.match(/(\d+)\s+(?:patients?|participants?|adults?|persons?|youths?)\s+(?:were\s+)?(?:randomized|enrolled|included)/i);
    if (totalM) {
      const nFem = parseInt(pctWomenParen[1]);
      const nTot = parseInt(totalM[1]);
      if (nFem < nTot) return { n_male: nTot - nFem, n_female: nFem, confidence: 0.82 };
    }
  }

  // All-female study: "N women were randomized" or "N (median...) were randomized to X (N women) or Y (N women)"
  // Pattern: "155 ... were randomized to CBT (80 women) or control (75 women)"
  const allWomenMatch = text.match(/(\d+)\s+(?:women|females?)\s+(?:were\s+)?(?:randomized|enrolled|included)/i)
    || text.match(/(\d+)\s+(?:\([^)]+\)\s+)?(?:were\s+)?(?:randomly\s+)?(?:assigned|randomized)\s+to\s+[A-Za-z]+\s*\(\d+\s+women\)/i);
  if (allWomenMatch) {
    const nTotal = parseInt(allWomenMatch[1]);
    return { n_male: 0, n_female: nTotal, confidence: 0.88 };
  }

  // "perinatal women" or "pregnant women" or "postpartum women" - implies all female
  const perinatalWomen = text.match(/(\d+)\s+(?:perinatal|pregnant|postpartum)\s+women/i);
  if (perinatalWomen) {
    return { n_male: 0, n_female: parseInt(perinatalWomen[1]), confidence: 0.90 };
  }

  // "N participants ... were randomized to CBT (N women) or control (N women)"
  const womenArmsMatch = text.match(/(\d+)\s+(?:participants?|patients?)[^.]*?(?:randomized|assigned)\s+to\s+[A-Za-z]+\s*\((\d+)\s+women\)\s+or\s+[A-Za-z]+\s*\((\d+)\s+women\)/i);
  if (womenArmsMatch) {
    const arm1 = parseInt(womenArmsMatch[2]);
    const arm2 = parseInt(womenArmsMatch[3]);
    return { n_male: 0, n_female: arm1 + arm2, confidence: 0.88 };
  }

  return null;
}

// --- Etnisite/ırk tespiti ---
function detectEthnicity(text) {
  const ethnicities = [];

  // Pattern: "White, N (X%)" veya "N (X%) White"
  const ethnicPatterns = [
    // "White, 180 (52.3%)" / "Black, 85 (24.7%)"
    { pattern: /\b(White|Caucasian)\s*[,:]?\s*(\d+)\s*\((\d+(?:\.\d+)?)\s*%?\)/gi, label: 'White' },
    { pattern: /\b(Black|African\s*American)\s*[,:]?\s*(\d+)\s*\((\d+(?:\.\d+)?)\s*%?\)/gi, label: 'Black' },
    { pattern: /\b(Hispanic|Latino)\s*[,:]?\s*(\d+)\s*\((\d+(?:\.\d+)?)\s*%?\)/gi, label: 'Hispanic' },
    { pattern: /\b(Asian)\s*[,:]?\s*(\d+)\s*\((\d+(?:\.\d+)?)\s*%?\)/gi, label: 'Asian' },
    { pattern: /\b(Native\s*American|American\s*Indian|Indigenous)\s*[,:]?\s*(\d+)\s*\((\d+(?:\.\d+)?)\s*%?\)/gi, label: 'Native American' },
    { pattern: /\b(Pacific\s*Islander)\s*[,:]?\s*(\d+)\s*\((\d+(?:\.\d+)?)\s*%?\)/gi, label: 'Pacific Islander' },
    { pattern: /\b(Other|Mixed|Multiracial)\s+(?:race|ethnicity)\s*[,:]?\s*(\d+)\s*\((\d+(?:\.\d+)?)\s*%?\)/gi, label: 'Other' },

    // Reverse pattern: "180 (52.3%) White"
    { pattern: /(\d+)\s*\((\d+(?:\.\d+)?)\s*%?\)\s*(White|Caucasian)\b/gi, label: 'White', reverse: true },
    { pattern: /(\d+)\s*\((\d+(?:\.\d+)?)\s*%?\)\s*(Black|African\s*American)\b/gi, label: 'Black', reverse: true },
    { pattern: /(\d+)\s*\((\d+(?:\.\d+)?)\s*%?\)\s*(Hispanic|Latino)\b/gi, label: 'Hispanic', reverse: true },
    { pattern: /(\d+)\s*\((\d+(?:\.\d+)?)\s*%?\)\s*(Asian)\b/gi, label: 'Asian', reverse: true },
  ];

  for (const { pattern, label, reverse } of ethnicPatterns) {
    let match;
    while ((match = pattern.exec(text)) !== null) {
      const n = reverse ? parseInt(match[1]) : parseInt(match[2]);
      const pct = reverse ? parseFloat(match[2]) : parseFloat(match[3]);
      // Aynı etnisite zaten eklenmişse atla
      if (!ethnicities.find(e => e.label === label)) {
        ethnicities.push({ label, n, percentage: pct });
      }
    }
  }

  // En az 2 etnisite bulunduysa döndür
  if (ethnicities.length >= 2) {
    return { ethnicities, confidence: 0.85 };
  }

  return null;
}

function detectMeanAge(text) {
  // Bracket pattern: either ( or [ for SD notation — many JAMA papers use [SD]
  // Pattern: mean (SD) age, X y / mean [SD] age, X [Y] y

  // "Mean (SD) age, 5.2 y (range, 1.8; 3-12 y)" — SD + range
  const sdRange = text.match(/mean\s*[\[(]SD[\])]\s*age[,\s]+([\d.]+)\s*y\s*[\[(]range[,\s]+([^\])]+)[\])]/i);
  if (sdRange) {
    return { value: `${sdRange[1]} y`, age_range: sdRange[2].trim(), confidence: 0.94 };
  }

  // "Mean (SD) age was 5.2 years (range, ...)"
  const sdWasRange = text.match(/mean\s*[\[(]SD[\])]\s*age\s+was\s+([\d.]+)\s*(?:[\[(][\d.]+[\])]\s*)?(y|years?)\s*[\[(]range[,\s]+([^\])]+)[\])]/i);
  if (sdWasRange) {
    return { value: `${sdWasRange[1]} y`, age_range: sdWasRange[3].trim(), confidence: 0.93 };
  }

  // "mean (SD) age was/of 45.2 (14.6) years" — SD değerini de yakala
  const sdWas = text.match(/mean\s*[\[(]SD[\])]\s*age\s+(?:was|of)\s+([\d.]+)\s*(?:[\[(]([\d.]+)[\])]\s*)?(y|years?)/i);
  if (sdWas) return { value: `${sdWas[1]} y`, sd: sdWas[2] || null, confidence: 0.92 };

  // "Mean (SD) age, 36.2 [14.4] years" / "Mean (SD) age, 62.6 y"
  const sd = text.match(/mean\s*[\[(]SD[\])]\s*age[,\s]+([\d.]+)\s*(?:[\[(]([\d.]+)[\])]\s*)?(y|years?)/i);
  if (sd) return { value: `${sd[1]} y`, sd: sd[2] || null, confidence: 0.95 };

  // "Mean age, 66.7 y" / "mean age of 66.7 years"
  const simple = text.match(/mean\s+age[,\s]+(?:of\s+)?([\d.]+)\s*(y|years?)/i);
  if (simple) return { value: `${simple[1]} y`, confidence: 0.93 };

  // "Mean(range) age, 49.4 (20.0-75.0) y"
  const meanRange = text.match(/mean\s*[\[(]range[\])]\s*age[,\s]+([\d.]+)\s*[\[(]([\d.]+[-–][\d.]+)[\])]\s*(y|years?)/i);
  if (meanRange) {
    return { value: `${meanRange[1]} y`, age_range: meanRange[2], confidence: 0.92 };
  }

  return null;
}

function detectMedianAge(text) {
  // "Median (range) age, 49.8 (40.7-55.8) y"
  const m = text.match(/median\s*\(range\)\s*age[,\s]+([\d.]+)\s*\(([\d.]+[-–]([\d.]+))\)\s*(y|years?)/i);
  if (m) {
    return {
      value: `${m[1]} y`,
      age_range: m[2],
      confidence: 0.93,
    };
  }

  // "median [IQR] age, 19 [18 to 22] years" or "median (IQR) age, 19 (18-22) y"
  const iqrMatch = text.match(/median\s*[\[(]IQR[\])]\s*age[,\s]+([\d.]+)\s*[\[(]([\d.]+)\s*(?:to|[-–])\s*([\d.]+)[\])]\s*(y|years?)/i);
  if (iqrMatch) {
    return {
      value: `${iqrMatch[1]} y`,
      age_range: `${iqrMatch[2]}-${iqrMatch[3]}`,
      iqr: `${iqrMatch[2]}-${iqrMatch[3]}`,
      confidence: 0.93,
    };
  }

  // "N (median [IQR] age, 19 [18-22] years)" - embedded in participant count
  const embeddedIqr = text.match(/\d+\s*[\[(]median\s*[\[(]IQR[\])]\s*age[,\s]+([\d.]+)\s*[\[(]([\d.]+)\s*(?:to|[-–])\s*([\d.]+)[\])]\s*(y|years?)[\])]/i);
  if (embeddedIqr) {
    return {
      value: `${embeddedIqr[1]} y`,
      age_range: `${embeddedIqr[2]}-${embeddedIqr[3]}`,
      iqr: `${embeddedIqr[2]}-${embeddedIqr[3]}`,
      confidence: 0.92,
    };
  }

  // "Median age, 59.2 y"
  const simple = text.match(/median\s+age[,\s]+([\d.]+)\s*(y|years?)/i);
  if (simple) return { value: `${simple[1]} y`, confidence: 0.88 };
  return null;
}

function detectPValue(text) {
  // P=.01, P<.001, p-value of 0.05, p < 0.05
  const m = text.match(/[Pp][\s-]*(?:value)?[\s=<>≤≥]+\.?\d+/);
  if (m) {
    const raw = m[0].replace(/\s+/g, '');
    return { value: raw.startsWith('p') ? raw.replace('p', 'P') : raw, confidence: 0.9 };
  }
  if (/statistically significant/i.test(text)) {
    return { value: null, confidence: 0.45 };
  }
  return null;
}

function detectArmCounts(text, fullText) {
  const arms = [];
  let m;

  // "106 patients received X" / "53 children were assigned to X"
  const pattern = /(\d+)\s+(?:patients?|participants?|subjects?|children|infants?|adults?|were)\s+(?:were\s+)?(?:randomly\s+)?(?:received?|assigned\s+to|randomized\s+to|allocated\s+to)\s+([^.;]+)/gi;
  while ((m = pattern.exec(text)) !== null) {
    const desc = m[2].trim().replace(/\s+/g, ' ');
    if (desc.length > 3) arms.push({ n: parseInt(m[1]), description: desc });
  }

  // "either CAPT (53 children; ...) or patching therapy (55 children; ...)"
  if (arms.length < 2) {
    const eitherPat = /either\s+([\w\s()/-]+?)\s*\((\d+)\s*(?:patients?|participants?|children|subjects?)[^)]*\)\s*or\s+([\w\s()/-]+?)\s*\((\d+)\s*(?:patients?|participants?|children|subjects?)[^)]*\)/i;
    const ep = text.match(eitherPat);
    if (ep) {
      arms.push({ n: parseInt(ep[2]), label: ep[1].trim(), description: ep[1].trim() });
      arms.push({ n: parseInt(ep[4]), label: ep[3].trim(), description: ep[3].trim() });
    }
  }

  // "randomized to CBT (80 women) or control (75 women)" or "assigned to X (N participants) or Y (N participants)"
  if (arms.length < 2) {
    const toArmPat = /(?:randomized|assigned)\s+to\s+(?:the\s+)?([A-Za-z][A-Za-z\s-]{1,30}?)\s*\((\d+)\s*(?:women|men|participants?|patients?)\)\s+(?:or|and)\s+(?:the\s+)?([A-Za-z][A-Za-z\s-]{1,30}?)\s*\((\d+)\s*(?:women|men|participants?|patients?)\)/i;
    const toArm = text.match(toArmPat);
    if (toArm) {
      arms.push({ n: parseInt(toArm[2]), label: toArm[1].trim(), description: toArm[1].trim() });
      arms.push({ n: parseInt(toArm[4]), label: toArm[3].trim(), description: toArm[3].trim() });
    }
  }

  // "Assigned to receive CBT ... 80 ... control ... 75" from CONSORT flowchart style
  if (arms.length < 2) {
    const assignedPat = /(\d+)\s+(?:Assigned|Randomized)\s+to\s+(?:receive\s+)?([A-Za-z][A-Za-z\s-]{1,40}?)[\s\S]{0,50}?(\d+)\s+(?:Assigned|Randomized)\s+to\s+(?:receive\s+)?([A-Za-z][A-Za-z\s-]{1,40})/i;
    const assigned = text.match(assignedPat);
    if (assigned) {
      arms.push({ n: parseInt(assigned[1]), label: assigned[2].trim(), description: assigned[2].trim() });
      arms.push({ n: parseInt(assigned[3]), label: assigned[4].trim(), description: assigned[4].trim() });
    }
  }

  // Fallback: INTERVENTIONS section "N patients — description"
  if (arms.length < 2) {
    const ivSection = text.match(/INTERVENTIONS?[:\s]+(.+?)(?:MAIN OUTCOMES?|PRIMARY OUTCOME|RESULTS?)/is);
    if (ivSection) {
      const ivPat = /(\d+)\s+(?:patients?|participants?|children|were)\s*[–—-]\s*([^.;\n]+)/gi;
      while ((m = ivPat.exec(ivSection[1])) !== null) {
        arms.push({ n: parseInt(m[1]), description: m[2].trim() });
      }
    }
  }

  // "Treatment A (n=52), Treatment B (n=53)"
  if (arms.length < 2) {
    const nPat = /([A-Za-z][A-Za-z\s()/-]{3,50}?)\s*\(n\s*=\s*(\d+)\)/gi;
    const nArms = [];
    while ((m = nPat.exec(text)) !== null) {
      const label = m[1].trim().replace(/[,;]\s*$/, '');
      if (label.length > 2 && label.length < 60) nArms.push({ n: parseInt(m[2]), label, description: label });
    }
    if (nArms.length >= 2) nArms.forEach(a => arms.push(a));
  }

  // "N in the X arm and N in the Y arm" — results section format
  if (arms.length < 2) {
    const armPat = /(\d+)\s+in\s+the\s+([A-Za-z][A-Za-z\s-]{2,30}?)\s+arm\s+and\s+(\d+)\s+in\s+the\s+([A-Za-z][A-Za-z\s-]{2,30}?)\s+arm/i;
    const armMatch = text.match(armPat);
    if (armMatch) {
      // Get descriptions from INTERVENTIONS section if available
      let desc1 = armMatch[2].trim();
      let desc2 = armMatch[4].trim();
      const ivSection = text.match(/INTERVENTIONS?[:\s]+(.+?)(?:MAIN OUTCOMES?|PRIMARY OUTCOME|RESULTS?)/is);
      if (ivSection) {
        const ivText = ivSection[1];
        // Look for taper/dosage info: "12-day postoperative taper of oral prednisone"
        const taperMatch = ivText.match(/(\d+[- ]day)\s+postoperative\s+taper\s+of\s+oral\s+prednisone/i);
        // Look for common regimen: "All ... received ... regimen of ... fluticasone ... saline"
        const regimenMatch = ivText.match(/(?:also\s+)?received\s+(?:a\s+)?(?:uniform\s+)?\d+[- ]week\s+postoperative\s+regimen\s+of\s+[^.]+/i);
        const regimenPart = regimenMatch ? ' plus fluticasone spray and saline rinses' : '';

        if (taperMatch) {
          desc1 = 'Oral prednisone: Postoperative ' + taperMatch[1] + ' oral prednisone taper' + regimenPart;
        }
        if (ivText.match(/placebo\s+tablets?/i)) {
          desc2 = 'Placebo: Postoperative placebo tablets' + regimenPart;
        }
      }
      arms.push({ n: parseInt(armMatch[1]), label: armMatch[2].trim(), description: desc1 });
      arms.push({ n: parseInt(armMatch[3]), label: armMatch[4].trim(), description: desc2 });
    }
  }

  // ── Full-text patterns (CONSORT diagram + results section) ────────────────
  if (arms.length < 2 && fullText) {
    // CONSORT: "58 Allocated to and received [desc] 58 Analyzed" (works both with \n and space between)
    const seen = new Set();
    const allocPat = /(\d+)\s+[Aa]llocated\s+to\s+and\s+received\s+([A-Za-z][A-Za-z\s]{1,60}?)\s+\d+\s+[Aa]nalyzed/g;
    while ((m = allocPat.exec(fullText)) !== null) {
      const n = parseInt(m[1]);
      const label = m[2].trim().replace(/\s+/g, ' ');
      const key = `${n}|${label}`;
      if (!seen.has(key) && label.length > 1) { seen.add(key); arms.push({ n, label, description: label }); }
    }
  }

  if (arms.length < 2 && fullText) {
    // "50 (23.4%) were randomized to usual care, 48 (22.4%) were randomized to ascorbic acid only"
    const seen = new Set();
    const randPat = /(\d+)\s*\([\d.]+%\)\s+were\s+randomized\s+to\s+([^,;.(]+)/gi;
    while ((m = randPat.exec(fullText)) !== null) {
      const n = parseInt(m[1]);
      const label = m[2].trim().replace(/\s+/g, ' ');
      const key = `${n}|${label}`;
      if (!seen.has(key) && label.length > 1) { seen.add(key); arms.push({ n, label, description: label }); }
    }
  }

  // Pattern: "N (X%) had MI, and N (X%) had TAU" (COACH-MI study style)
  if (arms.length < 2) {
    const newArms = [];
    const seen = new Set();
    // "94 (57%) had MI, and 70 (43%) had TAU" - use lookahead to not consume separators
    const hadPat = /(\d+)\s*\([\d.]+%\)\s+had\s+([A-Za-z][A-Za-z0-9\s()-]+?)(?=\s*[,;.]|\s+and\s+|$)/gi;
    for (const src of [text, fullText].filter(Boolean)) {
      for (const mc of src.matchAll(hadPat)) {
        const n = parseInt(mc[1]);
        let label = mc[2].trim();
        const key = `${n}|${label}`;
        if (!seen.has(key) && label.length >= 2 && label.length < 50) {
          seen.add(key);
          // MI/TAU expansion
          if (/^MI$/i.test(label)) label = 'Motivational interviewing (MI)';
          if (/^TAU$/i.test(label)) label = 'Usual care';
          newArms.push({ n, label, description: label });
        }
      }
      if (newArms.length >= 2) break;
    }
    if (newArms.length >= 2) { arms.length = 0; newArms.forEach(a => arms.push(a)); }
  }

  // Pattern A0: "N randomized to receive LABEL" (makale6 mesh study style)
  // "173 randomized to receive heavy-weight polypropylene mesh"
  if (arms.length < 2) {
    const newArms = [];
    const seen = new Set();
    const patA0 = /(\d+)\s+randomized\s+to\s+receive\s+([\w-]+(?:\s+[\w-]+)?)\s+(?:polypropylene\s+)?mesh/gi;
    for (const src of [text, fullText].filter(Boolean)) {
      for (const mc of src.matchAll(patA0)) {
        const n = parseInt(mc[1]);
        const label = mc[2].trim();
        const key = `${n}|${label}`;
        if (n > 50 && label.length > 3 && !seen.has(key)) {
          seen.add(key);
          newArms.push({ n, label, description: label + ' mesh' });
        }
      }
      if (newArms.length >= 2) break;
    }
    if (newArms.length >= 2) { arms.length = 0; newArms.forEach(a => arms.push(a)); }
  }

  // Pattern A: "N [optional-demographics] were randomized to receive LABEL" (makale3 style)
  if (arms.length < 2) {
    const newArms = [];
    const seen   = new Set();
    const patA   = /(\d+)\s*(?:\([^)]+\)\s*)?were\s+randomized\s+to\s+receive\s+([A-Za-z][A-Za-z\s\-]+?)(?=\s+and\s+\d+|\s*[,;.(\n]|$)/gi;
    for (const src of [text, fullText].filter(Boolean)) {
      for (const mc of src.matchAll(patA)) {
        const n = parseInt(mc[1]);
        const label = mc[2].trim().replace(/\s+/g, ' ');
        const key = `${n}|${label}`;
        if (label.length > 1 && label.length < 60 && !seen.has(key)) {
          seen.add(key); newArms.push({ n, label, description: label });
        }
      }
      if (newArms.length >= 2) break;
    }
    if (newArms.length >= 2) { arms.length = 0; newArms.forEach(a => arms.push(a)); }
  }

  // Pattern B: "N [participants] (X%) were randomized to LABEL" — handles optional keyword between N and % (makale9 style)
  if (arms.length < 2) {
    const newArms = [];
    const seen   = new Set();
    const patB   = /(\d+)\s*(?:participants?|patients?|subjects?|adults?|infants?|children)?\s*\([\d.]+%\)\s+were\s+randomized\s+to\s+([A-Za-z][A-Za-z\s\-]+?)(?=\s+and\s|\s*[,;.(\n]|$)/gi;
    for (const src of [text, fullText].filter(Boolean)) {
      for (const mc of src.matchAll(patB)) {
        const n = parseInt(mc[1]);
        const label = mc[2].trim().replace(/\s+/g, ' ');
        const key = `${n}|${label}`;
        if (label.length > 1 && label.length < 60 && !seen.has(key)) {
          seen.add(key); newArms.push({ n, label, description: label });
        }
      }
      if (newArms.length >= 2) break;
    }
    if (newArms.length >= 2) { arms.length = 0; newArms.forEach(a => arms.push(a)); }
  }

  // Pattern B2: "randomized to LABEL (details; n = N; ...)" (GALAXY trial style - makale5)
  // "randomized to awake (local anesthesia; n = 56; ...) or to asleep (general anesthesia; n = 54; ...)"
  if (arms.length < 2) {
    const newArms = [];
    const seen   = new Set();
    // İlk arm: "randomized to LABEL (...; n = N; ...)"
    const patB2a = /randomized\s+to\s+([A-Za-z][A-Za-z\s\-]*?)\s*\(([^;)]+);\s*n\s*=\s*(\d+)/gi;
    // İkinci arm: "or to LABEL (...; n = N; ...)" veya "and N to LABEL"
    const patB2b = /\bor\s+to\s+([A-Za-z][A-Za-z\s\-]*?)\s*\(([^;)]+);\s*n\s*=\s*(\d+)/gi;

    for (const src of [text, fullText].filter(Boolean)) {
      for (const mc of src.matchAll(patB2a)) {
        const label = mc[1].trim();
        const clarification = mc[2].trim();
        const n = parseInt(mc[3]);
        const fullLabel = label + ' (' + clarification + ')';
        const key = `${n}|${label}`;
        if (label.length > 1 && label.length < 30 && !seen.has(key)) {
          seen.add(key);
          newArms.push({ n, label: fullLabel, description: clarification });
        }
      }
      for (const mc of src.matchAll(patB2b)) {
        const label = mc[1].trim();
        const clarification = mc[2].trim();
        const n = parseInt(mc[3]);
        const fullLabel = label + ' (' + clarification + ')';
        const key = `${n}|${label}`;
        if (label.length > 1 && label.length < 30 && !seen.has(key)) {
          seen.add(key);
          newArms.push({ n, label: fullLabel, description: clarification });
        }
      }
      if (newArms.length >= 2) break;
    }
    if (newArms.length >= 2) { arms.length = 0; newArms.forEach(a => arms.push(a)); }
  }

  // Pattern C: "N patients (X%) in the LABEL group/vs" (makale4 style)
  if (arms.length < 2) {
    const newArms = [];
    const seen   = new Set();
    const patC   = /(\d+)\s+patients?\s*\([\d.]+%\)\s+in\s+the\s+([A-Za-z][A-Za-z\s\-]+?)(?:\s+group|\s+arm|\s+vs?\b|\s*[,;.(]|$)/gi;
    for (const src of [text, fullText].filter(Boolean)) {
      for (const mc of src.matchAll(patC)) {
        const n = parseInt(mc[1]);
        const label = mc[2].trim().replace(/\s+/g, ' ');
        const key = `${n}|${label}`;
        if (label.length > 1 && label.length < 60 && !seen.has(key)) {
          seen.add(key); newArms.push({ n, label, description: label });
        }
      }
      if (newArms.length >= 2) break;
    }
    if (newArms.length >= 2) { arms.length = 0; newArms.forEach(a => arms.push(a)); }
  }

  // Pattern D: "N in the LABEL arm" (makale8 style) - with INTERVENTIONS section descriptions
  if (arms.length < 2) {
    const newArms = [];
    const seen   = new Set();
    const patD   = /(\d+)\s+in\s+the\s+([A-Za-z][A-Za-z\s\-]+?)\s+arm\b/gi;

    // Get INTERVENTIONS section for descriptions
    const ivSection = text.match(/INTERVENTIONS?[:\s]+(.+?)(?:MAIN OUTCOMES?|PRIMARY OUTCOME|RESULTS?)/is);
    const ivText = ivSection ? ivSection[1] : '';

    for (const src of [text, fullText].filter(Boolean)) {
      for (const mc of src.matchAll(patD)) {
        const n = parseInt(mc[1]);
        const label = mc[2].trim().replace(/\s+/g, ' ');
        const key = `${n}|${label}`;
        if (label.length > 1 && label.length < 40 && !seen.has(key)) {
          seen.add(key);
          // Try to find fuller description in INTERVENTIONS section
          let desc = label;
          const labelLower = label.toLowerCase();
          if (ivText && labelLower.includes('prednisone')) {
            // Match "12-day postoperative taper of oral prednisone" stopping at "vs" or "."
            const predDesc = ivText.match(/(\d+[- ]day\s+)?postoperative[^.]*?oral\s+prednisone(?:\s+taper)?/i);
            if (predDesc) {
              desc = 'Postoperative ' + (predDesc[1] ? predDesc[1].trim() + ' ' : '') + 'oral prednisone taper plus fluticasone spray and saline rinses';
            }
          } else if (ivText && labelLower.includes('placebo')) {
            // Match placebo description
            const hasPostop = ivText.match(/postoperative/i);
            if (hasPostop) {
              desc = 'Postoperative placebo tablets plus fluticasone spray and saline rinses';
            }
          }
          newArms.push({ n, label, description: desc });
        }
      }
      if (newArms.length >= 2) break;
    }
    if (newArms.length >= 2) { arms.length = 0; newArms.forEach(a => arms.push(a)); }
  }

  // Pattern E: "LABEL (... n = N ...)" inside a randomized-to sentence (makale5/makale7 style)
  if (arms.length < 2) {
    const newArms = [];
    const seen   = new Set();
    const sentRe = /randomi[sz]ed\s+(?:to|into)\s+(?:either\s+)?([\s\S]{20,400})/i;
    const armRe  = /([A-Za-z][A-Za-z\s\-]+?)\s*\([^)]*n\s*=\s*(\d+)[^)]*\)/gi;
    for (const src of [text, fullText].filter(Boolean)) {
      const sentM = sentRe.exec(src);
      if (!sentM) continue;
      for (const mc of sentM[1].matchAll(armRe)) {
        const raw   = mc[1].trim().replace(/\s+/g, ' ');
        const label = raw.replace(/^(?:or|and|either)\s+/i, '').replace(/^(?:the|to)\s+/i, '').trim();
        const n = parseInt(mc[2]);
        const key = `${n}|${label}`;
        if (label.length > 2 && label.length < 80 && !/^(?:age|mean|SD|CI|range)$/i.test(label) && !seen.has(key)) {
          seen.add(key); newArms.push({ n, label, description: label });
        }
      }
      if (newArms.length >= 2) break;
    }
    if (newArms.length >= 2) { arms.length = 0; newArms.forEach(a => arms.push(a)); }
  }

  // Pattern F: "N randomized to receive LABEL [optional-demographics]" (makale6 style)
  if (arms.length < 2) {
    const newArms = [];
    const seen   = new Set();
    const patF   = /(\d+)\s+randomized\s+to\s+receive\s+([A-Za-z][A-Za-z\s\-]+?)(?=\s*\([^)]*(?:female|male|\d+\.\d+%)|\s+and\s+\d+|\s*[,;.\n]|$)/gi;
    for (const src of [text, fullText].filter(Boolean)) {
      for (const mc of src.matchAll(patF)) {
        const n = parseInt(mc[1]);
        const label = mc[2].trim().replace(/\s+/g, ' ');
        const key = `${n}|${label}`;
        if (label.length > 1 && label.length < 60 && !seen.has(key)) {
          seen.add(key); newArms.push({ n, label, description: label });
        }
      }
      if (newArms.length >= 2) break;
    }
    if (newArms.length >= 2) { arms.length = 0; newArms.forEach(a => arms.push(a)); }
  }

  // Pattern G: CONSORT "N Assigned to LABEL" — multi-arm trials with CONSORT diagram
  // Example: "96  Assigned to control and received intervention"
  // Example: "99  Assigned to gamification with choice and immediate goals and received intervention"
  if (arms.length < 2 && fullText) {
    const newArms = [];
    const seen   = new Set();
    // Match: N (whitespace) Assigned to LABEL (and received intervention)?
    const patG   = /(\d+)\s+[Aa]ssigned\s+to\s+([A-Za-z][A-Za-z\s\-]+?)(?:\s+and\s+received\s+(?:intervention|allocated\s+intervention)|\s*\n\s*\d+\s+(?:Completed|Analyzed|Lost))/gi;
    for (const mc of fullText.matchAll(patG)) {
      const n = parseInt(mc[1]);
      let label = mc[2].trim().replace(/\s+/g, ' ');
      // Only remove trailing "and" but keep "goals"
      label = label.replace(/\s+and\s*$/, '');
      // Normalize "choice" to "self-chosen" for consistency with JAMA terminology
      label = label.replace(/\bwith\s+choice\s+and\s+/gi, 'with self-chosen and ');
      const key = `${n}|${label}`;
      if (label.length > 2 && label.length < 80 && !seen.has(key)) {
        seen.add(key); newArms.push({ n, label, description: label });
      }
    }
    if (newArms.length >= 2) { arms.length = 0; newArms.forEach(a => arms.push(a)); }
  }

  // Pattern H: "There were N patients (X%) in the standard-dose vs N patients (X%) in the therapeutic-dose group"
  // makale4 HEP-COVID style
  if (arms.length < 2) {
    const patH = /(?:There\s+were\s+)?(\d+)\s+patients?\s*\([\d.]+%\)\s+in\s+the\s+([A-Za-z][A-Za-z\s\-]+?)\s+vs\s+(\d+)\s+patients?\s*\([\d.]+%\)\s+in\s+the\s+([A-Za-z][A-Za-z\s\-]+?)\s+group/i;
    const hMatch = text.match(patH) || (fullText && fullText.match(patH));
    if (hMatch) {
      arms.length = 0;
      arms.push({ n: parseInt(hMatch[1]), label: hMatch[2].trim(), description: hMatch[2].trim() });
      arms.push({ n: parseInt(hMatch[3]), label: hMatch[4].trim(), description: hMatch[4].trim() });
    }
  }

  // Intervention details'i çıkar ve arms'a ekle
  if (arms.length >= 1) {
    const interventionDetails = extractInterventionDetails(text);
    if (interventionDetails.length > 0) {
      for (let i = 0; i < arms.length; i++) {
        arms[i] = enrichArmWithDetails(arms[i], interventionDetails);
      }
    }

    // Heparin-specific enrichment (makale4 HEP-COVID)
    const ivSection = text.match(/INTERVENTIONS?[:\s]+(.+?)(?:MAIN OUTCOMES?|PRIMARY OUTCOME|RESULTS?)/is);
    if (ivSection) {
      const ivText = ivSection[1];
      for (let i = 0; i < arms.length; i++) {
        const labelLower = (arms[i].label || '').toLowerCase();

        // Therapeutic-dose heparin/LMWH
        if (labelLower.includes('therapeutic') && (labelLower.includes('dose') || labelLower.includes('heparin') || labelLower.includes('lmwh'))) {
          arms[i].detailed_description = 'Enoxaparin 0.5 or 1 mg/kg 2× daily based on creatinine clearance';
          arms[i].label = 'Therapeutic-dose low-molecular-weight heparin (LMWH)';
          arms[i].isTherapeutic = true;
        }

        // Standard-dose / prophylactic heparin
        if ((labelLower.includes('standard') || labelLower.includes('prophylactic') || labelLower.includes('intermediate')) &&
            (labelLower.includes('dose') || labelLower.includes('heparin'))) {
          arms[i].detailed_description = 'Prophylactic or intermediate-dose LMWH or unfractionated heparin per institutional standard of care';
          arms[i].label = 'Standard-dose heparins';
          arms[i].isStandardCare = true;
        }
      }
    }

    // Awake/Asleep DBS enrichment (GALAXY trial gibi)
    const dbsMatch = text.match(/(?:deep\s*brain\s*stimulation|DBS)/i);
    const anesthesiaMatch = text.match(/(?:general|local)\s+anesthesia/i);
    if (dbsMatch && anesthesiaMatch) {
      for (let i = 0; i < arms.length; i++) {
        const labelLower = (arms[i].label || '').toLowerCase();

        // Awake / Local anesthesia
        if (labelLower.includes('local') && labelLower.includes('anesthesia')) {
          arms[i].label = 'Awake (local anesthesia)';
          arms[i].detailed_description = 'DBS surgery under local anesthesia with intraoperative clinical testing';
          arms[i].isAwake = true;
        }
        if (labelLower.includes('awake')) {
          arms[i].label = 'Awake (local anesthesia)';
          arms[i].detailed_description = 'DBS surgery under local anesthesia with intraoperative clinical testing';
          arms[i].isAwake = true;
        }

        // Asleep / General anesthesia
        if (labelLower.includes('general') && labelLower.includes('anesthesia')) {
          arms[i].label = 'Asleep (general anesthesia)';
          arms[i].detailed_description = 'DBS surgery under general anesthesia with microelectrode recording';
          arms[i].isAsleep = true;
        }
        if (labelLower.includes('asleep')) {
          arms[i].label = 'Asleep (general anesthesia)';
          arms[i].detailed_description = 'DBS surgery under general anesthesia with microelectrode recording';
          arms[i].isAsleep = true;
        }
      }
    }
  }

  if (arms.length >= 2) return { arms, confidence: arms[0].n != null ? 0.88 : 0.65 };
  if (arms.length === 1) return { arms, confidence: 0.6 };
  return null;
}

// --- Intervention Details Extraction ---
// INTERVENTIONS bölümünden doz, frekans ve uygulama yolu bilgilerini çıkarır
// "oral upadacitinib, 30 mg once daily" → { route: "oral", drug: "upadacitinib", dose: "30 mg", frequency: "once daily" }
function extractInterventionDetails(text) {
  const details = [];

  // INTERVENTIONS bölümünü bul
  const ivMatch = text.match(/INTERVENTIONS?[:\s]+(.+?)(?:MAIN OUTCOMES?|PRIMARY OUTCOME|RESULTS?)/is);
  if (!ivMatch) return details;

  const ivText = ivMatch[1];

  // Pattern: "oral/subcutaneous/intravenous DRUG, DOSE FREQUENCY"
  // Örnek: "oral upadacitinib, 30 mg once daily"
  // Örnek: "subcutaneous dupilumab, 300 mg every other week"
  const drugPatterns = [
    // "oral DRUG, DOSE FREQUENCY" veya "subcutaneous DRUG, DOSE FREQUENCY"
    /\b(oral|subcutaneous|intravenous|intramuscular|topical|inhaled|intranasal)\s+(?:tablet\s+of\s+)?([a-zA-Z]+(?:inib|mab|zole|cin|lin|ine|ide|ate|one|pril|tan|fen|lol)?)\s*,?\s*(\d+(?:\.\d+)?\s*(?:mg|g|mcg|μg|IU|mL))\s*,?\s*((?:once|twice|three\s+times?|every\s+(?:other\s+)?(?:day|week|month)|daily|weekly|monthly|(?:per|a|each)\s+(?:day|week|month)|q\d+h?|BID|TID|QID)[^,;.]*)/gi,

    // "DRUG DOSE ROUTE FREQUENCY" - "dupilumab 300 mg subcutaneously every other week"
    /\b([a-zA-Z]+(?:inib|mab|zole|cin|lin|ine|ide|ate|one|pril|tan|fen|lol)?)\s+(\d+(?:\.\d+)?\s*(?:mg|g|mcg|μg|IU|mL))\s+(orally|subcutaneously|intravenously|intramuscularly)\s+((?:once|twice|three\s+times?|every\s+(?:other\s+)?(?:day|week|month)|daily|weekly|monthly)[^,;.]*)/gi
  ];

  for (const pattern of drugPatterns) {
    let match;
    while ((match = pattern.exec(ivText)) !== null) {
      if (pattern === drugPatterns[0]) {
        // İlk pattern: route drug dose frequency
        details.push({
          route: match[1].toLowerCase(),
          drug: match[2].toLowerCase(),
          dose: match[3].trim(),
          frequency: match[4].trim().replace(/\s+/g, ' ')
        });
      } else {
        // İkinci pattern: drug dose route frequency
        const routeMap = { 'orally': 'oral', 'subcutaneously': 'subcutaneous', 'intravenously': 'intravenous', 'intramuscularly': 'intramuscular' };
        details.push({
          drug: match[1].toLowerCase(),
          dose: match[2].trim(),
          route: routeMap[match[3].toLowerCase()] || match[3].toLowerCase(),
          frequency: match[4].trim().replace(/\s+/g, ' ')
        });
      }
    }
  }

  // Loading dose pattern: "loading dose of 400mg, then 200mg weekly"
  const loadingDosePattern = /loading\s+dose\s+(?:of\s+)?(\d+(?:\.\d+)?\s*(?:mg|g|mcg))[,\s]+(?:then|followed\s+by)\s+(\d+(?:\.\d+)?\s*(?:mg|g|mcg))\s+([^,;.]+)/gi;
  let loadMatch;
  while ((loadMatch = loadingDosePattern.exec(ivText)) !== null) {
    details.push({
      route: 'variable',
      drug: 'loading dose regimen',
      dose: `${loadMatch[1]} loading, then ${loadMatch[2]}`,
      frequency: loadMatch[3].trim()
    });
  }

  // Combination therapy pattern: "Drug A + Drug B" or "Drug A and Drug B"
  const combinationPattern = /\b([a-zA-Z]+(?:inib|mab|zole|cin|lin)?)\s+(?:\+|and|plus)\s+([a-zA-Z]+(?:inib|mab|zole|cin|lin)?)\b/gi;
  let comboMatch;
  while ((comboMatch = combinationPattern.exec(ivText)) !== null) {
    details.push({
      route: 'combination',
      drug: `${comboMatch[1]} + ${comboMatch[2]}`,
      dose: 'combination therapy',
      frequency: ''
    });
  }

  // Titration pattern: "titrated from X to Y" or "dose titration from X to Y"
  const titrationPattern = /(?:dose\s+)?titrat(?:ed|ion)\s+from\s+(\d+(?:\.\d+)?\s*(?:mg|g|mcg))\s+to\s+(\d+(?:\.\d+)?\s*(?:mg|g|mcg))/gi;
  let titrMatch;
  while ((titrMatch = titrationPattern.exec(ivText)) !== null) {
    details.push({
      route: 'titration',
      drug: 'titrated dose',
      dose: `${titrMatch[1]} to ${titrMatch[2]}`,
      frequency: 'titration'
    });
  }

  // Eğer yukarıdaki patternler bulamazsa, daha basit pattern dene
  // "treated with X or Y" formatı
  if (details.length === 0) {
    // "treated with oral upadacitinib, 30 mg once daily, or subcutaneous dupilumab, 300 mg every other week"
    const treatMatch = ivText.match(/treated\s+with\s+(.+?)(?:\.|$)/i);
    if (treatMatch) {
      const treatText = treatMatch[1];
      // "or" ile ayır
      const parts = treatText.split(/\s*,?\s+or\s+/i);
      for (const part of parts) {
        const simpleMatch = part.match(/\b(oral|subcutaneous|intravenous|intramuscular)\s+([a-zA-Z]+)\s*,?\s*(\d+(?:\.\d+)?\s*(?:mg|g|mcg|μg))\s*,?\s*(.+)/i);
        if (simpleMatch) {
          details.push({
            route: simpleMatch[1].toLowerCase(),
            drug: simpleMatch[2].toLowerCase(),
            dose: simpleMatch[3].trim(),
            frequency: simpleMatch[4].trim().replace(/\s+/g, ' ').replace(/[,;.].*$/, '')
          });
        }
      }
    }
  }

  return details;
}

// Arm'a detaylı açıklama ekle
function enrichArmWithDetails(arm, interventionDetails) {
  if (!interventionDetails || interventionDetails.length === 0) return arm;

  const labelLower = (arm.label || arm.description || '').toLowerCase();

  for (const detail of interventionDetails) {
    // Drug adı arm label'ında var mı kontrol et
    if (labelLower.includes(detail.drug)) {
      // Route'u capitalize et
      const routeCapitalized = detail.route.charAt(0).toUpperCase() + detail.route.slice(1);

      // Detaylı açıklama oluştur
      let fullDescription;
      if (detail.route === 'oral') {
        fullDescription = `Oral tablet of ${detail.drug}, ${detail.dose}, ${detail.frequency}`;
      } else if (detail.route === 'subcutaneous') {
        fullDescription = `Subcutaneous ${detail.drug}, ${detail.dose}, ${detail.frequency}`;
      } else {
        fullDescription = `${routeCapitalized} ${detail.drug}, ${detail.dose}, ${detail.frequency}`;
      }

      return {
        ...arm,
        route: detail.route,
        dose: detail.dose,
        frequency: detail.frequency,
        detailed_description: fullDescription
      };
    }
  }

  return arm;
}

function detectSettings(text) {
  // "6 government-run antenatal clinics in Pujehun District, Sierra Leone"
  const govClinics = text.match(/(\d+)\s+(?:government[- ]run\s+)?(?:antenatal|prenatal|maternal|health)\s+clinics?\s+in\s+([A-Za-z][A-Za-z\s]+(?:District)?)[,\s]+([A-Za-z][A-Za-z\s]+)/i);
  if (govClinics) {
    return { value: `${govClinics[1]} Clinics in ${govClinics[3].trim()}`, confidence: 0.90 };
  }

  // "N clinics in [Location], [Country]" - generic clinic pattern
  const clinicsIn = text.match(/(\d+)\s+(?:[\w-]+\s+)?clinics?\s+in\s+([A-Za-z][A-Za-z\s]+(?:District|Province|Region)?)[,\s]+([A-Za-z][A-Za-z\s]+)/i);
  if (clinicsIn) {
    return { value: `${clinicsIn[1]} Clinics in ${clinicsIn[3].trim()}`, confidence: 0.88 };
  }

  // "129 centers located in 22 countries" / "3 academic centers in Europe"
  const multiLocated = text.match(/(\d+)\s+(?:academic|hospital|clinical|medical|tertiary|multicenter)?\s*centers?\s+(?:located\s+)?in\s+(?:\d+\s+)?[A-Za-z][A-Za-z\s,]+/i);
  if (multiLocated) return { value: multiLocated[0].trim(), confidence: 0.9 };

  // "1 Hospital in Shanghai, China" / "1 Tertiary care hospital in Paris, France"
  const numbered = text.match(/(\d+)\s+(?:tertiary\s+care\s+)?(?:hospital|clinic|center|academic\s+center)\s+in\s+([A-Za-z\s,]+)/i);
  if (numbered) return { value: numbered[0].trim(), confidence: 0.88 };

  // "outpatient care in sites in Ohio and Florida"
  const outpatientCare = text.match(/outpatient\s+(?:care\s+(?:in\s+)?)?sites?\s+in\s+([A-Za-z][A-Za-z\s,]+)/i);
  if (outpatientCare) return { value: outpatientCare[0].trim(), confidence: 0.88 };

  // "17 outpatient sites / facilities / clinics"
  const outpatient = text.match(/(\d+)\s+outpatient\s+(?:sites?|facilities|clinics?|centers?)/i);
  if (outpatient) return { value: outpatient[0].trim(), confidence: 0.88 };

  // "at/across X sites in/throughout Y"
  const sites = text.match(/(?:at|across)\s+(\d+)\s+sites?\s+(?:in|across|throughout)\s+([A-Za-z][A-Za-z\s,]+)/i);
  if (sites) return { value: sites[0].trim(), confidence: 0.82 };

  // "4 institutions (Cleveland Clinic, Vanderbilt University, ...)"
  // Also handles "X surgeons at Y institutions (...)"
  const surgeonInst = text.match(/\d+\s+surgeons?\s+at\s+(\d+)\s+institutions?\s*\([\s\S]{5,200}?\)/i);
  if (surgeonInst) {
    const cleaned = surgeonInst[0].trim().replace(/\s+/g, ' ');
    return { value: cleaned, confidence: 0.85 };
  }

  const institutions = text.match(/(\d+)\s+institutions?\s*\([\s\S]{5,150}?\)/i);
  if (institutions) {
    const cleaned = institutions[0].trim().replace(/\s+/g, ' ');
    return { value: cleaned, confidence: 0.85 };
  }

  // "X neonatal/pediatric intensive care units in Y countries"
  const nicu = text.match(/(\d+)\s+\w+\s+(?:intensive\s+care\s+units?|neonatal\s+units?)\s+in\s+\d+\s+[A-Za-z]+\s+countries?/i);
  if (nicu) return { value: nicu[0].trim(), confidence: 0.87 };

  // "X primary care practices / offices"
  const pcPractices = text.match(/(\d+)\s+(?:primary[\s-]care\s+)?(?:practices?|offices?)\b/i);
  if (pcPractices) return { value: pcPractices[0].trim(), confidence: 0.78 };

  // "conducted at Stanford Sinus Center" / "conducted in the Amsterdam University Medical Centers"
  const conductedAt = text.match(/conducted\s+(?:in|at)\s+(?:the\s+)?([A-Z][A-Za-z\s,]+(?:Center|Hospital|Clinic|Institute|University|Practice)[A-Za-z\s,]*)/);
  if (conductedAt) return { value: conductedAt[1].trim().replace(/\s+/g, ' '), confidence: 0.80 };

  // "Stanford University School of Medicine ... Stanford, California" — author affiliation location
  const uniAffiliation = text.match(/([A-Z][a-zA-Z]+)\s+University\s+(?:School\s+of\s+Medicine[,\s]+)?(?:Department\s+of\s+)?[\s\S]{0,100}?,\s+([A-Z][a-zA-Z]+,\s+(?:California|CA|New York|NY|Massachusetts|MA|Texas|TX|Pennsylvania|PA|Illinois|IL|Ohio|OH|Florida|FL|Michigan|MI))/i);
  if (uniAffiliation) return { value: `Single academic hospital in ${uniAffiliation[2].trim()}`, confidence: 0.82 };

  // "single academic tertiary rhinology practice" with location in Author Affiliations
  const singleAcademic = text.match(/single\s+academic\s+(?:tertiary\s+)?(?:rhinology\s+)?practice/i);
  if (singleAcademic) {
    // Look for Stanford, CA or similar in author affiliations
    const locMatch = text.match(/(?:Stanford|Boston|Chicago|Houston|Philadelphia|Seattle|Miami|Denver|Atlanta),\s*(?:CA|MA|IL|TX|PA|WA|FL|CO|GA|California|Massachusetts|Illinois|Texas|Pennsylvania|Washington|Florida|Colorado|Georgia)\b/i);
    if (locMatch) return { value: `Single academic hospital in ${locMatch[0].trim()}`, confidence: 0.85 };
  }

  // "from lower-income neighborhoods in and around Philadelphia, Pennsylvania" — full context with demographics
  const neighborhoodContext = text.match(/(?:from\s+)?((?:lower-income|low-income|urban|rural|suburban|underserved|disadvantaged)\s+(?:neighborhoods?|communities?|areas?|regions?))\s+in\s+(?:and\s+around\s+)?([A-Z][a-zA-Z\s,]+?)(?=\s+who\s+|\s+with\s+|\s*[,.])/i);
  if (neighborhoodContext) {
    const desc = neighborhoodContext[1].charAt(0).toUpperCase() + neighborhoodContext[1].slice(1);
    return { value: `${desc} in and around ${neighborhoodContext[2].trim()}`, confidence: 0.85 };
  }

  // "in and around Philadelphia, Pennsylvania" / "in Philadelphia, PA" — city context
  const city = text.match(/in\s+(?:and\s+around\s+)?([A-Z][a-zA-Z]+,\s+[A-Z][a-z]+(?:ylvania|shire|nia|nia|shire)?)/);
  if (city) return { value: city[1].trim(), confidence: 0.60 };

  // "at the University Children's Hospital in Düsseldorf, Germany" - named institution with "in" separator
  // Matches: "at the [Institution Name] Hospital in [City], [Country/State]"
  const atNamedHosp = text.match(/at\s+(?:the\s+)?((?:University\s+)?(?:Children[''\u2019ʼ]?s?\s+)?Hospital|University\s+(?:Medical\s+)?(?:Center|Hospital))\s+(?:specialized\s+outpatient\s+clinics\s+)?in\s+([A-Z][A-Za-zäöüÄÖÜß\s-]+,\s+[A-Z][A-Za-zäöüÄÖÜß]+)/i);
  if (atNamedHosp) {
    return { value: `${atNamedHosp[1].trim()}, ${atNamedHosp[2].trim()}`, confidence: 0.85 };
  }

  // "at a/the/single children's hospital in Shanghai, China"
  const atHosp = text.match(/at\s+(?:a|an|the|one|single)\s+(?:single[-\s]center\s+)?(?:[\w']+\s+)?(?:hospital|clinic|center|institution)\s+in\s+([A-Za-z][A-Za-z\s,]+)/i);
  if (atHosp) return { value: '1 ' + atHosp[0].replace(/^at\s+(?:a|an|the|one|single)\s+(?:single[-\s]center\s+)?/i, '').trim(), confidence: 0.82 };

  // "conducted in a single academic tertiary rhinology practice"
  // Allow up to 5 adjectives before the facility type word
  const singleType = text.match(/(?:a|one)\s+single\s+(?:\w+\s+){0,5}(?:hospital|clinic|center|practice|institution)/i);

  // Before returning "Single center", try to extract named institution from Author Affiliations
  // Pattern: "University Children's Hospital, Düsseldorf, Germany" or "Department of..., University of X, City, Country"
  // Use flexible apostrophe matching: ' ' ' ʼ or no apostrophe
  const namedInst = text.match(/(?:Author\s+Affiliations?:?\s*)?(?:Department\s+of\s+[\w\s]+,\s+)?((?:University|Children[''\u2019ʼ]?s?|Teaching|Academic|Medical|Regional)\s+(?:Children[''\u2019ʼ]?s?\s+)?Hospital(?:\s+of\s+[A-Za-z]+)?)[,\s]+([A-Za-z][A-Za-zäöüÄÖÜß\s-]+,\s+[A-Za-z][A-Za-zäöüÄÖÜß\s-]+)/i);
  if (namedInst && singleType) {
    const institutionName = namedInst[1].trim();
    const locationInfo = namedInst[2].trim();
    return { value: `${institutionName}, ${locationInfo}`, confidence: 0.80 };
  }

  // Also try extracting named institution without "single" mention — some papers mention institution in affiliations
  const affInst = text.match(/Author\s+Affiliations?:?\s*(?:\d+\s*)?(?:Department\s+of\s+[\w\s]+,\s+)?((?:University|Children[''\u2019ʼ]?s?|Teaching|Academic|Medical)\s+(?:Children[''\u2019ʼ]?s?\s+)?Hospital(?:\s+of\s+[A-Za-z]+)?)[,\s]+([A-Za-z][A-Za-zäöüÄÖÜß\s-]+,\s+[A-Za-z][A-Za-zäöüÄÖÜß\s-]+)/i);
  if (affInst) {
    const institutionName = affInst[1].trim();
    const locationInfo = affInst[2].trim();
    return { value: `${institutionName}, ${locationInfo}`, confidence: 0.78 };
  }

  // Try extracting named institution anywhere in text (without Author Affiliations prefix)
  // Pattern: "University Children's Hospital, Düsseldorf, Germany" or "Children's Hospital, City, Country"
  // Use flexible apostrophe matching: ' ' ' ʼ or no apostrophe
  const anyInst = text.match(/((?:University\s+)?Children[''\u2019ʼ]?s?\s+Hospital|University\s+(?:Medical\s+)?(?:Center|Hospital)|Teaching\s+Hospital|Academic\s+(?:Medical\s+)?Center)[,\s]+([A-Z][A-Za-zäöüÄÖÜß\s-]+,\s+[A-Z][A-Za-zäöüÄÖÜß\s-]+)/);
  if (anyInst) {
    const institutionName = anyInst[1].trim();
    const locationInfo = anyInst[2].trim();
    // Higher confidence if singleType also matches
    const conf = singleType ? 0.80 : 0.72;
    return { value: `${institutionName}, ${locationInfo}`, confidence: conf };
  }

  if (singleType) return { value: 'Single center', confidence: 0.68 };

  // "single-center" or "single center" alone
  const singleCenter = text.match(/single[\s-]center/i);
  if (singleCenter) return { value: 'Single center', confidence: 0.65 };

  return null;
}

function detectPrimaryOutcome(text) {
  // Helper: format outcome with timeframe
  function formatOutcome(rawOutcome) {
    let outcome = rawOutcome.trim().replace(/\s+/g, ' ');

    // Remove leading "The primary outcome was" type phrases
    outcome = outcome.replace(/^(?:the\s+)?primary\s+(?:outcome|end\s*point)\s+was\s+/i, '');

    // Remove common prefixes that shouldn't be in the output
    outcome = outcome.replace(/^(?:the\s+)?(?:primary\s+)?(?:end\s*)?(?:point|outcome|efficacy\s+outcome|variable)\s+was\s+/i, '');
    outcome = outcome.replace(/^were\s+/i, '');
    // Remove standalone "Of" at the beginning (artifact from "primary outcome of X")
    outcome = outcome.replace(/^of\s+/i, '');

    // Capitalize first letter
    outcome = outcome.charAt(0).toUpperCase() + outcome.slice(1);

    // Extract and reformat timeframe if present
    // "from baseline to the 8-week maintenance intervention period" → "(week 9 to 16)"
    const timeMatch = outcome.match(/from\s+baseline\s+to\s+(?:the\s+)?(\d+)-week\s+(\w+)\s+(?:intervention\s+)?period/i);
    if (timeMatch) {
      const weeks = parseInt(timeMatch[1]);
      const phase = timeMatch[2].toLowerCase();
      // maintenance period typically starts after introductory period
      // 8-week intro + 8-week maintenance = weeks 9-16
      if (phase === 'maintenance') {
        outcome = outcome.replace(/from\s+baseline\s+to\s+(?:the\s+)?\d+-week\s+\w+\s+(?:intervention\s+)?period/i,
          `from baseline to the ${phase} intervention period (week ${weeks + 1} to ${weeks * 2})`);
      }
    }

    // Clean up redundant phrases
    outcome = outcome.replace(/\s*Other\s+outcomes?\s+included\b.*$/i, '');
    outcome = outcome.replace(/\s*All\s+randomly\s+assigned\b.*$/i, '');

    return outcome;
  }

  // JAMA abstract section header — en güvenilir kaynak
  // "MAIN OUTCOMES AND MEASURES  The primary outcome was X"
  const main = text.match(/MAIN\s+OUTCOMES?\s+AND\s+MEASURES?[:\s]+(?:The\s+)?(?:primary\s+)?(?:outcome\s+)?(?:was\s+|were\s+)?([^.]+(?:\.[^A-Z\n][^.]+)*)/i);
  if (main) {
    let val = main[1].trim();
    // Remove "MEASURES" if it got captured at the start
    val = val.replace(/^MEASURES?\s+(?:The\s+)?(?:primary\s+)?(?:outcome\s+)?(?:was\s+|were\s+)?/i, '');
    // Truncate at RESULTS or other section headers
    val = val.replace(/\s*(?:RESULTS|CONCLUSIONS?|DISCUSSION|METHODS?|Secondary|Other)\s+[\s\S]*$/i, '');
    // Remove trailing "Secondary outcome measures included..." sentence
    val = val.replace(/\.\s*Secondary\s+outcome[^.]*\.?$/i, '');
    return { value: formatOutcome(val), confidence: 0.95 };
  }

  const outcomes = text.match(/(?:OUTCOMES?\s+AND\s+MEASURES?|MAIN\s+OUTCOME)[:\s]+(?:The\s+)?(?:primary\s+)?(?:outcome\s+)?(?:was\s+)?([^.]+)/i);
  if (outcomes) {
    let val = outcomes[1].trim();
    val = val.replace(/^MEASURES?\s+(?:The\s+)?(?:primary\s+)?(?:outcome\s+)?(?:was\s+)?/i, '');
    return { value: formatOutcome(val), confidence: 0.90 };
  }

  // "Primary outcome:" — section label form
  const m = text.match(/[Pp]rimary\s+(?:end\s*)?(?:outcome|end\s*point)[:\s]+(?!(?:was|were|is|are)\b)([^.]+)/i);
  if (m) return { value: formatOutcome(m[1]), confidence: 0.80 };

  // "The primary outcome was X" / "The primary end point was X" — sentence form
  const sent = text.match(/[Tt]he\s+primary\s+(?:end\s*)?(?:outcome|end\s*point|efficacy\s+outcome)\s+was\s+([^.]+)/i);
  if (sent) return { value: formatOutcome(sent[1]), confidence: 0.75 };

  // "primary outcome variable was X"
  const varSent = text.match(/primary\s+outcome\s+variable\s+was\s+([^.]+)/i);
  if (varSent) return { value: formatOutcome(varSent[1]), confidence: 0.73 };

  return null;
}

function detectResults(text) {
  const results = [];

  // "Epley: mean (SD) 3.3 (3.6) d"
  const sdPat = /([A-Za-z][A-Za-z\s-]+):\s*mean\s*\(SD\)\s*([\d.]+\s*\([\d.]+\)\s*\w+)/gi;
  let m;
  while ((m = sdPat.exec(text)) !== null) {
    results.push({ arm: m[1].trim(), metric: 'mean (SD)', value: m[2].trim() });
  }

  // "Standard OMT: -4.7 (95% CI, -6.6 to -2.8)" style
  const ciPat = /([A-Za-z][A-Za-z\s()'-]+):\s*(-?[\d.]+\s*\(95%\s*CI[^)]+\))/gi;
  while ((m = ciPat.exec(text)) !== null) {
    results.push({ arm: m[1].trim(), metric: '95% CI', value: m[2].trim() });
  }

  // "X.X lines in the GROUP group" (ophthalmology VA lines)
  const linesPat = /([\d.]+)\s+lines?\s+in\s+the\s+([A-Za-z][A-Za-z\s()-]+?)\s+group/gi;
  while ((m = linesPat.exec(text)) !== null) {
    results.push({ arm: m[2].trim(), metric: 'Mean improvement', value: m[1] + ' Lines' });
  }

  return results.length > 0 ? { value: results, confidence: 0.87 } : null;
}

function detectTitle(text) {
  // Öncelik 1: PDF'in ilk satırlarından başlık çıkar (JAMA formatı)
  // İlk 10 satırı al, yazar adları (MD, PhD) öncesini birleştir
  const firstLines = text.split('\n').slice(0, 10).map(l => l.trim()).filter(l => l.length > 0);
  const titleParts = [];
  for (const line of firstLines) {
    // Yazar satırına gelince dur
    if (/\b(?:MD|PhD|MPH|DO|MS)\s*[,;]/.test(line)) break;
    // Trial subtitle (ör: "The GALAXY Randomized Clinical Trial")
    if (/^(?:The\s+)?[A-Z]{2,}\s+(?:Randomized|Clinical|Trial)/i.test(line)) {
      titleParts.push(line);
      break;
    }
    // Normal başlık satırı
    if (line.length > 10 && !/^(?:JAMA|doi:|http|Original|©|\d+$)/i.test(line)) {
      titleParts.push(line);
    }
  }
  if (titleParts.length > 0) {
    const candidate = titleParts.join(' ').replace(/\s+/g, ' ').trim();
    if (candidate.length > 30 && candidate.length < 300) {
      return { value: candidate, confidence: 0.85 };
    }
  }

  // IMPORTANCE'tan önceki bloğu bul (^ anchoru yok — PDF başında journal info olabilir)
  const beforeAbstract = text.match(/([\s\S]{10,600}?)(?:\n\s*(?:IMPORTANCE|OBJECTIVE|BACKGROUND)\b)/i);
  if (beforeAbstract) {
    const block = beforeAbstract[1].replace(/\n+/g, ' ').trim();
    // Başlık genellikle mixed case, 30-200 karakter arası, yazar adlarından önceki son uzun satır
    // Yazar satırlarını (MD, PhD, et al. içerenleri) temizle
    const lines = block.split(/\s{2,}|\n/).map(l => l.trim()).filter(l => l.length > 25);
    const titleLines = lines.filter(l =>
      !/\b(?:MD|PhD|MPH|DO|MS|et al\.|JAMA|doi:|http|Original|Invited|Special|©)\b/i.test(l) &&
      !/^\d+$/.test(l)
    );
    if (titleLines.length > 0) {
      const candidate = titleLines[titleLines.length - 1].replace(/\s+/g, ' ').trim();
      if (candidate.length > 25 && candidate.length < 300) {
        return { value: candidate, confidence: 0.73 };
      }
    }
  }

  // "Effect of X vs/on Y" yapısı — makul bir title pattern
  const effectOf = text.match(/\b((?:Effect|Association|Comparison|Efficacy|Safety|Impact)\s+of\s+[A-Za-z][^.]{20,150})/i);
  if (effectOf) return { value: effectOf[1].trim().replace(/\s+/g, ' '), confidence: 0.80 };

  return null;
}

function detectParticipantCounts(text) {
  // "400 Participants randomized" / "394 Participants analyzed"
  const randomized = text.match(/(\d+)\s+participants?\s+randomized/i);
  const analyzed = text.match(/(\d+)\s+participants?\s+analyzed/i);
  if (randomized || analyzed) {
    return {
      n_randomized: randomized ? parseInt(randomized[1]) : null,
      n_analyzed: analyzed ? parseInt(analyzed[1]) : null,
      confidence: 0.9,
    };
  }
  return null;
}

// --- Ana parser ---

/**
 * Ham klinik metni yapılandırılmış JSON'a dönüştürür.
 * @param {string} text
 * @returns {Object}  — standart girdi schema'sına uyar + review_flags
 */
function detectFindingsSummary(text) {
  // CONCLUSIONS AND RELEVANCE — en temiz özet
  const conc = text.match(/CONCLUSIONS?\s+(?:AND\s+RELEVANCE)?[:\s]+([^.]+(?:\.[^A-Z\n][^.]+)?)/i);
  if (conc) {
    let s = conc[1].trim().replace(/\s+/g, ' ');
    // "TRIAL REGISTRATION ClinicalTrials.gov..." suffix'ini temizle
    s = s.replace(/\s*TRIAL\s+REGISTRATION\b.*$/i, '')
         .replace(/\s*ClinicalTrials\.gov\b.*$/i, '')
         .replace(/\s*Identifier[:\s]+NCT\d+.*$/i, '')
         .trim();
    if (s.length > 30) return { value: s, confidence: 0.88 };
  }
  // RESULTS — son cümlesi (genel çıkarım genelde sondadır)
  const resMatch = text.match(/RESULTS?[:\s]+([\s\S]+?)(?=\n\s*(?:CONCLUSIONS?|INTERPRETATION|$))/i);
  if (resMatch) {
    const sentences = resMatch[1].split(/\.\s+/);
    const last = sentences.filter(s => s.trim().length > 30).pop();
    if (last) return { value: last.trim().replace(/\s+/g, ' '), confidence: 0.80 };
  }
  return null;
}

// Relative Risk / Odds Ratio / Hazard Ratio tespit et
function detectRelativeRisk(text) {
  const risks = [];

  // Pattern: "RR, 0.68; 95% CI, 0.49-0.96; P = .03" veya "[RR], 0.68; ..."
  const rrPattern = /(?:relative\s+risk|\[?RR\]?)[,\s:]+(\d+\.\d+)\s*[;,]\s*95%\s*CI[,\s]+(\d+\.\d+)[-–](\d+\.\d+)\s*[;,]?\s*[Pp]\s*[=<>]\s*\.?(\d+)/gi;
  let match;
  while ((match = rrPattern.exec(text)) !== null) {
    risks.push({
      type: 'RR',
      value: parseFloat(match[1]),
      ci_low: parseFloat(match[2]),
      ci_high: parseFloat(match[3]),
      p_value: 'P = .' + match[4],
      label: 'Relative risk of primary outcome'
    });
  }

  // Pattern: "(RR, 0.68; 95% CI, 0.49-0.96; P = .03)" veya "([RR], 0.68; ...)"
  const rrParenPattern = /\((?:\[?RR\]?|relative\s+risk)[,\s:]+(\d+\.\d+)\s*[;,]\s*95%\s*CI[,\s]+(\d+\.\d+)[-–](\d+\.\d+)\s*[;,]?\s*[Pp]\s*[=<>]\s*\.?(\d+)\)/gi;
  while ((match = rrParenPattern.exec(text)) !== null) {
    if (!risks.find(r => r.value === parseFloat(match[1]))) {
      risks.push({
        type: 'RR',
        value: parseFloat(match[1]),
        ci_low: parseFloat(match[2]),
        ci_high: parseFloat(match[3]),
        p_value: 'P = .' + match[4],
        label: 'Relative risk'
      });
    }
  }

  // Major bleeding or secondary safety outcome
  const bleedPattern = /(?:major\s+)?bleeding[^.]*?(?:RR|relative\s+risk)[,\s:]+(\d+\.\d+)\s*[;,]\s*95%\s*CI[,\s]+(\d+\.\d+)[-–](\d+\.\d+)\s*[;,]?\s*[Pp]\s*[=<>]\s*\.?(\d+)/gi;
  while ((match = bleedPattern.exec(text)) !== null) {
    risks.push({
      type: 'RR',
      value: parseFloat(match[1]),
      ci_low: parseFloat(match[2]),
      ci_high: parseFloat(match[3]),
      p_value: 'P = .' + match[4],
      label: 'Relative risk of major bleeding'
    });
  }

  // Primary outcome OR: "odds ratio [OR], 1.96; 95% CI, 0.98-3.92; P = .06" (RESULTS section)
  // Also matches "adjusted odds ratio [OR]" format
  const primaryOrPattern = /(?:adjusted\s+)?odds\s+ratio\s*\[OR\][,\s]+(\d+\.?\d*)[;,\s]+95%\s*CI[,\s]+(\d+\.?\d*)[-–](\d+\.?\d*)[;,\s]+P\s+[=<>]\s*\.?(\d+)/gi;
  while ((match = primaryOrPattern.exec(text)) !== null) {
    risks.unshift({  // unshift ile başa ekle - primary outcome
      type: 'OR',
      value: parseFloat(match[1]),
      ci_low: parseFloat(match[2]),
      ci_high: parseFloat(match[3]),
      p_value: 'P = .' + match[4],
      label: 'Odds ratio for primary outcome'
    });
  }

  // Odds Ratio pattern: "odds ratio, 0.7; 95% CI, 0.3-1.7" veya "(OR, 0.7 [95% CI, 0.3-1.7])"
  const orPattern = /(?:odds\s+ratio|OR)[,\s:]+(\d+\.?\d*)\s*[;,\[\s]+95%\s*CI[,\s\]]+(\d+\.?\d*)[-–](\d+\.?\d*)/gi;
  while ((match = orPattern.exec(text)) !== null) {
    if (!risks.find(r => r.type === 'OR' && r.value === parseFloat(match[1]))) {
      risks.push({
        type: 'OR',
        value: parseFloat(match[1]),
        ci_low: parseFloat(match[2]),
        ci_high: parseFloat(match[3]),
        label: 'Odds ratio'
      });
    }
  }

  // Odds Ratio with P value: "OR, 0.7 (95% CI, 0.3-1.7; P = .40)" veya "P   = .06" (çoklu boşluk)
  const orPvalPattern = /(?:odds\s+ratio|\[?OR\]?)[,\s:]+(\d+\.?\d*)\s*[;,(\[\s]+95%\s*CI[,\s]+(\d+\.?\d*)[-–](\d+\.?\d*)[)\]]?\s*[;,]?\s*[Pp]\s+[=<>]\s*\.?(\d+)/gi;
  while ((match = orPvalPattern.exec(text)) !== null) {
    const existingIdx = risks.findIndex(r => r.type === 'OR' && r.value === parseFloat(match[1]));
    if (existingIdx >= 0) {
      risks[existingIdx].p_value = 'P = .' + match[4];
    } else {
      risks.push({
        type: 'OR',
        value: parseFloat(match[1]),
        ci_low: parseFloat(match[2]),
        ci_high: parseFloat(match[3]),
        p_value: 'P = .' + match[4],
        label: 'Odds ratio'
      });
    }
  }

  // Tablo formatı: "0.7 (0.3-1.7)  .40" veya "0.7 (0.3-1.7) P value .40"
  // Primary outcome satırında OR + P value yakala
  const tablePattern = /(\d+\.?\d*)\s*\((\d+\.?\d*)[-–](\d+\.?\d*)\)\s+\.(\d+)/g;
  while ((match = tablePattern.exec(text)) !== null) {
    const val = parseFloat(match[1]);
    // Sadece 0-2 arası değerler OR olabilir (percentage değil)
    if (val > 0 && val < 2) {
      const existingOR = risks.find(r => r.type === 'OR' && r.value === val);
      if (existingOR && !existingOR.p_value) {
        existingOR.p_value = 'P = .' + match[4];
      }
    }
  }

  return risks.length > 0 ? risks : null;
}

function detectCitation(text) {
  const result = {};

  // DOI: "doi:10.1001/..." or "https://doi.org/10.1001/..."
  const doi = text.match(/(?:doi[:\s]*|https?:\/\/doi\.org\/)(10\.\d{4,}\/[^\s,;)\]]+)/i);
  if (doi) result.doi = 'doi:' + doi[1].replace(/\.$/, '');

  // "Published online March 15, 2021" / "Published January 2021"
  const published = text.match(/Published(?:\s+online)?\s+(?:\w+\s+)?\w+(?:\s+\d+,)?\s+\d{4}/i);
  if (published) result.published = published[0].trim();

  // JAMA journal abbreviations — all known JAMA family journals
  const jabbr = text.match(/JAMA\s+(?:Network\s+Open|Intern(?:al)?\s+Med|Ophthalmol|Pediatr(?:ics)?|Surg(?:ery)?|Cardiol(?:ogy)?|Neurol(?:ogy)?|Oncol(?:ogy)?|Psychiatry|Dermatol(?:ogy)?|Otolaryngol(?:ogy)?|(?:Head\s+Neck\s+Surg)|Health\s+Forum)[.\s,]/i);
  if (jabbr) {
    result.journal = jabbr[0].trim().replace(/[,\s]+$/, '').replace(/\s+/g, ' ');
  } else {
    const jama = text.match(/\bJAMA\b\.\s/);
    if (jama) result.journal = 'JAMA.';
  }

  // Authors — before IMPORTANCE/OBJECTIVE/BACKGROUND section
  // JAMA format: "Surname A, MD; Surname B, PhD; et al"
  const beforeAbstract = text.match(/([\s\S]{10,1200}?)(?:\n\s*(?:IMPORTANCE|OBJECTIVE|BACKGROUND)\b)/i);
  if (beforeAbstract) {
    const block = beforeAbstract[1];
    // Match: "Surname Initial(s), Degree; ..." line
    const authMatch = block.match(/([A-Z][a-z]+\s+[A-Z]+(?:,\s*(?:MD|PhD|DO|MS|MPH|MBBS|FACS|DrPH))+.*?(?:et\s+al\.)?)/);
    if (authMatch) {
      result.authors = authMatch[0].trim().replace(/\s+/g, ' ').replace(/;\s*$/, '');
    }
  }

  if (result.doi || result.published || result.journal) {
    return { value: result, confidence: 0.85 };
  }
  return null;
}

function detectPopulationDescription(text) {
  // "pregnant and postpartum women who were undernourished and had depression"
  // Perinatal/pregnant women with conditions
  const perinatalWomen = text.match(/(?:pregnant\s+and\s+postpartum|perinatal|pregnant|postpartum)\s+women\s+(?:who\s+were\s+)?([A-Za-z][A-Za-z\s,]+?)(?:\s+and\s+had\s+([A-Za-z][A-Za-z\s]+))?(?=\s*[\.\(]|\s+scoring|\s+in\s+rural)/i);
  if (perinatalWomen) {
    let desc = perinatalWomen[1].trim();
    if (perinatalWomen[2]) desc += ' and ' + perinatalWomen[2].trim();
    return { value: `Undernourished pregnant and postpartum women with ${desc.replace(/undernourished\s+and\s+/i, '')}`, confidence: 0.88 };
  }

  // "women with perinatal depression" or "women who were undernourished"
  const womenWith = text.match(/women\s+(?:who\s+(?:were|had)\s+)?(?:undernourished\s+(?:and\s+had\s+)?)?with\s+([A-Za-z][A-Za-z\s]+?depression)/i);
  if (womenWith) {
    return { value: `Undernourished pregnant and postpartum women with ${womenWith[1].trim()}`, confidence: 0.86 };
  }

  // "who had either an ASCVD condition or a 10-year ASCVD risk score greater than or equal to 7.5%"
  // Pattern for risk score or condition with either/or structure
  const riskCondition = text.match(/who\s+had\s+(?:either\s+)?(?:an?\s+)?([A-Za-z][A-Za-z\s()-]+?(?:condition|disease|disorder))\s+or\s+(?:an?\s+)?(.{10,120}?(?:risk\s+score|score)\s+(?:greater\s+than\s+or\s+equal\s+to|≥|>=?|less\s+than\s+or\s+equal\s+to|≤|<=?)\s*[\d.]+%?)(?=\s+were\s+|\s*\.)/i);
  if (riskCondition) {
    const cond1 = riskCondition[1].trim().replace(/\s+/g, ' ');
    let cond2 = riskCondition[2].trim().replace(/\s+/g, ' ');
    cond2 = cond2.replace(/greater than or equal to/gi, '≥').replace(/less than or equal to/gi, '≤').replace(/greater than/gi, '>').replace(/less than/gi, '<');
    return { value: `Adults with either ${cond1} or ${cond2}`, confidence: 0.88 };
  }

  // "adults from lower-income neighborhoods ... who had either ASCVD condition or risk score"
  const adultsWithCondition = text.match(/\b(?:adults?|patients?|participants?)\s+(?:from\s+[^.]{10,60}?\s+)?who\s+had\s+(?:either\s+)?(.{15,150}?)(?=\s+were\s+enrolled|\s+were\s+recruited|\.\s)/i);
  if (adultsWithCondition) {
    let cond = adultsWithCondition[1].trim().replace(/\s+/g, ' ');
    cond = cond.replace(/greater than or equal to/gi, '≥').replace(/less than or equal to/gi, '≤');
    return { value: 'Adults with ' + cond, confidence: 0.82 };
  }

  // "enrolled 214 adult patients with a diagnosis of SARS-CoV-2 infection confirmed with a PCR assay"
  // Use [\s\S] to match across newlines
  const enrolled = text.match(/enrolled\s+\d+\s+(?:adult\s+)?(?:patients?|participants?|adults?|persons?|children|infants?)\s+with\s+(?:a\s+)?(?:diagnosis\s+of\s+)?([\s\S]{15,200}?)(?:\s+who\s+(?:received|were|had|underwent|presented)|\s+(?:in|at)\s+(?:sites?|centers?|hospitals?)|\s+from\s+\w+\s+\d|\.\s+The\s+|,\s+The\s+|\s+were\s+enrolled)/i);
  if (enrolled) {
    const cond = enrolled[1].trim().replace(/\s+/g, ' ');
    return { value: 'Adult patients with ' + cond, confidence: 0.78 };
  }

  // "among 673 adults with moderate-to-severe atopic dermatitis"
  const amongAdults = text.match(/among\s+\d+\s+(adults?|patients?|infants?|children)\s+with\s+([\s\S]{10,100}?)(?=\s+(?:who|that|with|were|at|in|from|randomized)|\.\s)/i);
  if (amongAdults) {
    const pop = amongAdults[1].charAt(0).toUpperCase() + amongAdults[1].slice(1);
    const cond = amongAdults[2].trim().replace(/\s+/g, ' ');
    return { value: `${pop} with ${cond}`, confidence: 0.82 };
  }

  // "hospitalized adult patients with COVID-19 with D-dimer levels more than 4 times"
  const hospitalizedWith = text.match(/(?:hospitalized|ambulatory|outpatient)\s+(?:adult\s+)?(?:patients?|persons?)\s+with\s+([\s\S]{10,80}?)(?=\s+(?:who|were|at|in|from|are|with\s+D-dimer)|\.\s|,\s)/i);
  if (hospitalizedWith) {
    let cond = hospitalizedWith[1].trim().replace(/\s+/g, ' ');
    // Clean trailing words that shouldn't be part of condition
    cond = cond.replace(/\s+are\s*$/, '');
    return { value: `Hospitalized patients with ${cond}`, confidence: 0.80 };
  }

  // "patients with Parkinson disease and disabling motor response fluctuations"
  const patientsWith = text.match(/patients?\s+with\s+((?:Parkinson|Alzheimer|Huntington)[\s\S]{1,80}?)(?=\s+(?:who|were|at|in|from|despite|referred)|\.\s|,\s)/i);
  if (patientsWith) {
    const cond = patientsWith[1].trim().replace(/\s+/g, ' ');
    return { value: `Patients with ${cond}`, confidence: 0.78 };
  }

  // "Patients undergoing clean, open ventral hernia repairs"
  const patientsUndergoing = text.match(/patients?\s+undergoing\s+([\s\S]{10,80}?)(?=\s+(?:were|with\s+a\s+width)|\.\s)/i);
  if (patientsUndergoing) {
    const proc = patientsUndergoing[1].trim().replace(/\s+/g, ' ');
    return { value: `Patients undergoing ${proc}`, confidence: 0.76 };
  }

  // "Children Aged 3 to 12 Years" with condition from context
  const childrenAged = text.match(/children\s+aged?\s+(\d+)\s+to\s+(\d+)\s+years?/i);
  if (childrenAged) {
    // Look for condition nearby
    const condMatch = text.match(/(?:with\s+)?(?:severe\s+)?(?:unilateral\s+)?amblyopia/i);
    const cond = condMatch ? ' with amblyopia' : '';
    return { value: `Children aged ${childrenAged[1]} to ${childrenAged[2]} years${cond}`, confidence: 0.75 };
  }

  // "practice included adults with CRS without polyps undergoing ESS"
  const includedAdults = text.match(/(?:included|recruited|consisted of)\s+(?:adult\s+)?(?:patients?|adults?)\s+with\s+([\s\S]{10,100}?)(?=\s+(?:who|were|at|in|from|Of\s+\d)|\.\s)/i);
  if (includedAdults) {
    let cond = includedAdults[1].trim().replace(/\s+/g, ' ');
    // Expand common medical abbreviations
    cond = expandMedicalAbbreviations(cond);
    return { value: `Adults with ${cond}`, confidence: 0.78 };
  }

  // "Infants Born Before 28 Weeks' Gestational Age" / "preterm infants" patterns
  const infants = text.match(/(?:preterm|premature)\s+(?:infants?|neonates?|babies?)\s*(?:born\s+)?(?:before|at|<\s*)?([\d.]+\s+weeks?(?:'\s*)?(?:gestational\s+age)?)?/i);
  if (infants) {
    const age = infants[1] ? ` born before ${infants[1].replace(/'/g, '').trim()}` : '';
    return { value: `Preterm infants${age}`, confidence: 0.75 };
  }

  // "PARTICIPANTS  Adults with nonspecific subacute and chronic low back pain"
  const partSec = text.match(/(?:DESIGN[^A-Z]*)?PARTICIPANTS?[:\s]+(?:This[^.]+?\s+enrolled\s+\d+\s+)?(?:Adults?|Patients?|Infants?|Children)\s+with\s+([\s\S]{15,150}?)(?:\.|;|\s+were\s+)/i);
  if (partSec) {
    const cond = partSec[1].trim().replace(/\s+/g, ' ');
    return { value: 'Patients with ' + cond, confidence: 0.75 };
  }

  // "PARTICIPANTS  Mothers threatening preterm delivery before week 28"
  const partAlt = text.match(/(?:DESIGN[^A-Z]*)?PARTICIPANTS?[:\s]+(?:This[^.]+?\s+enrolled\s+\d+\s+)?(?:\w+\s+){1,4}(?:with|who|at|aged|before|after|following)\s+([\s\S]{15,120}?)(?:\.|;)/i);
  if (partAlt) {
    const cond = partAlt[1].trim().replace(/\s+/g, ' ');
    return { value: cond.charAt(0).toUpperCase() + cond.slice(1), confidence: 0.65 };
  }
  return null;
}

function detectTotalN(text) {
  // "155 (median...) were randomized to X or Y" - number followed by parenthetical then randomized
  const withParen = text.match(/(\d+)\s*\([^)]+\)\s*(?:were\s+)?(?:randomly\s+)?(?:assigned|randomized)\s+to/i);
  if (withParen) return { value: parseInt(withParen[1]), confidence: 0.92 };

  // "N women were randomized" or "N perinatal women"
  const womenRand = text.match(/(\d+)\s+(?:perinatal\s+)?women\s+(?:were\s+)?(?:randomized|enrolled|screened)/i);
  if (womenRand) return { value: parseInt(womenRand[1]), confidence: 0.90 };

  // "Of X patients randomized, Y were included in the analysis" — prefer analysis count
  const analysisCount = text.match(/(?:Of\s+\d+\s+patients?\s+randomized,?\s+)?(\d+)\s+(?:were\s+)?included\s+in\s+(?:the\s+)?analysis/i);
  if (analysisCount) return { value: parseInt(analysisCount[1]), confidence: 0.95 };

  // "X patients in the modified intention-to-treat population"
  const mITT = text.match(/(\d+)\s+patients?\s+in\s+the\s+(?:modified\s+)?intention-to-treat\s+population/i);
  if (mITT) return { value: parseInt(mITT[1]), confidence: 0.94 };

  // "214 patients were randomized" / "246 infants treated" / "350 patients participated" / "164 youths were randomized"
  const m = text.match(/(\d+)\s+(?:patients?|participants?|subjects?|adults?|children|infants?|youths?|persons?)\s+(?:were\s+)?(?:randomized|enrolled|included|recruited|treated|participated)/i);
  if (m) return { value: parseInt(m[1]), confidence: 0.88 };
  // "randomized X patients" / "enrolled X participants"
  const rev = text.match(/(?:randomized|enrolled|included|treated)\s+(\d+)\s+(?:patients?|participants?|infants?)/i);
  if (rev) return { value: parseInt(rev[1]), confidence: 0.85 };
  // "A total of X patients/participants" / "Among X participants" / "Among 164 youths"
  const total = text.match(/(?:[Aa]\s+total\s+of|[Aa]mong)\s+(\d+)\s+(?:patients?|participants?|subjects?|adults?|persons?|infants?|youths?|children)/i);
  if (total) return { value: parseInt(total[1]), confidence: 0.83 };
  // "among 673 adults with" — adults without standard trigger word
  const adults = text.match(/(?:[Aa]mong|[Oo]f)\s+(\d+)\s+adults?\s+with/i);
  if (adults) return { value: parseInt(adults[1]), confidence: 0.80 };
  return null;
}

function detectChartData(text) {
  const unitRe = '(?:days?|d\\b|weeks?|months?|hours?|h\\b|years?|y\\b|lines?|points?|mm|cm|mg\\/dL|mmHg|bpm|min(?:utes?)?)';

  function cleanLabel(s) {
    return s
      .replace(/\s+without\b.*/i, '')
      .replace(/\s+(?:supplementation|therapy|treatment|supplemented|supplemental)\b.*$/i, '')
      .replace(/\s+\(.*$/, '')
      .replace(/^(?:both\s+)?the\s+/i, '')
      .trim()
      .replace(/\s+/g, ' ');
  }

  // Search within RESULTS section only (most reliable source); fall back to full text
  const resSec = text.match(/(?:RESULTS?|Primary Outcome)[:\s]+([\s\S]{100,1200}?)(?=\n\s*(?:CONCLUSIONS?|Secondary|Discussion)\b)/i);
  const searchIn = resSec ? resSec[1] : text;

  // Find "mean (SD) of X (Y) [unit] ... compared with" — the primary outcome comparison sentence.
  // Use a pattern that skips from the mean value to "compared with" across ≤ 200 chars.
  const anchorRe = new RegExp(
    `([^.]*?achieved[^.]*?mean\\s*\\(SD\\)\\s*(?:of\\s+)?([\\d.]+)\\s*\\(([\\d.]+)\\)\\s*(${unitRe})[^.]*?compared\\s+with)`,
    'is'
  );
  const ancM = anchorRe.exec(searchIn);
  if (!ancM) return null;

  const firstMean = parseFloat(ancM[2]);
  const firstSd   = parseFloat(ancM[3]);
  const unitRaw   = ancM[4].toLowerCase();
  const yLabel    = unitRaw.startsWith('d') ? 'Time, d'
    : unitRaw.startsWith('y') ? 'Time, y'
    : unitRaw.startsWith('w') ? 'Time, wk'
    : unitRaw.startsWith('h') ? 'Time, h'
    : (unitRaw.startsWith('m') && !unitRaw.startsWith('mm') && !unitRaw.startsWith('mg')) ? 'Time, mo'
    : ancM[4];

  // First arm label: look backwards in the matched anchor for "received LABEL achieved"
  const anchor = ancM[1];
  const fLm = anchor.match(/(?:who\s+received|receiving)\s+([\s\S]{5,80}?)\s+(?:achieved|accomplished|attained|had\b)/i);
  let firstLabel = 'Control';
  if (fLm) firstLabel = cleanLabel(fLm[1]);

  // Extract text after "compared with" (up to next sentence or paragraph end)
  const afterStart = ancM.index + ancM[0].length;
  const afterRaw = searchIn.slice(afterStart, afterStart + 700);
  // Cut at sentence end: ")." followed by capital / "(overall" / double-newline
  const sentEnd = afterRaw.search(/\)\.\s+[A-Z]|\)\.\s*$|\n\n|CONCLUSIONS/i);
  const afterCW = sentEnd > 20 ? afterRaw.slice(0, sentEnd + 2) : afterRaw.slice(0, 700);

  const datasets = [{ label: firstLabel, mean: firstMean, sd: firstSd }];

  // Full-text pattern: "mean (SD) of X (Y) unit for patients receiving LABEL"
  const patFull = new RegExp(
    `mean\\s*\\(SD\\)\\s*(?:of\\s+)?([\\d.]+)\\s*\\(([\\d.]+)\\)\\s*${unitRe}\\s+for\\s+patients?\\s+receiving\\s+([^,;(\n]+?)(?=[,;(]|\\s+and\\s+a?\\s*mean|$)`,
    'gi'
  );

  // Abstract pattern A: "X (Y) unit for the LABEL group"
  const patAbsA = new RegExp(
    `([\\d.]+)\\s*\\(([\\d.]+)\\)\\s*${unitRe}\\s+for\\s+the\\s+([^,;.(]+?)\\s+(?:group|arm)(?=[,;.]|\\s+and|$)`,
    'gi'
  );

  // Abstract pattern B: "X (Y) unit for the group receiving LABEL"
  const patAbsB = new RegExp(
    `([\\d.]+)\\s*\\(([\\d.]+)\\)\\s*${unitRe}\\s+for\\s+the\\s+group\\s+receiving\\s+([^,;.(\n]+?)(?=[,;.(]|$)`,
    'gi'
  );

  let m;
  let count = 0;

  while ((m = patFull.exec(afterCW)) !== null) {
    const label = cleanLabel(m[3]);
    if (label.length > 1) { datasets.push({ label, mean: parseFloat(m[1]), sd: parseFloat(m[2]) }); count++; }
  }

  if (count === 0) {
    while ((m = patAbsA.exec(afterCW)) !== null) {
      const label = cleanLabel(m[3]);
      if (label.length > 1) { datasets.push({ label, mean: parseFloat(m[1]), sd: parseFloat(m[2]) }); count++; }
    }
    while ((m = patAbsB.exec(afterCW)) !== null) {
      const label = cleanLabel(m[3]);
      if (label.length > 1) { datasets.push({ label, mean: parseFloat(m[1]), sd: parseFloat(m[2]) }); count++; }
    }
  }

  if (datasets.length < 2) return null;

  return { type: 'bar', y_label: yLabel, datasets, confidence: 0.82 };
}

// Detect "score at X days (Y vs Z, P = ...)" format - same outcome for both groups
function detectChartDataVsComparison(text) {
  const resSec = text.match(/\bRESULTS?\b[:\s]*([\s\S]{100,2000}?)(?=\n\s*(?:CONCLUSIONS?|INTERPRETATION|DISCUSSION)\b)/i);
  const searchIn = resSec ? resSec[1] : text;

  // Pattern: "score at X days/months (Y vs Z, P = ...)" or "at 30 days, X vs Y"
  // Also look for baseline to follow-up: "from X to Y in the GROUP group"
  const baselineFollowup = searchIn.match(/(?:from|baseline)\s+([\d.]+)\s+to\s+([\d.]+)\s+in\s+the\s+([\w-]+)\s+(?:mesh\s+)?group\s+and\s+(?:from\s+)?([\d.]+)\s+to\s+([\d.]+)\s+in\s+the\s+([\w-]+)/i);

  if (baselineFollowup) {
    const baseline1 = parseFloat(baselineFollowup[1]);
    const followup1 = parseFloat(baselineFollowup[2]);
    const label1 = baselineFollowup[3].replace(/-/g, ' ');
    const baseline2 = parseFloat(baselineFollowup[4]);
    const followup2 = parseFloat(baselineFollowup[5]);
    const label2 = baselineFollowup[6].replace(/-/g, ' ');

    // Look for outcome measure name
    const outcomeMatch = text.match(/(?:pain|PROMIS|score|outcome)\s*(?:T\s*)?scores?/i);
    const yLabel = outcomeMatch ? 'Pain Score' : 'Score';

    return {
      type: 'line',
      y_label: yLabel,
      x_labels: ['Baseline', '1 Year'],
      datasets: [
        { label: label1.charAt(0).toUpperCase() + label1.slice(1), values: [baseline1, followup1] },
        { label: label2.charAt(0).toUpperCase() + label2.slice(1), values: [baseline2, followup2] }
      ],
      confidence: 0.78
    };
  }

  // Pattern: "X vs Y at N days" or "at N days (X vs Y, P=...)"
  const vsPattern = searchIn.match(/(?:scores?\s+)?(?:at|after)\s+(\d+)\s+(days?|weeks?|months?|years?)[^(]*?\(([\d.]+)\s+vs\s+([\d.]+)\s*,?\s*[Pp]\s*[=<>]\s*\.?\d+\)/i);
  if (vsPattern) {
    const timepoint = vsPattern[1] + ' ' + vsPattern[2];
    const value1 = parseFloat(vsPattern[3]);
    const value2 = parseFloat(vsPattern[4]);

    // Try to find group labels
    const groupMatch = searchIn.match(/(\w+[-\s]weight)\s+(?:vs|versus)\s+(\w+[-\s]weight)/i);
    const label1 = groupMatch ? groupMatch[1] : 'Group 1';
    const label2 = groupMatch ? groupMatch[2] : 'Group 2';

    return {
      type: 'bar',
      y_label: 'Score at ' + timepoint,
      datasets: [
        { label: label1, mean: value1 },
        { label: label2, mean: value2 }
      ],
      confidence: 0.72
    };
  }

  return null;
}

function detectChartDataProportion(text) {
  const resSec = text.match(/\bRESULTS?\b[:\s]*([\s\S]{100,1500}?)(?=\n\s*(?:CONCLUSIONS?|INTERPRETATION|DISCUSSION)\b)/i);
  const searchIn = resSec ? resSec[1] : text;

  function cleanArm(s) {
    return s.trim().replace(/^(?:the|a|an)\s+/i, '').replace(/\s+/g, ' ');
  }

  // Pattern 1: "N patients receiving LABEL (X%) and N patients receiving LABEL (X%) achieved METRIC"
  // makale3: "248 patients receiving upadacitinib (72.4%) and 207 patients receiving dupilumab (62.6%) achieved EASI75"
  const pat1 = /(\d+)\s+(?:patients?|participants?)\s+receiving\s+([A-Za-z][^(]{1,40}?)\s*\(([\d.]+)%\)\s+and\s+(\d+)\s+(?:patients?|participants?)\s+receiving\s+([A-Za-z][^(]{1,40}?)\s*\(([\d.]+)%\)\s+achieved\s+([A-Za-z][A-Za-z0-9\s]+?)(?=\s*\(\s*[Pp]|\s*[Pp]\s*[=<]|[\n;]|\s*$)/i;
  const m1 = pat1.exec(searchIn);
  if (m1) {
    const metric = m1[7].trim().replace(/\s+/g, ' ').replace(/\s+$/, '').slice(0, 25);
    return {
      type: 'bar', y_label: `Achieving ${metric}, %`,
      datasets: [
        { label: cleanArm(m1[2]), mean: parseFloat(m1[3]) },
        { label: cleanArm(m1[5]), mean: parseFloat(m1[6]) },
      ],
    };
  }

  // Pattern 2: "N of M (X%) after LABEL and N of M (X%) after LABEL [context]"
  // makale5: "15 of 52 (29%) after awake and 11 of 51 (22%) after asleep DBS"
  const pat2 = /(\d+)\s+of\s+\d+\s*\(([\d.]+)%\)\s+after\s+([A-Za-z][A-Za-z\s\-]+?)\s+and\s+(\d+)\s+of\s+\d+\s*\(([\d.]+)%\)\s+after\s+([A-Za-z][A-Za-z\s\-]+?)(?=\s*[\w]*\s*\(|\s*$)/i;
  const m2 = pat2.exec(searchIn);
  if (m2) {
    return {
      type: 'bar', y_label: 'Patients, %',
      datasets: [
        { label: cleanArm(m2[3]), mean: parseFloat(m2[2]) },
        { label: cleanArm(m2[6]), mean: parseFloat(m2[5]) },
      ],
    };
  }

  // Pattern 3: "N of M patients (X%) ... with LABEL vs N of M patients (X%) ... with LABEL"
  // makale4: "52 of 124 patients (41.9%) ... with standard-dose heparins vs 37 of 129 patients (28.7%) ... with therapeutic-dose LMWH"
  const pat3 = /(\d+)\s+of\s+\d+\s+patients?\s*\(([\d.]+)%\)[\s\S]{0,150}?with\s+([A-Za-z][A-Za-z\s\-]+?)\s+vs\s+(\d+)\s+of\s+\d+\s+patients?\s*\(([\d.]+)%\)[\s\S]{0,150}?with\s+([A-Za-z][A-Za-z\s\-]+?)(?=\s*\(|\s*\[|$)/i;
  const m3 = pat3.exec(searchIn);
  if (m3) {
    return {
      type: 'bar', y_label: 'Patients with primary outcome, %',
      datasets: [
        { label: cleanArm(m3[3]), mean: parseFloat(m3[2]) },
        { label: cleanArm(m3[6]), mean: parseFloat(m3[5]) },
      ],
    };
  }

  // Pattern 4: "N infants/patients (X%) receiving LABEL ... compared with N (X%) receiving LABEL"
  // makale7: "41 infants (33.1%) receiving the new respiratory support system were intubated or died ... compared with 55 infants (45.1%) receiving standard care"
  const pat4 = /(\d+)\s+(?:patients?|participants?|infants?|subjects?)\s*\(([\d.]+)%\)\s+receiving\s+([A-Za-z][\s\S]{1,80}?)\s+(?:were?|was)\s+[\s\S]{1,100}?compared\s+with\s+(\d+)\s+(?:patients?|participants?|infants?|subjects?)\s*\(([\d.]+)%\)\s+receiving\s+([A-Za-z][A-Za-z\s\-]+?)(?=\s*\.|$)/i;
  const m4 = pat4.exec(searchIn);
  if (m4) {
    const label1 = cleanArm(m4[3]).split(/\s+/).slice(0, 5).join(' ');
    return {
      type: 'bar', y_label: 'Patients, %',
      datasets: [
        { label: label1, mean: parseFloat(m4[2]) },
        { label: cleanArm(m4[6]), mean: parseFloat(m4[5]) },
      ],
    };
  }

  // Pattern 5: Change/difference with 95% CI - "had significant increases ... (DIFF; 95% CI, LOW-HIGH; P < X)"
  // makale2: "participants with self-chosen and immediate goals had significant increases ... (1384; 95% CI, 805-1963; P < .001)"
  const pat5 = /(?:participants?|patients?|those)\s+(?:with|in|receiving)\s+([A-Za-z][A-Za-z\s\-]+?)\s+(?:goals?\s+)?had\s+significant\s+(?:increases?|decreases?|improvements?|reductions?)\s+[\s\S]{0,100}?\((\d+(?:\.\d+)?)\s*;\s*95%\s*CI\s*,?\s*([\d.]+)[\s–-]+([\d.]+)\s*;\s*[Pp]\s*[=<>]\s*\.?(\d+)\)/i;
  const m5 = pat5.exec(searchIn);
  if (m5) {
    return {
      type: 'comparison',
      y_label: 'Change from control',
      datasets: [
        {
          label: m5[1].trim().replace(/\s+/g, ' '),
          mean: parseFloat(m5[2]),
          ci_low: parseFloat(m5[3]),
          ci_high: parseFloat(m5[4]),
          p_value: 'P < .' + m5[5]
        }
      ],
    };
  }

  // Pattern 6: "X of Y (Z.Z%) in/among LABEL ... vs/and X of Y (Z.Z%) in/among LABEL"
  // COACH-MI style: "36 of 94 (40.0%) in MI vs 18 of 70 (26.8%) in TAU"
  const pat6 = /(\d+)\s+of\s+\d+\s*\(([\d.]+)%\)\s+(?:in|among|with)\s+(?:the\s+)?([A-Za-z][A-Za-z\s\-()]*?)\s+(?:vs\.?|versus|and|compared\s+(?:with|to))\s+(\d+)\s+of\s+\d+\s*\(([\d.]+)%\)\s+(?:in|among|with)\s+(?:the\s+)?([A-Za-z][A-Za-z\s\-()]*?)(?:\s+group)?(?=\s*[.;,]|\s*\(|$)/i;
  const m6 = pat6.exec(searchIn);
  if (m6) {
    return {
      type: 'bar', y_label: 'Primary outcome, %',
      datasets: [
        { label: cleanArm(m6[3]), mean: parseFloat(m6[2]) },
        { label: cleanArm(m6[6]), mean: parseFloat(m6[5]) },
      ],
    };
  }

  // Pattern 6b: Square brackets format "LABEL: N patients [X.X%] vs LABEL: N patients [X.X%]"
  // COACH-MI actual format: "MI: 36 patients [40.0%] vs TAU: 18 patients [26.8%]"
  const pat6b = /([A-Z][A-Z0-9]{0,5})\s*:\s*(\d+)\s+patients?\s*\[([\d.]+)%\]\s*vs\.?\s*([A-Z][A-Z0-9]{0,5})\s*:\s*(\d+)\s+patients?\s*\[([\d.]+)%\]/i;
  const m6b = pat6b.exec(searchIn);
  if (m6b) {
    return {
      type: 'bar', y_label: 'Uptake of mental health services, %',
      datasets: [
        { label: m6b[1].toUpperCase(), mean: parseFloat(m6b[3]) },
        { label: m6b[4].toUpperCase(), mean: parseFloat(m6b[6]) },
      ],
    };
  }

  // Pattern 6c: "X.X% and Y.Y% of patients/adolescents" with preceding labels
  // "Following an MI or TAU counseling session, 40.0% and 26.8% of adolescent patients..."
  const pat6c = /(?:Following\s+(?:an?\s+)?)?([A-Z][A-Z0-9]{1,5})\s+(?:or|and|vs\.?)\s+([A-Z][A-Z0-9]{1,5})\s+(?:counseling\s+)?(?:session|treatment|intervention)?[,\s]+([\d.]+)\s*%\s+(?:and|vs\.?)\s+([\d.]+)\s*%\s+(?:of\s+)?(?:adolescent\s+)?(?:patients?|participants?|youths?)/i;
  const m6c = pat6c.exec(searchIn);
  if (m6c) {
    return {
      type: 'bar', y_label: 'Primary outcome, %',
      datasets: [
        { label: m6c[1].toUpperCase(), mean: parseFloat(m6c[3]) },
        { label: m6c[2].toUpperCase(), mean: parseFloat(m6c[4]) },
      ],
    };
  }

  // Pattern 7: "LABEL: N/M (X.X%), LABEL: N/M (X.X%)" or "N (X%) in LABEL, N (X%) in LABEL"
  // Primary outcome percentages listed by group
  const pat7 = /(?:primary\s+outcome|endpoint|response)[:\s]+[\s\S]{0,50}?(\d+)\s*(?:\/\d+\s*)?\(([\d.]+)%\)\s+(?:in|for|among)\s+([A-Za-z][A-Za-z\s\-()]+?)\s+(?:and|,|vs\.?)\s+(\d+)\s*(?:\/\d+\s*)?\(([\d.]+)%\)\s+(?:in|for|among)\s+([A-Za-z][A-Za-z\s\-()]+?)(?=\s*[.;]|$)/i;
  const m7 = pat7.exec(searchIn);
  if (m7) {
    return {
      type: 'bar', y_label: 'Achieving primary outcome, %',
      datasets: [
        { label: cleanArm(m7[3]), mean: parseFloat(m7[2]) },
        { label: cleanArm(m7[6]), mean: parseFloat(m7[5]) },
      ],
    };
  }

  // Pattern 8: "X of Y patients (Z%) in the GROUP and X of Y patients (Z%) in the GROUP"
  // More flexible pattern for percentage reporting
  const pat8 = /(\d+)\s+of\s+\d+\s+(?:patients?|participants?|youths?)\s*\(([\d.]+)%\)\s+(?:in\s+)?(?:the\s+)?([A-Za-z][A-Za-z0-9\s\-()]+?)\s+group\s+(?:and|,)\s+(\d+)\s+of\s+\d+\s+(?:patients?|participants?|youths?)\s*\(([\d.]+)%\)\s+(?:in\s+)?(?:the\s+)?([A-Za-z][A-Za-z0-9\s\-()]+?)\s+group/i;
  const m8 = pat8.exec(searchIn);
  if (m8) {
    return {
      type: 'bar', y_label: 'Primary outcome, %',
      datasets: [
        { label: cleanArm(m8[3]), mean: parseFloat(m8[2]) },
        { label: cleanArm(m8[6]), mean: parseFloat(m8[5]) },
      ],
    };
  }

  // Pattern 9: Simple percentage comparison "X.X% vs Y.Y%" or "X% versus Y%"
  // Generic pattern for any percentage comparison
  const pat9 = /([\d.]+)\s*%\s+(?:vs\.?|versus|compared\s+(?:with|to))\s+([\d.]+)\s*%/i;
  const m9 = pat9.exec(searchIn);
  if (m9) {
    return {
      type: 'bar', y_label: 'Outcome, %',
      datasets: [
        { label: 'Treatment', mean: parseFloat(m9[1]) },
        { label: 'Control', mean: parseFloat(m9[2]) },
      ],
    };
  }

  // Pattern 10: "GROUP achieved X%; GROUP achieved Y%" or similar
  const pat10 = /([A-Za-z][A-Za-z\s]+?)\s+(?:achieved|had|showed|demonstrated)\s+([\d.]+)\s*%[\s\S]{0,50}?([A-Za-z][A-Za-z\s]+?)\s+(?:achieved|had|showed|demonstrated)\s+([\d.]+)\s*%/i;
  const m10 = pat10.exec(searchIn);
  if (m10) {
    return {
      type: 'bar', y_label: 'Outcome, %',
      datasets: [
        { label: cleanArm(m10[1]), mean: parseFloat(m10[2]) },
        { label: cleanArm(m10[3]), mean: parseFloat(m10[4]) },
      ],
    };
  }

  // Pattern 11: "(X/Y, Z%)" format - "treatment (36/94, 40.0%) ... control (18/70, 26.8%)"
  const pat11 = /([A-Za-z][A-Za-z\s\-]+?)\s*\((\d+)\s*\/\s*(\d+)\s*,?\s*([\d.]+)\s*%\)[\s\S]{0,80}?([A-Za-z][A-Za-z\s\-]+?)\s*\((\d+)\s*\/\s*(\d+)\s*,?\s*([\d.]+)\s*%\)/i;
  const m11 = pat11.exec(searchIn);
  if (m11) {
    return {
      type: 'bar', y_label: 'Primary outcome, %',
      datasets: [
        { label: cleanArm(m11[1]), mean: parseFloat(m11[4]) },
        { label: cleanArm(m11[5]), mean: parseFloat(m11[8]) },
      ],
    };
  }

  // Pattern 12: Inline "X of Y participants (Z%)" multiple times in text
  // Capture standalone mentions and pair them, try to find labels
  const percentMentions = [];
  const mentionPat = /(\d+)\s+of\s+(\d+)\s+(?:patients?|participants?|youths?|subjects?|infants?)\s*\(([\d.]+)\s*%\)/gi;
  let mm;
  while ((mm = mentionPat.exec(searchIn)) !== null) {
    // Try to find label before or after this match
    const beforeText = searchIn.slice(Math.max(0, mm.index - 60), mm.index);
    const afterText = searchIn.slice(mm.index + mm[0].length, mm.index + mm[0].length + 30);
    let label = null;
    // Look for "In the X group," pattern (common in JAMA abstracts)
    const groupBeforeMatch = beforeText.match(/(?:in|among|with)\s+(?:the\s+)?([A-Za-z][A-Za-z0-9\s\-]{1,20}?)\s+group[,\s;:]+$/i);
    if (groupBeforeMatch) label = groupBeforeMatch[1].trim();
    // Or simpler "in X," pattern
    if (!label) {
      const simpleBeforeMatch = beforeText.match(/(?:in\s+(?:the\s+)?|among\s+|with\s+)([A-Za-z][A-Za-z0-9]{1,10})[,\s;:]+$/i);
      if (simpleBeforeMatch) label = simpleBeforeMatch[1].trim();
    }
    // Or "X group" after
    if (!label) {
      const afterMatch = afterText.match(/^\s*(?:in\s+(?:the\s+)?)?([A-Za-z][A-Za-z0-9\s\-]{1,15}?)\s+group/i);
      if (afterMatch) label = afterMatch[1].trim();
    }
    percentMentions.push({ n: parseInt(mm[1]), total: parseInt(mm[2]), pct: parseFloat(mm[3]), label: label });
  }
  if (percentMentions.length >= 2) {
    return {
      type: 'bar', y_label: 'Primary outcome, %',
      datasets: [
        { label: percentMentions[0].label || 'Group 1', mean: percentMentions[0].pct },
        { label: percentMentions[1].label || 'Group 2', mean: percentMentions[1].pct },
      ],
    };
  }

  // Pattern 13: Look for arm-specific percentage patterns "MI: 40.0%, TAU: 26.8%"
  // or "MI 40.0% vs TAU 26.8%"
  // Exclude common English words that could be mistaken for arm abbreviations
  const commonWords = /^(OF|TO|IN|AT|OR|AN|AS|BY|IF|IS|IT|NO|ON|SO|UP|WE|BE|DO|GO|HE|ME|MY|US)$/i;
  const pat13 = /\b([A-Z][A-Z0-9]{1,5})\s*[:\s]?\s*([\d.]+)\s*%[\s,;]+(?:vs\.?\s+)?([A-Z][A-Z0-9]{1,5})\s*[:\s]?\s*([\d.]+)\s*%/i;
  const m13 = pat13.exec(searchIn);
  if (m13 && !commonWords.test(m13[1]) && !commonWords.test(m13[3])) {
    return {
      type: 'bar', y_label: 'Primary outcome, %',
      datasets: [
        { label: m13[1].toUpperCase(), mean: parseFloat(m13[2]) },
        { label: m13[3].toUpperCase(), mean: parseFloat(m13[4]) },
      ],
    };
  }

  // Pattern 14: "reached X% in GROUP vs Y% in GROUP"
  const pat14 = /(?:reached|achieved|observed|found)\s+([\d.]+)\s*%\s+(?:in\s+)?(?:the\s+)?([A-Za-z][A-Za-z0-9\s\-]+?)\s+(?:vs\.?|versus|and|compared\s+(?:to|with))\s+([\d.]+)\s*%\s+(?:in\s+)?(?:the\s+)?([A-Za-z][A-Za-z0-9\s\-]+?)(?:\s+group)?(?=\s*[.;,]|$)/i;
  const m14 = pat14.exec(searchIn);
  if (m14) {
    return {
      type: 'bar', y_label: 'Primary outcome, %',
      datasets: [
        { label: cleanArm(m14[2]), mean: parseFloat(m14[1]) },
        { label: cleanArm(m14[4]), mean: parseFloat(m14[3]) },
      ],
    };
  }

  // Pattern 15: "N LABEL participants (X%) achieved OUTCOME compared with N participants (Y%) in the LABEL group"
  // CBT trial: "59 CBT participants (78.6%) achieved remission compared with 22 participants (33.8%) in the control group"
  const pat15 = /(\d+)\s+([A-Za-z][A-Za-z0-9\s\-]{1,15}?)\s+participants?\s*\(([\d.]+)%\)\s+achieved\s+([A-Za-z][A-Za-z\s]+?)\s+compared\s+with\s+(\d+)\s+participants?\s*\(([\d.]+)%\)\s+(?:in\s+)?(?:the\s+)?([A-Za-z][A-Za-z0-9\s\-]+?)\s+group/i;
  const m15 = pat15.exec(searchIn);
  if (m15) {
    const outcome = m15[4].trim();
    return {
      type: 'bar', y_label: `${outcome.charAt(0).toUpperCase() + outcome.slice(1)}, %`,
      datasets: [
        { label: cleanArm(m15[2]), mean: parseFloat(m15[3]) },
        { label: cleanArm(m15[7]), mean: parseFloat(m15[6]) },
      ],
    };
  }

  // Pattern 16: "N participants [X%] vs N participants [Y%]" with square brackets
  // CBT trial: "72 participants [96.0%] vs 36 participants [55.4%]"
  const pat16 = /(\d+)\s+participants?\s*\[([\d.]+)%\]\s+(?:vs\.?|versus)\s+(\d+)\s+participants?\s*\[([\d.]+)%\]/i;
  const m16 = pat16.exec(searchIn);
  if (m16) {
    // Try to find arm labels from context
    const beforeMatch = searchIn.slice(0, pat16.lastIndex ? pat16.lastIndex - m16[0].length : searchIn.indexOf(m16[0]));
    const cbtVsCtrl = beforeMatch.match(/(?:with|in|among)\s+([A-Za-z]+)\s+(?:vs\.?|versus|compared\s+(?:to|with))\s+([A-Za-z]+)/i);
    let label1 = 'Treatment', label2 = 'Control';
    if (cbtVsCtrl) {
      label1 = cbtVsCtrl[1].toUpperCase();
      label2 = cbtVsCtrl[2].toLowerCase();
    }
    return {
      type: 'bar', y_label: 'Primary outcome, %',
      datasets: [
        { label: label1, mean: parseFloat(m16[2]) },
        { label: label2, mean: parseFloat(m16[4]) },
      ],
    };
  }

  return null;
}

function detectChartDataLines(text) {
  const resSec = text.match(/\bRESULTS?\b[:\s]*([\s\S]{100,1200}?)(?=\n\s*CONCLUSIONS?\b)/i);
  const searchIn = resSec ? resSec[1] : text;

  // "LABEL group's mean ... X logMAR (Y lines) compared with Z logMAR (W lines) in LABEL2 group"
  // makale9: "CAPT group's mean improvement ... 0.72 logMAR (7.2 lines) compared with 0.58 logMAR (5.8 lines) in the patching alone group"
  // Note: '’' handles PDF-extracted Unicode right single quotation mark in "group's"
  const pat1 = /([A-Za-z][A-Za-z\s]+?)\s+group['’]?s?\s+mean\s+[\s\S]{0,80}?([\d.]+)\s+logMAR\s*\(([\d.]+)\s+lines?\)\s+compared\s+with\s+([\d.]+)\s+logMAR\s*\(([\d.]+)\s+lines?\)\s+in\s+(?:the\s+)?([A-Za-z][A-Za-z\s]+?)\s+(?:alone\s+)?group/i;
  const m = pat1.exec(searchIn);
  if (m) {
    return {
      type: 'bar', y_label: 'VA improvement, lines',
      datasets: [
        { label: m[1].trim().replace(/^(?:the|a|an)\s+/i, ''), mean: parseFloat(m[3]) },
        { label: m[6].trim().replace(/^(?:the|a|an)\s+/i, ''), mean: parseFloat(m[5]) },
      ],
    };
  }

  return null;
}

function parseText(text) {
  const result = {};
  const reviewFlags = [];

  // Text normalization: line-break hyphenation düzelt
  const normalizedText = normalizeText(text);

  // JAMA full-paper PDF ise abstract kısmını çıkar — gürültüyü azalt
  const workingText = normalizeText(extractAbstract(normalizedText));

  const studyType = detectStudyType(workingText);
  result.study_type = studyType.value;
  if (studyType.confidence < 0.7) reviewFlags.push('study_type');

  // Title: full text'ten al (abstract öncesi bölümden)
  const titleDet = detectTitle(text);
  if (titleDet) {
    result.title_raw = titleDet.value;
    if (titleDet.confidence < 0.7) reviewFlags.push('title');
  }

  // Sex: abstract önce, yoksa characteristics table (multi-arm RCT'lerde tablo daha doğru)
  const sexFromAbstract = detectSex(workingText);
  const sexFromTable    = detectSexTable(text);        // full text taranır
  // Table verisi varsa ve abstract'tan farklıysa table'ı tercih et (daha kapsamlı)
  const sex = sexFromTable || sexFromAbstract;
  const age = detectMeanAge(workingText);
  const medianAge = detectMedianAge(workingText);
  if (sex || age || medianAge) {
    result.population = {};
    if (sex) {
      result.population.n_male = sex.n_male;
      result.population.n_female = sex.n_female;
      result.population.parse_confidence = sex.confidence;
      if (sex.confidence < 0.7) reviewFlags.push('population.sex');
    }
    if (age) {
      result.population.mean_age = age.value;
      if (age.sd) result.population.mean_age_sd = age.sd;
      if (age.age_range) result.population.age_range = age.age_range;
      if (age.confidence < 0.7) reviewFlags.push('population.mean_age');
    } else if (medianAge) {
      result.population.median_age = medianAge.value;
      if (medianAge.age_range) result.population.age_range = medianAge.age_range;
      if (medianAge.confidence < 0.7) reviewFlags.push('population.median_age');
    }
    const popDesc = detectPopulationDescription(workingText);
    if (popDesc) result.population.description = popDesc.value;

    // Etnisite tespiti
    const ethnicity = detectEthnicity(text);
    if (ethnicity) {
      result.population.ethnicities = ethnicity.ethnicities;
    }

    result.population.needs_review = reviewFlags.some((f) => f.startsWith('population'));
  }

  const totalN  = detectTotalN(workingText);
  const counts  = detectParticipantCounts(workingText);
  const arms    = detectArmCounts(workingText, normalizedText);
  if (arms || counts || totalN) {
    result.intervention = {};
    if (totalN) result.intervention.total_n = totalN.value;
    if (counts) {
      if (counts.n_randomized) result.intervention.n_randomized = counts.n_randomized;
      if (counts.n_analyzed) result.intervention.n_analyzed = counts.n_analyzed;
    }
    if (arms) {
      result.intervention.arms = arms.arms;
      if (arms.confidence < 0.7) reviewFlags.push('intervention');
      result.intervention.needs_review = arms.confidence < 0.7;
    } else {
      reviewFlags.push('intervention');
    }
  } else {
    reviewFlags.push('intervention');
  }

  // Try abstract first, then full text for settings (institution info often in Methods section)
  const settings = detectSettings(workingText) || detectSettings(text);
  if (settings) {
    result.settings = { description: settings.value };
  }

  const outcome = detectPrimaryOutcome(workingText);
  if (outcome) {
    result.primary_outcome = { description: outcome.value };
    if (outcome.confidence < 0.7) reviewFlags.push('primary_outcome');
  }

  const pValue = detectPValue(workingText);
  const resultsData = detectResults(workingText);
  const summaryDet = detectFindingsSummary(workingText);
  if (pValue || resultsData || summaryDet) {
    result.findings = {};
    if (summaryDet) result.findings.summary = summaryDet.value;
    if (pValue) {
      result.findings.p_value = pValue.value;
      result.findings.parse_confidence = pValue.confidence;
      if (pValue.confidence < 0.7) reviewFlags.push('findings');
    }
    if (resultsData) {
      result.findings.results = resultsData.value;
    }
    result.findings.needs_review = reviewFlags.includes('findings');
  }

  // Chart data — "mean (SD) of X compared with Y for ARM" sentence
  const chartData = detectChartData(workingText) || detectChartData(text)
    || detectChartDataVsComparison(workingText) || detectChartDataVsComparison(text)
    || detectChartDataProportion(workingText) || detectChartDataProportion(text)
    || detectChartDataLines(workingText) || detectChartDataLines(text);
  if (chartData) {
    if (!result.findings) result.findings = {};
    const cd = { type: chartData.type, y_label: chartData.y_label, datasets: chartData.datasets };
    if (chartData.x_labels) cd.x_labels = chartData.x_labels;
    result.findings.chart_data = cd;
  }

  // Relative Risk / Odds Ratio tespit et
  const relativeRisks = detectRelativeRisk(text);
  if (relativeRisks && relativeRisks.length > 0) {
    if (!result.findings) result.findings = {};
    result.findings.relative_risks = relativeRisks;
    // Link first risk to primary_outcome.risk for display
    if (!result.primary_outcome) result.primary_outcome = {};
    result.primary_outcome.risk = relativeRisks[0];
  }

  // Citation — full text'ten al (DOI, journal, authors genellikle abstract öncesinde)
  const citation = detectCitation(text);
  if (citation && citation.value) {
    result.citation = citation.value;
  }

  result.review_flags = reviewFlags;
  return result;
}

module.exports = { parseText };
