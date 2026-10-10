ALTER TABLE shares ADD COLUMN audience TEXT NOT NULL DEFAULT 'university' CHECK (audience IN ('university','selected','public'));
ALTER TABLE shares ADD COLUMN recipients TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(recipients) AND json_type(recipients)='array');
