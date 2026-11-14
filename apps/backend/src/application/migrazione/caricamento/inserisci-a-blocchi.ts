/**
 * Fase 3 (3.1), D6: motore di caricamento a blocchi per tenant.
 *
 * Ogni blocco gira in `TenantContext.run({ tenantId })` + `prisma.$transaction` sul client
 * APPLICATIVO (RLS: nessuna riga di un'altra azienda e' visibile o scrivibile, e il contesto non
 * sopravvive da un blocco al successivo). I blocchi gia' scritti restano (la riesecuzione e'
 * idempotente grazie a `ON CONFLICT` sulla chiave legacy); al primo errore il lotto va `FALLITO`
 * con il numero del blocco e il vincolo violato (mai i valori), e il caricamento si ferma. I
 * conteggi si aggiornano alla fine di ogni blocco, nella stessa transazione.
 *
 * Ogni blocco chiude con `SET CONSTRAINTS ... IMMEDIATE`: senza, l'errore del vincolo differito dei
 * movimenti importati (Prisma 5.22) non arriverebbe qui. Log: solo id e conteggi.
 */
import { TenantContext } from '../../../core/context/tenant-context'
import type { LoggerService } from '../../../core/logger/logger.service'
import type { PrismaService } from '../../../infrastructure/persistence/prisma.service'
import { CaricamentoBloccoFallitoError, causaSenzaDati } from './errori'
import type { LottiImportService } from './lotti-import.service'
import {
  ConteggiLotto,
  DIMENSIONE_BLOCCO_DEFAULT,
  OpzioniInserimento,
  VINCOLI_DIFFERITI_DEFAULT,
} from './tipi'

const NOME_VINCOLO = /^[A-Za-z_][A-Za-z0-9_]*$/

export interface DipendenzeCaricamento {
  prisma: PrismaService
  lotti: LottiImportService
  logger: LoggerService
}

/**
 * Carica `righe` nel lotto `lottoId` dell'azienda `tenantId`, a blocchi.
 * @returns i conteggi finali del lotto (che a questo punto e' `COMPLETATO`)
 * @throws CaricamentoBloccoFallitoError al primo blocco fallito (il lotto e' `FALLITO`)
 */
export async function inserisciABlocchi<R>(
  dip: DipendenzeCaricamento,
  tenantId: string,
  lottoId: string,
  righe: readonly R[],
  opzioni: OpzioniInserimento<R>
): Promise<ConteggiLotto> {
  const dimensione = opzioni.dimensioneBlocco ?? DIMENSIONE_BLOCCO_DEFAULT
  if (!Number.isInteger(dimensione) || dimensione < 1) {
    throw new RangeError('La dimensione del blocco deve essere un intero maggiore di zero')
  }
  const vincoli = opzioni.vincoliDifferiti ?? VINCOLI_DIFFERITI_DEFAULT
  for (const v of vincoli) {
    if (!NOME_VINCOLO.test(v)) throw new RangeError('Nome di vincolo differito non valido')
  }

  let ultimi: ConteggiLotto = { lette: 0, inserite: 0, saltate: 0, scartate: 0, blocchi: 0 }
  for (let inizio = 0, numero = 1; inizio < righe.length; inizio += dimensione, numero++) {
    const blocco = righe.slice(inizio, inizio + dimensione)
    const numeroBlocco = numero
    try {
      ultimi = await TenantContext.run(
        { tenantId },
        async () =>
          await dip.prisma.$transaction(async tx => {
            const inserite = await opzioni.inserisciBlocco(tx, blocco, {
              tenantId,
              lottoId,
              numeroBlocco,
            })
            if (!Number.isInteger(inserite) || inserite < 0 || inserite > blocco.length) {
              throw new Error('Il blocco ha dichiarato un numero di righe inserite impossibile')
            }
            const conteggi = await dip.lotti.registraBlocco(tx, tenantId, lottoId, {
              lette: blocco.length,
              inserite,
              saltate: blocco.length - inserite,
            })
            // Ultimo statement: il vincolo differito fallisce QUI, non al COMMIT.
            for (const v of vincoli) await tx.$executeRawUnsafe(`SET CONSTRAINTS "${v}" IMMEDIATE`)
            return conteggi
          })
      )
      dip.logger.debug('Blocco di import scritto', {
        tenantId,
        lottoId,
        numeroBlocco,
        righe: blocco.length,
      })
    } catch (errore) {
      const causa = causaSenzaDati(errore)
      await dip.lotti.fallisci(tenantId, lottoId, `Blocco ${numeroBlocco}: ${causa}`)
      dip.logger.warn('Blocco di import fallito', { tenantId, lottoId, numeroBlocco })
      throw new CaricamentoBloccoFallitoError(lottoId, numeroBlocco, causa)
    }
  }
  await dip.lotti.completa(tenantId, lottoId)
  return ultimi
}
