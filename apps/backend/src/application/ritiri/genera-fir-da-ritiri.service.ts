/**
 * Generazione in serie delle bozze FIR dai ritiri programmati (4.7, T12; P7 §3.2).
 *
 * Per ogni ritiro, nell'ordine fisso della serie (data, mezzo, ordine nel giro, creazione):
 * dal ritiro si ricava il comando con `comandoFirDaRitiro` e si chiama `CreateFIRUseCase`, che
 * scrive il FIR in una transazione sua (un INSERT per ritiro: un errore non annulla gli altri).
 * Nessuna trasmissione a RENTRI: le bozze restano bozze.
 *
 * Esito per riga: CREATO, GIA_GENERATO (FIR attivo già presente, anche per corsa con un'altra
 * generazione: indice parziale `firs_ritiro_attivo_key`) oppure ERRORE con un codice stabile.
 * I messaggi sono fissi e non contengono id.
 */
import { Injectable, Logger } from '@nestjs/common'
import {
  FirGiaGeneratoDalRitiroError,
  RitiroNonProgrammatoError,
  RitiroNonTrovatoError,
} from '../../core/domain/errors'
import { comandoFirDaRitiro, type RitiroPerFir } from '../../domain/ritiri'
import { ProvenienzaRifiuto, TipoTratta } from '../../domain/fir/aggregates/fir.aggregate'
import { PrismaService } from '../../infrastructure/persistence/prisma.service'
import { RitiriRepository } from '../../infrastructure/persistence/ritiri.repository'
import { CreateFIRCommand } from '../fir/commands/create-fir.command'
import { CODICI_CREA_FIR, CreateFIRUseCase } from '../fir/use-cases/create-fir.use-case'
import { nelContestoTenant } from '../pese/nel-contesto-tenant'
import { RitiroDatiNonValidiError } from './errori-ritiri'
import { eUuid } from './ritiri.input'
import type { RitiroVista } from './ritiri.tipi'

export const MASSIMO_RITIRI_PER_LOTTO = 100

export type CodiceErroreGenerazione =
  | 'RITIRO_NON_TROVATO'
  | 'RITIRO_NON_PROGRAMMATO'
  | 'CER_NON_VALIDO'
  | 'SEDE_NON_VALIDA'
  | 'ANAGRAFICA_MANCANTE'
  | 'ERRORE_INTERNO'

export type EsitoGenerazioneRiga =
  | { ritiroId: string; esito: 'CREATO'; firId: string }
  | { ritiroId: string; esito: 'GIA_GENERATO'; firId: string }
  | {
      ritiroId: string
      esito: 'ERRORE'
      codice: CodiceErroreGenerazione
      messaggio: string
    }

export interface RisultatoGenerazione {
  righe: EsitoGenerazioneRiga[]
}

const MESSAGGI: Record<CodiceErroreGenerazione, string> = {
  RITIRO_NON_TROVATO: 'Ritiro non trovato.',
  RITIRO_NON_PROGRAMMATO: 'Il ritiro non è più programmato: non si può generare il FIR.',
  CER_NON_VALIDO: 'Il codice CER del ritiro non è valido.',
  SEDE_NON_VALIDA: 'Una sede indicata sul ritiro non è più una sede attiva della ditta scelta.',
  ANAGRAFICA_MANCANTE:
    'Mancano dati del ritiro o un’anagrafica non è più disponibile: completa il ritiro.',
  ERRORE_INTERNO: 'Errore imprevisto durante la generazione del FIR.',
}

const errore = (ritiroId: string, codice: CodiceErroreGenerazione): EsitoGenerazioneRiga => ({
  ritiroId,
  esito: 'ERRORE',
  codice,
  messaggio: MESSAGGI[codice],
})

/** Codice tipizzato del fallimento di `CreateFIRUseCase`; ogni altro caso e' un errore interno. */
function codiceDaEsito(codice: string | undefined): CodiceErroreGenerazione {
  switch (codice) {
    case CODICI_CREA_FIR.CER_NON_VALIDO:
      return 'CER_NON_VALIDO'
    case CODICI_CREA_FIR.SEDE_NON_VALIDA:
      return 'SEDE_NON_VALIDA'
    case CODICI_CREA_FIR.ANAGRAFICA_MANCANTE:
      return 'ANAGRAFICA_MANCANTE'
    default:
      return 'ERRORE_INTERNO'
  }
}

@Injectable()
export class GeneraFirDaRitiriService {
  private readonly logger = new Logger(GeneraFirDaRitiriService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly repo: RitiriRepository,
    private readonly creaFir: CreateFIRUseCase
  ) {}

