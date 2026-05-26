-- Add match_num (stable FIFA match number, only set for knockout matches 73-104)
-- Add winner ('home' or 'away'), set when admin enters result
ALTER TABLE matches ADD COLUMN match_num integer;
ALTER TABLE matches ADD COLUMN winner text CHECK (winner IN ('home', 'away'));

-- Populate match_num for all 32 knockout matches using placeholder home_team
-- (these are the values in the DB before any results are entered)
UPDATE matches SET match_num = 73  WHERE home_team = '2A'   AND phase != 'grupos';
UPDATE matches SET match_num = 74  WHERE home_team = '1E'   AND phase != 'grupos';
UPDATE matches SET match_num = 75  WHERE home_team = '1F'   AND phase != 'grupos';
UPDATE matches SET match_num = 76  WHERE home_team = '1C'   AND phase != 'grupos';
UPDATE matches SET match_num = 77  WHERE home_team = '1I'   AND phase != 'grupos';
UPDATE matches SET match_num = 78  WHERE home_team = '2E'   AND phase != 'grupos';
UPDATE matches SET match_num = 79  WHERE home_team = '1A'   AND phase != 'grupos';
UPDATE matches SET match_num = 80  WHERE home_team = '1L'   AND phase != 'grupos';
UPDATE matches SET match_num = 81  WHERE home_team = '1D'   AND phase != 'grupos';
UPDATE matches SET match_num = 82  WHERE home_team = '1G'   AND phase != 'grupos';
UPDATE matches SET match_num = 83  WHERE home_team = '2K'   AND phase != 'grupos';
UPDATE matches SET match_num = 84  WHERE home_team = '1H'   AND phase != 'grupos';
UPDATE matches SET match_num = 85  WHERE home_team = '1B'   AND phase != 'grupos';
UPDATE matches SET match_num = 86  WHERE home_team = '1J'   AND phase != 'grupos';
UPDATE matches SET match_num = 87  WHERE home_team = '1K'   AND phase != 'grupos';
UPDATE matches SET match_num = 88  WHERE home_team = '2D'   AND phase != 'grupos';
UPDATE matches SET match_num = 89  WHERE home_team = 'W74'  AND phase != 'grupos';
UPDATE matches SET match_num = 90  WHERE home_team = 'W73'  AND phase != 'grupos';
UPDATE matches SET match_num = 91  WHERE home_team = 'W76'  AND phase != 'grupos';
UPDATE matches SET match_num = 92  WHERE home_team = 'W79'  AND phase != 'grupos';
UPDATE matches SET match_num = 93  WHERE home_team = 'W83'  AND phase != 'grupos';
UPDATE matches SET match_num = 94  WHERE home_team = 'W81'  AND phase != 'grupos';
UPDATE matches SET match_num = 95  WHERE home_team = 'W86'  AND phase != 'grupos';
UPDATE matches SET match_num = 96  WHERE home_team = 'W85'  AND phase != 'grupos';
UPDATE matches SET match_num = 97  WHERE home_team = 'W89'  AND phase != 'grupos';
UPDATE matches SET match_num = 98  WHERE home_team = 'W93'  AND phase != 'grupos';
UPDATE matches SET match_num = 99  WHERE home_team = 'W91'  AND phase != 'grupos';
UPDATE matches SET match_num = 100 WHERE home_team = 'W95'  AND phase != 'grupos';
UPDATE matches SET match_num = 101 WHERE home_team = 'W97'  AND phase != 'grupos';
UPDATE matches SET match_num = 102 WHERE home_team = 'W99'  AND phase != 'grupos';
UPDATE matches SET match_num = 103 WHERE home_team = 'L101' AND phase != 'grupos';
UPDATE matches SET match_num = 104 WHERE home_team = 'W101' AND phase != 'grupos';

-- Prevent two knockout matches from sharing the same match_num
CREATE UNIQUE INDEX ON matches (match_num) WHERE match_num IS NOT NULL;

-- Sanity check: all 32 knockout matches must have been assigned a match_num
DO $$
BEGIN
  IF (SELECT COUNT(*) FROM matches WHERE match_num IS NOT NULL) != 32 THEN
    RAISE EXCEPTION 'Expected 32 knockout matches with match_num, got %',
      (SELECT COUNT(*) FROM matches WHERE match_num IS NOT NULL);
  END IF;
END $$;
