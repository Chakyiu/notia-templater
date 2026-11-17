// Tags in the shape Obsidian's Templater uses. The whole template becomes
// one function, so a `tp.file.rename` is visible to the tags after it, and
// an execution block can append to `tR`.

import { formatDate, shiftDate, weekdayDate } from "./date.js";
import {
  baseTitle,
  cleanTitle,
  includeCandidates,
  noteFilePath,
  noteKey,
  parentFolder,
} from "./files.js";

/** A template the New template command writes and opens. */
export const STARTER = `---
date: <% tp.date.now("YYYY-MM-DD") %>
---

# <% tp.file.title %>

<% tp.file.cursor() %>
`;

const MAX_SOURCE = 500_000;
const MAX_OUTPUT = 500_000;
const MAX_INCLUDE = 8;
const CURSOR = /\u2063notia-cursor:(\d+)\u2063/g;

export class TemplateError extends Error {
  /** @param {string} message */
  constructor(message) {
    super(message);
    this.name = "TemplateError";
  }
}

/**
 * @typedef {object} RenderOptions
 * @property {string} [title]
 * @property {string} [folder]
 * @property {string} [path]
 * @property {string} [fromPath]
 * @property {string} [selection]
 * @property {string} [content]
 * @property {string[]} [tags]
 * @property {boolean} [creating]
 * @property {Date} [now]
 * @property {Date | null} [created]
 * @property {Date | null} [modified]
 * @property {string} [dateFormat]
 * @property {string} [templatesFolder]
 * @property {(path: string) => string | null | undefined} [read]
 */

/**
 * Runs `source` and returns the note text, where the cursor should sit,
 * and the title (`tp.file.rename` may change it while creating a note).
 * @param {string} source
 * @param {RenderOptions} [options]
 */
export async function renderTemplate(source, options = {}) {
  if (source.length > MAX_SOURCE) throw new TemplateError("That template is too long");
  /** @type {{ order: number }[]} */
  const cursors = [];
  const state = {
    title: options.title ?? "Untitled",
    folder: options.folder ?? "",
    path: options.path ?? "",
    fromPath: noteKey(options.fromPath ?? ""),
    selection: options.selection ?? "",
    content: options.content ?? "",
    tags: options.tags ?? [],
    creating: options.creating === true,
    renamed: false,
    cursors,
    /** @type {string[]} */
    stack: [],
  };
  if (state.fromPath) state.stack.push(state.fromPath);
  const text = await expand(source, state, options);
  if (text.length > MAX_OUTPUT) throw new TemplateError("The template result is too long");
  const placed = placeCursor(text, cursors);
  return { ...placed, title: state.title, renamed: state.renamed };
}

/**
 * @param {string} source
 * @param {TemplateState} state
 * @param {RenderOptions} options
 */
async function expand(source, state, options) {
  const parts = parse(source);
  const body = compile(parts);
  const tp = createTp(state, options, (nested) => expand(nested, state, options));
  return execute(body, tp);
}

/**
 * @typedef {object} TemplateState
 * @property {string} title
 * @property {string} folder
 * @property {string} path
 * @property {string} fromPath
 * @property {string} selection
 * @property {string} content
 * @property {string[]} tags
 * @property {boolean} creating
 * @property {boolean} renamed
 * @property {{ order: number }[]} cursors
 * @property {string[]} stack
 */

/**
 * @typedef {{ kind: "text", text: string } | { kind: "expr" | "block", code: string, trimBefore: boolean, trimAfter: boolean }} Part
 */

/** @param {string} source @returns {Part[]} */
function parse(source) {
  /** @type {Part[]} */
  const parts = [];
  let cursor = 0;
  while (cursor < source.length) {
    const open = source.indexOf("<%", cursor);
    if (open === -1) {
      parts.push({ kind: "text", text: source.slice(cursor) });
      break;
    }
    parts.push({ kind: "text", text: source.slice(cursor, open) });
    let at = open + 2;
    let trimBefore = false;
    if (source[at] === "-") {
      trimBefore = true;
      at += 1;
    }
    let kind = "expr";
    if (source[at] === "*") {
      kind = "block";
      at += 1;
    } else if (source[at] === "#") {
      kind = "comment";
      at += 1;
    } else if (source[at] === "+" || source[at] === "=") {
      at += 1;
    }
    const tag = readTag(source, at);
    if (kind !== "comment") {
      parts.push({ kind: /** @type {"expr" | "block"} */ (kind), code: tag.code, trimBefore, trimAfter: tag.trimAfter });
    } else if (trimBefore || tag.trimAfter) {
      parts.push({ kind: "expr", code: "", trimBefore, trimAfter: tag.trimAfter });
    }
    cursor = tag.end;
  }
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if (part.kind === "text") continue;
    if (part.trimBefore) {
      const previous = parts[i - 1];
      if (previous?.kind === "text") previous.text = previous.text.replace(/[ \t\r\n]+$/u, "");
    }
    if (part.trimAfter) {
      const next = parts[i + 1];
      if (next?.kind === "text") next.text = next.text.replace(/^[ \t\r\n]+/u, "");
    }
  }
  return parts;
}

