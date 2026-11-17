ALTER TABLE attendance ADD COLUMN check_out_source text NOT NULL DEFAULT 'GPS';
ALTER TABLE attendance ADD COLUMN check_out_recorded_by uuid REFERENCES users(id);
ALTER TABLE attendance ADD COLUMN check_out_recorded_at timestamptz;
ALTER TABLE attendance ADD COLUMN check_out_reason text;
UPDATE attendance SET check_out_source='GPS' WHERE check_out_at IS NOT NULL;
ALTER TABLE attendance DROP CONSTRAINT checkout_complete;
ALTER TABLE attendance ADD CONSTRAINT checkout_complete CHECK (
  (check_out_at IS NULL AND check_out_source='GPS' AND check_out_distance_m IS NULL AND check_out_accuracy IS NULL AND check_out_recorded_by IS NULL AND check_out_recorded_at IS NULL AND check_out_reason IS NULL)
  OR (check_out_at IS NOT NULL AND check_out_source IS NOT NULL AND check_out_source='GPS' AND check_out_distance_m IS NOT NULL AND check_out_accuracy IS NOT NULL AND check_out_recorded_by IS NULL AND check_out_recorded_at IS NULL AND check_out_reason IS NULL)
  OR (check_out_at IS NOT NULL AND check_out_source IS NOT NULL AND check_out_source='OWNER_MANUAL' AND check_out_distance_m IS NULL AND check_out_accuracy IS NULL AND check_out_recorded_by IS NOT NULL AND check_out_recorded_at IS NOT NULL AND check_out_reason IS NOT NULL AND length(trim(check_out_reason)) BETWEEN 3 AND 1000 AND check_out_at<=check_out_recorded_at)
);
