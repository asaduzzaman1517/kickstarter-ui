import { defineConfig } from "vite";
import fs from "fs-extra";
import path from "path";
import chokidar from "chokidar";
import * as sass from "sass";
import { globSync } from "glob";
import nunjucks from "nunjucks";

// -----------------------
// Paths
// -----------------------
const paths = {
  src: {
    templateRoot: "src/templates",
    templates: [
      "src/templates/**/*.html",
      "!src/templates/layouts/**",
      "!src/templates/partials/**",
    ],
    styleSCSS: "src/assets/scss/style.scss",
    bootstrapSCSS: "src/assets/scss/bootstrap/scss/bootstrap.scss",
    bootstrapJS: "node_modules/bootstrap/dist/js/bootstrap.bundle.js",
    vendorCSS: "src/assets/scss/vendor/*.*",
    vendorJS: "src/assets/js/vendor/*.*",
    fontSCSS: "src/assets/scss/fonts/*.*",
    fonts: "src/assets/fonts/**/*.*",
    images: "src/assets/img/**/*.*",
    appJS: "src/assets/js/app.js",
  },
  dist: { base: "dist" },
  dev: { base: ".vite-temp" },
};

// -----------------------
// Helpers
// -----------------------
async function compileSCSS(inputFile, outDir, outFileName) {
  if (!fs.existsSync(inputFile)) return;
  const result = sass.compile(inputFile, { style: "compressed", quietDeps: true });
  const outFile = path.join(outDir, "assets/css", outFileName);
  await fs.ensureDir(path.dirname(outFile));
  await fs.writeFile(outFile, result.css);
  console.log(`✅ SCSS compiled: ${path.relative(".", outFile)}`);
}

async function compileFontSCSS(outDir) {
  const files = globSync(paths.src.fontSCSS);
  for (const file of files) {
    const result = sass.compile(file, { style: "compressed", quietDeps: true });
    const outFile = path.join(outDir, "assets/css", path.basename(file).replace(/\.scss$/, ".css"));
    await fs.ensureDir(path.dirname(outFile));
    await fs.writeFile(outFile, result.css);
    console.log(`✅ Font SCSS compiled: ${path.relative(".", outFile)}`);
  }
}

async function copyFileOrFolder(src, dest) {
  if (!fs.existsSync(src)) return;
  const stats = fs.statSync(src);
  if (stats.isFile()) {
    await fs.ensureDir(path.dirname(dest));
    await fs.copyFile(src, dest);
    console.log(`✅ Copied file: ${path.relative(".", src)} → ${path.relative(".", dest)}`);
  } else if (stats.isDirectory()) {
    await fs.copy(src, dest);
    console.log(`✅ Copied folder: ${path.relative(".", src)} → ${path.relative(".", dest)}`);
  }
}

async function copyBootstrapJS(outDir) {
  const dest = path.join(outDir, "assets/js/bootstrap.bundle.js");
  await fs.ensureDir(path.dirname(dest));
  await fs.copy(paths.src.bootstrapJS, dest);
  console.log("✅ Bootstrap JS copied");
}

async function copyImages(outDir) {
  if (fs.existsSync("src/assets/img")) {
    await fs.copy("src/assets/img", path.join(outDir, "assets/img"));
    console.log("✅ Images copied");
  }
}

// -----------------------
// Nunjucks
// -----------------------
const njkEnv = nunjucks.configure(
  [
    paths.src.templateRoot,
    path.join(paths.src.templateRoot, "layouts"),
    path.join(paths.src.templateRoot, "partials"),
  ],
  { autoescape: false, noCache: true }
);

async function compileHTML(outDir) {
  const templates = globSync(paths.src.templates, {
    ignore: ["src/templates/layouts/**", "src/templates/partials/**"],
  });

  for (const file of templates) {
    const relativePath = path.relative(paths.src.templateRoot, file);
    const html = njkEnv.render(relativePath, {});
    const outFile = path.join(outDir, relativePath);
    await fs.ensureDir(path.dirname(outFile));
    await fs.writeFile(outFile, html);
    console.log(`✅ HTML compiled: ${relativePath}`);
  }
}

