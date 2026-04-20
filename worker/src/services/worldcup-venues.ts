/**
 * Static stadium/venue context for World Cup 2026.
 * Used in the DeepSeek system prompt to answer questions about
 * stadiums, host cities and match locations.
 *
 * "ground" values come from the match schedule (worldcup.json).
 * Format: ground → stadium, city, country (capacity) [phases]
 */
export const VENUE_CONTEXT = `Estadios y ciudades sede del Mundial 2026:
"Atlanta" -> Mercedes-Benz Stadium, Atlanta, USA (cap. 71,000) [Semifinal, Octavos, Dieciseisavos, Grupos]
"Boston (Foxborough)" -> Gillette Stadium, Foxborough, USA (cap. 65,878) [Cuartos, Dieciseisavos, Grupos]
"Dallas (Arlington)" -> AT&T Stadium, Arlington, USA (cap. 80,000) [Semifinal, Octavos, Dieciseisavos, Grupos]
"Guadalajara (Zapopan)" -> Estadio Akron, Guadalajara, Mexico (cap. 46,232) [Grupos]
"Houston" -> NRG Stadium, Houston, USA (cap. 72,220) [Octavos, Dieciseisavos, Grupos]
"Kansas City" -> Arrowhead Stadium, Kansas City, USA (cap. 76,416) [Cuartos, Dieciseisavos, Grupos]
"Los Angeles (Inglewood)" -> SoFi Stadium, Inglewood, USA (cap. 70,240) [Cuartos, Dieciseisavos, Grupos]
"Mexico City" -> Estadio Azteca, Ciudad de Mexico, Mexico (cap. 87,264) [Partido inaugural, Grupos, Dieciseisavos, Octavos]
"Miami (Miami Gardens)" -> Hard Rock Stadium, Miami Gardens, USA (cap. 64,767) [Tercer puesto, Cuartos, Grupos, Dieciseisavos]
"Monterrey (Guadalupe)" -> Estadio BBVA, Monterrey, Mexico (cap. 51,348) [Dieciseisavos, Grupos]
"New York/New Jersey (East Rutherford)" -> MetLife Stadium, East Rutherford, USA (cap. 82,500) [Final, Grupos, Dieciseisavos, Octavos]
"Philadelphia" -> Lincoln Financial Field, Filadelfia, USA (cap. 69,796) [Octavos, Dieciseisavos, Grupos]
"San Francisco Bay Area (Santa Clara)" -> Levi's Stadium, Santa Clara, USA (cap. 68,500) [Octavos, Dieciseisavos, Grupos]
"Seattle" -> Lumen Field, Seattle, USA (cap. 69,000) [Octavos, Dieciseisavos, Grupos]
"Toronto" -> BMO Field, Toronto, Canada (cap. 30,000) [Dieciseisavos, Grupos]
"Vancouver" -> BC Place, Vancouver, Canada (cap. 54,500) [Octavos, Dieciseisavos, Grupos]

En el calendario, el campo "sede" indica la ciudad. El estadio correspondiente es el listado arriba. La Final es en MetLife Stadium (East Rutherford/Nueva York). El partido inaugural es en Estadio Azteca (Mexico City).`;
