-- Departure has no deadline. Legacy values are retained as historical data.
-- New meetings use NULL for both closing timestamps: close arrival via status.
ALTER TABLE meetings ALTER COLUMN registration_close_at DROP NOT NULL;
ALTER TABLE meetings ALTER COLUMN checkout_close_at DROP NOT NULL;
