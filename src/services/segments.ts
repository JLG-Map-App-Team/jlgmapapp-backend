import type { QueryResultRow } from 'pg';
import pool from '../db/pool.js';
import type {
  LineStringGeometry,
  SegmentFeatureCollection,
  SegmentPhase,
  SegmentTypeCode,
} from '../types/segments.js';

interface SegmentRow extends QueryResultRow {
  segment_id: string;
  geometry: LineStringGeometry;
  phase: SegmentPhase | null;
  phase_label: string | null;
  type: SegmentTypeCode | null;
  type_label: string | null;
}

export async function getSegments(): Promise<SegmentFeatureCollection> {
  const result = await pool.query<SegmentRow>(`
    SELECT
      rs.id::text AS segment_id,
      ST_AsGeoJSON(rs.geom)::json AS geometry,
      rs.status_code AS phase,
      ss.label AS phase_label,
      rs.type_code AS type,
      st.label AS type_label
    FROM core.route_segment AS rs
    LEFT JOIN core.segment_status AS ss
      ON ss.code = rs.status_code
    LEFT JOIN core.segment_type AS st
      ON st.code = rs.type_code
    ORDER BY rs.id
  `);

  return {
    type: 'FeatureCollection',
    features: result.rows.map((row) => ({
      type: 'Feature',
      geometry: row.geometry,
      properties: {
        segment_id: row.segment_id,
        phase: row.phase,
        phase_label: row.phase_label,
        type: row.type,
        type_label: row.type_label,
      },
    })),
  };
}
