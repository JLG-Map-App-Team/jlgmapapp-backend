/**
 * L2.2 -- Verify the open-segment gate reports interruption, not the long arc.
 *
 * FR-08a shall-4 forbids substituting a longer arc when the shorter path is
 * interrupted. routing.segment_edge (migration 0008) is deliberately built to
 * hold EVERY segment regardless of status, precisely so a caller routes across
 * the full network first and inspects the returned segments' status afterward,
 * rather than filtering closed segments out of the graph before routing --
 * which would make pgr_dijkstra silently detour around them.
 *
 * This test builds a small synthetic triangle inside a transaction that is
 * always rolled back, so it never touches the real 51-segment network:
 *
 *   A --- (120 m, under_construction) --- B
 *    \                                   /
 *     '-- (405 m, open) -- C -- (405 m, open) --'
 *
 * and demonstrates the two possible query shapes give two different answers,
 * only one of which is the shape FR-08a shall-4 requires.
 */

import assert from 'node:assert/strict'
import test, { after, before } from 'node:test'
import pg from 'pg'

const { Client } = pg

const databaseConfig = {
  host: process.env.PGHOST ?? 'localhost',
  port: Number(process.env.PGPORT ?? process.env.POSTGRES_PORT ?? 5432),
  database: process.env.PGDATABASE ?? process.env.POSTGRES_DB ?? 'jlgmapapp',
  user: process.env.PGUSER ?? process.env.POSTGRES_USER ?? 'jlgmapapp',
  password: process.env.PGPASSWORD ?? process.env.POSTGRES_PASSWORD ?? 'jlgmapapp_dev',
}

// Deliberately far outside the real network's id range (max vertex id 54 on
// the published dataset as of 2026-08-21), so the fixture cannot collide with
// a live vertex even though it shares the transaction with the real tables.
const NODE_A = 900001
const NODE_B = 900002
const NODE_C = 900003

const client = new Client(databaseConfig)
let segAB, segAC, segCB

before(async () => {
  await client.connect()
  await client.query('BEGIN')

  const { rows: [greenway] } = await client.query(
    'SELECT id FROM core.greenway ORDER BY id LIMIT 1',
  )

  const insertSegment = async (label, sourceRef, statusCode, x1, y1, x2, y2) => {
    const { rows: [row] } = await client.query(
      `INSERT INTO core.route_segment (greenway_id, name, geom, status_code, source, source_ref)
       VALUES ($1, $2,
         ST_Transform(ST_SetSRID(ST_MakeLine(ST_MakePoint($3,$4), ST_MakePoint($5,$6)), 26917), 4326),
         $7, 'test_fixture', $8)
       RETURNING id`,
      [greenway.id, `L2.2 gate fixture: ${label}`, x1, y1, x2, y2, statusCode, sourceRef],
    )
    return row.id
  }

  segAB = await insertSegment('A-B direct (interrupted)', 'l2.2-gate-a-b', 'under_construction', 500000, 4700000, 500120, 4700000)
  segAC = await insertSegment('A-C detour leg', 'l2.2-gate-a-c', 'open', 500000, 4700000, 500060, 4700400)
  segCB = await insertSegment('C-B detour leg', 'l2.2-gate-c-b', 'open', 500060, 4700400, 500120, 4700000)

  await client.query(
    `INSERT INTO routing.segment_vertex (id, geom, degree) VALUES
       ($1, ST_SetSRID(ST_MakePoint(500000,4700000), 26917), 2),
       ($2, ST_SetSRID(ST_MakePoint(500120,4700000), 26917), 2),
       ($3, ST_SetSRID(ST_MakePoint(500060,4700400), 26917), 2)`,
    [NODE_A, NODE_B, NODE_C],
  )

  const insertEdge = async (segmentId, source, target, x1, y1, x2, y2) => {
    await client.query(
      `INSERT INTO routing.segment_edge (source_segment_id, split_ordinal, source, target, cost, reverse_cost, geom)
       SELECT $1, 1, $2, $3, ST_Length(g), ST_Length(g), g
       FROM (SELECT ST_SetSRID(ST_MakeLine(ST_MakePoint($4,$5), ST_MakePoint($6,$7)), 26917) AS g) s`,
      [segmentId, source, target, x1, y1, x2, y2],
    )
  }

  await insertEdge(segAB, NODE_A, NODE_B, 500000, 4700000, 500120, 4700000)
  await insertEdge(segAC, NODE_A, NODE_C, 500000, 4700000, 500060, 4700400)
  await insertEdge(segCB, NODE_C, NODE_B, 500060, 4700400, 500120, 4700000)
})

