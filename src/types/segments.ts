// The shared vocabulary for the GET /api/v1/segments contract.
//
// This file exists so that both the backend and the harness import ONE name
// each, from ONE place — Stage B Definition of Done, clause 3. Without it,
// consumers reach into the generated file with a five-level accessor and the
// contract stops being legible at the call site.
//
// api.d.ts is generated from openapi_B2.yaml and must never be hand-edited.
// Run `npm run gen:api` after any spec change; CI enforces this via
// `npm run gen:api:check`.

import type { components } from './api.js';

export type SegmentFeatureCollection = components['schemas']['SegmentFeatureCollection'];
export type SegmentFeature = components['schemas']['SegmentFeature'];
export type SegmentProperties = components['schemas']['SegmentProperties'];
export type LineStringGeometry = components['schemas']['LineStringGeometry'];
export type Position = components['schemas']['Position'];

/** RFC 9457 Problem Details — the shape of every error this API returns. */
export type Problem = components['schemas']['Problem'];
