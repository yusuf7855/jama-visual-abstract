'use strict';

// JAMA Visual Abstract tokenizer.
// Klinik metni naif split(" ") yerine JAMA kurallarına göre token'lara ayırır.
// Node.js API kullanılmaz — browser uyumlu.

// Sıralı regex pattern'ları; ilk eşleşen kazanır.
const TOKEN_PATTERNS = [
  // mean (SD), 3.3 (3.6) d  →  ["mean (SD),", "3.3 (3.6) d"]  (her biri 1 token)
  /mean\s*\(SD\),?\s*[\d.]+\s*\([\d.]+\)\s*\w+/i,
  // İstatistik ifadesi: P=.01, P<.001, p-value=0.05
  /[Pp][\s]*[=<>≤≥]\s*\.?\d+/,
  // Negatif sayı+birim: -4.7 (95% CI formatlarında); COMBINED i-flagsiz çalışır
  /-[\d.]+\s*(?:y|d|mo|wk|h|min|s|patients?|participants?|subjects?|centers?|[Ll]ines?|°)/,
  // Sayı+birim ikilisi: 62.6 y, 214 patients, 3.3 d, 60°, 7.2 Lines
  /[\d.]+\s*(?:y|d|mo|wk|h|min|s|patients?|participants?|subjects?|centers?|[Ll]ines?|°)/,
  // Parantezli sayı bloğu: (3.6) veya (SD)
  /\([\d.]+\)/,
  /\(SD\)/i,
  // Kısaltmalar (büyük harf dizisi): BPPV, RCT, CAPT, OMT
  /\b[A-Z]{2,}\b/,
  // Standart kelime (noktalama dahil)
  /\S+/,
];

const COMBINED = new RegExp(
  TOKEN_PATTERNS.map((p) => `(?:${p.source})`).join('|'),
  'g'
);

/**
 * Metni JAMA kurallarına göre token listesine ayırır.
 * @param {string} text
 * @returns {string[]}
 */
function tokenize(text) {
  if (!text || typeof text !== 'string') return [];
  const matches = text.match(COMBINED);
  return matches || [];
}

/**
 * Metindeki JAMA kelime sayısını döner.
 * @param {string} text
 * @returns {number}
 */
function countWords(text) {
  return tokenize(text).length;
}

/**
 * Metni token sınırına göre keser. hard_lock token'larına dokunmaz.
 * @param {string} text
 * @param {number} limit
 * @param {string[]} hardLockedValues  — korunacak değerler
 * @returns {{ content: string, truncated: boolean }}
 */
function truncateToLimit(text, limit, hardLockedValues = []) {
  const tokens = tokenize(text);
  if (tokens.length <= limit) {
    return { content: text, truncated: false };
  }

  const locked = new Set(hardLockedValues);
  const kept = [];
  let count = 0;

  for (const token of tokens) {
    if (locked.has(token)) {
      kept.push(token);
      count++;
    } else if (count < limit) {
      kept.push(token);
      count++;
    }
  }

  return {
    content: kept.join(' '),
    truncated: true,
  };
}

module.exports = { tokenize, countWords, truncateToLimit };
