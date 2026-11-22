import assert from "node:assert/strict";
import test from "node:test";
import { formatDate, shiftDate, weekdayDate } from "../lib/date.js";
import { positionAt, spliceText } from "../lib/edit.js";
import {
  availablePath,
  datedTitle,
  includeCandidates,
  isInFolder,
  listTemplates,
  sameNote,
  uniqueCommandSlug,
} from "../lib/files.js";
import { activeNotesFolder, activeTemplatesFolder, settingsFrom } from "../lib/settings.js";
import { STARTER, TemplateError, renderTemplate } from "../lib/template.js";

const now = new Date(2026, 10, 17, 15, 4, 5);

test("dates use local tokens, offsets, and weekdays", () => {
  assert.equal(formatDate(now, "YYYY-MM-DD [at] HH:mm"), "2026-11-17 at 15:04");
  assert.equal(formatDate(now, "dddd, MMMM D"), "Tuesday, November 17");
  assert.equal(formatDate(now, "hh:mm A"), "03:04 PM");
  assert.equal(formatDate(shiftDate(now, -1), "YYYY-MM-DD"), "2026-11-16");
  assert.equal(formatDate(shiftDate(now, "2h"), "HH:mm"), "17:04");
  assert.equal(formatDate(shiftDate(now, "1M"), "YYYY-MM"), "2026-12");
  assert.equal(formatDate(weekdayDate(now, "Monday"), "YYYY-MM-DD"), "2026-11-16");
  assert.equal(formatDate(weekdayDate(now, 0), "dddd"), "Sunday");
  assert.throws(() => shiftDate(now, "soon"), /Unknown date offset/);
});

test("template notes are the files inside the templates folder", () => {
  const notes = [
    { path: "Templates.md" },
    { path: "Templates/Daily.md" },
    { path: "Templates/Work/Standup.md" },
    { path: "Notes/Other.md" },
  ];
  assert.deepEqual(
    listTemplates(notes, "Templates").map((template) => template.name),
    ["Daily", "Work/Standup"],
  );
  assert.equal(isInFolder("Templates/Daily.md", "Templates"), true);
  assert.equal(isInFolder("Templates.md", "Templates"), false);
  assert.equal(sameNote("Daily.md", "Daily"), true);
});

test("new notes take the next free name", () => {
  const taken = new Set(["Notes/Daily", "Notes/Journal/Day"]);
  assert.equal(availablePath("Notes", "Daily", (path) => taken.has(path)).path, "Notes/Daily 2");
  assert.equal(availablePath("Notes", "Journal/Day", (path) => taken.has(path)).path, "Notes/Journal/Day 2");
  assert.equal(availablePath("", "Minutes", () => false).path, "Minutes");
  assert.equal(datedTitle("Daily", true, "2026-11-17"), "2026-11-17 Daily");
  assert.equal(datedTitle("Daily", false, "2026-11-17"), "Daily");
});

test("include links stay inside the vault", () => {
  assert.deepEqual(includeCandidates("[[Bit]]", { templatesFolder: "Templates", fromPath: "Templates/Main.md" }), [
    "Templates/Bit",
    "Bit",
  ]);
  assert.deepEqual(includeCandidates("[[Note#heading|label]]", { templatesFolder: "Templates" }), [
    "Templates/Note",
    "Note",
  ]);
  assert.deepEqual(includeCandidates("../secret", {}), []);
  assert.deepEqual(includeCandidates("[[.hidden]]", { templatesFolder: "Templates" }), []);
});

test("command names stay unique", () => {
  const used = new Set();
  assert.equal(uniqueCommandSlug("Templates/Daily.md", used), "templates-daily");
  assert.equal(uniqueCommandSlug("会议.md", used), "template");
  assert.equal(uniqueCommandSlug("笔记.md", used), "template-2");
});

test("settings keep typed text and fall back when a folder is unsafe", () => {
  assert.equal(activeTemplatesFolder(settingsFrom(null)), "Templates");
  assert.equal(activeTemplatesFolder(settingsFrom({ templatesFolder: "../x" })), "Templates");
  assert.equal(activeNotesFolder(settingsFrom({ notesFolder: "" })), "");
  assert.equal(activeNotesFolder(settingsFrom({ notesFolder: "Journal" })), "Journal");
  assert.equal(settingsFrom({ dateInTitle: "yes" }).dateInTitle, false);
  assert.equal(settingsFrom({ dateFormat: "HH:mm" }).dateFormat, "HH:mm");
});