after(async () => {
  // The fixture never commits. Rolling back is what makes this test safe to
  // run against the real development database.
  await client.query('ROLLBACK')
  await client.end()
})

test('routing across the full, unfiltered segment_edge table takes the interrupted short path, not the long arc', async () => {
  const { rows } = await client.query(
    `SELECT edge, cost
       FROM pgr_dijkstra(
         'SELECT edge_id AS id, source, target, cost, reverse_cost FROM routing.segment_edge',
         $1::bigint, $2::bigint, directed => true)
      WHERE edge <> -1
      ORDER BY seq`,
    [NODE_A, NODE_B],
  )

  // pgr_dijkstra's agg_cost on an edge row is the cost ACCUMULATED BEFORE that
  // edge, not the path total -- the total only appears on the terminal
  // edge = -1 sentinel row, which is filtered out above. Summing each edge's
  // own cost is the reliable way to get the path length here.
  const totalCost = rows.reduce((sum, r) => sum + Number(r.cost), 0)

  assert.equal(rows.length, 1, 'expected the single direct edge, not the two-edge detour')
  assert.equal(Number(rows[0].edge), Number((await client.query(
    'SELECT edge_id FROM routing.segment_edge WHERE source_segment_id = $1', [segAB],
  )).rows[0].edge_id))
  assert.ok(totalCost < 200, `expected roughly 120 m, got ${totalCost}`)
})

test('the path returned by the full-graph query surfaces the interruption for the caller to flag', async () => {
  const { rows } = await client.query(
    `SELECT rs.status_code
       FROM pgr_dijkstra(
         'SELECT edge_id AS id, source, target, cost, reverse_cost FROM routing.segment_edge',
         $1::bigint, $2::bigint, directed => true) d
       JOIN routing.segment_edge se ON se.edge_id = d.edge
       JOIN core.route_segment rs   ON rs.id = se.source_segment_id
      WHERE d.edge <> -1`,
    [NODE_A, NODE_B],
  )

  // This is the load-bearing assertion: the closed segment is IN the result,
  // with its real status attached, not silently absent. A caller reads this
  // row and reports the interruption; nothing here hid it by rerouting.
  assert.deepEqual(rows.map((r) => r.status_code), ['under_construction'])
})

test('pre-filtering the graph to open segments -- the forbidden pattern -- silently substitutes the long arc instead', async () => {
  const { rows } = await client.query(
    `SELECT edge, cost
       FROM pgr_dijkstra(
         'SELECT se.edge_id AS id, se.source, se.target, se.cost, se.reverse_cost
            FROM routing.segment_edge se
            JOIN core.route_segment rs ON rs.id = se.source_segment_id
           WHERE rs.status_code = ''open''',
         $1::bigint, $2::bigint, directed => true)
      WHERE edge <> -1
      ORDER BY seq`,
    [NODE_A, NODE_B],
  )

  const { rows: [interruptedEdge] } = await client.query(
    'SELECT edge_id FROM routing.segment_edge WHERE source_segment_id = $1', [segAB],
  )

  const edgeIds = rows.map((r) => Number(r.edge))
  const totalCost = rows.reduce((sum, r) => sum + Number(r.cost), 0)

  assert.equal(rows.length, 2, 'expected the two-edge detour via C')
  assert.ok(
    !edgeIds.includes(Number(interruptedEdge.edge_id)),
    'the interrupted edge must be entirely absent once the graph is pre-filtered',
  )
  assert.ok(totalCost > 700, `expected roughly 809 m for the detour, got ${totalCost}`)
})
