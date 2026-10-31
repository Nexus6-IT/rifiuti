/**
 * Livello di pulizia a livello di database, SOLO per entità prive di un
 * endpoint di cancellazione HTTP (oggi: i FIR — vedi fixtures/risorse.ts,
 * che spiega perché non esiste `DELETE /fir/:id`).
 *
 * Nato dal rilievo 1 del giro di correzione 1 (2026-09-14): senza questo
 * livello, `registra('fir', id)` faceva fallire ogni run per sempre
 * (residuo permanente), oppure — se un task futuro avesse smesso di
 * registrare i formulari per evitarlo — quel residuo sarebbe diventato
 * REALE e INVISIBILE, perché `verificaResiduo` non guardava i FIR.
 *
 * Tre vincoli non negoziabili (dal ruling):
 * (a) Cancella SOLO ciò che porta il prefisso della run. Mai per data, mai
 *     "tutto il resto", mai TRUNCATE. Qui: si cancella un FIR solo se
 *     almeno uno dei suoi campi snapshot (producerName/carrierName/
 *     receiverName — vedi apps/backend/prisma/schema.prisma model FIR)
 *     porta il prefisso della run corrente, verificato QUI, non fidandosi
 *     del solo fatto che l'id sia stato registrato.
 * (b) Funziona SOLO contro un target locale. Stesso controllo di
 *     `apiLogin` (isProductionTarget su E2E_BASE_URL) PIÙ un controllo
 *     indipendente sull'host di DATABASE_URL: due credenziali diverse,
 *     due controlli separati — un DATABASE_URL puntato altrove per errore
 *     non deve sfuggire solo perché E2E_BASE_URL è locale.
 * (c) Usato anche in lettura da `verificaResiduo` (scripts/verifica-residuo.ts)
 *     per interrogare i FIR, non solo per cancellarli.
 *
 * Connessione: `DATABASE_URL`, esattamente come le `*.postgres.spec.ts` del
 * backend (es. apps/backend/src/infrastructure/persistence/
 * fir-prisma.repository.postgres.spec.ts) — stesso pacchetto `@prisma/client`,
 * disponibile qui perché hoistato dai workspace npm alla radice. Nessuna
 * configurazione nuova: se DATABASE_URL non è impostata, questo modulo si
 * rifiuta esplicitamente di procedere (vedi `assicuraTargetLocale`) invece
 * di inventare un default.
 */

import { PrismaClient } from '@prisma/client'
import { isProductionTarget } from './env'
import { haPrefissoDiRun } from './run-id'

interface FirSnapshot {
  id: string
  producerName: string
  carrierName: string
  receiverName: string
}

let client: PrismaClient | null = null

function assicuraTargetLocale(): void {
  if (isProductionTarget()) {
    throw new Error(
      '[SICUREZZA] La pulizia a livello di database rifiuta di procedere: E2E_BASE_URL punta a ' +
        'un target non locale. Questo livello esiste per ripulire entità prive di endpoint di ' +
        'cancellazione (i FIR) e non deve mai toccare un database di produzione.'
    )
  }

  const databaseUrl = process.env.DATABASE_URL?.trim()
  if (!databaseUrl) {
    throw new Error(
      '[CONFIGURAZIONE] DATABASE_URL non è impostata. La pulizia dei FIR (senza endpoint di ' +
        'cancellazione HTTP) richiede una connessione diretta al database, come le *.postgres.spec.ts ' +
        'del backend (vedi apps/backend/.env). Impostala prima di eseguire la suite con dati FIR — ' +
        'questo modulo non genera né assume un default.'
    )
  }

  let hostname: string
  try {
    hostname = new URL(databaseUrl).hostname
  } catch {
    throw new Error(
      `[CONFIGURAZIONE] DATABASE_URL non è un URL valido: "${databaseUrl}". Impossibile verificare ` +
        'che punti a un host locale.'
    )
  }

  if (hostname !== 'localhost' && hostname !== '127.0.0.1') {
    throw new Error(
      `[SICUREZZA] DATABASE_URL punta all'host "${hostname}", non locale. La pulizia a livello di ` +
        'database si rifiuta di connettersi: questo controllo è indipendente da E2E_BASE_URL — ' +
        'un DATABASE_URL sbagliato non deve sfuggire solo perché il resto punta a localhost.'
    )
  }
}

function ottieniClient(): PrismaClient {
  assicuraTargetLocale()
  if (!client) {
    client = new PrismaClient()
  }
  return client
}

/** Chiude la connessione Postgres aperta da questo modulo, se presente. */
export async function chiudiConnessioneDb(): Promise<void> {
  if (client) {
    await client.$disconnect()
    client = null
  }
}

