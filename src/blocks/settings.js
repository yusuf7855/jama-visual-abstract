'use strict';

const { countWords } = require('../tokenizer/jama-tokenizer');

const WORD_LIMIT = 15;

function generate(studyData) {
  if (!studyData.settings || !studyData.settings.description) {
    return { block: 'settings', missing: true, content: null };
  }

  const content = studyData.settings.description;
  const wordCount = countWords(content);

  return {
    block: 'settings',
    content,
    word_count: wordCount,
    word_limit: WORD_LIMIT,
    within_limit: wordCount <= WORD_LIMIT,
    truncated: false,
    source_fields: ['settings.description'],
  };
}

module.exports = { generate };
