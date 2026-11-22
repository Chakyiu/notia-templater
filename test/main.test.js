import assert from "node:assert/strict";
import test from "node:test";
import Templater from "../main.js";
import { notices } from "./support/notia-stub.mjs";
import { formatDate } from "../lib/date.js";
import { STARTER } from "../lib/template.js";
import { makeEditor, makeVault, makeWorkspace } from "./support/vault.mjs";

/**
 * @param {{ notes?: Record<string, string | { text: string, tags?: string[], modified?: number | null }>, data?: unknown, active?: string, activeText?: string }} [options]
 */
function setup(options = {}) {
  const vault = makeVault(options.notes ?? {});
  const workspace = makeWorkspace(vault);
  const app = { vault, workspace, metadata: {} };
  const plugin = new Templater(app, { id: "templater", name: "Templater", dir: ".notia/plugins/templater" });
  if ("data" in options) plugin.data = options.data;
  notices.length = 0;
  if (options.active) workspace.open(options.active, options.activeText);
  return { app, vault, workspace, plugin };
}

/** Let promises created inside a command callback settle. */
const settle = () => new Promise((resolve) => setImmediate(resolve));

test("onload registers the panel, ribbon, settings tab, commands, and listeners", async () => {
  const { plugin } = setup({
    notes: {
      "Templates/Daily.md": "# <% tp.file.title %>",
      "Templates/Work/Standup.md": "Standup",
      "Notes/Other.md": "Other",
    },
  });
  await plugin.onload();

  assert.deepEqual([...plugin.commands.keys()].sort(), [
    "create",
    "create-templates-daily",
    "create-templates-work-standup",
    "insert",
    "insert-templates-daily",
    "insert-templates-work-standup",
    "new-template",
    "replace",
  ]);
  assert.equal(plugin.commands.get("insert-templates-work-standup").name, "Insert template: Work/Standup");
  assert.equal(plugin.commands.get("create-templates-daily").name, "New note from template: Daily");
  assert.equal(plugin.commands.get("replace").name, "Replace templates in the active file");

  assert.equal(plugin.panels.length, 1);
  assert.equal(plugin.panels[0].options.id, "templates");
  assert.equal(plugin.panels[0].options.side, "right");
  assert.deepEqual(plugin.ribbonIcons.map((icon) => icon.title), ["New note from template"]);
  assert.equal(plugin.settingTabs.length, 1);
  assert.equal(plugin.events.length, 2, "vault change and file-open listeners");
  assert.ok(plugin.events.every((event) => typeof event.off === "function"));
});

test("saved settings decide the template folder before commands are registered", async () => {
  const { plugin } = setup({
    notes: { "Scratch/Log.md": "log", "Templates/Daily.md": "daily" },
    data: { templatesFolder: "Scratch", defaultTemplate: "Scratch/Log.md", newTab: true, dateFormat: "HH:mm" },
  });
  await plugin.onload();

  assert.equal(plugin.settings.templatesFolder, "Scratch");
  assert.equal(plugin.settings.newTab, true);
  assert.equal(plugin.settings.dateFormat, "HH:mm");
  assert.equal(plugin.chosen(), "Scratch/Log.md");
  assert.ok(plugin.commands.has("create-scratch-log"));
  assert.equal(plugin.commands.has("create-templates-daily"), false);
  assert.equal(plugin.panels[0].refreshes, 1);
});

test("a data.json that cannot be read leaves the defaults in place", async () => {
  const { plugin } = setup();
  plugin.loadData = async () => {
    throw new Error("data.json is not JSON");
  };
  await plugin.onload();
  assert.equal(plugin.settings.templatesFolder, "Templates");
  assert.equal(plugin.settings.notesFolder, "");
});

test("a vault change adds commands for new templates without repeating the old ones", async () => {
  const { plugin, vault } = setup({ notes: { "Templates/Daily.md": "daily" } });
  await plugin.onload();
  const before = plugin.commands.size;

  vault.emit("change");
  assert.equal(plugin.commands.size, before);

  vault.create("Templates/New.md", "new");
  vault.emit("change");
  assert.equal(plugin.commands.size, before + 2);
  assert.ok(plugin.commands.has("insert-templates-new"));
  assert.ok(plugin.commands.has("create-templates-new"));

  vault.emit("change");
  assert.equal(plugin.commands.size, before + 2);
});

