/** Static trusted worker code. Only JSON query/text data crosses this boundary; never user JS. */
export const regexWorkerSource = String.raw`
const { parentPort } = require('node:worker_threads');
parentPort.on('message', ({ query, syntax, caseSensitive, text, limit }) => {
  let expression;
  try {
    const source = syntax === 'literal' ? query.replace(/[.*+?^$\{\}()|[\]\\]/g, '\\$&') : query;
    expression = new RegExp(source, caseSensitive ? 'u' : 'iu');
  } catch {
    parentPort.postMessage({ error: 'pattern' });
    return;
  }
  const matches = [];
  const lines = text.split(/\r\n|\n|\r/);
  for (let line = 0; line < lines.length; line++) {
    const match = expression.exec(lines[line]);
    if (match) matches.push({ line, offset: match.index });
    if (matches.length >= limit) break;
  }
  parentPort.postMessage({ matches });
});
`;
