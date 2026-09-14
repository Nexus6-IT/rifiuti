import { test, expect } from '@playwright/test'
import { hasRoleCredentials } from '../../utils/env'
import { apiLogin, apiPost, apiGet } from '../../utils/api-client'
import { conRunIsolata } from '../../fixtures/run-isolata'

/**
 * Self-test delle fondamenta E2E (Task 1 del piano UAT/E2E): crea due
 * anagrafiche col prefisso di run via API, invoca il teardown (`ripulisci`)
 * e verifica — con una lettura indipendente dal registro — che non resti
 * alcun residuo con quel prefisso.
 *
 * RICHIEDE un backend locale raggiungibile su E2E_API_URL/E2E_BASE_URL più
 * credenziali per il ruolo "admin" (E2E_ADMIN_USER/PASS, usate solo per
 * l'email — vedi utils/api-client.ts `apiLogin`, che passa via il bypass
 * di sviluppo POST /auth/dev/login, non disponibile in produzione).
 *
 * In questo ambiente di sviluppo lo stack backend non è acceso (vincolo di
 * memoria della macchina — vedi task brief): il test viene saltato
 * esplicitamente quando mancano le credenziali, non finge di passare. Se le
 * credenziali sono impostate ma il backend non risponde, il test FALLISCE
 * con l'errore di rete: non c'è un percorso che lo faccia risultare verde
 * senza aver davvero parlato con un backend.
 *
 * ISOLAMENTO (rilievo critico della revisione finale, 2026-09-14): questo
 * test NON usa più `ripulisci()` sul registro CONDIVISO della run (quello
 * scritto da tutti i worker, vedi fixtures/risorse.ts) — con
 * `fullyParallel: true` quel registro viene letto e TRONCATO anche mentre
 * altri test stanno ancora usando le anagrafiche che hanno appena
 * registrato lì, e il teardown globale successivo trova il registro
 * svuotato: tutto ciò che era registrato prima della troncatura smette di
 * essere visto come residuo. Qui si lavora invece sotto un E2E_RUN_ID
 * isolato dedicato (vedi fixtures/run-isolata.ts, stessa tecnica di
 * registro-risorse-persistenza.spec.ts): il registro toccato da questo
 * test è file proprio, mai condiviso con nessun altro.
 */

function partitaIvaCasuale(): string {
  // 11 cifre, nessun vincolo di checksum lato dominio (vedi
  // apps/backend/src/domain/registry/value-objects/partita-iva.ts) — solo
  // univoca abbastanza da non collidere fra run diverse.
  return String(Math.floor(1_000_000_0000 + Math.random() * 8_999_999_9999)).slice(0, 11)
}

function datiProduttore(ragioneSociale: string) {
  return {
    ragioneSociale,
    partitaIVA: partitaIvaCasuale(),
    sedeLegale: {
      via: 'Via della Pulizia',
      civico: '1',
      cap: '00100',
      comune: 'Roma',
      provincia: 'RM',
    },
  }
}

function datiTrasportatore(ragioneSociale: string) {
  return {
    ragioneSociale,
    partitaIVA: partitaIvaCasuale(),
    sedeLegale: {
      via: 'Via della Pulizia',
      civico: '2',
      cap: '00100',
      comune: 'Roma',
      provincia: 'RM',
    },
    numeroIscrizione: `ISCR-${Date.now()}`,
  }
}

interface RisorsaCreata {
  id: string
  ragioneSociale: string
}

interface ListaPaginata<T> {
  items: T[]
}

test.describe('Pulizia self-test — prefisso di run e teardown', () => {
  test.skip(
    !hasRoleCredentials('admin'),
    'Richiede E2E_ADMIN_USER/PASS + backend locale attivo (POST /auth/dev/login) — vedi e2e/README.md'
  )

  test('crea due anagrafiche col prefisso, ripulisce, verifica residuo zero', async () => {
    await conRunIsolata('pulizia-self-test', async ({ conPrefisso, haPrefissoDiRun, registra, ripulisci }) => {
      const token = await apiLogin('admin')

      const nomeProduttore = conPrefisso('produttore-pulizia-self-test')
      const nomeTrasportatore = conPrefisso('trasportatore-pulizia-self-test')

      const produttore = await apiPost<RisorsaCreata>(
        '/registry/produttori',
        datiProduttore(nomeProduttore),
        token
      )
      registra('produttore', produttore.id)

      const trasportatore = await apiPost<RisorsaCreata>(
        '/registry/trasportatori',
        datiTrasportatore(nomeTrasportatore),
        token
      )
      registra('trasportatore', trasportatore.id)

      // Verifica a delta: prima del teardown le due anagrafiche col prefisso
      // devono essere effettivamente presenti (altrimenti il test dopo il
      // teardown proverebbe ben poco).
      const [produttoriPrima, trasportatoriPrima] = await Promise.all([
        apiGet<ListaPaginata<RisorsaCreata>>('/registry/produttori', token),
        apiGet<ListaPaginata<RisorsaCreata>>('/registry/trasportatori', token),
      ])
      expect(produttoriPrima.items.some(p => p.id === produttore.id)).toBe(true)
      expect(trasportatoriPrima.items.some(t => t.id === trasportatore.id)).toBe(true)

      const { rimosse, residue } = await ripulisci(token)

      // Asserzione ESATTA, non "almeno due" (rilievo critico della
      // revisione finale): il registro è ormai isolato a questo solo test,
      // quindi deve contenere esattamente le due risorse appena create — se
      // ne rimuove di più o di meno, qualcosa non torna nel meccanismo, non
      // è "va bene comunque".
      expect(residue).toEqual([])
      expect(rimosse).toBe(2)

      const [produttoriDopo, trasportatoriDopo] = await Promise.all([
        apiGet<ListaPaginata<RisorsaCreata>>('/registry/produttori', token),
        apiGet<ListaPaginata<RisorsaCreata>>('/registry/trasportatori', token),
      ])

      const residuoProduttori = produttoriDopo.items.filter(p => haPrefissoDiRun(p.ragioneSociale))
      const residuoTrasportatori = trasportatoriDopo.items.filter(t =>
        haPrefissoDiRun(t.ragioneSociale)
      )

      expect(residuoProduttori).toEqual([])
      expect(residuoTrasportatori).toEqual([])
    })
  })
})