/** @param {string} source @param {number} start */
function readTag(source, start) {
  let quote = "";
  let escape = false;
  let lineComment = false;
  let blockComment = false;
  for (let i = start; i < source.length; i++) {
    const current = source[i];
    const next = source[i + 1];
    if (lineComment) {
      if (current === "\n") lineComment = false;
      continue;
    }
    if (blockComment) {
      if (current === "*" && next === "/") {
        blockComment = false;
        i += 1;
      }
      continue;
    }
    if (quote) {
      if (escape) {
        escape = false;
        continue;
      }
      if (current === "\\") {
        escape = true;
        continue;
      }
      if (current === quote) quote = "";
      continue;
    }
    if (current === "/" && next === "/") {
      lineComment = true;
      i += 1;
      continue;
    }
    if (current === "/" && next === "*") {
      blockComment = true;
      i += 1;
      continue;
    }
    if (current === '"' || current === "'" || current === "`") {
      quote = current;
      continue;
    }
    if (current === "-" && next === "%" && source[i + 2] === ">") {
      return { end: i + 3, code: source.slice(start, i).trim(), trimAfter: true };
    }
    if (current === "%" && next === ">") {
      return { end: i + 2, code: source.slice(start, i).trim(), trimAfter: false };
    }
  }
  const line = source.slice(0, start).split("\n").length;
  throw new TemplateError(`A <% tag is missing %> around line ${line}`);
}

/** @param {Part[]} parts */
function compile(parts) {
  let body = 'let tR = "";\n';
  for (const part of parts) {
    if (part.kind === "text") {
      if (part.text) body += `tR += ${JSON.stringify(part.text)};\n`;
    } else if (part.kind === "expr" && part.code) {
      body += `tR += __str(await (${part.code}));\n`;
    } else if (part.kind === "block" && part.code) {
      body += `${part.code}\n`;
    }
  }
  return `${body}return tR;`;
}

/**
 * @param {string} body
 * @param {object} tp
 */
async function execute(body, tp) {
  const Factory = /** @type {new (...args: string[]) => Function} */ (
    Object.getPrototypeOf(async function () {}).constructor
  );
  /** @type {(tp: object, __str: typeof stringify) => Promise<unknown>} */
  let fn;
  try {
    fn = /** @type {typeof fn} */ (new Factory("tp", "__str", `"use strict";\n${body}`));
  } catch (error) {
    throw wrap(error);
  }
  try {
    const value = await fn(tp, stringify);
    return typeof value === "string" ? value : stringify(value);
  } catch (error) {
    throw wrap(error);
  }
}

/** @param {unknown} error */
function wrap(error) {
  if (error instanceof TemplateError) return error;
  return new TemplateError(error instanceof Error ? error.message : String(error));
}

/**
 * A function tagged with `templateValue` inserts that text when a tag names
 * it without calling it, so `<% tp.file.path %>` and `<% tp.file.path() %>` match.
 * @param {Function} fn
 */
function expose(fn) {
  /** @type {((...args: unknown[]) => unknown) & { templateValue?: () => unknown }} */
  const wrapped = (...args) => fn(...args);
  wrapped.templateValue = () => fn();
  return wrapped;
}

/** @param {unknown} value @param {number} [depth] */
function stringify(value, depth = 0) {
  if (value == null || depth > 3) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (value instanceof Date) return formatDate(value, "YYYY-MM-DD");
  if (typeof value === "function" && "templateValue" in value && typeof value.templateValue === "function") {
    return stringify(value.templateValue(), depth + 1);
  }
  return String(value);
}

/**
 * @param {string} text
 * @param {{ order: number }[]} cursors
 */
function placeCursor(text, cursors) {
  /** @type {{ order: number, index: number, length: number }[]} */
  const found = [];
  for (const match of text.matchAll(new RegExp(CURSOR.source, "g"))) {
    const id = Number(match[1]);
    found.push({
      order: cursors[id]?.order ?? 0,
      index: match.index ?? 0,
      length: match[0].length,
    });
  }
  if (!found.length) return { text, cursor: /** @type {number | null} */ (null) };
  found.sort((a, b) => a.order - b.order || a.index - b.index);
  const chosen = found[0].index;
  let cursor = chosen;
  let result = text;
  for (const mark of [...found].sort((a, b) => b.index - a.index)) {
    result = result.slice(0, mark.index) + result.slice(mark.index + mark.length);
    if (mark.index < chosen) cursor -= mark.length;
  }
  return { text: result, cursor };
}

/**
 * @param {TemplateState} state
 * @param {RenderOptions} options
 * @param {(source: string) => Promise<string>} expandNested
 */
