// Concise, accurate game facts so CLAUDE answers chat correctly instead of guessing.
// Distilled from wiki.html — keep it factual and short (token budget guarded by the test).
export const GAME_KNOWLEDGE = [
  'Game facts (answer accurately, stay brief):',
  '- Start: spawn in a Hauler near Meridian Refinery; progress auto-saves anonymously. A Pilot Code moves you between devices; linking a Solana wallet enables holder cosmetics and Ranked PvP. Motto: 60 seconds from click to flight.',
  '- Controls: WASD thrust, A/D strafe, R/F vertical, Q/E roll, mouse aim, Shift boost, X brake, V flight assist (coupled vs Newtonian), hold Left-click to mine, Right-click to fire, Space to dock, M Solar Atlas, N cycle quantum destination, J jump, L leaderboard, Enter chat.',
  "- Economy: dock and use TRADE. ORE is cheap at Helios Mining Colony and dear at Meridian Refinery; ALLOY is the reverse. Prices are dynamic. Mine glowing cyan ore veins by holding Left-click in range.",
  '- Upgrades: four tracks (cargo, speed, boost, mining), Tier 0 to 5, prices ramp steeply. Hulls: Hauler (starter), Fighter (combat), Miner (cargo/tanky), Interceptor (fastest/fragile).',
  '- Crafting: refine Craft Cores (50,000 cr) then craft cosmetic kits (engine trail, hull finish, comet wake, void runner). Rarities Common to Rare to Epic to Legendary with a pity guarantee by 20 crafts. Cosmetics are visual only and tradable on the MARKET for credits or $CITIZEN.',
  '- Ranks: six tiers Cadet to Admiral by LIFETIME earnings (spending never demotes). Earnings bonus scales +0% to +50%; higher hulls unlock by rank.',
  '- Token: $CITIZEN on Solana. Holder tiers T1 Gold (1+), T2 Cyan (100k+), T3 Whale (1M+) are cosmetic only, no pay-to-win. Ranked PvP needs 1,000+.',
  '- Combat: pirates hunt open space; Right-click fights and station safe zones repair. Three deep-space rings: Training Arena (shoot drones, zero risk), Practice Arena (open PvP, no token), Ranked Arena (1,000+ $CITIZEN, counts on the ranked board).',
  '- Race: set the Season Hub as your quantum destination and thread the time-trial gates in order; the Race board ranks your fastest run.',
  '- Black hole: gravity reaches ~50 km, tidal damage inside ~18 km, fatal event horizon ~5.5 km. Dive as close as you dare and pull out; the Black Hole board ranks closest approach.',
  '- Leaderboards: Career (lifetime credits), Ranked PvP, Race, Black Hole.',
].join('\n')
