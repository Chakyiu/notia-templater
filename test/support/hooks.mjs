// Loader hook: `import ... from "notia"` resolves to the test stub, since the
// plugin's dependency is provided by the app at runtime and is not on npm.

const STUB = new URL("./notia-stub.mjs", import.meta.url).href;

/** @param {string} specifier @param {object} context @param {(s: string, c: object) => Promise<object>} next */
export async function resolve(specifier, context, next) {
  if (specifier === "notia") return { url: STUB, shortCircuit: true };
  return next(specifier, context);
}
