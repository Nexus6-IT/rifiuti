/**
 * Servizio dei ritiri programmati (4.7, T10): CRUD, ripetizione, annulla, non eseguito,
 * riprogramma, lista con stato visibile. Contratto di lettura: `RitiroVista` (P7 §9).
 *
 * Concorrenza (P7 §2):
 *  - ogni scrittura su un ritiro esistente apre una transazione, prende `SELECT … FOR UPDATE`
 *    sul ritiro e solo dopo controlla il FIR attivo: il lock va in conflitto con il
 *    `FOR KEY SHARE` della chiave esterna di un INSERT di FIR e con il `FOR SHARE` del trigger
 *    `firs_ritiro_controlli`, quindi o il ritiro cambia senza FIR o il FIR nasce e si risponde
 *    409 `RITIRO_CON_FIR`;
 *  - lock ottimistico con `versione` (409 `RITIRO_MODIFICATO`).
 */
import { Inject, Injectable } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import { randomUUID } from 'node:crypto'
import { ICERRepository } from '../../domain/cer/repositories/cer-repository.interface'
import { espandiRipetizione } from '../../domain/ritiri'
import { PrismaService } from '../../infrastructure/persistence/prisma.service'
import { RitiriRepository, type Tx } from '../../infrastructure/persistence/ritiri.repository'
import { normalizzaCerCode, verificaCerPerFormulario } from '../fir/verifica-cer-formulario'
import { nelContestoTenant } from '../pese/nel-contesto-tenant'
import {
  RitiroConFirError,
  RitiroDatiNonValidiError,
  RitiroModificatoError,
  RitiroNonTrovatoError,
  RitiroStatoNonValidoError,
} from './errori-ritiri'
import {
  dataValida,
  eUuid,
  messaggiErrori,
  normalizzaDatiRitiro,
  normalizzaMotivo,
  type ValoriRitiro,
} from './ritiri.input'
import type {
  DatiRitiro,
  ElencoRitiri,
  FiltriRitiri,
  ModificaRitiro,
  NuovoRitiro,
  RisultatoCreazioneRitiri,
  RitiroVista,
} from './ritiri.tipi'

const eViolazioneUnicita = (err: unknown) =>
  err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002'

