/**
 * Cloudflare R2 upload (D3).
 *
 * R2 is S3-compatible, so the AWS SDK's S3Client talks to it directly —
 * point it at the account-scoped R2 endpoint instead of an AWS region.
 * https://developers.cloudflare.com/r2/api/s3/api/
 */

import { createReadStream, statSync } from 'node:fs';
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';

export function r2Endpoint(accountId) {
  return `https://${accountId}.r2.cloudflarestorage.com`;
}

export function createR2Client({ accountId, accessKeyId, secretAccessKey }) {
  return new S3Client({
    region: 'auto',
    endpoint: r2Endpoint(accountId),
    credentials: { accessKeyId, secretAccessKey },
  });
}

export async function uploadPmtiles({ client, bucket, key, filePath }) {
  const { size } = statSync(filePath);

  await client.send(new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    Body: createReadStream(filePath),
    ContentLength: size,
    ContentType: 'application/octet-stream',
  }));

  return { bucket, key, bytes: size };
}
