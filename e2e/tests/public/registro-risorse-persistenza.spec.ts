import { test, expect } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
import { conRunIsolata } from '../../fixtures/run-isolata'

/**
 * Copre il meccanismo più delicato dopo il guardrail (rilievo 3 del giro di
 * correzione 1, 2026-09-14): la persistenza su file del registro delle
 * risorse fra il processo che le crea (un worker Playwright) e quello che
 * le ripulisce (il globalTeardown — un processo Node diverso, vedi
 * fixtures/risorse.ts).
 *
 * Gira SEMPRE, senza stack acceso: intercetta `fetch` con un doppio in
 * memoria — nessuna richiesta di rete reale, nessuna dipendenza da un
 * backend o da Postgres.
 *
 * Ogni test gira sotto un E2E_RUN_ID isolato (vedi fixtures/run-isolata.ts
 * `conRunIsolata`): senza questo, tutti i worker di UNA STESSA esecuzione
 * condividono lo stesso E2E_RUN_ID (impostato una volta sola in
 * playwright.config.ts prima che i worker partano — vedi utils/run-id.ts),
 * quindi lo stesso file di registro su disco. L'E2E_RUN_ID dedicato simula
 * genuinamente "due processi diversi che si accordano solo tramite il
 * file", senza inquinare né essere inquinati dal registro reale della run
 * o da altri test di questo stesso file — e senza inquinare `process.env`
 * per le spec caricate DOPO nello stesso worker: `conRunIsolata` ripristina
 * sempre l'ambiente e ricarica i moduli al termine (rilievo critico della
 * revisione finale, 2026-09-14: una versione precedente di questo file
 * impostava `process.env.E2E_RUN_ID` senza mai ripristinarlo).
 */

function percorsoRegistroPer(runId: string): string {
  return path.join(__dirname, '..', '..', '.artifacts', `registro-${runId}.jsonl`)
}

function installaFetchFittizio(statoServer: Set<string>): () => void {
  const originale = global.fetch
  global.fetch = (async (url: unknown, init: RequestInit = {}) => {
    const metodo = (init.method || 'GET').toUpperCase()
    if (metodo === 'DELETE') {
      const id = String(url).split('/').pop() ?? ''
      if (statoServer.has(id)) {
        statoServer.delete(id)
        return new Response(null, { status: 204 })
      }
      return new Response(JSON.stringify({ message: 'not found' }), { status: 404 })
    }
    return new Response(JSON.stringify({}), { status: 200 })
  }) as typeof fetch

  return () => {
    global.fetch = originale
  }
}

test.describe('Registro risorse — persistenza su file fra processi simulati', () => {
  test('scrive nel processo "test", rilegge e ripulisce nel processo "teardown"', async () => {
    await conRunIsolata('persistenza', async ({ registra, ripulisci, runId }) => {
      const percorsoRegistro = percorsoRegistroPer(runId)
      const statoServer = new Set(['id-produttore-1', 'id-trasportatore-1'])
      const ripristinaFetch = installaFetchFittizio(statoServer)

      try {
        // "Processo A": un worker che crea due risorse di test e le registra.
        registra('produttore', 'id-produttore-1')
        registra('trasportatore', 'id-trasportatore-1')

        expect(fs.existsSync(percorsoRegistro)).toBe(true)
        const righe = fs.readFileSync(percorsoRegistro, 'utf-8').trim().split('\n')
        expect(righe).toHaveLength(2)

        // "Processo B" (il globalTeardown, un processo Node diverso nella
        // realtà): rilegge dal file, non da uno stato in memoria condiviso
        // col processo A — qui lo dimostriamo chiamando ripulisci() sulla
        // stessa copia di modulo, ma il meccanismo sotto test (lettura da
        // disco, non da un array in memoria) è esattamente quello che rende
        // possibile la lettura da un processo realmente diverso.
        const esito = await ripulisci('token-fittizio')
        expect(esito.rimosse).toBe(2)
        expect(esito.residue).toEqual([])
        expect(fs.readFileSync(percorsoRegistro, 'utf-8')).toBe('')
      } finally {
        ripristinaFetch()
        fs.rmSync(percorsoRegistro, { force: true })
      }
    })
  })

  test('idempotenza: una seconda ripulisci() dopo la prima non fallisce (registro già vuoto)', async () => {
    await conRunIsolata('idempotenza-vuoto', async ({ registra, ripulisci, runId }) => {
      const percorsoRegistro = percorsoRegistroPer(runId)
      const statoServer = new Set(['id-produttore-2'])
      const ripristinaFetch = installaFetchFittizio(statoServer)

      try {
        registra('produttore', 'id-produttore-2')
        const prima = await ripulisci('token-fittizio')
        expect(prima.rimosse).toBe(1)

        const seconda = await ripulisci('token-fittizio')
        expect(seconda.rimosse).toBe(0)
        expect(seconda.residue).toEqual([])
      } finally {
        ripristinaFetch()
        fs.rmSync(percorsoRegistro, { force: true })
      }
    })
  })

  test('idempotenza dopo una run morta a metà: file di registro mai creato, ripulisci non fallisce', async () => {
    await conRunIsolata('morta-a-meta', async ({ ripulisci, runId }) => {
      const percorsoRegistro = percorsoRegistroPer(runId)
      const ripristinaFetch = installaFetchFittizio(new Set())

      try {
        expect(fs.existsSync(percorsoRegistro)).toBe(false)
        const esito = await ripulisci('token-fittizio')
        expect(esito.rimosse).toBe(0)
        expect(esito.residue).toEqual([])
      } finally {
        ripristinaFetch()
        fs.rmSync(percorsoRegistro, { force: true })
      }
    })
  })

  test('un 404 in cancellazione (risorsa già rimossa altrove) non è un residuo', async () => {
    await conRunIsolata('gia-rimossa', async ({ registra, ripulisci, runId }) => {
      const percorsoRegistro = percorsoRegistroPer(runId)
      // Server fittizio "vuoto": qualunque DELETE risponde 404, come se la
      // risorsa fosse già stata cancellata da un teardown precedente.
      const ripristinaFetch = installaFetchFittizio(new Set())

      try {
        registra('produttore', 'id-gia-sparito')
        const esito = await ripulisci('token-fittizio')
        expect(esito.rimosse).toBe(1)
        expect(esito.residue).toEqual([])
      } finally {
        ripristinaFetch()
        fs.rmSync(percorsoRegistro, { force: true })
      }
    })
  })
})
