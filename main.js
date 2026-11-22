import { Notice, Plugin, ui } from "notia";
import { positionAt, spliceText } from "./lib/edit.js";
import { formatDate } from "./lib/date.js";
import {
  availablePath,
  datedTitle,
  isInFolder,
  listTemplates,
  parentFolder,
  sameNote,
  templateTitle,
  uniqueCommandSlug,
} from "./lib/files.js";
import { activeDateFormat, activeNotesFolder, activeTemplatesFolder, settingsFrom } from "./lib/settings.js";
import { STARTER, renderTemplate } from "./lib/template.js";

export default class Templater extends Plugin {
  /**
   * @param {import("notia").App} app
   * @param {import("notia").PluginManifest} manifest
   */
  constructor(app, manifest) {
    super(app, manifest);
    this.settings = settingsFrom(null);
    /** @type {Set<string>} */
    this.registered = new Set();
    /** @type {Set<string>} */
    this.slugs = new Set();
    /** @type {string | null} */
    this.templateKey = null;
    /** @type {import("notia").SettingTabHandle | undefined} */
    this.tab = undefined;
    /** @type {import("notia").PanelHandle | undefined} */
    this.panel = undefined;
  }

  async onload() {
    this.install();
    let saved = null;
    try {
      saved = await this.loadData();
    } catch {
      // A missing or broken data.json means the defaults.
    }
    this.settings = settingsFrom(saved);
    this.syncCommands();
    this.registerEvent(this.app.vault.on("change", () => this.syncCommands()));
    this.registerEvent(this.app.workspace.on("file-open", () => this.panel?.refresh()));
  }

  install() {
    this.tab = this.addSettingTab({
      icon: "file-plus",
      render: () => this.renderSettings(),
    });
    this.panel = this.addPanel({
      id: "templates",
      title: "Templates",
      icon: "file-plus",
      side: "right",
      render: () => this.renderPanel(),
    });
    this.addRibbonIcon("file-plus", "New note from template", () => this.createDefault());
    this.addCommand({
      id: "create",
      name: "New note from template",
      icon: "file-plus",
      hotkey: "secondary-alt-n",
      callback: () => this.createDefault(),
    });
    this.addCommand({
      id: "insert",
      name: "Insert template",
      icon: "file-plus",
      hotkey: "secondary-alt-t",
      editorCallback: (editor) => this.insertDefault(editor),
    });
    this.addCommand({
      id: "new-template",
      name: "New template",
      icon: "file-plus",
      callback: () => this.createTemplate(),
    });
    this.addCommand({
      id: "replace",
      name: "Replace templates in the active file",
      icon: "file-plus",
      editorCallback: (editor, note) => this.replaceActive(editor, note),
    });
  }

  /** @param {string} key @param {unknown} value */
  setSetting(key, value) {
    this.settings = settingsFrom({ ...this.settings, [key]: value });
    this.saveData(this.settings);
    if (key === "templatesFolder" || key === "notesFolder") this.syncCommands(false);
  }

  templates() {
    try {
      return listTemplates(this.app.vault.getNotes(), activeTemplatesFolder(this.settings));
    } catch {
      return [];
    }
  }

  /** The template Insert and New note use when the command does not name one. */
  chosen() {
    const templates = this.templates();
    const saved = this.settings.defaultTemplate;
    if (saved && templates.some((template) => template.path === saved)) return saved;
    if (templates.length === 1) return templates[0].path;
    return null;
  }

  /** @param {boolean} [refreshSettings] */
  syncCommands(refreshSettings = true) {
    const templates = this.templates();
    for (const template of templates) {
      if (this.registered.has(template.path)) continue;
      const slug = uniqueCommandSlug(template.path, this.slugs);
      const path = template.path;
      this.addCommand({
        id: `insert-${slug}`,
        name: `Insert template: ${template.name}`,
        icon: "file-plus",
        editorCallback: (editor) => this.insert(path, editor),
      });
      this.addCommand({
        id: `create-${slug}`,
        name: `New note from template: ${template.name}`,
        icon: "file-plus",
        callback: () => this.createFrom(path),
      });
      this.registered.add(path);
    }
    const key = templates.map((template) => template.path).join("\n");
    const changed = key !== this.templateKey;
    this.templateKey = key;
    if (!changed) return;
    this.panel?.refresh();
    if (refreshSettings) this.tab?.refresh();
  }

  createDefault() {
    const templates = this.templates();
    if (!templates.length) {
      new Notice("There is no template yet. Creating one.");
      this.createTemplate();
      return;
    }
    const path = this.chosen();
    if (!path) {
      new Notice("Name a template in the command palette, or choose a default in Templater settings.");
      this.panel?.show();
      return;
    }
    this.createFrom(path);
  }

