/**
 * Where `offset` sits in `text`. Lines and columns match Notia's editor:
 * a column is a JavaScript string index on that line.
 * @param {string} text
 * @param {number} offset
 */
export function positionAt(text, offset) {
  const clamped = Math.max(0, Math.min(text.length, Number.isFinite(offset) ? Math.trunc(offset) : 0));
  let line = 0;
  let start = 0;
  for (let i = 0; i < clamped; i++) {
    if (text.charCodeAt(i) === 10) {
      line += 1;
      start = i + 1;
    }
  }
  return { line, ch: clamped - start };
}

/**
 * Replaces `from`–`to` in `text` with a rendered template. `cursor` is an
 * index in the result, at the template's cursor or just after the insert.
 * @param {string} text
 * @param {number} from
 * @param {number} to
 * @param {{ text: string, cursor: number | null }} rendered
 */
export function spliceText(text, from, to, rendered) {
  const start = clamp(Math.min(from, to), 0, text.length);
  const end = clamp(Math.max(from, to), 0, text.length);
  const next = text.slice(0, start) + rendered.text + text.slice(end);
  const at = rendered.cursor == null ? rendered.text.length : rendered.cursor;
  return { text: next, cursor: clamp(start + at, 0, next.length) };
}

/** @param {number} value @param {number} min @param {number} max */
function clamp(value, min, max) {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}