test("a template's own command inserts it into the open note", async () => {
  const { plugin, workspace } = setup({
    notes: { "Templates/Daily.md": "TL;DR <% tp.file.title %>" },
    active: "Notes/Today.md",
    activeText: "Hello ",
  });
  await plugin.onload();
  const editor = workspace.getActiveEditor();
  editor.setCursor({ line: 0, ch: 6 });

  await plugin.commands.get("insert-templates-daily").editorCallback(editor, workspace.getActiveNote());

  assert.equal(editor.getValue(), "Hello TL;DR Today");
  assert.deepEqual(editor.getCursor(), { line: 0, ch: 17 });
  assert.equal(editor.focused, true);
});

test("a template's own command creates a note and puts the cursor where the template asks", async () => {
  const { plugin, workspace, vault } = setup({
    notes: { "Templates/Daily.md": "# <% tp.file.title %>\n<% tp.file.cursor() %>" },
    data: { notesFolder: "Notes" },
  });
  await plugin.onload();

  await plugin.commands.get("create-templates-daily").callback();

  assert.equal(vault.text("Notes/Daily"), "# Daily\n");
  assert.deepEqual(workspace.openNoteCalls.at(-1), { path: "Notes/Daily.md", options: { line: 1, newTab: false } });
  assert.deepEqual(workspace.getActiveEditor().getCursor(), { line: 1, ch: 0 });
});

test("creating a note uses the date in the title and a subfolder from rename", async () => {
  const { plugin, vault } = setup({
    notes: { "Templates/Meeting.md": "<% tp.file.rename('Journal/Standup') %># <% tp.file.title %>" },
    data: { notesFolder: "Notes", dateInTitle: true },
  });
  await plugin.onload();
  const today = formatDate(new Date(), "YYYY-MM-DD");

  await plugin.createFrom("Templates/Meeting.md");

  assert.equal(vault.text("Notes/Journal/Standup"), "# Standup");
  assert.equal(vault.exists(`Notes/${today} Meeting`), false, "rename replaces the dated name");
});

test("the date in the title prefixes a new note when the template does not rename", async () => {
  const { plugin, vault } = setup({
    notes: { "Templates/Meeting.md": "# <% tp.file.title %>" },
    data: { notesFolder: "Notes", dateInTitle: true },
  });
  await plugin.onload();
  const today = formatDate(new Date(), "YYYY-MM-DD");

  await plugin.createFrom("Templates/Meeting.md");

  assert.equal(vault.text(`Notes/${today} Meeting`), `# ${today} Meeting`);
});

test("a new note only takes a free name", async () => {
  const { plugin, vault } = setup({
    notes: { "Templates/Daily.md": "daily", "Notes/Daily.md": "taken" },
    data: { notesFolder: "Notes" },
  });
  await plugin.onload();

  await plugin.createFrom("Templates/Daily.md");

  assert.equal(vault.text("Notes/Daily 2"), "daily");
  assert.equal(vault.text("Notes/Daily"), "taken");
});

test("creating a note refuses to save it into the templates folder", async () => {
  const { plugin, workspace } = setup({
    notes: { "Templates/Daily.md": "daily" },
    data: { templatesFolder: "Templates", notesFolder: "templates" },
  });
  await plugin.onload();

  await plugin.createFrom("Templates/Daily.md");

  assert.match(notices.at(-1), /new-notes folder and the templates folder are the same/);
  assert.deepEqual(workspace.openNoteCalls, []);
});

test("New note from template creates a template when the vault has none", async () => {
  const { plugin, vault, workspace } = setup({ notes: {}, data: { templatesFolder: "Templates" } });
  await plugin.onload();

  plugin.commands.get("create").callback();

  assert.match(notices[0], /There is no template yet. Creating one/);
  assert.equal(vault.text("Templates/New template"), STARTER);
  assert.deepEqual(workspace.openNoteCalls.at(-1), { path: "Templates/New template.md", options: {} });
});

