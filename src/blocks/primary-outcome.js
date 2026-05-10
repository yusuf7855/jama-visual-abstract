'use strict';

const { countWords } = require('../tokenizer/jama-tokenizer');

const WORD_LIMIT = 25;

function generate(studyData) {
  if (!studyData.primary_outcome || !studyData.primary_outcome.description) {
    const err = new Error('MISSING_REQUIRED_FIELD — primary_outcome.description');
    err.code = 'MISSING_REQUIRED_FIELD';
    err.exitCode = 1;
    throw err;
  }

  const content = studyData.primary_outcome.description;
  const wordCount = countWords(content);

  return {
    block: 'primary_outcome',
    content,
    word_count: wordCount,
    word_limit: WORD_LIMIT,
    within_limit: wordCount <= WORD_LIMIT,
    truncated: false,
    source_fields: ['primary_outcome.description'],
  };
}

module.exports = { generate };
