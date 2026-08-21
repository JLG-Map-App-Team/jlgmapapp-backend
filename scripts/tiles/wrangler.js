/**
 * Cloudflare R2 upload via wrangler (D3).
 *
 * wrangler authenticates non-interactively from CLOUDFLARE_API_TOKEN and
 * CLOUDFLARE_ACCOUNT_ID in the environment — no separate S3-style access
 * key/secret needed. `r2 object put` defaults to a local simulated bucket
 * unless told otherwise, so every remote call here passes --remote.
 * https://developers.cloudflare.com/r2/reference/wrangler-commands/
 */

import { spawn } from 'node:child_process';

function run(args) {
  return new Promise((resolve, reject) => {
    const child = spawn('npx', ['wrangler', ...args], { stdio: ['ignore', 'pipe', 'pipe'] });

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; process.stdout.write(chunk); });
    child.stderr.on('data', (chunk) => { stderr += chunk; process.stderr.write(chunk); });

    child.on('error', reject); // e.g. ENOENT — npx/wrangler not resolvable
    child.on('exit', (code) => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(Object.assign(new Error(`wrangler ${args[0]} exited with code ${code}`), { stdout, stderr }));
    });
  });
}

export function buildCreateBucketArgs(bucket) {
  return ['r2', 'bucket', 'create', bucket];
}

export function buildPutObjectArgs({ bucket, key, filePath, contentType }) {
  return [
    'r2', 'object', 'put', `${bucket}/${key}`,
    '--file', filePath,
    '--content-type', contentType,
    '--remote',
  ];
}

/**
 * Idempotent: a bucket that already exists is not a failure. wrangler
 * reports that case as a non-zero exit with "already exists" in stderr —
 * there is no separate "does this bucket exist" command to check first.
 */
export async function ensureBucket(bucket) {
  try {
    await run(buildCreateBucketArgs(bucket));
  } catch (err) {
    if (!/already exists/i.test(err.stderr ?? '')) throw err;
  }
}

export async function uploadObject({ bucket, key, filePath, contentType = 'application/octet-stream' }) {
  await run(buildPutObjectArgs({ bucket, key, filePath, contentType }));
  return { bucket, key };
}
