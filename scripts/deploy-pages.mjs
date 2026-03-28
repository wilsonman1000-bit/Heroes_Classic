import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');

function run(cmd, args, { allowFailure = false } = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { cwd: repoRoot, stdio: 'inherit', shell: false });
    p.on('exit', (code) => {
      if (code === 0 || allowFailure) resolve(code ?? 0);
      else reject(new Error(`${cmd} ${args.join(' ')} failed with code ${code}`));
    });
  });
}

async function main() {
  const msg = process.argv.slice(2).join(' ').trim() || 'Update pages';

  // 1) Rebuild docs/
  await run(process.execPath, [path.join(repoRoot, 'scripts', 'build-pages.mjs')]);

  // 2) Stage docs/
  await run('git', ['add', 'docs']);

  // 3) If no staged changes, stop cleanly.
  const hasChangesCode = await run('git', ['diff', '--cached', '--quiet'], { allowFailure: true });
  if (hasChangesCode === 0) {
    console.log('\nNo changes in docs/ to deploy.');
    return;
  }

  // 4) Commit + push
  await run('git', ['commit', '-m', msg]);
  await run('git', ['push']);

  console.log('\nDeployed. If GitHub Pages is enabled, refresh the site in 1–2 minutes.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
