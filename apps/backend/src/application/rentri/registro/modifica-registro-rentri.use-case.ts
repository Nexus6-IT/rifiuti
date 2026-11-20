/**
 * Modifica un registro gia' collegato su RENTRI (eREGI E3, T0): descrizione e/o codici di
 * recupero e smaltimento (`PUT /operatore/registri/{id}`). Le attivita' non si cambiano (il
 * contratto non lo consente). Solo ADMIN.
 *
 * Prima di scrivere si LEGGE il dettaglio: il registro esiste, e' della sede giusta, non e'
 * chiuso (se lo e' si allinea il flag locale e si rifiuta), e i codici R/D si controllano contro
 * le attivita' che ha davvero su RENTRI. La PUT e' idempotente (stessi valori, stesso risultato),
 * ma su esito incerto non si dichiara successo: si rilegge il dettaglio e si salva solo se
 * RENTRI mostra i nuovi valori. Il registro locale si aggiorna solo a modifica confermata.
 */
import { Injectable } from '@nestjs/common'
import { TenantContext } from '../../../core/context/tenant-context'
import { LoggerService } from '../../../core/logger/logger.service'
import { PrismaService } from '../../../infrastructure/persistence/prisma.service'
import {
  RentriAnagraficheClient,
  type RegistroAnagraficoModel,
} from '../../../infrastructure/rentri/rentri-anagrafiche.client'
import { TrasmissioneRentriIncertaError } from '../../../infrastructure/rentri/rentri-api.client'
import { EsitoRentriMalformatoError } from '../../../infrastructure/rentri/rentri-registri.client'
import { RentriApiError } from '../../../infrastructure/rentri/rentri-http-resilienza'
import {
  CODICI_RECUPERO_SMALTIMENTO_RENTRI,
  LUNGHEZZA_MASSIMA_DESCRIZIONE_REGISTRO_RENTRI,
  attivitaDaRentri,
  motivoAttivitaNonValide,
} from './attivita-registro-rentri'
import { leggiContestoRegistroRentri, registroRentriChiuso } from './contesto-registro-rentri'
import {
  RegistroNonCollegatoRentriError,
  RegistroRentriChiusoError,
  RegistroRentriNonTrovatoError,
  RichiestaTrasmissioneNonValidaError,
  richiediAmministratore,
} from './errori-azioni-rentri-registro'
import {
  ImpostazioniRentriRegistroService,
  type ImpostazioniRegistro,
} from './impostazioni-rentri-registro.service'

export interface RichiestaModificaRegistro {
  descrizione?: string
  attivitaRecSmalt?: string[]
  /** `forza_salvataggio_attivita_rec_smalt`: salta il controllo dei codici sulle autorizzazioni. */
  forza?: boolean
}

export type EsitoModifica =
  | { esito: 'MODIFICATO'; impostazioni: ImpostazioniRegistro }
  | { esito: 'INCERTO'; messaggio: string }

export const MESSAGGIO_MODIFICA_INCERTA =
  'RENTRI non ha confermato la modifica: il registro non risulta cambiato. Puoi riprovare, la richiesta è ripetibile senza effetti collaterali.'

const ordinati = (a: readonly string[]) => [...a].sort().join('|')

@Injectable()
export class ModificaRegistroRentriUseCase {
  constructor(
    private readonly prisma: PrismaService,
    private readonly client: RentriAnagraficheClient,
    private readonly impostazioni: ImpostazioniRentriRegistroService,
    private readonly logger: LoggerService
  ) {
    this.logger.setContext('ModificaRegistroRentriUseCase')
  }

