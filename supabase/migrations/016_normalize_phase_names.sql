-- Normalize phase names: 2006 and 2010 use "Semifinals"/"Quarterfinals" without hyphens
UPDATE wc_matches SET phase = 'Semi-finals'    WHERE phase = 'Semifinals';
UPDATE wc_matches SET phase = 'Quarter-finals' WHERE phase = 'Quarterfinals';
UPDATE wc_matches SET phase = 'Third-place match' WHERE phase = 'Third-place play-off';