test("tags insert values, execution text, and the cursor", async () => {
  const rendered = await renderTemplate(
    "<% tp.date.now('YYYY-MM-DD HH:mm') %> <% tp.file.title %><%* tR += '!' %>",
    { now, title: "Daily", dateFormat: "YYYY-MM-DD" },
  );
  assert.equal(rendered.text, "2026-11-17 15:04 Daily!");
  assert.equal(rendered.cursor, null);

  const marked = await renderTemplate("<% tp.file.cursor(2) %>A<% tp.file.cursor(1) %>B", { now });
  assert.equal(marked.text, "AB");
  assert.equal(marked.cursor, 1);

  const appended = await renderTemplate("X<% tp.file.cursor_append('YZ') %>", { now });
  assert.equal(appended.text, "XYZ");
  assert.equal(appended.cursor, 1);
});

test("creating a note can rename it, and later tags see the new name", async () => {
  const rendered = await renderTemplate(
    "<% tp.file.rename('Journal/Day') %><% tp.file.title %> <% tp.file.path() %>",
    { creating: true, title: "Standup", folder: "Notes", now },
  );
  assert.equal(rendered.text, "Day Notes/Journal/Day.md");
  assert.equal(rendered.title, "Journal/Day");
  assert.equal(rendered.renamed, true);
});

test("rename is refused while inserting into an existing note", async () => {
  await assert.rejects(
    () => renderTemplate("<% tp.file.rename('Other') %>", { creating: false, title: "Daily", now }),
    TemplateError,
  );
});

test("includes, frontmatter, and the selection are filled in", async () => {
  const rendered = await renderTemplate("Hello <% tp.file.include('[[Bit]]') %> [<% tp.file.selection() %>]", {
    title: "Daily",
    templatesFolder: "Templates",
    fromPath: "Templates/Main.md",
    selection: "word",
    content: "---\ntitle: Hello\ncount: 2\n---\n",
    now,
    read: (path) => (path === "Templates/Bit" ? "<% tp.file.title %>/<% tp.frontmatter.count + 1 %>" : null),
  });
  assert.equal(rendered.text, "Hello Daily/3 [word]");
});

test("a template cannot include itself", async () => {
  await assert.rejects(
    () =>
      renderTemplate("<% tp.file.include('[[Main]]') %>", {
        templatesFolder: "Templates",
        fromPath: "Templates/Main.md",
        now,
        read: () => "<% tp.file.include('[[Main]]') %>",
      }),
    /includes itself/,
  );
});

test("whitespace dashes, comments, and %> inside strings", async () => {
  assert.equal((await renderTemplate("A\n<%- 'b' -%>\nC", { now })).text, "AbC");
  assert.equal((await renderTemplate("A\n<% 'b' %>\nC", { now })).text, "A\nb\nC");
  assert.equal((await renderTemplate("A<%# hidden %>B", { now })).text, "AB");
  assert.equal((await renderTemplate("<% 'a%>b' %>", { now })).text, "a%>b");
  assert.equal((await renderTemplate("<% tp.file.path %> <% tp.date.now %>", {
    now,
    path: "Notes/Daily.md",
    title: "Daily",
    dateFormat: "YYYY-MM-DD",
  })).text, "Notes/Daily.md 2026-11-17");
});

test("a comment is dropped even when it holds a quote or a slash", async () => {
  assert.equal((await renderTemplate("A<%# Don't forget %>B", { now })).text, "AB");
  assert.equal((await renderTemplate("A<%# it's // fine %>B", { now })).text, "AB");
  assert.equal((await renderTemplate("A <%# trimmed -%> B", { now })).text, "A B");
  await assert.rejects(() => renderTemplate("A<%# never closed", { now }), /missing %>/);
});

test("a broken tag fails before the note changes", async () => {
  await assert.rejects(() => renderTemplate("<% tp.file.title", { now }), /missing %>/);
  await assert.rejects(() => renderTemplate("<% ) %>", { now }), TemplateError);
  await assert.rejects(() => renderTemplate("<% tp.system.prompt('Name') %>", { now }), /no prompt/);
  await assert.rejects(
    () => renderTemplate("<% tp.file.include('[[Missing]]') %>", { templatesFolder: "Templates", now, read: () => null }),
    /No note/,
  );
});

test("the starter template leaves the cursor under the title", async () => {
  const rendered = await renderTemplate(STARTER, { title: "Daily", now, dateFormat: "YYYY-MM-DD" });
  assert.equal(rendered.text, "---\ndate: 2026-11-17\n---\n\n# Daily\n\n\n");
  assert.equal(rendered.cursor, rendered.text.length - 1);
  assert.deepEqual(positionAt(rendered.text, rendered.cursor), { line: 6, ch: 0 });
});

test("an insert replaces the selection and keeps the cursor in the new text", () => {
  const applied = spliceText("Hello world", 6, 11, { text: "there", cursor: null });
  assert.equal(applied.text, "Hello there");
  assert.equal(applied.cursor, 11);
  const marked = spliceText("abcdef", 2, 4, { text: "XY", cursor: 1 });
  assert.equal(marked.text, "abXYef");
  assert.equal(marked.cursor, 3);
  assert.deepEqual(positionAt(marked.text, marked.cursor), { line: 0, ch: 3 });
});
