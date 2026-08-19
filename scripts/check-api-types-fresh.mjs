// Drift guard: fails if src/types/api.d.ts is out of date with the OpenAPI spec.
//
// Committing generated code is a deliberate choice — a teammate can clone and
// typecheck without running codegen first, and a reviewer sees contract changes
// in the diff. The cost is one failure mode: someone edits the spec and forgets
// to regenerate. The types then describe an API that no longer exists, and the
// compiler cheerfully agrees with them.
//
// Implementation note: this regenerates IN PLACE and asks git whether anything
// changed. It does not generate to a temp file and compare, because
// redocly.yaml declares `x-openapi-ts.output` and openapi-typescript therefore
// ignores any -o argument. A temp-file version silently regenerates the real
// file instead, which means running the check would *repair* the drift it is
// supposed to detect. It would pass every time and catch nothing.

import { execFileSync } from 'node:child_process';

const GENERATED = 'src/types/api.d.ts';

function run(cmd, args) {
  return execFileSync(cmd, args, { encoding: 'utf8' });
}

try {
  run('git', ['rev-parse', '--is-inside-work-tree']);
} catch {
  console.error(`Cannot check for drift: not inside a git work tree.`);
  process.exit(1);
}

// Refuse to run if the file is already dirty — otherwise we cannot tell
// "the spec changed" from "someone was mid-edit".
const dirtyBefore = run('git', ['status', '--porcelain', '--', GENERATED]).trim();
if (dirtyBefore !== '') {
  console.error('');
  console.error(`  ${GENERATED} has uncommitted changes before this check ran.`);
  console.error('  Commit or stash it first, then re-run.');
  console.error('');
  process.exit(1);
}

execFileSync('npx', ['openapi-typescript'], { stdio: ['ignore', 'ignore', 'inherit'] });

const changed = run('git', ['status', '--porcelain', '--', GENERATED]).trim();

if (changed === '') {
  console.log(`OK  ${GENERATED} is in sync with the OpenAPI spec.`);
  process.exit(0);
}

console.error('');
console.error('DRIFT DETECTED');
console.error('');
console.error(`  ${GENERATED} did not match what the spec generates.`);
console.error('  The spec was edited without regenerating the types.');
console.error('');
console.error('  It has now been regenerated in your working tree. Review the diff');
console.error('  and commit it:');
console.error('');
console.error(`      git diff -- ${GENERATED}`);
console.error(`      git add ${GENERATED}`);
console.error('');
process.exit(1);
