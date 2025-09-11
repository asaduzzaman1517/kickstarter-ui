import { defineConfig } from "vite";
import path from "path";
import sass from "sass";
import fs from "fs-extra";
import chokidar from "chokidar";

// --- Paths ---
const paths = {
  src: {
    html: "src/*.html",
    styleSCSS: "src/assets/scss/style.scss",
    bootstrapSCSS: "node_modules/bootstrap/scss/bootstrap.scss",
    bootstrapJS: "node_modules/bootstrap/dist/js/bootstrap.bundle.js",
    appJS: "src/assets/js/main.js",
  },
  dist: {
    base: "dist",
    css: "dist/assets/css",
    js: "dist/assets/js",
  },
  dev: {
    css: "src/assets/css", // style.css output for dev
  },
};

// --- Helper Functions ---
async function compileSCSS(file, outDir, outName) {
  const result = sass.compile(file, { style: "compressed" });
  await fs.ensureDir(outDir);
  await fs.writeFile(path.join(outDir, outName), result.css);
  console.log(`✅ SCSS compiled: ${outName}`);
}

async function copyFile(srcFile, destDir, destName = null) {
  await fs.ensureDir(destDir);
  await fs.copy(srcFile, path.join(destDir, destName || path.basename(srcFile)));
  console.log(`✅ Copied: ${destName || path.basename(srcFile)}`);
}

async function copyHTML(dest = paths.dist.base) {
  const files = fs.readdirSync("src").filter(f => f.endsWith(".html"));
  for (const file of files) {
    await copyFile(path.join("src", file), dest, file);
  }
}

// --- Vite Config ---
export default defineConfig(({ command }) => {
  const isBuild = command === "build";

  return {
    root: "./src",
    build: {
      outDir: "../dist",
      emptyOutDir: true,
      rollupOptions: {
        input: path.resolve(__dirname, paths.src.appJS),
        output: {
          entryFileNames: "assets/js/app.js",
          assetFileNames: (assetInfo) => {
            if (/\.css$/i.test(assetInfo.name || "")) return "assets/css/[name][extname]";
            return "assets/[name][extname]";
          },
        },
      },
    },
    plugins: [
      {
        name: "custom-build",
        closeBundle: async () => {
          // Copy HTML
          await copyHTML();

          // Compile main SCSS
          await compileSCSS(paths.src.styleSCSS, paths.dist.css, "style.css");

          // Build-only Bootstrap SCSS & JS
          if (isBuild) {
            await compileSCSS(paths.src.bootstrapSCSS, paths.dist.css, "bootstrap.css");
            await copyFile(paths.src.bootstrapJS, paths.dist.js, "bootstrap.bundle.js");
          }

          // Copy app.js
          await copyFile(paths.src.appJS, paths.dist.js, "app.js");
        },
      },
      {
        name: "dev-watch",
        apply: "serve",
        configureServer(server) {
          const watcher = chokidar.watch(
            [paths.src.html, paths.src.styleSCSS],
            { ignoreInitial: true }
          );

          watcher.on("all", async (event, file) => {
            console.log(`🔄 ${event}: ${file}`);

            if (file.endsWith(".scss")) {
              await compileSCSS(paths.src.styleSCSS, paths.dev.css, "style.css");
            } else if (file.endsWith(".html")) {
              await copyHTML("src"); // copy to src for dev
            }

            server.ws.send({ type: "full-reload" });
          });
        },
      },
    ],
    server: {
      open: "/index.html",
    },
  };
});
