'use strict';

// citation bloğu — bibliyografik format, kelime limiti yok.

function generate(studyData) {
  if (!studyData.citation) {
    return { block: 'citation', missing: true, content: null };
  }

  const c = studyData.citation;
  const parts = [c.authors, c.title, c.journal, c.published, c.doi].filter(Boolean);
  const content = parts.join(' ');

  return {
    block: 'citation',
    content,
    word_count: null,
    word_limit: null,
    within_limit: true,
    truncated: false,
    source_fields: ['citation.authors', 'citation.title', 'citation.journal', 'citation.published', 'citation.doi'],
  };
}

module.exports = { generate };
