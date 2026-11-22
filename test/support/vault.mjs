// Small stand-ins for the parts of the Notia API the plugin uses. The vault
// keeps notes in memory; the workspace holds one open note and its editor.
// Paths follow Notia: `.md` is optional, and `getNotes` returns it.

/** @param {string} path */
function key(path) {
  return String(path ?? "")
    .replace(/\\/g, "/")
    .replace(/\.md$/i, "")
    .replace(/^\/+|\/+$/g, "");
}

/** @param {string} path */
function withMarkdown(path) {
  return `${key(path)}.md`;
}

/**
 * @param {Record<string, string | { text: string, tags?: string[], modified?: number | null }>} [initial]
 */
export function makeVault(initial = {}) {
  /** @type {Map<string, { text: string, tags: string[], modified: number | null }>} */
  const files = new Map();
  for (const [path, value] of Object.entries(initial)) {
    const note = typeof value === "string" ? { text: value } : value;
    files.set(key(path), { text: note.text, tags: note.tags ?? [], modified: note.modified ?? null });
  }
  /** @type {Map<string, ((...args: string[]) => unknown)[]>} */
  const listeners = new Map();

  const vault = {
    /** @param {string} event @param {(...args: string[]) => unknown} callback */
    on(event, callback) {
      const list = listeners.get(event) ?? [];
      list.push(callback);
      listeners.set(event, list);
      return { event, off() {} };
    },
    /** @param {string} event */
    emit(event) {
      for (const callback of listeners.get(event) ?? []) callback();
    },
    getName: () => "Vault",
    getNotes() {
      return [...files.keys()]
        .sort()
        .map((path) => ({
          path: withMarkdown(path),
          name: path.slice(path.lastIndexOf("/") + 1),
          tags: [...(files.get(path)?.tags ?? [])],
          words: 0,
          modified: files.get(path)?.modified ?? null,
        }));
    },
    /** @param {string} path */
    read(path) {
      const note = files.get(key(path));
      if (!note) throw new Error(`No note at ${path}`);
      return note.text;
    },
    /** @param {string} path */
    exists(path) {
      return files.has(key(path));
    },
    /** @param {string} path @param {string} [text] */
    create(path, text = "") {
      const name = key(path);
      if (files.has(name)) throw new Error(`${name} already exists`);
      files.set(name, { text, tags: [], modified: null });
      return withMarkdown(name);
    },
    /** @param {string} path @param {string} text */
    modify(path, text) {
      const note = files.get(key(path));
      if (!note) throw new Error(`No note at ${path}`);
      note.text = text;
    },
    /** @param {string} path @param {string} text */
    append(path, text) {
      const note = files.get(key(path));
      if (!note) throw new Error(`No note at ${path}`);
      note.text = `${note.text}${note.text ? "\n" : ""}${text}`;
    },
    /** @param {string} path */
    text(path) {
      return files.get(key(path))?.text;
    },
  };
  return vault;
}

/** @param {string} text @param {{ line: number, ch: number }} [at] */
export function makeEditor(text, at = { line: 0, ch: 0 }) {
  let value = text;
  let cursor = { anchor: at, head: at };
  const editor = {
    focused: false,
    /** @type {object[]} */
    transactions: [],
    getDoc: () => editor,
    refresh() {},
    getValue: () => value,
    /** @param {string} next */
    setValue(next) {
      value = next;
    },
    /** @param {number} line */
    getLine(line) {
      return value.split("\n")[line] ?? "";
    },
    lineCount: () => value.split("\n").length,
    lastLine: () => value.split("\n").length - 1,
    getSelection: () => value.slice(offset(cursor.anchor), offset(cursor.head)),
    somethingSelected: () => offset(cursor.anchor) !== offset(cursor.head),
    /** @param {{ line: number, ch: number }} from @param {{ line: number, ch: number }} to */
    getRange: (from, to) => value.slice(offset(from), offset(to)),
    /** @param {string} next */
    replaceSelection(next) {
      editor.transaction({ changes: [{ from: cursor.anchor, to: cursor.head, text: next }] });
    },
    /** @param {"from" | "to" | "head" | "anchor"} [which] */
    getCursor(which = "head") {
      return which === "from" || which === "anchor" ? cursor.anchor : cursor.head;
    },
    listSelections: () => [{ anchor: cursor.anchor, head: cursor.head }],
    /** @param {{ line: number, ch: number } | number} position @param {number} [ch] */
    setCursor(position, ch) {
      const next = typeof position === "number" ? { line: position, ch: ch ?? 0 } : position;
      cursor = { anchor: next, head: next };
    },
    /** @param {{ line: number, ch: number }} anchor @param {{ line: number, ch: number }} [head] */
    setSelection(anchor, head = anchor) {
      cursor = { anchor, head };
    },
    posToOffset: (position) => offset(position),
    offsetToPos: (index) => position(index),
    /**
     * @param {{ changes?: { from: { line: number, ch: number }, to?: { line: number, ch: number }, text: string }[], selection?: { from: { line: number, ch: number }, to?: { line: number, ch: number } } }} change
     */
    transaction(change) {
      editor.transactions.push(change);
      /** @type {{ start: number, end: number, text: string }[]} */
      const edits = (change.changes ?? []).map((item) => ({
        start: offset(item.from),
        end: item.to ? offset(item.to) : offset(item.from),
        text: item.text,
      }));
      const before = value;
      value = nextText(before, edits);
      if (change.selection) {
        const from = offsetIn(value, change.selection.from);
        cursor = { anchor: from, head: from };
      }
    },
    focus() {
      editor.focused = true;
    },
  };

  /** @param {{ line: number, ch: number }} position */
  function offset(position) {
    const lines = value.split("\n");
    const line = Math.max(0, Math.min(lines.length - 1, position?.line ?? 0));
    const start = lines.slice(0, line).reduce((sum, text) => sum + text.length + 1, 0);
    return start + Math.max(0, Math.min(lines[line].length, position?.ch ?? 0));
  }

  /** @param {number} index */
  function position(index) {
    const clamped = Math.max(0, Math.min(value.length, index));
    const before = value.slice(0, clamped).split("\n");
    return { line: before.length - 1, ch: before[before.length - 1].length };
  }

  return editor;
}

