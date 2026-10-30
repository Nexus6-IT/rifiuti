/**
 * Servizio delle ditte e delle sedi (F2-10, D2-D4).
 *
 * `risolviPerRuolo` fa i passi 1, 2 e 4 di D3 DENTRO la transazione del chiamante: il passo 3
 * (ruolo gia' presente per la ditta) e l'insert della riga di ruolo li fa il chiamante con lo
 * stesso `tx` (Task 3a). Gli altri metodi aprono una transazione propria.
 *
 * Il codice fiscale di un privato e' un dato personale (D12): non entra in log, audit, messaggi
 * d'errore ne' query string.
 */
import { Injectable } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import { TenantContext } from '../../../core/context/tenant-context'
import {
  DatiControparteNonValidiError,
  DittaIdentificativiInConflittoError,
  DittaNonTrovataError,
  SedeNonModificabileError,
  SedeNonTrovataError,
} from '../../../core/domain/errors'
import { Ditta } from '../../../domain/registry/entities/ditta'
import {
  ContattiSede,
  RuoloControparte,
  SedeDitta,
  chiaveIndirizzo,
} from '../../../domain/registry/entities/sede-ditta'
import {
  IdentificativoFiscale,
  MESSAGGIO_PRIVATO_SOLO_PRODUTTORE,
} from '../../../domain/registry/value-objects/identificativo-fiscale'
import { Indirizzo, IndirizzoProps } from '../../../domain/registry/value-objects/indirizzo'
import { normalizzaCodiceFiscaleSoggetto } from '../../../domain/shared/codice-fiscale-soggetto'
import { RuoloDitta } from '../../../domain/registry/repositories/ditta.repository'
import { PrismaService } from '../../../infrastructure/persistence/prisma.service'
import {
  ClientDitte,
  DittaPrismaRepository,
} from '../../../infrastructure/persistence/ditta-prisma.repository'

export const AZIONE_PARTITA_IVA_CORRETTA = 'DITTA_PARTITA_IVA_CORRETTA'

export interface DatiRisoluzioneRuolo extends ContattiSede {
  ragioneSociale: string
  partitaIva?: string | null
  codiceFiscale?: string | null
  indirizzo: IndirizzoProps
}

export interface RisoluzioneRuolo {
  dittaId: string
  sedeId: string
  /** Ragione sociale della ditta dopo la risoluzione (quella gia' registrata se esisteva). */
  ragioneSocialeDitta: string
  /** Identificativi della ditta dopo la risoluzione (comprese le aggiunte di D2.7). */
  partitaIva: string | null
  codiceFiscale: string | null
  dittaEsistente: boolean
  avvisi: string[]
  /** Contatti EFFETTIVI della sede risolta (non quelli della richiesta, se la sede esisteva). */
  contatti: { email: string | null; telefono: string | null; pec: string | null }
}

export const AVVISO_CONTATTI_SEDE_MANTENUTI =
  'La sede esistente ha già dei contatti: sono stati mantenuti quelli della sede. Per cambiarli usa "Sedi".'

export interface SedeDto {
  id: string
  denominazione: string | null
  via: string
  civico: string
  cap: string
  citta: string
  provincia: string
  referente: string | null
  email: string | null
  telefono: string | null
  pec: string | null
  principale: boolean
  attiva: boolean
}

export interface DittaDto {
  id: string
  ragioneSociale: string
  partitaIva: string | null
  codiceFiscale: string | null
  partitaIvaDaVerificare: boolean
  privato: boolean
  sedi: SedeDto[]
  ruoli: { produttoreId?: string; trasportatoreId?: string; destinatarioId?: string }
}

export interface AggiornaDittaDati {
  ragioneSociale?: string
  partitaIva?: string | null
  codiceFiscale?: string | null
}

export interface DatiSede extends ContattiSede {
  indirizzo: IndirizzoProps
}

