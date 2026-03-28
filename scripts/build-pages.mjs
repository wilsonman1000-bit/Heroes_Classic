import { build } from 'esbuild';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const repoRoot = path.resolve(__dirname, '..');
const outDir = path.join(repoRoot, 'docs');
const outAssetsDir = path.join(outDir, 'assets');

async function rmDirSafe(p) {
  await fs.rm(p, { recursive: true, force: true }).catch(() => {});
}

async function ensureDir(p) {
  await fs.mkdir(p, { recursive: true });
}

async function copyDir(srcDir, destDir) {
  const entries = await fs.readdir(srcDir, { withFileTypes: true });
  await ensureDir(destDir);
  await Promise.all(
    entries.map(async (ent) => {
      const src = path.join(srcDir, ent.name);
      const dest = path.join(destDir, ent.name);
      if (ent.isDirectory()) return copyDir(src, dest);
      if (ent.isFile()) return fs.copyFile(src, dest);
    }),
  );
}

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, {
      cwd: repoRoot,
      stdio: 'inherit',
      shell: false,
    });
    p.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${cmd} ${args.join(' ')} failed with code ${code}`));
    });
  });
}

function toPagesIndexHtml(rootIndexHtml) {
  // Replace Pixi script (served from node_modules in dev) + the dist entry with a single bundled module.
  let html = rootIndexHtml;

  // Remove stylesheet link that doesn't exist in repo.
  html = html.replace(/\s*<link[^>]*href=["']styles\.css["'][^>]*>\s*/i, '\n');

  // Drop PixiJS script tag.
  html = html.replace(/\s*<script[^>]*src=["']node_modules\/pixi\.js\/dist\/pixi\.min\.js["'][^>]*>\s*<\/script>\s*/i, '\n');

  // Replace app entry script.
  html = html.replace(
    /<script\s+type=["']module["']\s+src=["']dist\/index\.web\.js["']\s*><\/script>/i,
    '<script type="module" src="./assets/index.js"></script>',
  );

  return html;
}

async function main() {
  // 1) Compile TS into dist (keeps NodeNext-style ".js" import specifiers resolvable).
  // Avoid spawning .cmd files on Windows (can fail with EINVAL). Run the JS entry via node.
  const tscPath = path.join(repoRoot, 'node_modules', 'typescript', 'bin', 'tsc');
  await run(process.execPath, [tscPath, '-p', 'tsconfig.json']);

  // 2) Clean docs output.
  await rmDirSafe(outDir);
  await ensureDir(outAssetsDir);

  // 3) Bundle for browser.
  await build({
    entryPoints: [path.join(repoRoot, 'dist', 'index.web.js')],
    bundle: true,
    format: 'esm',
    platform: 'browser',
    target: 'es2020',
    sourcemap: true,
    outfile: path.join(outAssetsDir, 'index.js'),
    logLevel: 'info',
  });

  // 4) Generate docs/index.html.
  const rootIndex = await fs.readFile(path.join(repoRoot, 'index.html'), 'utf8');
  const pagesIndex = toPagesIndexHtml(rootIndex);
  await fs.writeFile(path.join(outDir, 'index.html'), pagesIndex, 'utf8');

  // 5) Copy static assets.
  const dirsToCopy = ['ImagesRPG', 'Anim', 'sounds'];
  for (const d of dirsToCopy) {
    const src = path.join(repoRoot, d);
    const dest = path.join(outDir, d);
    await copyDir(src, dest);
  }

  // 6) Prevent Jekyll processing.
  await fs.writeFile(path.join(outDir, '.nojekyll'), '', 'utf8');

  console.log(`\nGitHub Pages build complete: ${path.relative(repoRoot, outDir)}\n`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
