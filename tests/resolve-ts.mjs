import { registerHooks } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

registerHooks({
  resolve(specifier, context, nextResolve) {
    let target = specifier;
    if (target.startsWith("@/")) {
      target = pathToFileURL(path.join(rootDir, target.slice(2))).href;
    }
    try {
      return nextResolve(target, context);
    } catch (error) {
      if (error?.code !== "ERR_MODULE_NOT_FOUND" && error?.code !== "ERR_UNSUPPORTED_DIR_IMPORT") throw error;
      try {
        return nextResolve(`${target}.ts`, context);
      } catch {
        try {
          return nextResolve(`${target}/index.ts`, context);
        } catch {
          try {
            return nextResolve(`${target}.tsx`, context);
          } catch {
            throw error;
          }
        }
      }
    }
  },
});
