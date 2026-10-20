START TRANSACTION;

ALTER TABLE fby_projection_parameter DROP CONSTRAINT chk_fby_projection_parameter_match;
ALTER TABLE fby_projection_parameter ADD CONSTRAINT chk_fby_projection_parameter_match CHECK (match IN ('equals', 'prefix', 'in', 'range', 'gt', 'gte', 'lt', 'lte'));

END TRANSACTION;