export interface AggiornaSedeDati extends ContattiSede {
  indirizzo?: IndirizzoProps
  attiva?: boolean
}

export interface ContestoAudit {
  userId?: string
}

function stessoNome(a: string, b: string): boolean {
  const n = (v: string) => v.trim().replace(/\s+/g, ' ').toLowerCase()
  return n(a) === n(b)
}

function eP2002(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002'
}

@Injectable()
export class DitteService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ditte: DittaPrismaRepository
  ) {}

  // -------------------------------------------------------------------------------------------
  // Creazione di un ruolo (passi 1, 2 e 4 di D3, nella transazione del chiamante)
  // -------------------------------------------------------------------------------------------

  async risolviPerRuolo(
    tx: ClientDitte,
    ruolo: RuoloControparte,
    dati: DatiRisoluzioneRuolo
  ): Promise<RisoluzioneRuolo> {
    const identificativo = IdentificativoFiscale.crea({
      partitaIva: dati.partitaIva,
      codiceFiscale: dati.codiceFiscale,
    })
    // D2.5: il privato e' ammesso solo come produttore
    if (identificativo.privato && ruolo !== 'PRODUTTORE') {
      throw new DatiControparteNonValidiError(MESSAGGIO_PRIVATO_SOLO_PRODUTTORE)
    }
    const indirizzo = Indirizzo.create(dati.indirizzo)

    // 1. lock sui valori, in ordine alfabetico
    await this.ditte.bloccaIdentificativi(tx, identificativo.valori())

    // 2. ricerca della ditta
    const trovate = await this.ditte.cercaPerIdentificativi(tx, identificativo.valori())
    if (trovate.length > 1) throw new DittaIdentificativiInConflittoError()

    const avvisi: string[] = []
    let ditta: Ditta
    let dittaEsistente: boolean
    if (trovate.length === 0) {
      ditta = Ditta.crea({ ragioneSociale: dati.ragioneSociale, identificativo })
      dittaEsistente = false
      await this.scrivi(() => this.ditte.crea(tx, ditta))
    } else {
      ditta = trovate[0]
      dittaEsistente = true
      if (ditta.aggiungiIdentificativi(identificativo)) {
        await this.scrivi(() => this.ditte.aggiorna(tx, ditta))
      }
      if (!stessoNome(ditta.ragioneSociale, dati.ragioneSociale)) {
        avvisi.push(
          `La ragione sociale registrata per questa ditta è «${ditta.ragioneSociale}»: è stata mantenuta.`
        )
      }
    }
    if (ditta.privato && ruolo !== 'PRODUTTORE') {
      throw new DatiControparteNonValidiError(MESSAGGIO_PRIVATO_SOLO_PRODUTTORE)
    }

    // 4. sede: la sede attiva con lo stesso indirizzo normalizzato, altrimenti una nuova
    // (principale solo se la ditta e' nuova)
    await this.ditte.bloccaSedi(tx, ditta.id)
    const sedi = dittaEsistente ? await this.ditte.sedi(tx, ditta.id) : []
    const chiave = this.chiaveDi(indirizzo)
    let sede = sedi.find(s => s.attiva && s.chiaveIndirizzo() === chiave)
    if (!sede) {
      sede = SedeDitta.crea({
        dittaId: ditta.id,
        indirizzo,
        denominazione: dati.denominazione,
        referente: dati.referente,
        email: dati.email,
        telefono: dati.telefono,
        pec: dati.pec,
        principale: !dittaEsistente,
      })
      await this.ditte.creaSede(tx, sede)
    } else {
      // sede riusata: i contatti vuoti si riempiono con quelli della richiesta, quelli gia'
      // valorizzati e diversi restano (con un avviso); stessa transazione e stesso lock
      const richiesti = {
        email: dati.email,
        telefono: dati.telefono,
        pec: dati.pec,
      }
      const daScrivere: { email?: string; telefono?: string; pec?: string } = {}
      let divergono = false
      for (const campo of ['email', 'telefono', 'pec'] as const) {
        const voluto = richiesti[campo]?.trim()
        if (!voluto) continue
        const attuale = sede[campo]
        if (!attuale) daScrivere[campo] = voluto
        else if (attuale.trim().toLowerCase() !== voluto.toLowerCase()) divergono = true
      }
      if (Object.keys(daScrivere).length > 0) {
        sede.aggiorna(daScrivere)
        await this.scrivi(() => this.ditte.aggiornaSede(tx, sede!))
      }
      if (divergono) avvisi.push(AVVISO_CONTATTI_SEDE_MANTENUTI)
    }

    return {
      dittaId: ditta.id,
      sedeId: sede.id,
      ragioneSocialeDitta: ditta.ragioneSociale,
      partitaIva: ditta.partitaIva,
      codiceFiscale: ditta.codiceFiscale,
      dittaEsistente,
      avvisi,
      contatti: { email: sede.email, telefono: sede.telefono, pec: sede.pec },
    }
  }

  // -------------------------------------------------------------------------------------------
  // Letture
  // -------------------------------------------------------------------------------------------

  /** Cerca per partita IVA o codice fiscale; la ricerca non esige il checksum (dati migrati). */
  async cerca(identificativo: string): Promise<DittaDto | null> {
    const valore = normalizzaCodiceFiscaleSoggetto(identificativo)
    // forma sbagliata = 400 (senza riportare il valore); forma giusta ma ignota = nessun risultato
    if (!/^[A-Z0-9]{11,16}$/.test(valore)) {
      throw new DatiControparteNonValidiError(
        'Indica una partita IVA o un codice fiscale in forma valida.'
      )
    }
    return this.prisma.$transaction(async tx => {
      const [ditta] = await this.ditte.cercaPerIdentificativi(tx, [valore])
      return ditta ? this.dto(tx, ditta) : null
    })
  }

  async dettaglio(dittaId: string): Promise<DittaDto> {
    return this.prisma.$transaction(async tx =>
      this.dto(tx, await this.dittaOppure404(tx, dittaId))
    )
  }

  // -------------------------------------------------------------------------------------------
  // Scritture
  // -------------------------------------------------------------------------------------------

  /**
   * Ragione sociale, aggiunta dell'identificativo mancante (D2.7) o sostituzione della partita
   * IVA (D2.8). La sostituzione prende il lock su ENTRAMBI i valori (quello vecchio e quello
   * nuovo), verifica l'unicita' e scrive una riga di audit senza valori.
   * Con `client` lavora dentro la transazione del chiamante invece di aprirne una propria.
   */
  async aggiornaDitta(
    dittaId: string,
    dati: AggiornaDittaDati,
    contesto: ContestoAudit = {},
    client?: ClientDitte
  ): Promise<DittaDto> {
    const tenantId = TenantContext.requireTenantId()
    const nuovo =
      dati.partitaIva || dati.codiceFiscale
        ? IdentificativoFiscale.crea({
            partitaIva: dati.partitaIva,
            codiceFiscale: dati.codiceFiscale,
          })
        : null

    const esegui = async (tx: ClientDitte): Promise<DittaDto> => {
      // la ditta si legge due volte: la prima per sapere quali valori bloccare, la seconda,
      // dopo i lock, per decidere sullo stato che nessun altro puo' piu' cambiare
      const prima = await this.dittaOppure404(tx, dittaId)
      await this.ditte.bloccaIdentificativi(tx, [...prima.valori(), ...(nuovo?.valori() ?? [])])
      const ditta = await this.dittaOppure404(tx, dittaId)

      if (dati.ragioneSociale !== undefined) ditta.rinomina(dati.ragioneSociale)

      let partitaIvaCorretta = false
      if (nuovo) {
        const altre = (await this.ditte.cercaPerIdentificativi(tx, nuovo.valori())).filter(
          d => d.id !== ditta.id
        )
        if (altre.length > 0) {
          throw new DittaIdentificativiInConflittoError(
            DittaIdentificativiInConflittoError.MESSAGGIO_GIA_ESISTENTE
          )
        }
        if (nuovo.partitaIva && ditta.partitaIva && ditta.partitaIva !== nuovo.partitaIva) {
          ditta.sostituisciPartitaIva(nuovo.partitaIva)
          partitaIvaCorretta = true
          // il resto (es. il CF) segue le regole dell'aggiunta
          ditta.aggiungiIdentificativi(
            IdentificativoFiscale.crea({
              partitaIva: nuovo.partitaIva,
              codiceFiscale: nuovo.codiceFiscale,
            })
          )
        } else {
          ditta.aggiungiIdentificativi(nuovo)
        }
      }

      await this.scrivi(() => this.ditte.aggiorna(tx, ditta))
      if (partitaIvaCorretta) {
        await tx.activityLog.create({
          data: {
            tenantId,
            userId: contesto.userId,
            action: AZIONE_PARTITA_IVA_CORRETTA,
            description:
              'Partita IVA di una ditta corretta (la precedente non passava il controllo).',
            metadata: { dittaId: ditta.id },
          },
        })
      }
      return this.dto(tx, ditta)
    }
    // con il `client` del chiamante la correzione fa parte della sua transazione (tutto o niente)
    return client ? esegui(client) : this.prisma.$transaction(esegui)
  }

  /** Esegue `fn` in UNA transazione (con il tenant corrente): per le modifiche tutto-o-niente. */
  transazione<T>(fn: (tx: ClientDitte) => Promise<T>): Promise<T> {
    return this.prisma.$transaction(fn)
  }

  async aggiungiSede(dittaId: string, dati: DatiSede): Promise<SedeDto> {
    const indirizzo = Indirizzo.create(dati.indirizzo)
    return this.prisma.$transaction(async tx => {
      await this.dittaOppure404(tx, dittaId)
      await this.ditte.bloccaSedi(tx, dittaId)
      const sedi = await this.ditte.sedi(tx, dittaId)
      const chiave = this.chiaveDi(indirizzo)
      if (sedi.some(s => s.attiva && s.chiaveIndirizzo() === chiave)) {
        throw new SedeNonModificabileError('Esiste già una sede con questo indirizzo.')
      }
      const { indirizzo: _ignorato, ...contatti } = dati
      const sede = SedeDitta.crea({
        dittaId,
        indirizzo,
        ...contatti,
        principale: sedi.length === 0,
      })
      await this.ditte.creaSede(tx, sede)
      return this.sedeDto(sede)
    })
  }

  async aggiornaSede(dittaId: string, sedeId: string, dati: AggiornaSedeDati): Promise<SedeDto> {
    const indirizzo = dati.indirizzo ? Indirizzo.create(dati.indirizzo) : undefined
    return this.prisma.$transaction(async tx => {
      await this.dittaOppure404(tx, dittaId)
      await this.ditte.bloccaSedi(tx, dittaId)
      const sede = await this.sedeOppure404(tx, dittaId, sedeId)

      if (dati.attiva === false) {
        const ruoli = await this.ditte.ruoliDellaDitta(tx, dittaId)
        sede.disattiva(this.ruoliConSede(ruoli, sede.id))
      } else if (dati.attiva === true) {
        sede.riattiva()
      }
      sede.aggiorna({ ...dati, indirizzo })
      if (sede.attiva) {
        // due sedi attive con lo stesso indirizzo renderebbero casuale la scelta di risolviPerRuolo
        const chiave = sede.chiaveIndirizzo()
        const altre = await this.ditte.sedi(tx, dittaId)
        if (altre.some(s => s.id !== sede.id && s.attiva && s.chiaveIndirizzo() === chiave)) {
          throw new SedeNonModificabileError('Esiste già una sede con questo indirizzo.')
        }
      }
      await this.ditte.aggiornaSede(tx, sede)
      return this.sedeDto(sede)
    })
  }

  async impostaPrincipale(dittaId: string, sedeId: string): Promise<DittaDto> {
    return this.prisma.$transaction(async tx => {
      const ditta = await this.dittaOppure404(tx, dittaId)
      await this.ditte.bloccaSedi(tx, dittaId)
      const sede = await this.sedeOppure404(tx, dittaId, sedeId)
      sede.rendiPrincipale() // 409 se disattivata
      await this.ditte.impostaPrincipale(tx, dittaId, sedeId)
      return this.dto(tx, ditta)
    })
  }

  // -------------------------------------------------------------------------------------------
  // Dettagli
  // -------------------------------------------------------------------------------------------

  private chiaveDi(indirizzo: Indirizzo): string {
    return chiaveIndirizzo(indirizzo)
  }

  private ruoliConSede(ruoli: RuoloDitta[], sedeId: string): RuoloControparte[] {
    return ruoli.filter(r => r.sedeId === sedeId).map(r => r.ruolo)
  }

  private async dittaOppure404(tx: ClientDitte, dittaId: string): Promise<Ditta> {
    const ditta = await this.ditte.trovaPerId(tx, dittaId)
    if (!ditta) throw new DittaNonTrovataError()
    return ditta
  }

  private async sedeOppure404(
    tx: ClientDitte,
    dittaId: string,
    sedeId: string
  ): Promise<SedeDitta> {
    const sede = await this.ditte.trovaSede(tx, dittaId, sedeId)
    if (!sede) throw new SedeNonTrovataError()
    return sede
  }

  /** Traduce la violazione dell'unicita' (rete di sicurezza dopo il lock) in un 409 senza valori. */
  private async scrivi(fn: () => Promise<void>): Promise<void> {
    try {
      await fn()
    } catch (err) {
      if (eP2002(err)) {
        throw new DittaIdentificativiInConflittoError(
          DittaIdentificativiInConflittoError.MESSAGGIO_GIA_ESISTENTE
        )
      }
      throw err
    }
  }

  private sedeDto(s: SedeDitta): SedeDto {
    return {
      id: s.id,
      denominazione: s.denominazione,
      via: s.indirizzo.getVia(),
      civico: s.indirizzo.getCivico(),
      cap: s.indirizzo.getCAP(),
      citta: s.indirizzo.getCitta(),
      provincia: s.indirizzo.getProvincia(),
      referente: s.referente,
      email: s.email,
      telefono: s.telefono,
      pec: s.pec,
      principale: s.principale,
      attiva: s.attiva,
    }
  }

  private async dto(tx: ClientDitte, ditta: Ditta): Promise<DittaDto> {
    const [sedi, ruoli] = await Promise.all([
      this.ditte.sedi(tx, ditta.id),
      this.ditte.ruoliDellaDitta(tx, ditta.id),
    ])
    const idDi = (r: RuoloControparte) => ruoli.find(x => x.ruolo === r)?.id
    return {
      id: ditta.id,
      ragioneSociale: ditta.ragioneSociale,
      partitaIva: ditta.partitaIva,
      codiceFiscale: ditta.codiceFiscale,
      partitaIvaDaVerificare: ditta.partitaIvaDaVerificare,
      privato: ditta.privato,
      sedi: sedi.map(s => this.sedeDto(s)),
      ruoli: {
        ...(idDi('PRODUTTORE') && { produttoreId: idDi('PRODUTTORE') }),
        ...(idDi('TRASPORTATORE') && { trasportatoreId: idDi('TRASPORTATORE') }),
        ...(idDi('DESTINATARIO') && { destinatarioId: idDi('DESTINATARIO') }),
      },
    }
  }
}