/** @param {string} before @param {{ start: number, end: number, text: string }[]} edits */
function nextText(before, edits) {
  let next = "";
  let at = 0;
  for (const edit of [...edits].sort((a, b) => a.start - b.start)) {
    next += before.slice(at, edit.start) + edit.text;
    at = edit.end;
  }
  return next + before.slice(at);
}

/** @param {string} text @param {{ line: number, ch: number }} target */
function offsetIn(text, target) {
  const lines = text.split("\n");
  const line = Math.max(0, Math.min(lines.length - 1, target?.line ?? 0));
  const start = lines.slice(0, line).reduce((sum, part) => sum + part.length + 1, 0);
  const index = start + Math.max(0, Math.min(lines[line].length, target?.ch ?? 0));
  const at = text.slice(0, index).split("\n");
  return { line: at.length - 1, ch: at[at.length - 1].length };
}

/**
 * One open note at a time. `deferOpen` mimics Notia opening a note a moment
 * after the plugin asks, so the cursor retry can be driven by the test.
 * @param {ReturnType<typeof makeVault>} vault
 */
export function makeWorkspace(vault) {
  /** @type {{ note: object, editor: ReturnType<typeof makeEditor> } | null} */
  let active = null;
  /** @type {{ path: string, options: object } | null} */
  let pending = null;
  /** @type {Map<string, ((...args: unknown[]) => unknown)[]>} */
  const listeners = new Map();

  const workspace = {
    openNoteCalls: [],
    /** @param {string} path @param {object} [options] */
    openNote(path, options = {}) {
      workspace.openNoteCalls.push({ path, options });
      if (workspace.deferOpen) {
        pending = { path, options };
        return;
      }
      workspace.activate(path, options);
    },
    /** @param {string} path @param {object} [options] */
    activate(path, options = {}) {
      const text = vault.read(path);
      const editor = makeEditor(text);
      if (typeof options.line === "number") editor.setCursor({ line: options.line, ch: 0 });
      active = { note: noteFor(path, editor), editor };
    },
    /** @param {string} path @param {string} [text] */
    open(path, text) {
      const editor = makeEditor(text ?? vault.read(path));
      active = { note: noteFor(path, editor), editor };
      return editor;
    },
    get activeEditor() {
      return active?.editor ?? null;
    },
    /** Opens the note the plugin asked for, once the test says so. */
    finishOpen() {
      const waiting = pending;
      pending = null;
      if (waiting) workspace.activate(waiting.path, waiting.options);
      return waiting;
    },
    deferOpen: false,
    getPending() {
      return pending;
    },
    getActiveNote: () => active?.note ?? null,
    getActiveEditor: () => active?.editor ?? null,
    openLink() {},
    newNote() {},
    insertText() {},
    revealLine() {},
    search() {},
    runCommand() {},
    /** @param {string} event @param {(...args: unknown[]) => unknown} callback */
    on(event, callback) {
      const list = listeners.get(event) ?? [];
      list.push(callback);
      listeners.set(event, list);
      return { event, off() {} };
    },
    /** @param {string} event */
    emit(event) {
      for (const callback of listeners.get(event) ?? []) callback();
    },
  };
  return workspace;
}

/** @param {string} path @param {ReturnType<typeof makeEditor>} editor */
function noteFor(path, editor) {
  return {
    path,
    name: path.replace(/\.md$/i, "").split("/").pop() ?? "",
    get text() {
      return editor.getValue();
    },
    get line() {
      return editor.getCursor("head").line;
    },
    mode: "editing",
  };
}
