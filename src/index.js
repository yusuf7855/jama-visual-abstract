'use strict';

// Paket entry point — browser/ESM uyumlu.
// Node.js API kullanılmaz.

const { assembleDeck } = require('./assembler');
const { parseText } = require('./parser/text-parser');
const { validateInput } = require('./validator/schema');

const blockModules = {
  title: require('./blocks/title'),
  population: require('./blocks/population'),
  intervention: require('./blocks/intervention'),
  settings: require('./blocks/settings'),
  primary_outcome: require('./blocks/primary-outcome'),
  findings: require('./blocks/findings'),
  citation: require('./blocks/citation'),
};

const ALL_BLOCKS = Object.keys(blockModules);

/**
 * Ana API. CLI ve tarayıcı bu fonksiyonu kullanır.
 *
 * @param {Object} options
 * @param {Object|string} options.input  — yapılandırılmış JSON objesi veya ham metin string'i
 * @param {string[]} options.blocks      — ['all'] veya blok adları listesi
 * @param {string} [options.inputFormat] — 'json' (varsayılan) veya 'text'
 * @returns {Promise<Object>}            — tek blok veya VisualAbstractDeck
 */
async function generate({ input, blocks = ['all'], inputFormat = 'json' }) {
  let studyData;

  if (inputFormat === 'text' || typeof input === 'string') {
    studyData = parseText(input);
  } else {
    studyData = input;
  }

  const validationError = validateInput(studyData);
  if (validationError) {
    const err = new Error(`MISSING_REQUIRED_FIELD — ${validationError}`);
    err.code = 'MISSING_REQUIRED_FIELD';
    err.exitCode = 1;
    throw err;
  }

  const requestedBlocks = blocks.includes('all') ? ALL_BLOCKS : blocks;

  if (requestedBlocks.length === 1) {
    const name = requestedBlocks[0];
    return blockModules[name].generate(studyData);
  }

  const results = {};
  for (const name of requestedBlocks) {
    if (!blockModules[name]) continue;
    results[name] = blockModules[name].generate(studyData);
  }

  return assembleDeck(studyData.study_type, results);
}

module.exports = { generate, parseText };
