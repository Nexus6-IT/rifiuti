/**
 * Orchestratore di un ambito a fasi (es. ANAGRAFICHE: ditte -> sedi -> ruoli) sullo STESSO lotto.
 *
 * Il lotto si apre una volta, ogni fase gira con `inserisciABlocchi(..., concludi: false)` e
 * `completa` arriva solo dopo l'ultima. Alla prima fase fallita il lotto e' `FALLITO` (lo fa il
 * motore per gli errori di blocco; qui per ogni altro errore) e le fasi seguenti non partono.
 * Le fasi gia' scritte restano: la riesecuzione e' idempotente sulla chiave legacy.
 * Log: solo id tecnici, nome della fase e conteggi.
 */
import { CaricamentoBloccoFallitoError, causaSenzaDati } from './errori'
import { DipendenzeCaricamento, inserisciABlocchi } from './inserisci-a-blocchi'
import { AvviaLotto, ConteggiLotto, OpzioniInserimento } from './tipi'

export interface FaseCaricamento<R = unknown> {
  readonly nome: string
  /** Chiamata solo quando la fase parte: le fasi seguenti a una fallita non vengono nemmeno lette. */
  readonly righe: () => Promise<readonly R[]>
  readonly opzioni: Omit<OpzioniInserimento<R>, 'concludi'>
}

export interface EsitoCaricamento {
  readonly lottoId: string
  readonly conteggi: ConteggiLotto
  /** Conteggi cumulati del lotto dopo ciascuna fase, nell'ordine. */
  readonly fasi: ReadonlyArray<{ nome: string; conteggi: ConteggiLotto }>
}

/** Una fase e' fallita: il lotto e' `FALLITO`. Nessun valore delle righe nel messaggio. */
export class FaseCaricamentoFallitaError extends Error {
  constructor(
    readonly lottoId: string,
    readonly fase: string,
    readonly causa: string
  ) {
    super(`Fase «${fase}» fallita: ${causa}`)
    this.name = 'FaseCaricamentoFallitaError'
  }
}

export async function caricaAmbito(
  dip: DipendenzeCaricamento,
  tenantId: string,
  lotto: AvviaLotto,
  fasi: readonly FaseCaricamento<any>[]
): Promise<EsitoCaricamento> {
  const creato = await dip.lotti.avvia(tenantId, lotto)
  const esiti: Array<{ nome: string; conteggi: ConteggiLotto }> = []
  let ultimi: ConteggiLotto = { lette: 0, inserite: 0, saltate: 0, scartate: 0, blocchi: 0 }
  for (const fase of fasi) {
    try {
      const righe = await fase.righe()
      ultimi = await inserisciABlocchi(dip, tenantId, creato.id, righe, {
        ...fase.opzioni,
        concludi: false,
      })
    } catch (errore) {
      const causa =
        errore instanceof CaricamentoBloccoFallitoError
          ? `blocco ${errore.numeroBlocco}: ${errore.causa}`
          : causaSenzaDati(errore)
      // Idempotente: se il motore l'ha gia' fatto, il lotto non e' piu' IN_CORSO e non cambia nulla.
      await dip.lotti.fallisci(tenantId, creato.id, `Fase ${fase.nome}: ${causa}`)
      dip.logger.warn('Fase di import fallita', { tenantId, lottoId: creato.id, fase: fase.nome })
      throw new FaseCaricamentoFallitaError(creato.id, fase.nome, causa)
    }
    esiti.push({ nome: fase.nome, conteggi: ultimi })
    dip.logger.info('Fase di import completata', {
      tenantId,
      lottoId: creato.id,
      fase: fase.nome,
      inserite: ultimi.inserite,
      saltate: ultimi.saltate,
    })
  }
  await dip.lotti.completa(tenantId, creato.id)
  return { lottoId: creato.id, conteggi: ultimi, fasi: esiti }
}