test("New note from template asks for a choice when several templates have no default", async () => {
  const { plugin, workspace } = setup({
    notes: { "Templates/Daily.md": "daily", "Templates/Weekly.md": "weekly" },
  });
  await plugin.onload();

  plugin.commands.get("create").callback();

  assert.match(notices.at(-1), /choose a default in Templater settings/);
  assert.equal(plugin.panels[0].shown, 1);
  assert.deepEqual(workspace.openNoteCalls, []);
});

test("New note from template uses the chosen default", async () => {
  const { plugin, vault } = setup({
    notes: { "Templates/Daily.md": "daily", "Templates/Weekly.md": "weekly" },
    data: { defaultTemplate: "Templates/Weekly.md", notesFolder: "Notes" },
  });
  await plugin.onload();

  plugin.ribbonIcons[0].callback();
  await settle();

  assert.equal(vault.text("Notes/Weekly"), "weekly");
});

test("Insert template reports an empty vault and opens the panel", async () => {
  const { plugin, workspace } = setup({ notes: {}, data: { templatesFolder: "Templates" } });
  await plugin.onload();
  const editor = makeEditor("text");
  workspace.open("Notes/Today.md", "text");

  plugin.commands.get("insert").editorCallback(editor, workspace.getActiveNote());

  assert.match(notices.at(-1), /There is no template yet. Run New template/);
  assert.equal(plugin.panels[0].shown, 1);
});

test("inserting replaces the selection and keeps the template's cursor", async () => {
  const { plugin, workspace } = setup({
    notes: { "Templates/Quote.md": "[<% tp.file.selection() %>]\n<% tp.file.cursor() %>" },
    active: "Notes/Today.md",
    activeText: "Say hello now",
  });
  await plugin.onload();
  const editor = workspace.getActiveEditor();
  editor.setSelection({ line: 0, ch: 4 }, { line: 0, ch: 9 });

  await plugin.insert("Templates/Quote.md", editor);

  assert.equal(editor.getValue(), "Say [hello]\n now");
  const applied = editor.transactions.at(-1);
  assert.deepEqual(applied.changes, [
    { from: { line: 0, ch: 4 }, to: { line: 0, ch: 9 }, text: "[hello]\n" },
  ]);
  assert.deepEqual(applied.selection, { from: { line: 1, ch: 0 } });
  assert.equal(editor.focused, true);
});

test("inserting leaves the cursor just after the text when the template marks none", async () => {
  const { plugin, workspace } = setup({
    notes: { "Templates/End.md": "END" },
    active: "Notes/Today.md",
    activeText: "abc",
  });
  await plugin.onload();
  const editor = workspace.getActiveEditor();
  editor.setCursor({ line: 0, ch: 3 });

  await plugin.insert("Templates/End.md", editor);

  assert.equal(editor.getValue(), "abcEND");
  assert.deepEqual(editor.getCursor(), { line: 0, ch: 6 });
});

test("inserting refuses without an open note, and while inside the templates folder", async () => {
  const empty = setup({ notes: { "Templates/Daily.md": "daily" } });
  await empty.plugin.onload();
  await empty.plugin.insert("Templates/Daily.md");
  assert.match(notices.at(-1), /Open a note to insert a template/);

  const template = setup({
    notes: { "Templates/Daily.md": "daily" },
    active: "Templates/Main.md",
    activeText: "x",
  });
  await template.plugin.onload();
  const editor = template.workspace.getActiveEditor();
  await template.plugin.insert("Templates/Daily.md", editor);
  assert.match(notices.at(-1), /This note is a template/);
  assert.deepEqual(editor.transactions, []);
});

