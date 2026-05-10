'use strict';

const { countWords } = require('../tokenizer/jama-tokenizer');

const WORD_LIMIT = 20;

function generate(studyData) {
  if (!studyData.title_raw) {
    return { block: 'title', missing: true, content: null };
  }

  const wordCount = countWords(studyData.title_raw);

  return {
    block: 'title',
    content: studyData.title_raw,
    word_count: wordCount,
    word_limit: WORD_LIMIT,
    within_limit: wordCount <= WORD_LIMIT,
    truncated: false,
    source_fields: ['title_raw'],
  };
}

module.exports = { generate };