  /**
   * @throws RuoloNonAutorizzatoRentriError 403
   * @throws RichiestaTrasmissioneNonValidaError 400 nulla da modificare, descrizione o codici non validi
   * @throws RegistroNonCollegatoRentriError 409
   * @throws RegistroRentriChiusoError 409 chiuso (o in chiusura) su RENTRI
   * @throws RegistroRentriNonTrovatoError 400 il registro non esiste piu' su RENTRI
   * @throws RentriApiError rifiuto dell'ente (400/422: codici non ammessi, `forza` li accetta)
   */
  async esegui(
    tenantId: string,
    utenteId: string,
    ruolo: string,
    registroId: string,
    richiesta: RichiestaModificaRegistro
  ): Promise<EsitoModifica> {
    richiediAmministratore(ruolo)
    const descrizione = richiesta.descrizione?.trim()
    const codici = richiesta.attivitaRecSmalt
    if (descrizione === undefined && codici === undefined) {
      throw new RichiestaTrasmissioneNonValidaError(
        'Indica la descrizione o i codici da modificare.'
      )
    }
    if (descrizione !== undefined) {
      if (descrizione === '') {
        throw new RichiestaTrasmissioneNonValidaError('La descrizione non può essere vuota.')
      }
      if (descrizione.length > LUNGHEZZA_MASSIMA_DESCRIZIONE_REGISTRO_RENTRI) {
        throw new RichiestaTrasmissioneNonValidaError(
          `La descrizione può avere al massimo ${LUNGHEZZA_MASSIMA_DESCRIZIONE_REGISTRO_RENTRI} caratteri.`
        )
      }
    }
    if (codici !== undefined) {
      if (new Set(codici).size !== codici.length) {
        throw new RichiestaTrasmissioneNonValidaError(
          'I codici di recupero e smaltimento non possono essere ripetuti.'
        )
      }
      if (!codici.every(c => CODICI_RECUPERO_SMALTIMENTO_RENTRI.includes(c))) {
        throw new RichiestaTrasmissioneNonValidaError(
          'Uno dei codici di recupero o smaltimento non è valido (R1-R13, D1-D15).'
        )
      }
    }

    const contesto = await TenantContext.run(
      { tenantId },
      async () =>
        await this.prisma.$transaction(async tx => {
          const c = await leggiContestoRegistroRentri(tx, tenantId, registroId)
          const r = await tx.registroRifiuti.findFirst({
            where: { id: registroId, tenantId },
            select: { rentriChiusuraRichiestaIl: true },
          })
          return { ...c, chiusuraRichiesta: r?.rentriChiusuraRichiestaIl ?? null }
        })
    )
    if (contesto.identificativoRentri === null) throw new RegistroNonCollegatoRentriError()
    if (contesto.rentriChiusoIl !== null || contesto.chiusuraRichiesta !== null) {
      throw new RegistroRentriChiusoError(
        'Il registro è chiuso (o in chiusura) su RENTRI: non si può modificare.'
      )
    }
    const identificativo = contesto.identificativoRentri

    const dettaglio = await this.leggiDettaglio(identificativo, tenantId)
    if (registroRentriChiuso(dettaglio)) {
      await this.allineaChiusura(tenantId, registroId, dettaglio)
      throw new RegistroRentriChiusoError(
        'Il registro risulta chiuso su RENTRI (probabilmente dal portale): non si può modificare.'
      )
    }

    if (codici !== undefined) {
      const attivita = attivitaDaRentri(dettaglio.attivita, dettaglio.attivita_rec_smalt).attivita
      const base = attivita.length > 0 ? attivita : contesto.rentriAttivita
      if (base.length > 0) {
        const motivo = motivoAttivitaNonValide({ attivita: base, attivitaRecSmalt: codici })
        if (motivo !== null) throw new RichiestaTrasmissioneNonValidaError(motivo)
      }
    }

    const corpo = {
      ...(descrizione !== undefined ? { descrizione } : {}),
      ...(codici !== undefined ? { attivitaRecSmalt: codici } : {}),
      ...(richiesta.forza === true ? { forza: true } : {}),
    }
    try {
      await this.client.modificaRegistro(identificativo, corpo, tenantId)
    } catch (errore) {
      const incerto =
        errore instanceof TrasmissioneRentriIncertaError ||
        errore instanceof EsitoRentriMalformatoError
      if (!incerto) throw errore
      const riletto = await this.rileggiSeConferma(identificativo, tenantId, descrizione, codici)
      if (riletto === null) {
        this.logger.warn('Modifica del registro su RENTRI non confermata', { tenantId, registroId })
        return { esito: 'INCERTO', messaggio: MESSAGGIO_MODIFICA_INCERTA }
      }
    }

    await this.salva(
      tenantId,
      utenteId,
      registroId,
      contesto.descrizione,
      contesto.rentriAttivitaRecSmalt,
      descrizione,
      codici
    )
    this.logger.info('Registro RENTRI modificato', { tenantId, registroId })
    return {
      esito: 'MODIFICATO',
      impostazioni: await this.rileggiImpostazioni(tenantId, registroId),
    }
  }

