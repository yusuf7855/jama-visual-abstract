'use strict';

// VisualAbstractDeck assembler.
// Üretilmiş blokları tek bir deck objesinde birleştirir.
// Node.js API kullanılmaz — browser uyumlu.

const SCHEMA_VERSION = '1.0';

/**
 * @param {string} studyType
 * @param {Object} blocks  — { blockName: blockResult, ... }
 * @returns {Object} VisualAbstractDeck
 */
function assembleDeck(studyType, blocks) {
  const blockNames = Object.keys(blocks);
  let blocksWithinLimit = 0;
  let blocksTruncated = 0;
  let blocksFailed = 0;

  for (const name of blockNames) {
    const b = blocks[name];
    if (b.missing) continue;
    if (b.within_limit) blocksWithinLimit++;
    if (b.truncated) blocksTruncated++;
    if (b.error) blocksFailed++;
  }

  const hasReviewFlags = blockNames.some(
    (n) => blocks[n].needs_review || blocks[n].error
  );

  return {
    schema_version: SCHEMA_VERSION,
    study_type: studyType,
    blocks,
    deck_valid: blocksFailed === 0 && !hasReviewFlags,
    validation_report: {
      blocks_within_limit: blocksWithinLimit,
      blocks_truncated: blocksTruncated,
      blocks_failed: blocksFailed,
    },
  };
}

module.exports = { assembleDeck };
