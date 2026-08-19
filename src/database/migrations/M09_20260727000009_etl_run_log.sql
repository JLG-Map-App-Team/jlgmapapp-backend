-- 0009  ETL run log
-- Created before the staging tables because they reference it.

-- migrate:up
CREATE TABLE staging.etl_run (
  id                      bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  source                  text NOT NULL,
  source_snapshot_date    date,
  started_at              timestamptz NOT NULL DEFAULT now(),
  finished_at             timestamptz,
  status                  text NOT NULL DEFAULT 'running',
  source_feature_count    integer,
  rows_inserted           integer,
  rows_updated            integer,
  rows_rejected           integer,
  fields_skipped_authored integer,
  error_text              text,
  CONSTRAINT etl_run_status_valid CHECK (status IN ('running','succeeded','failed'))
);

COMMENT ON COLUMN staging.etl_run.source_feature_count IS
  'ADR-001 4.8. A property of a batch, not of a segment, which is why it lives here rather than on route_segment.';
COMMENT ON COLUMN staging.etl_run.fields_skipped_authored IS
  'Counts authored values the run declined to overwrite. Makes the field-level survivorship rule OBSERVABLE. If this reads zero after staff have been setting statuses, the protection is not working, and there is otherwise no way to tell short of noticing the work has vanished.';

-- migrate:down
DROP TABLE IF EXISTS staging.etl_run;