  /** @param {import("notia").Editor} editor */
  insertDefault(editor) {
    if (!this.templates().length) {
      new Notice("There is no template yet. Run New template.");
      this.panel?.show();
      return;
    }
    const path = this.chosen();
    if (!path) {
      new Notice("Name a template in the command palette, or choose a default in Templater settings.");
      this.panel?.show();
      return;
    }
    this.insert(path, editor);
  }

  createTemplate() {
    const folder = activeTemplatesFolder(this.settings);
    try {
      const { path } = availablePath(folder, "New template", (candidate) => this.app.vault.exists(candidate));
      const created = this.app.vault.create(path, STARTER);
      this.app.workspace.openNote(created);
      new Notice(`Created ${created}`);
    } catch (error) {
      new Notice(failure(error));
    }
  }

  /** @param {string} templatePath */
  async createFrom(templatePath) {
    const templatesFolder = activeTemplatesFolder(this.settings);
    const notesFolder = activeNotesFolder(this.settings);
    if (templatesFolder.toLowerCase() === notesFolder.toLowerCase()) {
      new Notice("The new-notes folder and the templates folder are the same. Choose another folder in Templater settings.");
      return;
    }
    let source;
    try {
      source = this.app.vault.read(templatePath);
    } catch (error) {
      new Notice(failure(error));
      return;
    }
    const stem = templateTitle(templatePath, templatesFolder);
    const title = datedTitle(stem, this.settings.dateInTitle, formatDate(new Date(), "YYYY-MM-DD"));
    try {
      const rendered = await renderTemplate(source, {
        ...this.context(),
        title,
        folder: notesFolder,
        fromPath: templatePath,
        creating: true,
      });
      const { path } = availablePath(notesFolder, rendered.title, (candidate) => this.app.vault.exists(candidate));
      const created = this.app.vault.create(path, rendered.text);
      const line = rendered.cursor == null ? 0 : positionAt(rendered.text, rendered.cursor).line;
      this.app.workspace.openNote(created, { line, newTab: this.settings.newTab });
      this.placeCursor(created, rendered);
    } catch (error) {
      new Notice(failure(error));
    }
  }

  /**
   * @param {string} templatePath
   * @param {import("notia").Editor} [editor]
   */
  async insert(templatePath, editor) {
    const target = editor ?? this.app.workspace.getActiveEditor();
    const note = this.app.workspace.getActiveNote();
    if (!target || !note) {
      new Notice("Open a note to insert a template.");
      return;
    }
    if (isInFolder(note.path, activeTemplatesFolder(this.settings))) {
      new Notice("This note is a template. Run New note from template to use it.");
      return;
    }
    const from = target.getCursor("from");
    const to = target.getCursor("to");
    const content = target.getValue();
    const start = target.posToOffset(from);
    const end = target.posToOffset(to);
    try {
      const rendered = await renderTemplate(this.app.vault.read(templatePath), {
        ...this.context(note.path),
        fromPath: templatePath,
        selection: content.slice(Math.min(start, end), Math.max(start, end)),
        content,
        creating: false,
      });
      this.apply(target, content, start, end, rendered);
    } catch (error) {
      new Notice(failure(error));
    }
  }

  /**
   * @param {import("notia").Editor} editor
   * @param {import("notia").ActiveNote} note
   */
  async replaceActive(editor, note) {
    if (!note) return;
    if (isInFolder(note.path, activeTemplatesFolder(this.settings))) {
      new Notice("This note is a template. Run New note from template to use it.");
      return;
    }
    const content = editor.getValue();
    try {
      const rendered = await renderTemplate(content, {
        ...this.context(note.path),
        selection: editor.getSelection(),
        content,
        creating: false,
      });
      this.apply(editor, content, 0, content.length, rendered);
    } catch (error) {
      new Notice(failure(error));
    }
  }

  /**
   * @param {import("notia").Editor} editor
   * @param {string} content
   * @param {number} start
   * @param {number} end
   * @param {{ text: string, cursor: number | null }} rendered
   */
  apply(editor, content, start, end, rendered) {
    const applied = spliceText(content, start, end, rendered);
    const from = positionAt(content, Math.min(start, end));
    const to = positionAt(content, Math.max(start, end));
    editor.transaction({
      changes: [{ from, to, text: rendered.text }],
      selection: { from: positionAt(applied.text, applied.cursor) },
    });
    editor.focus();
  }

