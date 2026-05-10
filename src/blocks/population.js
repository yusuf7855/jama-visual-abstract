'use strict';

// population bloğu — kelime limiti 25.
// Node.js API kullanılmaz.

const { countWords } = require('../tokenizer/jama-tokenizer');

const WORD_LIMIT = 25;

function generate(studyData) {
  if (!studyData.population) {
    return { block: 'population', missing: true, content: null };
  }

  const p = studyData.population;
  const parts = [];

  if (p.n_male != null && p.n_female != null) {
    parts.push(`${p.n_male} men, ${p.n_female} women`);
  }
  if (p.description) parts.push(p.description);
  if (p.mean_age) {
    let ageStr;
    if (p.mean_age_sd) {
      ageStr = `Mean (SD) age, ${p.mean_age.replace(/\s*y$/, '')} (${p.mean_age_sd}) y`;
      if (p.age_range) ageStr += ` (range, ${p.age_range})`;
    } else {
      ageStr = p.age_range ? `Mean age, ${p.mean_age} (range, ${p.age_range})` : `Mean age, ${p.mean_age}`;
    }
    parts.push(ageStr);
  } else if (p.median_age) {
    const ageStr = p.age_range ? `Median age, ${p.median_age} (range, ${p.age_range})` : `Median age, ${p.median_age}`;
    parts.push(ageStr);
  }

  const content = parts.join('. ');
  const wordCount = countWords(content);

  return {
    block: 'population',
    content,
    word_count: wordCount,
    word_limit: WORD_LIMIT,
    within_limit: wordCount <= WORD_LIMIT,
    truncated: false,
    source_fields: ['population.n_male', 'population.n_female', 'population.description', 'population.mean_age', 'population.median_age', 'population.age_range'],
  };
}

module.exports = { generate };