  private async leggiDettaglio(
    identificativo: string,
    tenantId: string
  ): Promise<RegistroAnagraficoModel> {
    try {
      return await this.client.dettaglioRegistro(identificativo, tenantId)
    } catch (errore) {
      if (errore instanceof RentriApiError && errore.status === 404) {
        throw new RegistroRentriNonTrovatoError()
      }
      throw errore
    }
  }

  /** Dopo un esito incerto: `null` se RENTRI non mostra (ancora) i valori richiesti. */
  private async rileggiSeConferma(
    identificativo: string,
    tenantId: string,
    descrizione: string | undefined,
    codici: string[] | undefined
  ): Promise<RegistroAnagraficoModel | null> {
    let d: RegistroAnagraficoModel
    try {
      d = await this.client.dettaglioRegistro(identificativo, tenantId)
    } catch {
      return null
    }
    if (descrizione !== undefined && (d.descrizione ?? '').trim() !== descrizione) return null
    if (codici !== undefined && ordinati(d.attivita_rec_smalt ?? []) !== ordinati(codici)) {
      return null
    }
    return d
  }

  /** Il portale ha chiuso il registro: si ferma l'invio anche da noi. */
  private async allineaChiusura(
    tenantId: string,
    registroId: string,
    dettaglio: RegistroAnagraficoModel
  ): Promise<void> {
    const quando =
      typeof dettaglio.data_chiusura === 'string' &&
      !Number.isNaN(Date.parse(dettaglio.data_chiusura))
        ? new Date(dettaglio.data_chiusura)
        : new Date()
    await TenantContext.run(
      { tenantId },
      async () =>
        await this.prisma.registroRifiuti.updateMany({
          where: {
            id: registroId,
            tenantId,
            rentriChiusoIl: null,
            identificativoRentri: { not: null },
          },
          data: {
            rentriChiusoIl: quando,
            rentriChiusuraRichiestaIl: null,
            invioRentriAutomaticoDal: null,
          },
        })
    )
  }

  private async salva(
    tenantId: string,
    utenteId: string,
    registroId: string,
    descrizionePrima: string,
    codiciPrima: string[],
    descrizione: string | undefined,
    codici: string[] | undefined
  ): Promise<void> {
    await TenantContext.run(
      { tenantId },
      async () =>
        await this.prisma.$transaction(async tx => {
          await tx.registroRifiuti.updateMany({
            where: { id: registroId, tenantId },
            data: {
              ...(descrizione !== undefined ? { descrizione } : {}),
              ...(codici !== undefined ? { rentriAttivitaRecSmalt: codici } : {}),
              rentriSincronizzatoIl: new Date(),
            },
          })
          await tx.activityLog.create({
            data: {
              tenantId,
              userId: utenteId,
              action: 'RENTRI_REGISTRO_MODIFICATO',
              description: 'Registro RENTRI modificato da WasteFlow',
              metadata: {
                registroId,
                prima: { descrizione: descrizionePrima, attivitaRecSmalt: codiciPrima },
                dopo: {
                  descrizione: descrizione ?? descrizionePrima,
                  attivitaRecSmalt: codici ?? codiciPrima,
                },
              },
            },
          })
        })
    )
  }

  private async rileggiImpostazioni(
    tenantId: string,
    registroId: string
  ): Promise<ImpostazioniRegistro> {
    const lista = await this.impostazioni.leggi(tenantId)
    const r = lista.find(x => x.registroId === registroId)
    if (!r) throw new RegistroRentriNonTrovatoError()
    return r
  }
}
