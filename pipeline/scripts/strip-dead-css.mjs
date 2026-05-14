#!/usr/bin/env node
/**
 * One-shot script: strip dead CSS rules from KartfluencerLandingPage.css.
 *
 * Usage:
 *   node scripts/strip-dead-css.mjs <css-file> <dead-list-file>
 *
 * The dead-list-file is a newline-separated list of base class names
 * (without the leading `.`). A rule block is removed iff its full selector
 * list contains ONLY dead classes (after stripping pseudo-classes,
 * combinators, and parents). Selectors that mix dead + live classes are
 * preserved — better to leave a few dead leaf rules than break a live one.
 *
 * Safety: the script verifies brace balance before writing the output,
 * and it skips rule blocks nested inside @media / @supports / @keyframes
 * to keep parsing simple. Top-level dead rules are the dominant volume.
 */

import { readFileSync, writeFileSync } from 'node:fs'

const [, , cssPath, deadListPath] = process.argv
if (!cssPath || !deadListPath) {
  console.error('usage: strip-dead-css.mjs <css-file> <dead-list-file>')
  process.exit(2)
}

const css = readFileSync(cssPath, 'utf8')
const deadSet = new Set(
  readFileSync(deadListPath, 'utf8')
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean),
)

/**
 * Walk the file character by character, tracking brace depth and the
 * boundaries of each top-level rule. For each top-level rule (depth 0
 * before `{`), check whether its selector list is entirely dead.
 */
function isSelectorDead(rawSelector) {
  // Strip comments and whitespace
  const selector = rawSelector.replace(/\/\*[\s\S]*?\*\//g, '').trim()
  if (!selector) return false
  // At-rules like @media, @keyframes — never strip.
  if (selector.startsWith('@')) return false

  const parts = selector.split(',').map((s) => s.trim()).filter(Boolean)
  if (parts.length === 0) return false

  return parts.every((part) => {
    // For each comma-separated selector, every class token in it must be
    // dead AND the selector must not target an element/id we don't track.
    const classMatches = part.match(/\.[a-zA-Z_][a-zA-Z0-9_-]*/g) || []
    if (classMatches.length === 0) return false
    // If the selector contains a tag name like `div.foo`, we still allow
    // removal if the class is dead — `div.foo` won't match anything if
    // .foo isn't applied anywhere. But if the selector contains an id
    // (#something) or attribute selector, leave it alone — too risky.
    if (/[#[]/.test(part)) return false
    return classMatches.every((cls) => deadSet.has(cls.slice(1)))
  })
}

const out = []
let i = 0
let cursor = 0
let depth = 0
let removedCount = 0
let removedBytes = 0

while (i < css.length) {
  const ch = css[i]

  if (ch === '{') {
    if (depth === 0) {
      // We hit the opening of a top-level rule. The selector is everything
      // from `cursor` up to here.
      const selector = css.slice(cursor, i)
      // Find the matching closing brace.
      let j = i + 1
      let nest = 1
      let inString = null
      let inLineComment = false
      let inBlockComment = false
      while (j < css.length && nest > 0) {
        const c = css[j]
        const next = css[j + 1]

        if (inLineComment) {
          if (c === '\n') inLineComment = false
        } else if (inBlockComment) {
          if (c === '*' && next === '/') {
            inBlockComment = false
            j++
          }
        } else if (inString) {
          if (c === '\\') {
            j++
          } else if (c === inString) {
            inString = null
          }
        } else if (c === '/' && next === '*') {
          inBlockComment = true
          j++
        } else if (c === '/' && next === '/') {
          inLineComment = true
          j++
        } else if (c === '"' || c === "'") {
          inString = c
        } else if (c === '{') {
          nest++
        } else if (c === '}') {
          nest--
        }
        j++
      }

      const ruleEnd = j // exclusive index of char after the closing brace
      const isAtRule = selector.trim().startsWith('@')
      const ruleIsDead = !isAtRule && isSelectorDead(selector)

      if (ruleIsDead) {
        removedCount++
        removedBytes += ruleEnd - cursor
        // Skip writing this entire rule, including any leading whitespace
        // up to the previous newline so we don't leave dangling blank
        // lines (cosmetic).
      } else {
        out.push(css.slice(cursor, ruleEnd))
      }
      cursor = ruleEnd
      i = ruleEnd
      continue
    } else {
      depth++
    }
  } else if (ch === '}') {
    depth = Math.max(0, depth - 1)
  }
  i++
}

// Tail
if (cursor < css.length) out.push(css.slice(cursor))

const result = out.join('').replace(/\n{3,}/g, '\n\n')

// Brace balance sanity check
const openCount = (result.match(/\{/g) || []).length
const closeCount = (result.match(/\}/g) || []).length
if (openCount !== closeCount) {
  console.error(`brace mismatch after strip: { ${openCount} } ${closeCount}`)
  process.exit(1)
}

writeFileSync(cssPath, result, 'utf8')
console.log(
  `removed ${removedCount} rule blocks, saved ${removedBytes} bytes (${result.length} → ${css.length})`,
)
