/** Un altro lotto e' gia' `IN_CORSO` per la stessa azienda, archivio e ambito (indice unico parziale). */
export class LottoGiaInCorsoError extends Error {
  constructor(
    readonly archivio: string,
    readonly ambito: string
  ) {
    super(`Esiste gia' un lotto IN_CORSO per l'archivio ${archivio}, ambito ${ambito}`)
    this.name = 'LottoGiaInCorsoError'
  }
}

/** Il blocco `numeroBlocco` e' fallito: il lotto e' `FALLITO` e il caricamento si e' fermato. */
export class CaricamentoBloccoFallitoError extends Error {
  constructor(
    readonly lottoId: string,
    readonly numeroBlocco: number,
    /** Descrizione senza valori delle righe (vincolo o codice dell'errore). */
    readonly causa: string
  ) {
    super(`Caricamento fermo al blocco ${numeroBlocco}: ${causa}`)
    this.name = 'CaricamentoBloccoFallitoError'
  }
}

const LUNGHEZZA_MASSIMA = 1000

const DESCRIZIONE_SQLSTATE: Record<string, string> = {
  '23505': 'violazione di unicità',
  '23503': 'violazione di chiave esterna',
  '23502': 'valore nullo non ammesso',
  '23514': 'violazione di un vincolo di controllo',
  '23P01': 'violazione di un vincolo di esclusione',
  '42501': 'scrittura rifiutata dalla sicurezza per azienda (RLS)',
  '40001': 'conflitto di serializzazione',
  '40P01': 'deadlock',
  '57014': 'interrotta per timeout',
}

/**
 * Descrizione di un errore di database SENZA dati: il messaggio di Postgres, per le violazioni di
 * unicita' e di chiave esterna, porta i valori della riga (`Key (partita_iva)=(...)`), che sono
 * personali e non vanno ne' nel lotto ne' nei log. Con le query grezze di Prisma il nome del
 * vincolo non arriva comunque: restano la classe dell'errore e il codice SQLSTATE.
 *
 * Unica eccezione, `23514`: e' il codice con cui i trigger della Fase 3 sollevano i propri errori
 * (`RAISE ... ERRCODE '23514'`), i cui messaggi hanno per convenzione solo id tecnici; il testo si
 * riporta (senza il prefisso `ERROR:`, al massimo 300 caratteri) perche' dice QUALE regola ha fermato
 * il blocco.
 */
export function causaSenzaDati(errore: unknown): string {
  const e = errore as {
    code?: unknown
    message?: unknown
    meta?: { code?: unknown; message?: unknown }
  }
  const sqlstate =
    typeof e?.meta?.code === 'string' ? e.meta.code : typeof e?.code === 'string' ? e.code : null
  const descrizione = sqlstate ? DESCRIZIONE_SQLSTATE[sqlstate] : undefined
  let causa = descrizione
    ? `${descrizione} (codice ${sqlstate})`
    : sqlstate
      ? `errore del database (codice ${sqlstate})`
      : 'errore del database'
  if (sqlstate === '23514' && typeof e?.meta?.message === 'string') {
    const testo = e.meta.message
      .replace(/^ERROR:\s*/i, '')
      .trim()
      .slice(0, 300)
    if (testo) causa += `: ${testo}`
  }
  return causa.slice(0, LUNGHEZZA_MASSIMA - 40)
}
