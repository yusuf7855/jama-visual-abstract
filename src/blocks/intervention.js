'use strict';

// intervention bloğu — her kol ≤ 20, toplam ≤ 40.
// Her kol bağımsız doğrulanır.
// Node.js API kullanılmaz.

const { countWords } = require('../tokenizer/jama-tokenizer');

const ARM_LIMIT = 20;
const TOTAL_LIMIT = 40;

function generate(studyData) {
  if (!studyData.intervention || !Array.isArray(studyData.intervention.arms)) {
    return { block: 'intervention', missing: true, content: null };
  }

  const arms = studyData.intervention.arms;
  const armResults = arms.map((arm, i) => {
    const text = `${arm.label}: ${arm.description}`;
    const wordCount = countWords(text);
    const withinLimit = wordCount <= ARM_LIMIT;

    if (!withinLimit) {
      const err = new Error(
        `INTERVENTION_ARM_OVERLIMIT — arm[${i}] (${arm.label}): ${wordCount}/${ARM_LIMIT} words`
      );
      err.code = 'INTERVENTION_ARM_OVERLIMIT';
      err.exitCode = 2;
      throw err;
    }

    return { arm: arm.label, content: text, word_count: wordCount, within_limit: withinLimit };
  });

  const totalContent = armResults.map((a) => a.content).join('. ');
  const totalCount = countWords(totalContent);

  if (totalCount > TOTAL_LIMIT) {
    const err = new Error(
      `INTERVENTION_TOTAL_OVERLIMIT — total: ${totalCount}/${TOTAL_LIMIT} words`
    );
    err.code = 'INTERVENTION_TOTAL_OVERLIMIT';
    err.exitCode = 2;
    throw err;
  }

  return {
    block: 'intervention',
    content: totalContent,
    word_count: totalCount,
    word_limit: TOTAL_LIMIT,
    within_limit: true,
    truncated: false,
    arms: armResults,
    source_fields: ['intervention.arms'],
  };
}

module.exports = { generate };