function createTp(state, options, expandNested) {
  const now = options.now instanceof Date ? options.now : new Date();
  const dateFormat = options.dateFormat?.trim() || "YYYY-MM-DD";
  const created = options.created instanceof Date ? options.created : now;
  const modified = options.modified instanceof Date ? options.modified : now;
  const frontmatter = parseFrontmatter(state.content);

  /** @param {Date} date @param {unknown} format @param {unknown} [offset] */
  const formatAt = (date, format, offset) => {
    const pattern = typeof format === "string" && format.trim() ? format : dateFormat;
    try {
      return formatDate(shiftDate(date, offset), pattern);
    } catch (error) {
      throw wrap(error);
    }
  };

  const currentPath = () => {
    if (!state.renamed && state.path) return state.path.toLowerCase().endsWith(".md") ? state.path : `${state.path}.md`;
    return noteFilePath(state.folder, state.title);
  };

  const cursor = expose(/** @param {unknown} [order] */ (order = 0) => {
    const id = state.cursors.length;
    const value = Number(order);
    state.cursors.push({ order: Number.isFinite(value) ? value : 0 });
    return `\u2063notia-cursor:${id}\u2063`;
  });

  const file = {
    get title() {
      return baseTitle(state.title);
    },
    path: expose(currentPath),
    folder: expose(() => parentFolder(currentPath())),
    get content() {
      return state.content;
    },
    get tags() {
      return [...state.tags];
    },
    selection: expose(() => state.selection),
    cursor,
    /** @param {unknown} content */
    cursor_append(content) {
      return `${cursor(0)}${stringify(content)}`;
    },
    creation_date: expose(/** @param {unknown} [format] */ (format) => formatAt(created, format)),
    last_modified_date: expose(/** @param {unknown} [format] */ (format) => formatAt(modified, format)),
    /** @param {unknown} name */
    rename(name) {
      if (!state.creating) {
        throw new TemplateError("tp.file.rename sets the name when creating a note. Insert the template into a note that already has one.");
      }
      state.title = cleanTitle(name);
      state.renamed = true;
      return "";
    },
    /** @param {unknown} spec */
    async include(spec) {
      const candidates = includeCandidates(spec, {
        templatesFolder: options.templatesFolder,
        fromPath: state.fromPath,
      });
      if (!candidates.length) throw new TemplateError(`Cannot include “${spec}”`);
      /** @type {{ path: string, text: string } | null} */
      let found = null;
      for (const candidate of candidates) {
        const text = options.read?.(candidate);
        if (typeof text !== "string") continue;
        if (state.stack.includes(candidate)) throw new TemplateError(`Template “${candidate}” includes itself`);
        found = { path: candidate, text };
        break;
      }
      if (!found) throw new TemplateError(`No note for “${spec}”`);
      if (state.stack.length >= MAX_INCLUDE) throw new TemplateError("Templates include each other too deeply");
      const previous = state.fromPath;
      state.stack.push(found.path);
      state.fromPath = found.path;
      try {
        return await expandNested(found.text);
      } finally {
        state.stack.pop();
        state.fromPath = previous;
      }
    },
  };

  const date = {
    now: expose(/** @param {unknown} [format] @param {unknown} [offset] */ (format, offset) => formatAt(now, format, offset)),
    tomorrow: expose(/** @param {unknown} [format] */ (format) => formatAt(now, format, 1)),
    yesterday: expose(/** @param {unknown} [format] */ (format) => formatAt(now, format, -1)),
    weekday: expose(/** @param {unknown} [format] @param {unknown} [weekday] */ (format, weekday) => {
      try {
        const which = typeof weekday === "number" || typeof weekday === "string" ? weekday : "Monday";
        return formatDate(weekdayDate(now, which), typeof format === "string" && format.trim() ? format : dateFormat);
      } catch (error) {
        throw wrap(error);
      }
    }),
  };

  const system = {
    prompt() {
      throw new TemplateError("Write the value in the template. A command here finishes in one step, with no prompt.");
    },
  };

  return { date, file, frontmatter, system };
}

/** Flat `key: value` lines between the opening fences. Nested YAML stays text. @param {string} content */
function parseFrontmatter(content) {
  const match = String(content ?? "").match(/^---\r?\n([\s\S]*?)\r?\n---/);
  /** @type {Record<string, string | number | boolean | null>} */
  const data = {};
  if (!match) return data;
  for (const line of match[1].split(/\r?\n/)) {
    const item = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!item) continue;
    data[item[1]] = yamlValue(item[2].trim());
  }
  return data;
}

/** @param {string} value @returns {string | number | boolean | null} */
function yamlValue(value) {
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }
  if (value === "true") return true;
  if (value === "false") return false;
  if (value === "null" || value === "~") return null;
  if (/^-?\d+(?:\.\d+)?$/.test(value)) return Number(value);
  return value;
}
