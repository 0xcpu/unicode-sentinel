import * as esbuild from "esbuild";
import { mkdirSync, copyFileSync } from "fs";

const watch = process.argv.includes("--watch");
mkdirSync("dist", { recursive: true });

copyFileSync("src/popup/popup.html", "dist/popup.html");
copyFileSync("src/options/options.html", "dist/options.html");

const opts = {
  bundle: true,
  platform: "browser",
  target: "chrome120",
  outdir: "dist",
  outbase: ".",
  entryPoints: [
    "src/content/content.js",
    "src/background/background.js",
    "src/popup/popup.js",
    "src/options/options.js",
    "content.css",
  ],
  logLevel: "info",
};

if (watch) {
  const ctx = await esbuild.context(opts);
  await ctx.watch();
} else {
  await esbuild.build(opts);
}