function firPortaIlPrefisso(
  fir: Pick<FirSnapshot, 'producerName' | 'carrierName' | 'receiverName'>
): boolean {
  return (
    haPrefissoDiRun(fir.producerName) ||
    haPrefissoDiRun(fir.carrierName) ||
    haPrefissoDiRun(fir.receiverName)
  )
}

/**
 * Cancella dal database SOLO i FIR fra `ids` il cui snapshot porta
 * effettivamente il prefisso della run corrente (vincolo (a) — non ci si
 * fida del solo fatto che l'id sia stato registrato). Un id già assente
 * (FIR mai creato o già rimosso) conta come rimosso, non come residuo.
 */
export async function eliminaFirConPrefisso(
  ids: string[]
): Promise<{ rimossi: number; residue: string[] }> {
  if (ids.length === 0) return { rimossi: 0, residue: [] }

  const prisma = ottieniClient()
  let rimossi = 0
  const residue: string[] = []

  for (const id of ids) {
    try {
      const fir = await prisma.fIR.findUnique({
        where: { id },
        select: { id: true, producerName: true, carrierName: true, receiverName: true },
      })

      if (!fir) {
        rimossi++
        continue
      }

      if (!firPortaIlPrefisso(fir)) {
        residue.push(
          `fir:${id} (cancellazione rifiutata: nessun campo snapshot porta il prefisso della run — vincolo (a))`
        )
        continue
      }

      await prisma.fIR.delete({ where: { id } })
      rimossi++
    } catch (errore) {
      residue.push(`fir:${id}:${String(errore)}`)
    }
  }

  return { rimossi, residue }
}

/**
 * Cerca, fra TUTTI i FIR del database, quelli il cui snapshot porta il
 * prefisso della run corrente — usata da `verificaResiduo` (vincolo (c)):
 * una verifica di residuo che non guarda i FIR non è una verifica.
 */
export async function firConPrefissoResidui(): Promise<string[]> {
  const prisma = ottieniClient()
  const tutti = await prisma.fIR.findMany({
    select: { id: true, producerName: true, carrierName: true, receiverName: true },
  })

  return tutti.filter(firPortaIlPrefisso).map(fir => `fir:${fir.id}`)
}

/**
 * Cerca, fra TUTTE le anagrafiche di TUTTI i tenant (produttori,
 * trasportatori, destinatari), quelle la cui ragione sociale porta il
 * prefisso della run corrente.
 *
 * Correzione rispetto alla verifica precedente (rilievo della revisione
 * finale, 2026-09-14): `verificaResiduo` interrogava le anagrafiche via
 * `GET /registry/*`, endpoint che il controller scopa sempre sul tenant
 * PRIMARIO dell'utente autenticato (vedi registry.controller.ts) — un
 * residuo lasciato in un SECONDO tenant (esattamente il caso del test di
 * isolamento fra aziende, tests/registry/produttore.spec.ts) non sarebbe
 * mai stato visto, mentre l'intestazione del modulo prometteva di guardare
 * "i dati reali rimasti" senza quel limite. Qui, come già per i FIR sopra,
 * si interroga il database direttamente: nessuno scoping per tenant, la
 * stessa copertura cross-tenant che vale per `firConPrefissoResidui`.
 */
export async function anagraficheConPrefissoResidui(): Promise<string[]> {
  const prisma = ottieniClient()

  // Si leggono le RIGHE DI RUOLO con il nome della ditta, non la tabella `ditte`: le ditte
  // sopravvivono alla DELETE del ruolo e risulterebbero sempre "residue" (F2-10).
  const conDitta = { id: true, ditta: { select: { ragioneSociale: true } } } as const
  const [produttori, trasportatori, destinatari] = await Promise.all([
    prisma.produttore.findMany({ select: conDitta }),
    prisma.trasportatore.findMany({ select: conDitta }),
    prisma.destinatario.findMany({ select: conDitta }),
  ])
  const nome = (r: { ditta: { ragioneSociale: string } | null }) => r.ditta?.ragioneSociale ?? ''

  return [
    ...produttori.filter(p => haPrefissoDiRun(nome(p))).map(p => `produttore:${p.id}:${nome(p)}`),
    ...trasportatori
      .filter(t => haPrefissoDiRun(nome(t)))
      .map(t => `trasportatore:${t.id}:${nome(t)}`),
    ...destinatari
      .filter(d => haPrefissoDiRun(nome(d)))
      .map(d => `destinatario:${d.id}:${nome(d)}`),
  ]
}