// -----------------------
// Unified compile function
// -----------------------
async function compileAll(outDir, options = { compileBootstrap: false }) {
  if (options.compileBootstrap) {
    await compileSCSS(paths.src.bootstrapSCSS, outDir, "bootstrap.css");
  }

  await compileSCSS(paths.src.styleSCSS, outDir, "style.css");

  await copyFileOrFolder("src/assets/scss/vendor", path.join(outDir, "assets/css"));
  await copyFileOrFolder("src/assets/js/vendor", path.join(outDir, "assets/js"));

  await copyFileOrFolder(paths.src.fonts, path.join(outDir, "assets/fonts"));
  await compileFontSCSS(outDir);
  await copyImages(outDir);

  await copyFileOrFolder(paths.src.appJS, path.join(outDir, "assets/js", "app.js"));
  await copyBootstrapJS(outDir);

  await compileHTML(outDir);
}

// -----------------------
// Vite Config
// -----------------------
export default defineConfig(({ command }) => {
  const isDev = command === "serve";
  const rootDir = isDev ? paths.dev.base : ".";

  return {
    root: rootDir,
    publicDir: "public",
    build: {
      outDir: paths.dist.base,
      emptyOutDir: true,
      rollupOptions: {
        input: path.resolve(__dirname, paths.src.appJS),
        output: {
          entryFileNames: "assets/js/[name].js",
          assetFileNames: (assetInfo) => {
            if (/\.css$/i.test(assetInfo.name || "")) return "assets/css/[name][extname]";
            if (/\.(woff2?|ttf|eot|otf)$/i.test(assetInfo.name || "")) return "assets/fonts/[name][extname]";
            if (/\.(png|jpe?g|gif|svg|webp)$/i.test(assetInfo.name || "")) return "assets/img/[name][extname]";
            return "assets/[name][extname]";
          },
        },
      },
    },
    plugins: [
      {
        name: "nunjucks-dev",
        apply: "serve",
        configureServer(server) {
          fs.ensureDirSync(paths.dev.base);

          // Compile Bootstrap once at dev start
          compileSCSS(paths.src.bootstrapSCSS, paths.dev.base, "bootstrap.css").then(() => {
            console.log("✅ Bootstrap SCSS compiled for dev");
          });

          // Copy app.js first
          copyFileOrFolder(paths.src.appJS, path.join(paths.dev.base, "assets/js", "app.js"));

          // Compile dev files (style.css, fonts, HTML)
          compileAll(paths.dev.base, { compileBootstrap: false });

          chokidar
            .watch(
              ["src/templates/**/*.html", "src/assets/scss/**/*.scss", "src/assets/js/**/*.js"],
              { ignoreInitial: true }
            )
            .on("all", async (event, file) => {
              console.log(`🔄 ${event}: ${file}`);

              if (file.endsWith(".js")) {
                await copyFileOrFolder(
                  file,
                  path.join(paths.dev.base, "assets/js", path.basename(file))
                );
              }

              if (file.endsWith(".scss")) {
                await compileSCSS(paths.src.styleSCSS, paths.dev.base, "style.css");
                await compileFontSCSS(paths.dev.base);
              }

              if (file.endsWith(".html")) {
                await compileHTML(paths.dev.base);
              }

              server.ws.send({ type: "full-reload" });
            });
        },
      },
      {
        name: "custom-build",
        apply: "build",
        closeBundle: async () => {
          const bootstrapSrc = "node_modules/bootstrap/scss";
          const bootstrapDest = "src/assets/scss/bootstrap/scss";
          await fs.ensureDir(bootstrapDest);
          await fs.copy(bootstrapSrc, bootstrapDest);
          console.log("✅ Bootstrap SCSS copied for build");

          await compileAll(paths.dist.base, { compileBootstrap: true });
        },
      },
    ],
    server: {
      open: true,
      port: 5173,
      fs: { allow: [".."] },
    },
  };
});
