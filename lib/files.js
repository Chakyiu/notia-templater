// Vault paths for templates. Notia notes are `.md` files; the API accepts
// the path with or without that suffix.

/** @param {unknown} value @returns {string | null} `null` when the folder is not a safe vault path. */
export function cleanFolder(value) {
  const raw = String(value ?? "").trim().replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
  if (!raw) return "";
  const parts = raw.split("/");
  const unsafe = parts.some(
    (part) => !part || part === "." || part === ".." || part.startsWith(".") || /[:"*?<>|\u0000-\u001f]/.test(part),
  );
  return unsafe ? null : parts.join("/");
}

/** Keeps slashes, so a template can file a note under a subfolder. @param {unknown} value */
export function cleanTitle(value) {
  const parts = String(value ?? "")
    .replace(/\\/g, "/")
    .replace(/\.md$/i, "")
    .split("/")
    .map((part) => part.replace(/[:"*?<>|\u0000-\u001f]/g, " ").replace(/\s+/g, " ").trim().replace(/^\.+/g, ""))
    .filter((part) => part && part !== "." && part !== "..");
  return parts.join("/") || "Untitled";
}

/** @param {...unknown} parts */
export function joinFolder(...parts) {
  /** @type {string[]} */
  const cleaned = [];
  for (const part of parts) {
    const text = String(part ?? "").replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
    if (!text) continue;
    for (const piece of text.split("/")) {
      if (!piece || piece === "." || piece === "..") continue;
      cleaned.push(piece);
    }
  }
  return cleaned.join("/");
}

/** @param {unknown} path */
export function noteKey(path) {
  return String(path ?? "").replace(/\\/g, "/").replace(/\.md$/i, "").replace(/^\/+|\/+$/g, "");
}

/** @param {unknown} path */
export function parentFolder(path) {
  const stem = noteKey(path);
  const slash = stem.lastIndexOf("/");
  return slash === -1 ? "" : stem.slice(0, slash);
}

/** @param {unknown} path @param {unknown} folder */
export function displayName(path, folder) {
  const stem = noteKey(path);
  const dir = cleanFolder(folder);
  const prefix = dir ? `${dir}/` : "";
  return stem.startsWith(prefix) ? stem.slice(prefix.length) : stem;
}

/**
 * Prefixes a file name with a date when the setting is on.
 * @param {string} stem
 * @param {boolean} withDate
 * @param {string} today
 */
export function datedTitle(stem, withDate, today) {
  return withDate ? `${today} ${stem}` : stem;
}

/** The file name of a template, without its folders. @param {unknown} path @param {unknown} folder */
export function templateTitle(path, folder) {
  const name = displayName(path, folder);
  const slash = name.lastIndexOf("/");
  return (slash === -1 ? name : name.slice(slash + 1)) || "Untitled";
}

/** The last path segment of a title that may contain folders. @param {unknown} title */
export function baseTitle(title) {
  const cleaned = cleanTitle(title);
  const slash = cleaned.lastIndexOf("/");
  return slash === -1 ? cleaned : cleaned.slice(slash + 1);
}

/** @param {unknown} folder @param {unknown} title */
export function noteFilePath(folder, title) {
  const path = joinFolder(cleanFolder(folder) ?? "", cleanTitle(title));
  return `${path || "Untitled"}.md`;
}

/** @param {unknown} path @param {unknown} folder */
export function isInFolder(path, folder) {
  const note = String(path ?? "").replace(/\\/g, "/");
  const dir = cleanFolder(folder);
  if (!dir) return !noteKey(note).includes("/");
  return note.startsWith(`${dir}/`);
}

/** @param {unknown} a @param {unknown} b */
export function sameNote(a, b) {
  return noteKey(a) === noteKey(b);
}

/**
 * @param {{ path?: string }[]} notes
 * @param {unknown} folder
 * @returns {{ path: string, name: string }[]}
 */
export function listTemplates(notes, folder) {
  const dir = cleanFolder(folder);
  if (dir == null) return [];
  const prefix = dir ? `${dir}/` : "";
  return (notes ?? [])
    .filter((note) => {
      const path = String(note?.path ?? "");
      if (!path.toLowerCase().endsWith(".md")) return false;
      if (!prefix) return !noteKey(path).includes("/");
      return path.startsWith(prefix);
    })
    .map((note) => ({
      path: String(note.path),
      name: displayName(note.path, dir),
    }))
    .sort((a, b) => a.name.localeCompare(b.name) || a.path.localeCompare(b.path));
}

/**
 * The first free note path. `exists` is asked with the path and no `.md`.
 * @param {unknown} folder
 * @param {unknown} title
 * @param {(path: string) => boolean} exists
 */
export function availablePath(folder, title, exists) {
  const whole = joinFolder(cleanFolder(folder) ?? "", cleanTitle(title));
  const slash = whole.lastIndexOf("/");
  const dir = slash === -1 ? "" : whole.slice(0, slash);
  const stem = (slash === -1 ? whole : whole.slice(slash + 1)) || "Untitled";
  for (let n = 1; n <= 500; n++) {
    const name = n === 1 ? stem : `${stem} ${n}`;
    const path = dir ? `${dir}/${name}` : name;
    if (!exists(path)) return { path, title: name };
  }
  throw new Error("Could not find a free note name");
}

/** @param {unknown} path */
export function commandSlug(path) {
  const slug = noteKey(path)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "template";
}

/** @param {unknown} path @param {Set<string>} used */
export function uniqueCommandSlug(path, used) {
  const base = commandSlug(path).slice(0, 48);
  let slug = base;
  let n = 2;
  while (used.has(slug)) slug = `${base}-${n++}`;
  used.add(slug);
  return slug;
}

/**
 * Notes a `tp.file.include` link might mean, most specific first.
 * @param {unknown} spec
 * @param {{ templatesFolder?: unknown, fromPath?: unknown }} [where]
 */
export function includeCandidates(spec, { templatesFolder = "", fromPath = "" } = {}) {
  let target = String(spec ?? "").trim();
  const wiki = target.match(/^\[\[([^\]|#]+)/);
  if (wiki) target = wiki[1].trim();
  target = noteKey(target);
  if (!target || target.split("/").some((part) => !part || part === "." || part === ".." || part.startsWith("."))) {
    return [];
  }
  if (target.includes("/")) return [target];
  /** @type {string[]} */
  const found = [];
  const folder = cleanFolder(templatesFolder);
  if (folder) found.push(`${folder}/${target}`);
  const sibling = parentFolder(fromPath);
  if (sibling && sibling !== folder) found.push(`${sibling}/${target}`);
  if (!found.includes(target)) found.push(target);
  return found;
}
