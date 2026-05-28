-- Normalize scorer names in wc_goals to use full names consistently.
-- openfootball (source for 2014-2022) used abbreviated/nickname forms for some players
-- while jfjelstul (source for 1954-2013) used full names. This aligns all records.

-- Ronaldo: openfootball used "Ronaldo" for Cristiano Ronaldo (Portugal) in 2018.
-- R9 (Brazil) correctly keeps the name "Ronaldo".
UPDATE wc_goals SET scorer = 'Cristiano Ronaldo' WHERE scorer = 'Ronaldo' AND team = 'Portugal';

-- Abbreviated first-name forms from openfootball 2018 data
UPDATE wc_goals SET scorer = 'Lionel Messi'        WHERE scorer = 'Messi'               AND team = 'Argentina';
UPDATE wc_goals SET scorer = 'Javier Hernández'    WHERE scorer = 'J. Hernández'        AND team = 'Mexico';
UPDATE wc_goals SET scorer = 'Edinson Cavani'      WHERE scorer = 'E. Cavani'           AND team = 'Uruguay';
UPDATE wc_goals SET scorer = 'Luis Suárez'         WHERE scorer = 'L. Suárez'           AND team = 'Uruguay';

-- Surname-only forms from openfootball
UPDATE wc_goals SET scorer = 'Tim Cahill'          WHERE scorer = 'Cahill'              AND team = 'Australia';
UPDATE wc_goals SET scorer = 'Keisuke Honda'       WHERE scorer = 'Honda'               AND team = 'Japan';

-- Minor formatting differences
UPDATE wc_goals SET scorer = 'Robin van Persie'    WHERE scorer = 'Robin Van Persie'    AND team = 'Netherlands';
UPDATE wc_goals SET scorer = 'Klaas-Jan Huntelaar' WHERE scorer = 'Klaas Jan Huntelaar' AND team = 'Netherlands';