test("Replace templates in the active file runs every tag in the note", async () => {
  const modified = new Date(2026, 10, 17, 10, 30).getTime();
  const text = [
    "---",
    "status: draft",
    "---",
    "",
    "# <% tp.file.title %>",
    "",
    "<% tp.frontmatter.status %> <% tp.file.tags %> <% tp.file.path %>",
    "<% tp.file.creation_date('YYYY-MM-DD') %> <% tp.file.last_modified_date('YYYY-MM-DD') %>",
    "<%# a comment %>only <%* tR += 'this' %>",
    "",
  ].join("\n");
  const { plugin, workspace } = setup({
    notes: { "Notes/Today.md": { text, tags: ["idea"], modified } },
    active: "Notes/Today.md",
  });
  await plugin.onload();
  const editor = workspace.getActiveEditor();
  const note = workspace.getActiveNote();

  await plugin.commands.get("replace").editorCallback(editor, note);

  assert.equal(
    editor.getValue(),
    [
      "---",
      "status: draft",
      "---",
      "",
      "# Today",
      "",
      "draft idea Notes/Today.md",
      "2026-11-17 2026-11-17",
      "only this",
      "",
    ].join("\n"),
  );
  const applied = editor.transactions.at(-1);
  assert.equal(applied.changes.length, 1);
  assert.deepEqual(applied.changes[0].from, { line: 0, ch: 0 });
  assert.equal(applied.changes[0].to.line, 9);
  assert.deepEqual(editor.getCursor(), { line: 9, ch: 0 });
});

test("Replace templates in the active file includes another note and refuses a template", async () => {
  const { plugin, workspace } = setup({
    notes: { "Templates/Bit.md": "BIT", "Templates/Main.md": "main" },
    active: "Notes/Today.md",
    activeText: "start <% tp.file.include('[[Bit]]') %>",
  });
  await plugin.onload();
  const editor = workspace.getActiveEditor();

  await plugin.commands.get("replace").editorCallback(editor, workspace.getActiveNote());
  assert.equal(editor.getValue(), "start BIT");

  const inside = setup({
    notes: { "Templates/Main.md": "main" },
    active: "Templates/Main.md",
    activeText: "keep",
  });
  await inside.plugin.onload();
  const templateEditor = inside.workspace.getActiveEditor();
  await inside.plugin.commands.get("replace").editorCallback(templateEditor, inside.workspace.getActiveNote());
  assert.match(notices.at(-1), /This note is a template/);
  assert.equal(templateEditor.getValue(), "keep");
});

test("the templates panel lists templates and inserts when a note is open", async () => {
  const { plugin, workspace } = setup({
    notes: { "Templates/Daily.md": "<% tp.file.title %>", "Templates/Work/Standup.md": "standup" },
    active: "Notes/Today.md",
    activeText: "",
  });
  await plugin.onload();
  const [row, list] = plugin.panels[0].options.render();

  assert.equal(row.type, "row");
  assert.deepEqual(row.children.map((child) => child.label), ["New note", "New template"]);
  assert.equal(list.type, "list");
  assert.deepEqual(list.items.map((item) => item.title), ["Daily", "Work/Standup"]);
  assert.ok(list.items.every((item) => item.subtitle === "Insert"));

  await list.items[1].onClick();
  assert.equal(workspace.getActiveEditor().getValue(), "standup");
});

test("the templates panel creates a note when no note is open", async () => {
  const { plugin, vault } = setup({ notes: { "Templates/Daily.md": "daily" }, data: { notesFolder: "Notes" } });
  await plugin.onload();
  const list = plugin.panels[0].options.render()[1];

  assert.ok(list.items.every((item) => item.subtitle === "New note"));
  await list.items[0].onClick();
  assert.equal(vault.text("Notes/Daily"), "daily");
});

test("the templates panel offers a way out of an empty templates folder", async () => {
  const { plugin, vault } = setup({ notes: {} });
  await plugin.onload();
  const [empty, button] = plugin.panels[0].options.render();

  assert.equal(empty.type, "empty");
  assert.match(empty.text, /No templates in Templates yet/);
  button.onClick();
  assert.equal(vault.text("Templates/New template"), STARTER);
});

test("New template takes the next free name", async () => {
  const { plugin, vault } = setup({ notes: { "Templates/New template.md": "mine" } });
  await plugin.onload();

  plugin.createTemplate();

  assert.equal(vault.text("Templates/New template 2"), STARTER);
  assert.match(notices.at(-1), /Created Templates\/New template 2\.md/);
});

