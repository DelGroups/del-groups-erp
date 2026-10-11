// node --import ./scripts/node-ts/register.mjs …  (see hooks.mjs)
import { register } from "node:module";

register("./hooks.mjs", import.meta.url);
