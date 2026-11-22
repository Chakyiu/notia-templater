# Templater

A Notia community plugin. One command creates a note from a template. Another inserts a template at the cursor. A third creates the template file.

Templates are Markdown notes in a folder, with the same tags as Obsidian's Templater. `<% tp.date.now("YYYY-MM-DD") %>` becomes today's date. `<% tp.file.cursor() %>` is where the cursor lands. The command finishes in one step: the name, the text, and the cursor all come from the template.

## Install

Link this folder into a vault:

```bash
mkdir -p "/path/to/vault/.notia/plugins"
ln -s "/Users/chakyiu/Documents/project/github/2026/notia-templater" \
  "/path/to/vault/.notia/plugins/templater"
```

Open the vault, then turn **Templater** on in **Settings → Plugins**. Saving a file in this folder reloads the plugin.

## One command

**New template** creates `Templates/New template.md` and opens it. The note already has a date, a title, and a cursor:

```markdown
---
date: <% tp.date.now("YYYY-MM-DD") %>
---

# <% tp.file.title %>

<% tp.file.cursor() %>
```

**New note from template** creates a note from that file and opens it, with the cursor under the heading. With one template, that is the whole gesture. With several, each template has its own command, **New note from template: Daily**, so the command palette is the picker.

**Insert template** does the same thing at the cursor of the open note. The selected text is available as `tp.file.selection()` and is replaced by the template.

On Windows and Linux, Ctrl takes the place of ⌘. Option is Alt.

| Command | Shortcut |
| --- | --- |
| New note from template | `⌘⌥N` |
| Insert template | `⌘⌥T` |
| New template | |
| New note from template: *Name* | |
| Insert template: *Name* | |
| Replace templates in the active file | |

Replace templates in the active file runs whatever tags are still in the open note. Templater will not do that to a file inside the templates folder, so editing a template does not expand it.

The ribbon button and the Templates panel run the same commands. A row in the panel inserts into the open note, or creates a note when nothing is open.

Turn Templater off and on after you delete a template. That drops the command for the file you removed. Commands for templates you add appear as soon as the file is saved.

## Write a template

`<% expression %>` inserts the value. `<%* statements %>` runs JavaScript and can append to `tR`. `<%-` and `-%>` remove the blank space on that side of the tag. `<%# comment %>` inserts nothing.

```markdown
<% tp.file.rename(tp.date.now("YYYY-MM-DD") + " Meeting") %>
# <% tp.file.title %>

<% tp.file.cursor() %>
```

**New note from template: Meeting** then creates `2026-11-17 Meeting`.

| Tag | Inserts |
| --- | --- |
| `tp.date.now("YYYY-MM-DD", 1)` | A date. The second value is days, or `2h`, `-1 week`, `30m`, `1M` |
| `tp.date.tomorrow()` `tp.date.yesterday()` | The next or previous day |
| `tp.date.weekday("YYYY-MM-DD", "Monday")` | That weekday in the current week. `0` is Sunday |
| `tp.file.title` | The note's name. While creating, this is the template name until `rename` |
| `tp.file.rename("Journal/Day")` | The name of a note being created, including a subfolder |
| `tp.file.path()` `tp.file.folder()` | The note path, and the folder it sits in |
| `tp.file.cursor()` `tp.file.cursor(1)` | Where the cursor goes. The lowest number wins |
| `tp.file.cursor_append("END")` | Text that stays after the cursor |
| `tp.file.selection()` | The text that was selected |
| `tp.file.content` | The note's text before this template runs |
| `tp.file.tags` | The note's tags |
| `tp.file.creation_date()` `tp.file.last_modified_date()` | The note's modified time, or now when the note is new |
| `tp.file.include("[[Bit]]")` | Another note, with its tags run too |
| `tp.frontmatter.title` | A `key: value` line in the note's frontmatter |
| `tR` | Text appended from an execution block |

`tp.date.now()` with no format uses the date format in settings. Tokens are `YYYY` `YY` `MMMM` `MMM` `MM` `M` `DD` `D` `dddd` `ddd` `HH` `H` `hh` `h` `mm` `m` `ss` `s` `A` `a`. Text in `[brackets]` is copied as written.

A tag can name `tp.file.path` or call `tp.file.path()`. Both insert the path.

## Settings

**Templates folder** is `Templates`. Notes in folders inside it are templates too, and show up as `Work/Standup`.

**New notes folder** is where the new note is saved. Empty saves it at the top of the vault. It needs to be a different folder from the templates.

**Default template** is the one Insert template and New note from template use. A command named for a template ignores it. With one template and no default, that template is used.

**Date in the title** prefixes the note name with `YYYY-MM-DD`. `tp.file.rename` chooses the name instead.

**Open in a new tab** leaves the current note open.

## Develop

`notia.d.ts` is a copy of the plugin API. `jsconfig.json` points editors at it. When Notia's API changes, copy the new one from `crates/notia-js/notia.d.ts` in Notia, or from `.notia/plugins/notia.d.ts`.

The plugin itself has no dependencies. Everything in `devDependencies` is for the checks, and the versions are pinned.

## Check

```bash
npm ci
npm test
npm run typecheck
npm run lint
```

`npm test` runs `node --test` against the tests in `test/`, with the `notia` API replaced by a stub, so no vault is needed. `.github/workflows/ci.yml` runs the same three checks on Linux, macOS and Windows.
