// `node --import ./test/support/register.mjs` installs the "notia" resolver
// before any test file imports the plugin.

import { register } from "node:module";

register("./hooks.mjs", import.meta.url);
