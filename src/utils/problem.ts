// Builders for RFC 9457 Problem Details responses.
//
// Every error this API returns goes through here, so the shape in the spec and
// the shape on the wire cannot drift apart: the return type IS the generated
// contract type. Change the spec, regenerate, and this file stops compiling
// until it matches.

import type { Problem } from '../types/segments.js';

/** Problem type URIs. Stable — clients may branch on these. */
export const ProblemType = {
  RateLimited: '/problems/rate-limited',
  Internal: '/problems/internal-error',
  DatabaseUnavailable: '/problems/database-unavailable',
} as const;

/**
 * The media type every Problem response must carry. Express's res.json()
 * defaults to application/json, which would silently violate the contract.
 */
export const PROBLEM_MEDIA_TYPE = 'application/problem+json';

function problem(
  type: string,
  title: string,
  status: number,
  detail?: string,
  instance?: string,
): Problem {
  return {
    type,
    title,
    status,
    ...(detail === undefined ? {} : { detail }),
    ...(instance === undefined ? {} : { instance }),
  };
}

export const rateLimited = (detail?: string, instance?: string): Problem =>
  problem(ProblemType.RateLimited, 'Too Many Requests', 429, detail, instance);

export const internalError = (instance?: string): Problem =>
  problem(
    ProblemType.Internal,
    'Internal Server Error',
    500,
    'An unexpected error occurred. The details have been logged.',
    instance,
  );

export const databaseUnavailable = (instance?: string): Problem =>
  problem(
    ProblemType.DatabaseUnavailable,
    'Service Unavailable',
    503,
    'Segment data is temporarily unavailable. The base map will still load.',
    instance,
  );
