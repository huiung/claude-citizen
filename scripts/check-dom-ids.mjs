// Fails the build when src/ references a DOM id that no HTML file defines.
//
// Backstory: a previous task deleted <div id="gate-msg"> from index.html while
// src/landing.ts still had `document.getElementById('gate-msg')!` at module top level.
// The `!` is a compile-time-only assertion, so `tsc --noEmit` stayed green, and nothing
// in the vitest suite touches the DOM, so it stayed green too. The landing page threw a
// TypeError on every real load. This script closes that gap the cheap, mechanical way:
// it scans src/**/*.ts for string-literal getElementById() calls and checks each id
// against every id="..." found in index.html and wiki.html.
//
// Deliberately simple: regex-based, no TypeScript parser, no new dependencies. It only
// resolves string-literal ids (`getElementById('foo')`); a call built from a variable or
// template string can't be resolved statically and is skipped rather than guessed at.

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, extname } from 'node:path'

const ROOT = new URL('..', import.meta.url).pathname
const SRC_DIR = join(ROOT, 'src')
// The standalone showcase pages are included so their ids are genuinely validated rather than
// waved through by the allowlist — renaming an id there while src/social/*Showcase.ts keeps the
// old string is the same crash class this script exists to catch.
const HTML_FILES = [
  'index.html',
  'wiki.html',
  'public/social/comet-wake-showcase.html',
  'public/social/abyssal-driller-showcase.html',
  'public/social/ship-studio.html',
].map((f) => join(ROOT, f))

// Ids that are legitimately referenced from src/ but will never appear in any HTML file we
// scan. Keep this list short and each entry justified — anything else missing is a bug.
// Prefer adding the owning HTML file to HTML_FILES over adding an entry here: an allowlisted
// id is unvalidated forever, whereas a scanned file keeps catching renames.
const ALLOWLIST = new Set([
  // src/ui/solarSystemMap.ts injects this <style> element itself at runtime; the
  // getElementById call is only an existence guard against double-injection, never a
  // lookup of something an HTML file is expected to provide.
  'solar-map-style',
])

// Matches document.getElementById('foo') / getElementById("foo") — string-literal
// argument only. Variable or template-string calls are intentionally not matched;
// they can't be resolved statically and are out of scope for this check.
const GET_BY_ID_RE = /getElementById\((['"])([^'"]*)\1\)/g

// Matches id="foo" or id='foo' anywhere in an HTML file (tags, attributes, whatever).
const ID_ATTR_RE = /\bid=(['"])([^'"]*)\1/g

function walkTsFiles(dir) {
  const out = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    const st = statSync(full)
    if (st.isDirectory()) {
      out.push(...walkTsFiles(full))
    } else if (extname(full) === '.ts') {
      out.push(full)
    }
  }
  return out
}

function findReferences(file) {
  const text = readFileSync(file, 'utf8')
  const lines = text.split('\n')
  const refs = []
  lines.forEach((line, idx) => {
    GET_BY_ID_RE.lastIndex = 0
    let m
    while ((m = GET_BY_ID_RE.exec(line))) {
      refs.push({ id: m[2], file, line: idx + 1 })
    }
  })
  return refs
}

function collectHtmlIds(file) {
  const text = readFileSync(file, 'utf8')
  const ids = new Set()
  let m
  ID_ATTR_RE.lastIndex = 0
  while ((m = ID_ATTR_RE.exec(text))) {
    ids.add(m[2])
  }
  return ids
}

const htmlIds = new Set()
for (const file of HTML_FILES) {
  for (const id of collectHtmlIds(file)) htmlIds.add(id)
}

const tsFiles = walkTsFiles(SRC_DIR)
const allRefs = tsFiles.flatMap(findReferences)

const offenders = allRefs.filter((ref) => !htmlIds.has(ref.id) && !ALLOWLIST.has(ref.id))

if (offenders.length > 0) {
  console.error('check-dom-ids: found getElementById() calls referencing ids that do not exist in index.html or wiki.html:\n')
  for (const off of offenders) {
    console.error(`  '${off.id}' — ${off.file.replace(ROOT, '')}:${off.line}`)
  }
  console.error('\nEither add the id to index.html/wiki.html, or if it is intentionally only present')
  console.error('elsewhere (e.g. a standalone page under public/social/), add it to the ALLOWLIST in')
  console.error('scripts/check-dom-ids.mjs with a comment explaining why.')
  process.exit(1)
}

console.log(`check-dom-ids: OK — ${allRefs.length} getElementById() reference(s) across ${tsFiles.length} .ts file(s) all resolve.`)