test("the settings tab reads and writes every key", async () => {
  const { plugin, vault } = setup({
    notes: { "Templates/Daily.md": "daily", "Scratch/Log.md": "log" },
  });
  await plugin.onload();
  const rows = plugin.renderSettings();
  const settings = new Map(rows.filter((row) => row.type === "setting").map((row) => [row.name, row.control]));

  assert.deepEqual([...settings.keys()], [
    "Templates folder",
    "New notes folder",
    "Default template",
    "Date in the title",
    "Open in a new tab",
    "Date format",
  ]);
  assert.equal(settings.get("Templates folder").value, "Templates");
  assert.equal(settings.get("New notes folder").value, "");
  assert.equal(settings.get("Default template").type, "dropdown");
  assert.deepEqual(settings.get("Default template").options, [
    { value: "", label: "The only template" },
    { value: "Templates/Daily.md", label: "Daily" },
  ]);
  assert.equal(settings.get("Date in the title").value, false);
  assert.equal(settings.get("Date format").value, "YYYY-MM-DD");

  const refreshes = plugin.panels[0].refreshes;
  settings.get("Templates folder").onChange("Scratch");
  assert.equal(plugin.settings.templatesFolder, "Scratch");
  assert.deepEqual(plugin.saved.at(-1), plugin.settings);
  assert.ok(plugin.commands.has("insert-scratch-log"), "commands follow the new folder");
  assert.equal(plugin.panels[0].refreshes, refreshes + 1);

  settings.get("New notes folder").onChange("Notes");
  settings.get("Default template").onChange("Scratch/Log.md");
  settings.get("Date in the title").onChange(true);
  settings.get("Open in a new tab").onChange(true);
  settings.get("Date format").onChange("HH:mm");

  assert.deepEqual(plugin.settings, {
    templatesFolder: "Scratch",
    notesFolder: "Notes",
    defaultTemplate: "Scratch/Log.md",
    dateInTitle: true,
    newTab: true,
    dateFormat: "HH:mm",
  });
  assert.deepEqual(plugin.saved.at(-1), plugin.settings);
  assert.equal(plugin.saved.length, 6);
  assert.equal(plugin.chosen(), "Scratch/Log.md");

  const again = new Map(
    plugin
      .renderSettings()
      .filter((row) => row.type === "setting")
      .map((row) => [row.name, row.control]),
  );
  assert.equal(again.get("Default template").value, "Scratch/Log.md");
  assert.equal(again.get("Date in the title").value, true);
  assert.equal(vault.text("Scratch/Log"), "log");

  vault.create("Scratch/Second.md", "second");
  const two = new Map(
    plugin
      .renderSettings()
      .filter((row) => row.type === "setting")
      .map((row) => [row.name, row.control]),
  );
  assert.equal(two.get("Default template").options[0].label, "Choose in the command palette");
});

test("the date format setting reaches tp.date.now without a format", async () => {
  const { plugin, workspace } = setup({
    notes: { "Templates/Any.md": "x" },
    data: { dateFormat: "YYYY/MM/DD" },
    active: "Notes/Today.md",
    activeText: "<% tp.date.now() %>",
  });
  await plugin.onload();

  await plugin.commands.get("replace").editorCallback(workspace.getActiveEditor(), workspace.getActiveNote());

  assert.equal(workspace.getActiveEditor().getValue(), formatDate(new Date(), "YYYY/MM/DD"));
});

test("the cursor is placed once the new note becomes active", async () => {
  const { plugin, workspace } = setup({
    notes: { "Templates/Daily.md": "# <% tp.file.title %>\n<% tp.file.cursor() %>" },
  });
  await plugin.onload();
  workspace.deferOpen = true;
  const scheduled = [];
  const cleared = [];
  const realSetInterval = globalThis.setInterval;
  const realClearInterval = globalThis.clearInterval;
  globalThis.setInterval = (fn) => {
    scheduled.push(fn);
    return 41;
  };
  globalThis.clearInterval = (id) => {
    cleared.push(id);
  };
  try {
    await plugin.createFrom("Templates/Daily.md");
    assert.equal(scheduled.length, 1);
    assert.deepEqual(plugin.intervals, [41]);
    assert.equal(workspace.getActiveEditor(), null);

    workspace.finishOpen();
    scheduled[0]();

    assert.deepEqual(workspace.getActiveEditor().getCursor(), { line: 1, ch: 0 });
    assert.equal(workspace.getActiveEditor().focused, true);
    assert.deepEqual(cleared, [41]);
  } finally {
    globalThis.setInterval = realSetInterval;
    globalThis.clearInterval = realClearInterval;
  }
});

