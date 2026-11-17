import { cleanFolder } from "./files.js";

/** What the plugin does until the user changes it. */
export const DEFAULTS = {
  templatesFolder: "Templates",
  notesFolder: "",
  defaultTemplate: "",
  dateInTitle: false,
  newTab: false,
  dateFormat: "YYYY-MM-DD",
};

/**
 * Settings saved in the plugin's `data.json`. Missing values keep the
 * default. Folder text is kept as typed; {@link activeTemplatesFolder}
 * decides what is used.
 * @param {unknown} data
 */
export function settingsFrom(data) {
  const source = data && typeof data === "object" ? /** @type {Record<string, unknown>} */ (data) : {};
  return {
    templatesFolder: stringOr(source.templatesFolder, DEFAULTS.templatesFolder),
    notesFolder: stringOr(source.notesFolder, DEFAULTS.notesFolder),
    defaultTemplate: stringOr(source.defaultTemplate, ""),
    dateInTitle: flag(source.dateInTitle, DEFAULTS.dateInTitle),
    newTab: flag(source.newTab, DEFAULTS.newTab),
    dateFormat: stringOr(source.dateFormat, DEFAULTS.dateFormat),
  };
}

/** @param {unknown} value @param {string} fallback */
function stringOr(value, fallback) {
  return typeof value === "string" ? value : fallback;
}

/** @param {unknown} value @param {boolean} fallback */
function flag(value, fallback) {
  return typeof value === "boolean" ? value : fallback;
}

/** @param {{ templatesFolder?: string }} settings */
export function activeTemplatesFolder(settings) {
  return cleanFolder(settings?.templatesFolder) || DEFAULTS.templatesFolder;
}

/** @param {{ notesFolder?: string }} settings */
export function activeNotesFolder(settings) {
  const cleaned = cleanFolder(settings?.notesFolder);
  return cleaned == null ? DEFAULTS.notesFolder : cleaned;
}

/** @param {{ dateFormat?: string }} settings */
export function activeDateFormat(settings) {
  const format = settings?.dateFormat?.trim();
  return format || DEFAULTS.dateFormat;
}