@Injectable()
export class RitiriService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly repo: RitiriRepository,
    @Inject('ICERRepository') private readonly cerRepository: ICERRepository
  ) {}

  // --- lettura -----------------------------------------------------------------------------

  async elenca(tenantId: string, filtri: FiltriRitiri = {}): Promise<ElencoRitiri> {
    const messaggi: string[] = []
    for (const campo of ['dal', 'al'] as const) {
      if (filtri[campo] != null && !dataValida(filtri[campo])) {
        messaggi.push(`Il filtro «${campo}» non è una data valida.`)
      }
    }
    for (const campo of ['automezzoId', 'trasportatoreId', 'produttoreId'] as const) {
      if (filtri[campo] != null && !eUuid(filtri[campo])) {
        messaggi.push(`Il filtro «${campo}» non è valido.`)
      }
    }
    if (messaggi.length > 0) throw new RitiroDatiNonValidiError(messaggi)

    const { pagina, dimensione } = this.repo.limitiPagina(filtri.pagina, filtri.dimensione)
    const { pagina: _p, dimensione: _d, cerCode, ...resto } = filtri
    const cer = cerCode?.trim() ? normalizzaCerCode(cerCode.trim()) : undefined
    return nelContestoTenant(tenantId, () =>
      this.prisma.$transaction(tx =>
        this.repo.elenca(tx, tenantId, { ...resto, cerCode: cer }, pagina, dimensione)
      )
    )
  }

  async dettaglio(tenantId: string, id: string): Promise<RitiroVista> {
    if (!eUuid(id)) throw new RitiroNonTrovatoError()
    const vista = await nelContestoTenant(tenantId, () =>
      this.prisma.$transaction(tx => this.repo.leggi(tx, tenantId, id, { dettaglio: true }))
    )
    if (!vista) throw new RitiroNonTrovatoError()
    return vista
  }

  // --- creazione ---------------------------------------------------------------------------

  /**
   * Crea il ritiro, o la serie di ritiri se c'è una ripetizione (al massimo 52, mai troncata).
   * Un nuovo tentativo con la stessa `chiaveIdempotenza` restituisce le righe esistenti con
   * `giaRegistrato: true` e non scrive niente.
   */
  async crea(
    tenantId: string,
    utenteId: string,
    dati: NuovoRitiro
  ): Promise<RisultatoCreazioneRitiri> {
    if (!eUuid(dati.chiaveIdempotenza)) {
      throw new RitiroDatiNonValidiError(['La chiave di idempotenza non è valida.'])
    }
    const base = this.valida(dati)

    let date = [base.dataPrevista]
    if (dati.ripetizione) {
      const e = espandiRipetizione(base.dataPrevista, dati.ripetizione)
      if (!e.ok) throw new RitiroDatiNonValidiError([this.messaggioRipetizione(e.codice)])
      date = e.date
    }
    const valori: ValoriRitiro[] = date.map(d => ({ ...base, dataPrevista: d }))
    const serieId = dati.ripetizione ? randomUUID() : null

    return nelContestoTenant(tenantId, async () => {
      // Il CER si verifica prima della transazione (catalogo globale, nessuna scrittura).
      const cer = await verificaCerPerFormulario(this.cerRepository, base.cerCode)
      if (cer.isFailure) throw new RitiroDatiNonValidiError(['Il codice CER non è valido.'])
      const cerCode = cer.value
      const daSalvare = valori.map(v => ({ ...v, cerCode }))

      const giaPresenti = await this.leggiPerChiave(tenantId, dati.chiaveIdempotenza)
      if (giaPresenti) return { ritiri: giaPresenti, giaRegistrato: true }

      try {
        const ritiri = await this.prisma.$transaction(async tx => {
          await this.verificaAnagrafiche(tx, tenantId, base)
          const ids = await this.repo.inserisci(tx, tenantId, utenteId, daSalvare, {
            serieId,
            chiaveIdempotenza: dati.chiaveIdempotenza,
          })
          return this.repo.leggiMolti(tx, tenantId, ids)
        })
        return { ritiri, giaRegistrato: false }
      } catch (err) {
        if (!eViolazioneUnicita(err)) throw err
        // Stessa chiave da un'altra richiesta in corso: vince la prima, qui si restituisce.
        const esistenti = await this.leggiPerChiave(tenantId, dati.chiaveIdempotenza)
        if (esistenti) return { ritiri: esistenti, giaRegistrato: true }
        throw err
      }
    })
  }

  // --- modifica e transizioni --------------------------------------------------------------

  async modifica(tenantId: string, id: string, dati: ModificaRitiro): Promise<RitiroVista> {
    const valori = this.valida(dati)
    return nelContestoTenant(tenantId, async () => {
      const cer = await verificaCerPerFormulario(this.cerRepository, valori.cerCode)
      if (cer.isFailure) throw new RitiroDatiNonValidiError(['Il codice CER non è valido.'])
      const completi = { ...valori, cerCode: cer.value }
      return this.scrivi(
        tenantId,
        id,
        dati.versione,
        async tx => {
          await this.verificaAnagrafiche(tx, tenantId, completi)
          await this.repo.aggiornaDati(tx, tenantId, id, completi)
        },
        ['PROGRAMMATO'],
        'Solo un ritiro programmato si può modificare.'
      )
    })
  }

  async annulla(
    tenantId: string,
    utenteId: string,
    id: string,
    motivo: string,
    versione: number
  ): Promise<RitiroVista> {
    const m = this.motivo(motivo)
    return nelContestoTenant(tenantId, () =>
      this.scrivi(
        tenantId,
        id,
        versione,
        tx => this.repo.impostaStato(tx, tenantId, id, { stato: 'ANNULLATO', motivo: m, utenteId }),
        ['PROGRAMMATO', 'NON_ESEGUITO'],
        'Il ritiro è già annullato.'
      )
    )
  }

  async nonEseguito(
    tenantId: string,
    id: string,
    motivo: string,
    versione: number
  ): Promise<RitiroVista> {
    const m = this.motivo(motivo)
    return nelContestoTenant(tenantId, () =>
      this.scrivi(
        tenantId,
        id,
        versione,
        tx => this.repo.impostaStato(tx, tenantId, id, { stato: 'NON_ESEGUITO', motivo: m }),
        ['PROGRAMMATO'],
        'Solo un ritiro programmato si può segnare come non eseguito.'
      )
    )
  }

  /** Riporta a PROGRAMMATO un ritiro non eseguito, con una data nuova. */
  async riprogramma(
    tenantId: string,
    id: string,
    dataPrevista: string,
    versione: number
  ): Promise<RitiroVista> {
    if (!dataValida(dataPrevista)) {
      throw new RitiroDatiNonValidiError(['La data del ritiro non è valida.'])
    }
    return nelContestoTenant(tenantId, () =>
      this.scrivi(
        tenantId,
        id,
        versione,
        tx => this.repo.impostaStato(tx, tenantId, id, { stato: 'PROGRAMMATO', dataPrevista }),
        ['NON_ESEGUITO'],
        'Si può riprogrammare solo un ritiro non eseguito.'
      )
    )
  }

  // --- interni -----------------------------------------------------------------------------

  /**
   * Schema comune di ogni scrittura: transazione, FOR UPDATE, versione, stato ammesso, FIR
   * attivo, scrittura, rilettura. Il controllo del FIR sta DOPO il lock (vedi intestazione).
   */
  private async scrivi(
    tenantId: string,
    id: string,
    versione: number,
    operazione: (tx: Tx) => Promise<void>,
    statiAmmessi: string[],
    messaggioStato: string
  ): Promise<RitiroVista> {
    if (!eUuid(id)) throw new RitiroNonTrovatoError()
    if (!Number.isInteger(versione) || versione < 1) {
      throw new RitiroDatiNonValidiError(['La versione del ritiro non è valida.'])
    }
    try {
      return await this.prisma.$transaction(async tx => {
        const bloccato = await this.repo.bloccaPerId(tx, tenantId, id)
        if (!bloccato) throw new RitiroNonTrovatoError()
        if (bloccato.versione !== versione) throw new RitiroModificatoError()
        if (!statiAmmessi.includes(bloccato.stato)) {
          throw new RitiroStatoNonValidoError(messaggioStato)
        }
        if (await this.repo.firAttivo(tx, tenantId, id)) throw new RitiroConFirError()
        await operazione(tx)
        const vista = await this.repo.leggi(tx, tenantId, id, { dettaglio: true })
        if (!vista) throw new RitiroNonTrovatoError()
        return vista
      })
    } catch (err) {
      if (eViolazioneUnicita(err)) {
        throw new RitiroDatiNonValidiError([
          'Esiste già un ritiro di questa serie nella data indicata.',
        ])
      }
      throw err
    }
  }

  private valida(dati: DatiRitiro): ValoriRitiro {
    const e = normalizzaDatiRitiro(dati)
    if (!e.ok) throw new RitiroDatiNonValidiError(e.messaggi)
    return e.valori
  }

  private motivo(motivo: unknown): string {
    const m = normalizzaMotivo(motivo)
    if (!m.ok) throw new RitiroDatiNonValidiError(m.messaggi)
    return m.motivo
  }

  private messaggioRipetizione(codice: string): string {
    switch (codice) {
      case 'PASSO_NON_VALIDO':
        return 'Indica la ripetizione ogni N giorni oppure ogni N settimane.'
      case 'FINO_PRIMA_DELLA_DATA':
        return 'La data finale della ripetizione è precedente alla data del ritiro.'
      case 'FINO_OLTRE_UN_ANNO':
        return 'La ripetizione non può andare oltre un anno dalla data del ritiro.'
      case 'TROPPE_OCCORRENZE':
        return 'La ripetizione genera più di 52 ritiri: accorcia il periodo.'
      default:
        return messaggiErrori(['DATA_NON_VALIDA'])[0]
    }
  }

  private async leggiPerChiave(tenantId: string, chiave: string): Promise<RitiroVista[] | null> {
    return this.prisma.$transaction(async tx => {
      const ids = await this.repo.trovaPerChiave(tx, tenantId, chiave)
      return ids.length === 0 ? null : this.repo.leggiMolti(tx, tenantId, ids)
    })
  }

  /** Esistenza nel tenant e coerenza sede-ditta (come la creazione del FIR); mai id nei messaggi. */
  private async verificaAnagrafiche(tx: Tx, tenantId: string, v: ValoriRitiro): Promise<void> {
    const messaggi: string[] = []
    const dittaP = await this.repo.dittaDelRuolo(tx, tenantId, 'produttore', v.produttoreId)
    const dittaT = await this.repo.dittaDelRuolo(tx, tenantId, 'trasportatore', v.trasportatoreId)
    const dittaD = await this.repo.dittaDelRuolo(tx, tenantId, 'destinatario', v.destinatarioId)
    if (!dittaP) messaggi.push('Produttore non trovato.')
    else if (!(await this.repo.sedeAttivaDellaDitta(tx, tenantId, v.produttoreSedeId, dittaP))) {
      messaggi.push('La sede indicata non è una sede attiva del produttore scelto.')
    }
    if (!dittaT) messaggi.push('Trasportatore non trovato.')
    if (!dittaD) messaggi.push('Destinatario non trovato.')
    else if (!(await this.repo.sedeAttivaDellaDitta(tx, tenantId, v.destinatarioSedeId, dittaD))) {
      messaggi.push('La sede indicata non è una sede attiva del destinatario scelto.')
    }
    if (v.automezzoId && !(await this.repo.automezzoAttivo(tx, tenantId, v.automezzoId))) {
      messaggi.push('Automezzo non trovato.')
    }
    if (messaggi.length > 0) throw new RitiroDatiNonValidiError(messaggi)
  }
}
