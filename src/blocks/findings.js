'use strict';

// findings bloğu — hard_lock sayısal koruma burada.
// Node.js API kullanılmaz.

const { countWords, truncateToLimit } = require('../tokenizer/jama-tokenizer');

const WORD_LIMIT = 50;

// Sayısal koruma: findings'teki hard_lock değerleri tespit eder.
function extractHardLockedValues(findingsData) {
  const locked = [];
  if (findingsData.p_value) locked.push(findingsData.p_value);
  if (Array.isArray(findingsData.results)) {
    findingsData.results.forEach((r) => {
      if (r.value) locked.push(r.value);
    });
  }
  return locked;
}

function buildContent(findingsData) {
  const parts = [];

  if (findingsData.summary) parts.push(findingsData.summary);

  if (Array.isArray(findingsData.results)) {
    findingsData.results.forEach((r) => {
      parts.push(`${r.arm}: ${r.metric}, ${r.value}`);
    });
  }

  if (findingsData.p_value) parts.push(findingsData.p_value);

  return parts.join('. ');
}

// Minimum içerik: summary çıkarıldığında geriye kalan zorunlu kısım (results + p_value).
// Bu kısım kesilemez; eğer bu bile limiti aşıyorsa TRUNCATION_IMPOSSIBLE.
function buildMinimalContent(findingsData) {
  const parts = [];
  if (Array.isArray(findingsData.results)) {
    findingsData.results.forEach((r) => {
      parts.push(`${r.arm}: ${r.metric}, ${r.value}`);
    });
  }
  if (findingsData.p_value) parts.push(findingsData.p_value);
  return parts.join('. ');
}

/**
 * @param {Object} studyData
 * @returns {Object} blok sonucu
 */
function generate(studyData) {
  if (!studyData.findings) {
    return { block: 'findings', missing: true, content: null };
  }

  const hardLockedValues = extractHardLockedValues(studyData.findings);

  // Minimum içerik kontrolü: results + p_value limiti zaten aşıyorsa impossible.
  const minimalContent = buildMinimalContent(studyData.findings);
  const minimalCount = countWords(minimalContent);
  if (minimalCount > WORD_LIMIT) {
    const err = new Error(
      `TRUNCATION_IMPOSSIBLE — results + p_value ${minimalCount} kelime, limit ${WORD_LIMIT}. Hard-locked değerler kesilemez.`
    );
    err.code = 'TRUNCATION_IMPOSSIBLE';
    err.exitCode = 2;
    throw err;
  }

  const rawContent = buildContent(studyData.findings);
  const rawCount = countWords(rawContent);

  if (rawCount <= WORD_LIMIT) {
    return {
      block: 'findings',
      content: rawContent,
      word_count: rawCount,
      word_limit: WORD_LIMIT,
      within_limit: true,
      truncated: false,
      hard_locked_values: hardLockedValues,
      source_fields: ['findings.summary', 'findings.results', 'findings.p_value'],
    };
  }

  // Sayısal koruma adımları — önce zarflar/sıfatlar, sonra bağlaçlar, sonra tekrar bağlam
  let working = rawContent;

  const REMOVABLE_ADVERBS = /\b(significantly|notably|markedly|remarkably|substantially|considerably)\b/gi;
  const FILLER_PHRASES = /\bThere were\b|\bas compared to\b|\bwhich is\b/gi;

  working = working.replace(REMOVABLE_ADVERBS, '').replace(/\s{2,}/g, ' ').trim();
  if (countWords(working) <= WORD_LIMIT) {
    return buildResult(working, hardLockedValues, true);
  }

  working = working.replace(FILLER_PHRASES, '').replace(/\s{2,}/g, ' ').trim();
  if (countWords(working) <= WORD_LIMIT) {
    return buildResult(working, hardLockedValues, true);
  }

  // Son adım: token seviyesi kesme, hard_lock korunur
  const { content: truncated, truncated: wasTruncated } = truncateToLimit(
    working,
    WORD_LIMIT,
    hardLockedValues
  );

  const finalCount = countWords(truncated);
  if (finalCount > WORD_LIMIT) {
    // Hard_lock değerleri kesilemedi
    const err = new Error(
      `TRUNCATION_IMPOSSIBLE — findings bloğu ${finalCount} kelime, limit ${WORD_LIMIT}. Hard-locked değerler: ${hardLockedValues.join(', ')}`
    );
    err.code = 'TRUNCATION_IMPOSSIBLE';
    err.exitCode = 2;
    throw err;
  }

  return buildResult(truncated, hardLockedValues, wasTruncated);
}

function buildResult(content, hardLockedValues, truncated) {
  return {
    block: 'findings',
    content,
    word_count: countWords(content),
    word_limit: WORD_LIMIT,
    within_limit: countWords(content) <= WORD_LIMIT,
    truncated,
    hard_locked_values: hardLockedValues,
    source_fields: ['findings.summary', 'findings.results', 'findings.p_value'],
  };
}

module.exports = { generate };