  async genera(
    tenantId: string,
    utenteId: string,
    ritiroIds: readonly string[]
  ): Promise<RisultatoGenerazione> {
    if (!Array.isArray(ritiroIds) || ritiroIds.length < 1) {
      throw new RitiroDatiNonValidiError(['Indica almeno un ritiro.'])
    }
    const ids = [...new Set(ritiroIds)]
    if (ids.length > MASSIMO_RITIRI_PER_LOTTO) {
      throw new RitiroDatiNonValidiError([
        `Si possono generare al massimo ${MASSIMO_RITIRI_PER_LOTTO} FIR per volta.`,
      ])
    }
    if (!ids.every(eUuid)) throw new RitiroDatiNonValidiError(['Un identificativo non è valido.'])

    return nelContestoTenant(tenantId, async () => {
      // Ordine fisso: lo dà la stessa ORDER BY della lista (data, mezzo, ordine, creazione).
      const ordinati = await this.prisma.$transaction(tx => this.repo.leggiMolti(tx, tenantId, ids))
      const trovati = new Set(ordinati.map(r => r.id))
      const righe: EsitoGenerazioneRiga[] = []
      for (const ritiro of ordinati) {
        righe.push(await this.generaUno(tenantId, utenteId, ritiro))
      }
      for (const id of ids) if (!trovati.has(id)) righe.push(errore(id, 'RITIRO_NON_TROVATO'))
      return { righe }
    })
  }

  private async generaUno(
    tenantId: string,
    utenteId: string,
    ritiro: RitiroVista
  ): Promise<EsitoGenerazioneRiga> {
    const ritiroId = ritiro.id
    try {
      if (ritiro.stato !== 'PROGRAMMATO') return errore(ritiroId, 'RITIRO_NON_PROGRAMMATO')
      if (ritiro.fir) return { ritiroId, esito: 'GIA_GENERATO', firId: ritiro.fir.id }

      // Dati completi (campi del dettaglio) riletti al momento: la bozza copia lo stato attuale.
      const d = await this.prisma.$transaction(tx =>
        this.repo.leggi(tx, tenantId, ritiroId, { dettaglio: true })
      )
      if (!d) return errore(ritiroId, 'RITIRO_NON_TROVATO')
      if (d.stato !== 'PROGRAMMATO') return errore(ritiroId, 'RITIRO_NON_PROGRAMMATO')
      if (d.fir) return { ritiroId, esito: 'GIA_GENERATO', firId: d.fir.id }

      // Il FIR manuale richiede sempre provenienza e tipo di tratta (nessun default): senza,
      // il ritiro va completato.
      if (!d.provenienza || !d.tipoTratta) return errore(ritiroId, 'ANAGRAFICA_MANCANTE')

      const perFir: RitiroPerFir = {
        id: d.id,
        produttoreId: d.produttore.id,
        produttoreSedeId: d.produttore.sedeId,
        trasportatoreId: d.trasportatore.id,
        destinatarioId: d.destinatario.id,
        destinatarioSedeId: d.destinatario.sedeId,
        cerCode: d.cerCode,
        descrizione: d.descrizione,
        statoFisico: d.statoFisico ?? null,
        caratteristichePericolo: d.caratteristichePericolo ?? null,
        numeroColli: d.numeroColli ?? null,
        quantitaPresunta: d.quantitaPresunta,
        unita: d.unita,
        tipoOperazione: d.tipoOperazione ?? null,
        codiceOperazione: d.codiceOperazione ?? null,
        provenienza: d.provenienza as ProvenienzaRifiuto,
        tipoTratta: d.tipoTratta as TipoTratta,
        annotazioni: d.annotazioni ?? null,
      }
      const c = comandoFirDaRitiro(perFir, { userId: utenteId, tenantId })
      const comando = new CreateFIRCommand(
        c.produttoreId,
        c.rifiuto,
        c.trasportatoreId,
        c.destinatarioId,
        c.userId,
        c.tenantId,
        c.provenienza,
        c.tipoTrattaPrincipale,
        c.trasportatoriAggiuntivi,
        c.annotazioni,
        c.produttoreSedeId,
        c.destinatarioSedeId,
        c.ritiroId
      )

      const esito = await this.creaFir.execute(comando)
      if (esito.isFailure) return errore(ritiroId, codiceDaEsito(esito.code))
      return { ritiroId, esito: 'CREATO', firId: esito.value.id }
    } catch (err) {
      if (err instanceof FirGiaGeneratoDalRitiroError) return this.giaGenerato(tenantId, ritiroId)
      if (err instanceof RitiroNonProgrammatoError)
        return errore(ritiroId, 'RITIRO_NON_PROGRAMMATO')
      if (err instanceof RitiroNonTrovatoError) return errore(ritiroId, 'RITIRO_NON_TROVATO')
      this.logger.error(
        `Generazione FIR da ritiro fallita: ${err instanceof Error ? err.message : String(err)}`
      )
      return errore(ritiroId, 'ERRORE_INTERNO')
    }
  }

  /** Corsa persa contro un'altra generazione: il FIR vincitore c'è, lo si restituisce. */
  private async giaGenerato(tenantId: string, ritiroId: string): Promise<EsitoGenerazioneRiga> {
    const attivo = await this.prisma.$transaction(tx => this.repo.firAttivo(tx, tenantId, ritiroId))
    // Se nel frattempo il FIR vincitore è stato annullato non c'è nulla da restituire: la
    // generazione si rilancia, qui non si inventa un esito.
    return attivo
      ? { ritiroId, esito: 'GIA_GENERATO', firId: attivo.id }
      : errore(ritiroId, 'ERRORE_INTERNO')
  }
}
