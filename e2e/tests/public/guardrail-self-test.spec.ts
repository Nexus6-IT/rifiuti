import { test, expect } from '@playwright/test'
import {
  matchBlacklist,
  valutaRichiesta,
  esentaDallaBlacklist,
  pulisciEsenzioni,
} from '../../utils/blacklist'

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

/**
 * Self-test dell'esenzione per-run (Task 1 del piano UAT/E2E, passo 4):
 * `valutaRichiesta` deve lasciar passare la cancellazione di un record
 * registrato in questa run (esentato con `esentaDallaBlacklist`, come fa
 * fixtures/risorse.ts `registra`), ma continuare a bloccare la
 * cancellazione di un record qualunque non registrato. Il secondo caso è
 * quello che conta: senza di esso l'esenzione sarebbe un indebolimento
 * della blacklist travestito da correzione.
 */
test.describe('Guardrail — esenzione per-run su DELETE /registry/*', () => {
  test.beforeEach(() => {
    pulisciEsenzioni()
  })

  test('un record REGISTRATO in questa run passa (non viene bloccato)', () => {
    esentaDallaBlacklist('id-registrato-in-questo-run')

    const hit = valutaRichiesta(
      'DELETE',
      'https://rifiuti.ignicraft.com/api/v1/registry/produttori/id-registrato-in-questo-run'
    )

    expect(hit).toBeNull()
  })

  test('un record NON registrato resta bloccato — anche con altre esenzioni attive', () => {
    // Un'esenzione per un ALTRO id non deve mai "sbordare" su id diversi.
    esentaDallaBlacklist('id-registrato-in-questo-run')

    const hit = valutaRichiesta(
      'DELETE',
      'https://rifiuti.ignicraft.com/api/v1/registry/produttori/id-mai-registrato'
    )

    expect(hit).not.toBeNull()
    expect(hit?.label).toContain('DELETE /registry/*')
  })

  test("l'esenzione vale solo per DELETE /registry/*, non per altre voci della blacklist", () => {
    esentaDallaBlacklist('abc-123')

    const hit = valutaRichiesta('DELETE', 'https://rifiuti.ignicraft.com/api/v1/backup/cleanup')

    expect(hit).not.toBeNull()
  })
})
