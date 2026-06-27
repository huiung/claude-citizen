// One-off ops tool: reset Career-leaderboard exploit rows in the progress store.
//
// The server's economy guard now bounds per-save earned/credits growth, and the boot scrub clamps
// pre-guard outliers down to CAREER_SCRUB_CEILING (10M). This script is for FULLY removing a known
// offender from the top (e.g. resetting the 40M row to 0) rather than just clamping it.
//
// SAFE BY DEFAULT: prints what it WOULD change (dry run). Pass --apply to write, after backing up
// the store to <STORE_FILE>.bak.
//
// Usage (run on the box that holds the production store, e.g. the Railway relay):
//   node scripts/reset-cheater.mjs                       # dry run, threshold 10,000,000
//   node scripts/reset-cheater.mjs --threshold=9000000   # catch a row already clamped to 10M
//   node scripts/reset-cheater.mjs --token=<KEY>         # target one specific token/wallet key
//   node scripts/reset-cheater.mjs --to=0 --apply        # actually reset matched rows to 0
//
// STORE_FILE env overrides the store path (defaults to ./progress.json, same as the server).

import { readFileSync, writeFileSync, copyFileSync } from 'fs'

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const m = a.match(/^--([^=]+)(?:=(.*))?$/)
    return m ? [m[1], m[2] ?? true] : [a, true]
  }),
)

const FILE = process.env.STORE_FILE ?? './progress.json'
const APPLY = args.apply === true
const THRESHOLD = Number(args.threshold ?? 10_000_000)
const RESET_TO = Number(args.to ?? 0)
const TOKEN = typeof args.token === 'string' ? args.token : null

let store
try {
  store = JSON.parse(readFileSync(FILE, 'utf8'))
} catch (e) {
  console.error(`Cannot read store at ${FILE}: ${e.message}`)
  process.exit(1)
}

const matches = (key, row) => {
  if (!row || typeof row !== 'object') return false
  if (TOKEN) return key === TOKEN
  return (Number(row.earned) || 0) > THRESHOLD || (Number(row.credits) || 0) > THRESHOLD
}

const targets = Object.entries(store).filter(([key, row]) => matches(key, row))

if (!targets.length) {
  console.log(`No rows matched (${TOKEN ? `token=${TOKEN}` : `earned/credits > ${THRESHOLD.toLocaleString()}`}).`)
  process.exit(0)
}

console.log(`Matched ${targets.length} row(s) in ${FILE}:`)
for (const [key, row] of targets) {
  console.log(`  ${key}: earned ${Number(row.earned) || 0} → ${RESET_TO}, credits ${Number(row.credits) || 0} → ${Math.min(Number(row.credits) || 0, RESET_TO)}`)
}

if (!APPLY) {
  console.log('\nDry run — nothing written. Re-run with --apply to commit (a .bak backup is made first).')
  process.exit(0)
}

copyFileSync(FILE, `${FILE}.bak`)
for (const [, row] of targets) {
  row.earned = RESET_TO
  row.credits = Math.min(Number(row.credits) || 0, RESET_TO)
  row._careerAt = Date.now() // stamp so the guard treats it as established and the boot scrub skips it
}
writeFileSync(FILE, JSON.stringify(store))
console.log(`\nApplied. Backup at ${FILE}.bak. Restart the relay so the in-memory store reloads.`)
