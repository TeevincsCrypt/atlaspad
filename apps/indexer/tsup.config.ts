import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/main.ts", "src/rebuild.ts", "src/migrate-cli.ts"],
  format: ["esm"],
  platform: "node",
  target: "node22",
  outDir: "dist",
  clean: true,
  sourcemap: true,
  // Bundle workspace packages (they ship TypeScript sources); keep npm deps external.
  noExternal: [/^@atlaspad\//],
});
