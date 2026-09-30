/**
 * Test entry point.
 *
 * The sources use bundler-style ".js" import specifiers that Node cannot
 * resolve against ".ts" files, so this registers a resolver hook that maps
 * them, letting `node --test` run the TypeScript sources directly with no
 * bundler and no extra dependency.
 */
import { register } from "node:module";
import { pathToFileURL } from "node:url";

register("./resolve-ts.mjs", import.meta.url);
