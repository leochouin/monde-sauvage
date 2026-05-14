/**
 * Parse minimal CSV (commas, double-quote escapes). Returns rows as string arrays.
 * @param {string} text
 * @returns {string[][]}
 */
export function parseCsvRows(text) {
  if (!text || typeof text !== 'string') return [];
  const rows = [];
  let row = [];
  let field = '';
  let i = 0;
  let inQuotes = false;

  const pushField = () => {
    row.push(field);
    field = '';
  };
  const pushRow = () => {
    if (row.length > 0 || field !== '') {
      pushField();
      const nonEmpty = row.some((c) => String(c).trim() !== '');
      if (nonEmpty) rows.push(row);
    } else {
      field = '';
    }
    row = [];
  };

  while (i < text.length) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      field += c;
      i += 1;
      continue;
    }
    if (c === '"') {
      inQuotes = true;
      i += 1;
      continue;
    }
    if (c === ',') {
      pushField();
      i += 1;
      continue;
    }
    if (c === '\n') {
      pushRow();
      i += 1;
      continue;
    }
    if (c === '\r') {
      if (text[i + 1] === '\n') i += 1;
      pushRow();
      i += 1;
      continue;
    }
    field += c;
    i += 1;
  }
  pushField();
  if (row.length > 0) {
    const nonEmpty = row.some((cell) => String(cell).trim() !== '');
    if (nonEmpty) rows.push(row);
  }
  return rows;
}