  /**
   * @param {string} path
   * @param {{ text: string, cursor: number | null }} rendered
   */
  placeCursor(path, rendered) {
    if (rendered.cursor == null) return;
    const pos = positionAt(rendered.text, rendered.cursor);
    /** @param {boolean} force */
    const aim = (force) => {
      const note = this.app.workspace.getActiveNote();
      const current = this.app.workspace.getActiveEditor();
      if (!note || !current || !sameNote(note.path, path)) return false;
      if (!force && current.getValue() !== rendered.text) return false;
      current.setCursor(pos);
      current.focus();
      return true;
    };
    if (aim(false)) return;
    let tries = 0;
    const id = setInterval(() => {
      tries += 1;
      if (aim(tries >= 25) || tries >= 25) clearInterval(id);
    }, 40);
    this.registerInterval(id);
  }

  /** @param {string} [path] */
  context(path) {
    const info = path ? this.app.vault.getNotes().find((note) => sameNote(note.path, path)) : undefined;
    const notePath = path ?? "";
    return {
      now: new Date(),
      dateFormat: activeDateFormat(this.settings),
      templatesFolder: activeTemplatesFolder(this.settings),
      path: notePath,
      title: info?.name ?? templateTitle(notePath, parentFolder(notePath)),
      folder: parentFolder(notePath),
      fromPath: notePath,
      tags: info?.tags ?? [],
      created: info?.modified ? new Date(info.modified) : new Date(),
      modified: info?.modified ? new Date(info.modified) : null,
      selection: "",
      content: "",
      creating: false,
      read: (/** @type {string} */ candidate) => this.readNote(candidate),
    };
  }

  /** @param {string} path */
  readNote(path) {
    try {
      if (!this.app.vault.exists(path)) return null;
      return this.app.vault.read(path);
    } catch {
      return null;
    }
  }

  renderPanel() {
    const templates = this.templates();
    const folder = activeTemplatesFolder(this.settings);
    if (!templates.length) {
      return [
        ui.empty(`No templates in ${folder} yet.`),
        ui.button("New template", () => this.createTemplate(), { icon: "file-plus", variant: "primary" }),
      ];
    }
    const inserting = Boolean(this.app.workspace.getActiveEditor());
    return [
      ui.row([
        ui.button("New note", () => this.createDefault(), { icon: "file-plus", variant: "primary" }),
        ui.button("New template", () => this.createTemplate(), { icon: "file-plus", variant: "outline" }),
      ]),
      ui.list(
        templates.map((template) => ({
          title: template.name,
          subtitle: inserting ? "Insert" : "New note",
          icon: "file-plus",
          onClick: () => (inserting ? this.insert(template.path) : this.createFrom(template.path)),
        })),
      ),
    ];
  }

  renderSettings() {
    const templates = this.templates();
    const selected = templates.some((template) => template.path === this.settings.defaultTemplate)
      ? this.settings.defaultTemplate
      : "";
    /** @type {{ value: string, label: string }[]} */
    const choices = [
      {
        value: "",
        label: templates.length === 1 ? "The only template" : "Choose in the command palette",
      },
    ];
    for (const template of templates) choices.push({ value: template.path, label: template.name });
    return [
      ui.text(
        "New template creates a template note. New note from template fills a new note from it. Each template also has its own command.",
        { muted: true, small: true },
      ),
      ui.heading("Folders"),
      ui.setting(
        "Templates folder",
        ui.textInput(this.settings.templatesFolder, (value) => this.setSetting("templatesFolder", value)),
        { description: "Notes in this folder are templates. A folder inside it is included, such as Templates/Work/Standup." },
      ),
      ui.setting(
        "New notes folder",
        ui.textInput(this.settings.notesFolder, (value) => this.setSetting("notesFolder", value)),
        { description: "Where New note from template saves the note. Empty saves it at the top of the vault." },
      ),
      ui.setting("Default template", ui.dropdown(selected, choices, (value) => this.setSetting("defaultTemplate", value)), {
        description: "Used by Insert template and New note from template. A template’s own command ignores this.",
      }),
      ui.heading("New notes"),
      ui.setting(
        "Date in the title",
        ui.toggle(this.settings.dateInTitle, (value) => this.setSetting("dateInTitle", value)),
        { description: "Prefix the note name with today’s date. tp.file.rename in the template chooses the name instead." },
      ),
      ui.setting(
        "Open in a new tab",
        ui.toggle(this.settings.newTab, (value) => this.setSetting("newTab", value)),
        { description: "New note from template leaves the current note open." },
      ),
      ui.heading("Dates"),
      ui.setting(
        "Date format",
        ui.textInput(this.settings.dateFormat, (value) => this.setSetting("dateFormat", value)),
        { description: "Used by tp.date.now() when a tag gives no format. Example: YYYY-MM-DD." },
      ),
    ];
  }
}

/** @param {unknown} error */
function failure(error) {
  if (error instanceof Error && error.message) return error.message;
  return String(error);
}
