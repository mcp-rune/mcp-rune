/**
 * PKCE Property-Based Tests
 *
 * Validates PKCE (RFC 7636) invariants using randomized inputs:
 * - Random code verifiers always produce valid S256 challenges
 * - Different verifiers always produce different challenges
 * - Verifiers conform to RFC 7636 character set restrictions
 */

import { describe, it, expect } from 'vitest'
import * as fc from 'fast-check'
import { createHash, randomBytes } from 'crypto'

/**
 * Calculate S256 code challenge from a code verifier (same as openid-client)
 * Per RFC 7636 Section 4.2: BASE64URL(SHA256(ASCII(code_verifier)))
 */
function calculateS256Challenge(codeVerifier) {
  return createHash('sha256').update(codeVerifier).digest('base64url')
}

/**
 * Generate a random PKCE code verifier per RFC 7636 Section 4.1:
 * - 43 to 128 characters
 * - Characters: [A-Z] / [a-z] / [0-9] / "-" / "." / "_" / "~"
 */
function generateCodeVerifier(length = 43) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~'
  const bytes = randomBytes(length)
  return Array.from(bytes)
    .map((b) => chars[b % chars.length])
    .join('')
}

// Arbitrary for RFC 7636 compliant code verifiers
const codeVerifierArb = fc
  .integer({ min: 43, max: 128 })
  .chain((length) =>
    fc
      .array(
        fc.constantFrom(
          ...'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~'.split('')
        ),
        { minLength: length, maxLength: length }
      )
      .map((chars) => chars.join(''))
  )

describe('PKCE Properties (RFC 7636)', () => {
  it('random code verifiers always produce valid S256 challenges', () => {
    fc.assert(
      fc.property(codeVerifierArb, (verifier) => {
        const challenge = calculateS256Challenge(verifier)

        // Challenge must be a non-empty base64url string
        expect(challenge).toBeTruthy()
        expect(challenge.length).toBeGreaterThan(0)

        // SHA-256 produces 32 bytes = 43 base64url characters (no padding)
        expect(challenge.length).toBe(43)

        // Must be valid base64url (no +, /, or = characters)
        expect(challenge).toMatch(/^[A-Za-z0-9_-]+$/)
      }),
      { numRuns: 200 }
    )
  })

  it('same verifier always produces same challenge (deterministic)', () => {
    fc.assert(
      fc.property(codeVerifierArb, (verifier) => {
        const challenge1 = calculateS256Challenge(verifier)
        const challenge2 = calculateS256Challenge(verifier)

        expect(challenge1).toBe(challenge2)
      }),
      { numRuns: 100 }
    )
  })

  it('different verifiers produce different challenges (collision resistance)', () => {
    fc.assert(
      fc.property(codeVerifierArb, codeVerifierArb, (verifier1, verifier2) => {
        fc.pre(verifier1 !== verifier2)

        const challenge1 = calculateS256Challenge(verifier1)
        const challenge2 = calculateS256Challenge(verifier2)

        expect(challenge1).not.toBe(challenge2)
      }),
      { numRuns: 200 }
    )
  })

  it('code verifiers conform to RFC 7636 length requirements (43-128 chars)', () => {
    fc.assert(
      fc.property(codeVerifierArb, (verifier) => {
        expect(verifier.length).toBeGreaterThanOrEqual(43)
        expect(verifier.length).toBeLessThanOrEqual(128)
      }),
      { numRuns: 200 }
    )
  })

  it('code verifiers contain only unreserved URI characters', () => {
    fc.assert(
      fc.property(codeVerifierArb, (verifier) => {
        // RFC 7636 Section 4.1: unreserved characters
        expect(verifier).toMatch(/^[A-Za-z0-9\-._~]+$/)
      }),
      { numRuns: 200 }
    )
  })

  it('generateCodeVerifier produces valid verifiers', () => {
    fc.assert(
      fc.property(fc.integer({ min: 43, max: 128 }), (length) => {
        const verifier = generateCodeVerifier(length)

        expect(verifier.length).toBe(length)
        expect(verifier).toMatch(/^[A-Za-z0-9\-._~]+$/)

        // Should produce a valid challenge
        const challenge = calculateS256Challenge(verifier)
        expect(challenge.length).toBe(43)
      }),
      { numRuns: 100 }
    )
  })
})