test("the cursor retry gives up without touching the wrong note", async () => {
  const { plugin, workspace } = setup({
    notes: { "Templates/Daily.md": "<% tp.file.cursor() %>" },
  });
  await plugin.onload();
  workspace.deferOpen = true;
  workspace.open("Notes/Other.md", "other");
  const scheduled = [];
  const cleared = [];
  const realSetInterval = globalThis.setInterval;
  const realClearInterval = globalThis.clearInterval;
  globalThis.setInterval = (fn) => {
    scheduled.push(fn);
    return 7;
  };
  globalThis.clearInterval = (id) => {
    cleared.push(id);
  };
  try {
    await plugin.createFrom("Templates/Daily.md");
    const other = workspace.getActiveEditor();
    for (let attempt = 1; attempt < 25; attempt++) {
      assert.deepEqual(cleared, []);
      scheduled[0]();
    }
    scheduled[0]();
    assert.deepEqual(cleared, [7]);
    assert.equal(other.getValue(), "other");
    assert.deepEqual(other.transactions, []);
  } finally {
    globalThis.setInterval = realSetInterval;
    globalThis.clearInterval = realClearInterval;
  }
});

test("a template that fails to render leaves the note alone", async () => {
  const { plugin, workspace } = setup({
    notes: { "Templates/Broken.md": "<% tp.file.title" },
    active: "Notes/Today.md",
    activeText: "keep me",
  });
  await plugin.onload();
  const editor = workspace.getActiveEditor();

  await plugin.insert("Templates/Broken.md", editor);

  assert.match(notices.at(-1), /missing %>/);
  assert.equal(editor.getValue(), "keep me");
  assert.deepEqual(editor.transactions, []);
});

test("a frontmatter value reaches tp.frontmatter from the open note", async () => {
  const { plugin, workspace } = setup({
    notes: { "Templates/Any.md": "x" },
    active: "Notes/Today.md",
    activeText: "---\ntitle: Hello\ncount: 2\nflag: true\n---\n<% tp.frontmatter.title %> <% tp.frontmatter.count + 1 %> <% tp.frontmatter.flag %>",
  });
  await plugin.onload();

  await plugin.commands.get("replace").editorCallback(workspace.getActiveEditor(), workspace.getActiveNote());

  assert.match(workspace.getActiveEditor().getValue(), /---\nHello 3 true$/);
});

test("the vault is not a template when the templates folder is set explicitly", async () => {
  const { plugin, vault } = setup({
    notes: { "Daily.md": "daily", "Templates/New.md": "new" },
    data: { templatesFolder: "Templates" },
  });
  await plugin.onload();

  assert.deepEqual(
    plugin.templates().map((template) => template.path),
    ["Templates/New.md"],
  );
  assert.equal(vault.exists("Daily"), true);
});

test("a template that cannot be read reports the failure instead of throwing", async () => {
  const { plugin, workspace } = setup({
    notes: { "Templates/Daily.md": "daily" },
    active: "Notes/Today.md",
    activeText: "text",
  });
  await plugin.onload();
  const editor = workspace.getActiveEditor();

  await plugin.insert("Templates/Missing.md", editor);

  assert.match(notices.at(-1), /No note at Templates\/Missing\.md/);
  assert.deepEqual(editor.transactions, []);
  assert.equal(workspace.getActiveEditor().getValue(), "text");
});

test("the editor stub the tests rely on applies one transaction", () => {
  const editor = makeEditor("abc");
  editor.setCursor({ line: 0, ch: 1 });
  editor.transaction({
    changes: [{ from: { line: 0, ch: 1 }, to: { line: 0, ch: 2 }, text: "XY" }],
    selection: { from: { line: 0, ch: 3 } },
  });
  assert.equal(editor.getValue(), "aXYc");
  assert.deepEqual(editor.getCursor(), { line: 0, ch: 3 });
});
