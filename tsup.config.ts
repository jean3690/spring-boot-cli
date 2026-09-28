import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  target: "node18",
  platform: "node",
  bundle: true,
  minify: false,
  sourcemap: true,
  banner: {
    js: "#!/usr/bin/env node",
  },
});
