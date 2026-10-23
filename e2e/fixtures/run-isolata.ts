/**
 * Helper per i self-test delle fondamenta E2E (pulizia-self-test.spec.ts,
 * registro-risorse-persistenza.spec.ts): esegue un blocco di codice sotto
 * un E2E_RUN_ID isolato, dedicato al solo test chiamante, con copie fresche
 * dei moduli che memoizzano stato legato alla run (utils/run-id.ts —
 * memoizza `runId()` — e a cascata utils/api-client.ts, utils/blacklist.ts,
 * utils/db-locale.ts, fixtures/risorse.ts, che tutti dipendono da esso o
 * fra loro).
 *
 * Perché serve: playwright.config.ts genera E2E_RUN_ID UNA SOLA VOLTA,
 * prima di avviare i worker (i worker ereditano l'ambiente del processo
 * padre al fork — vedi utils/run-id.ts): è lo STESSO prefisso per tutti i
 * file di test di un worker, e quindi lo stesso file di registro su disco
 * (fixtures/risorse.ts `percorsoRegistro`). Un self-test che vuole
 * verificare il meccanismo di registro/pulizia (create → registra →
 * ripulisci → verifica residuo zero) senza toccare le risorse registrate
 * dagli ALTRI test della run — che con `fullyParallel: true` possono girare
 * in contemporanea nello stesso momento — deve lavorare sotto un
 * E2E_RUN_ID proprio, generato ad hoc, e ripristinare tutto esattamente
 * come l'ha trovato al termine: qualunque spec caricata DOPO nello stesso
 * processo worker eredita l'ambiente e la cache dei moduli lasciati da
 * questa funzione (rilievo della revisione finale, 2026-09-14: una prima
 * versione impostava `process.env.E2E_RUN_ID` senza mai ripristinarlo,
 * avvelenando ogni spec successiva nello stesso worker — le anagrafiche
 * create da quei test finivano con un prefisso che il teardown globale,
 * eseguito con l'ambiente corretto, non riconosceva: verde falso più dati
 * reali lasciati in banca dati).
 */

const PERCORSI_DA_RICARICARE = [
  require.resolve('../utils/run-id'),
  require.resolve('../utils/api-client'),
  require.resolve('../utils/blacklist'),
  require.resolve('../utils/db-locale'),
  require.resolve('./risorse'),
]

function scaricaCache(): void {
  for (const percorso of PERCORSI_DA_RICARICARE) {
    delete require.cache[percorso]
  }
}

export interface ModuliRunIsolato {
  /** Il prefisso di run generato per questa invocazione isolata. */
  runId: string
  conPrefisso: (nome: string) => string
  haPrefissoDiRun: (valore: string) => boolean
  registra: (tipo: 'produttore' | 'trasportatore' | 'destinatario' | 'fir', id: string) => void
  ripulisci: (token: string) => Promise<{ rimosse: number; residue: string[] }>
}

/**
 * Genera un E2E_RUN_ID isolato (prefissato con `etichetta`, per riconoscerlo
 * nei log/nei file di registro), ricarica a cache pulita i moduli elencati
 * sopra e invoca `callback` passandole le funzioni della copia fresca —
 * NON quelle importate staticamente in cima al file chiamante, che
 * resterebbero legate al modulo (e quindi al prefisso di run) caricato per
 * primo in questo processo worker.
 *
 * Ripristina SEMPRE — anche se `callback` lancia — sia
 * `process.env.E2E_RUN_ID` al valore che aveva prima (o lo rimuove, se non
 * era impostato) sia la cache dei moduli: senza questo secondo passo, la
 * prossima spec dello stesso worker che importa staticamente uno di questi
 * moduli riceverebbe l'ISTANZA GIÀ CARICATA con il prefisso isolato ancora
 * memoizzato al suo interno (vedi `cached` in utils/run-id.ts), invece di
 * una copia nuova che rilegge l'ambiente ripristinato al primo utilizzo.
 */
export async function conRunIsolata<T>(
  etichetta: string,
  callback: (moduli: ModuliRunIsolato) => Promise<T>
): Promise<T> {
  const runIdIsolato = `run-isolato-${etichetta}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const precedente = process.env.E2E_RUN_ID

  process.env.E2E_RUN_ID = runIdIsolato
  scaricaCache()

  // Require dinamico voluto (come già in registro-risorse-persistenza.spec.ts
  // prima di questo helper): serve una copia dei moduli con lo stato
  // memoizzato (runId cache, esenzioni blacklist) ripartito da zero con il
  // nuovo E2E_RUN_ID, cosa che un `import` statico in cima al file non
  // permetterebbe di ottenere invocazione per invocazione.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const runIdModulo = require('../utils/run-id')
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const risorseModulo = require('./risorse')

  try {
    return await callback({
      runId: runIdIsolato,
      conPrefisso: runIdModulo.conPrefisso,
      haPrefissoDiRun: runIdModulo.haPrefissoDiRun,
      registra: risorseModulo.registra,
      ripulisci: risorseModulo.ripulisci,
    })
  } finally {
    if (precedente === undefined) {
      delete process.env.E2E_RUN_ID
    } else {
      process.env.E2E_RUN_ID = precedente
    }
    scaricaCache()
  }
}
