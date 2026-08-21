import type { Request, Response } from 'express';
import { getSegments } from '../services/segments.js';
import {
  databaseUnavailable,
  PROBLEM_MEDIA_TYPE,
} from '../utils/problem.js';

export async function getSegmentsController(
  _req: Request,
  res: Response,
): Promise<void> {
  try {
    const segments = await getSegments();

    res
      .status(200)
      .type('application/geo+json')
      .json(segments);
  } catch (error) {
    console.error('GET /api/v1/segments database error:', error);

    res
      .status(503)
      .type(PROBLEM_MEDIA_TYPE)
      .json(databaseUnavailable());
  }
}
