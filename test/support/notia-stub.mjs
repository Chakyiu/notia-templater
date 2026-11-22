// A stand-in for Notia's `notia` module, mapped in by `test/support/hooks.mjs`.
// It records everything the plugin registers so a test can drive it.

/** Messages passed to `new Notice(...)`, oldest first. */
export const notices = [];

export class Notice {
  /** @param {string} message */
  constructor(message) {
    this.message = message;
    notices.push(message);
  }
}

export class Plugin {
  /**
   * @param {object} app
   * @param {object} manifest
   */
  constructor(app, manifest) {
    this.app = app;
    this.manifest = manifest;
    /** @type {Map<string, object>} */
    this.commands = new Map();
    /** @type {{ icon: string, title: string, callback: () => unknown }[]} */
    this.ribbonIcons = [];
    /** @type {object[]} */
    this.panels = [];
    /** @type {object[]} */
    this.settingTabs = [];
    /** @type {object[]} */
    this.events = [];
    /** @type {number[]} */
    this.intervals = [];
    /** What `loadData` returns. `undefined` reads as `null`, like a missing data.json. */
    this.data = undefined;
    /** Every object handed to `saveData`. */
    this.saved = [];
  }

  /** @param {object} command */
  addCommand(command) {
    this.commands.set(command.id, command);
    return command;
  }

  addRibbonIcon(icon, title, callback) {
    this.ribbonIcons.push({ icon, title, callback });
  }

  addStatusBarItem() {
    const item = { text: "", setText(text) { item.text = text; return item; } };
    return item;
  }

  /** @param {object} options */
  addPanel(options) {
    const handle = {
      options,
      refreshes: 0,
      shown: 0,
      refresh() {
        handle.refreshes += 1;
      },
      show() {
        handle.shown += 1;
      },
    };
    this.panels.push(handle);
    return handle;
  }

  /** @param {object} options */
  addSettingTab(options) {
    const handle = {
      options,
      refreshes: 0,
      refresh() {
        handle.refreshes += 1;
      },
    };
    this.settingTabs.push(handle);
    return handle;
  }

  registerEvent(ref) {
    this.events.push(ref);
    return ref;
  }

  registerInterval(id) {
    this.intervals.push(id);
    return id;
  }

  async loadData() {
    return this.data === undefined ? null : this.data;
  }

  /** @param {unknown} data */
  async saveData(data) {
    this.saved.push(data);
  }
}

/** Elements are plain objects: `{ type, ...fields }`. */
const element = (type, fields) => ({ type, ...fields });

export const ui = {
  column: (children, options) => element("column", { children, options }),
  row: (children, options) => element("row", { children, options }),
  heading: (text) => element("heading", { text }),
  text: (text, options) => element("text", { text, options }),
  markdown: (source) => element("markdown", { source }),
  button: (label, onClick, options) => element("button", { label, onClick, options }),
  list: (items) => element("list", { items }),
  separator: () => element("separator", {}),
  empty: (text) => element("empty", { text }),
  setting: (name, control, options) => element("setting", { name, control, options }),
  toggle: (value, onChange) => element("toggle", { value, onChange }),
  textInput: (value, onChange) => element("textInput", { value, onChange }),
  textArea: (value, onChange, options) => element("textArea", { value, onChange, options }),
  numberInput: (value, onChange, options) => element("numberInput", { value, onChange, options }),
  dropdown: (value, options, onChange) => element("dropdown", { value, options, onChange }),
};
