import { test, expect } from '@playwright/test'
import { matchBlacklist } from '../../utils/blacklist'

/**
 * Self-test del guardrail di sicurezza (e2e/fixtures/guardrail.ts +
 * utils/blacklist.ts): verifica che il matcher riconosca esattamente gli
 * endpoint della BLACKLIST distruttiva elencati in
 * docs/audits/uat-2026-07-25/01-api-surface.json, e che NON dia falsi
 * positivi su endpoint simili ma legittimi (es. GET sullo stesso path, o
 * DELETE su un path diverso).
 *
 * Questo test gira SEMPRE (locale e produzione) perché non fa alcuna
 * richiesta di rete — verifica solo la logica del matcher.
 */

test.describe('Guardrail — matcher blacklist distruttiva', () => {
  const cases: { method: string; url: string; shouldMatch: boolean; note: string }[] = [
    {
      method: 'POST',
      url: 'https://rifiuti.ignicraft.com/api/v1/backup/restore',
      shouldMatch: true,
      note: 'backup/restore',
    },
    {
      method: 'DELETE',
      url: 'https://rifiuti.ignicraft.com/api/v1/backup/cleanup',
      shouldMatch: true,
      note: 'backup/cleanup',
    },
    {
      method: 'POST',
      url: 'https://rifiuti.ignicraft.com/api/v1/backup/create',
      shouldMatch: true,
      note: 'backup/create',
    },
    {
      method: 'DELETE',
      url: 'https://rifiuti.ignicraft.com/api/v1/registry/produttori/abc-123',
      shouldMatch: true,
      note: 'delete produttore',
    },
    {
      method: 'DELETE',
      url: 'https://rifiuti.ignicraft.com/api/v1/registry/trasportatori/abc-123',
      shouldMatch: true,
      note: 'delete trasportatore',
    },
    {
      method: 'DELETE',
      url: 'https://rifiuti.ignicraft.com/api/v1/registry/destinatari/abc-123',
      shouldMatch: true,
      note: 'delete destinatario',
    },
    {
      method: 'PATCH',
      url: 'https://rifiuti.ignicraft.com/api/v1/admin/tenants/abc-123/status',
      shouldMatch: true,
      note: 'sospensione tenant',
    },
    {
      method: 'POST',
      url: 'https://rifiuti.ignicraft.com/api/v1/reference-data/reseed',
      shouldMatch: true,
      note: 'reseed reference data',
    },
    {
      method: 'POST',
      url: 'https://rifiuti.ignicraft.com/api/v1/fir/abc-123/annulla',
      shouldMatch: true,
      note: 'annulla FIR',
    },
    {
      method: 'DELETE',
      url: 'https://rifiuti.ignicraft.com/api/v1/rentri/credential',
      shouldMatch: true,
      note: 'delete credenziale RENTRI',
    },
    // Falsi positivi da evitare:
    {
      method: 'GET',
      url: 'https://rifiuti.ignicraft.com/api/v1/registry/produttori/abc-123',
      shouldMatch: false,
      note: 'GET stesso path di un DELETE in blacklist non deve matchare',
    },
    {
      method: 'GET',
      url: 'https://rifiuti.ignicraft.com/api/v1/backup/list',
      shouldMatch: false,
      note: 'backup/list è read-only, non in blacklist',
    },
    {
      method: 'DELETE',
      url: 'https://rifiuti.ignicraft.com/api/v1/notifications/abc-123',
      shouldMatch: false,
      note: 'delete notifica propria non è in blacklist',
    },
    {
      method: 'PATCH',
      url: 'https://rifiuti.ignicraft.com/api/v1/contracts/abc-123/status',
      shouldMatch: false,
      note: 'cambio status contratto non è in blacklist',
    },
  ]

  for (const c of cases) {
    test(`${c.method} ${c.url} -> shouldMatch=${c.shouldMatch} (${c.note})`, () => {
      const hit = matchBlacklist(c.method, c.url)
      expect(Boolean(hit)).toBe(c.shouldMatch)
    })
  }
})
