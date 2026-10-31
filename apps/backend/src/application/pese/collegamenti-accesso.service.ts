// Collegamenti di un accesso chiuso a un FIR o a un'annotazione del registro (D2, D12, D13).
// Un collegamento non modifica il documento: lega e basta, e la vista mostra sempre la differenza
// fra netto e quantita'. Si puo' revocare (una volta, con motivo); non si cancella.
//
// CONCORRENZA. Creare e revocare un collegamento prendono `bloccaAccesso` (advisory
// `accesso-pesa|<id>` + `FOR UPDATE`, vedi `blocchi-accesso.ts`) PRIMA di leggere o scrivere, come
// l'annullo: i due non si possono incrociare. Gli indici unici parziali del database restano la
// rete per le corse fra accessi diversi sullo stesso documento (P2002 -> 409).
import { Injectable } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import { firAnnullato, STATI_FIR_EMESSI, STATI_FIR_IN_BOZZA } from '../../domain/fir/stati-fir'
import { nettoNellUnitaFir } from '../../domain/pese/confronto-documento'
import { chiaveConfrontoCer } from '../../domain/waste-movement/cer-registro'
import { PrismaService } from '../../infrastructure/persistence/prisma.service'
import { RUOLI_OPERATORE_PESA, RUOLI_RESPONSABILE_PESA } from '../../api/pese/ruoli-pesa'
import type { UtentePesa } from './accessi-pesa.tipi'
import { traduciErroreDatabase } from './accessi-pesa.service'
import { scriviAuditPese } from './audit-pese'
import { bloccaAccesso } from './blocchi-accesso'
import {
  CollegamentoNonTrovatoError,
  CollegamentoNonValidoError,
  DatiPesaNonValidiError,
  FirNonTrovatoError,
  RuoloPesaInsufficienteError,
  StatoAccessoNonValidoError,
} from './errori-pese'
import { leggiMovimentiCollegati, leggiRadiceOrdinaria } from './movimenti-collegati'
import { nelContestoTenant } from './nel-contesto-tenant'
import { leggiVistaAccesso, type AccessoVista } from './viste-accesso'

export const MSG_GIA_COLLEGATO = "L'accesso o il documento è già collegato."
const MSG_SOLO_CHIUSO = 'Si può collegare solo un accesso chiuso.'

type Accesso = Awaited<ReturnType<typeof bloccaAccesso>>

@Injectable()
export class CollegamentiAccessoService {
  /** Sostituibile nei test. */
  protected adesso: () => Date = () => new Date()

  constructor(private readonly prisma: PrismaService) {}

  async collegaFir(
    tenantId: string,
    utente: UtentePesa,
    accessoId: string,
    firId: string
  ): Promise<AccessoVista> {
    this.richiediOperatore(utente)
    return this.esegui(tenantId, async tx => {
      const accesso = await bloccaAccesso(tx, tenantId, accessoId)
      await this.collegaFirSottoLock(tx, tenantId, utente.id, accesso, firId)
      return leggiVistaAccesso(tx, tenantId, accessoId, this.adesso())
    })
  }

  async collegaMovimento(
    tenantId: string,
    utente: UtentePesa,
    accessoId: string,
    movimentoId: string
  ): Promise<AccessoVista> {
    this.richiediOperatore(utente)
    return this.esegui(tenantId, async tx => {
      const accesso = await bloccaAccesso(tx, tenantId, accessoId)
      this.richiediChiuso(accesso)
      const radice = await leggiRadiceOrdinaria(tx, tenantId, movimentoId)
      if (!radice) throw new CollegamentoNonValidoError('Annotazione non trovata.')
      if (radice.tipoAnnotazione !== 'ORDINARIA') {
        throw new CollegamentoNonValidoError(
          "Collegare l'annotazione originale, non una sua rettifica."
        )
      }
      if (radice.registroId !== accesso.registroId) {
        throw new CollegamentoNonValidoError("L'annotazione appartiene a un altro registro.")
      }
      if (radice.type !== accesso.verso) {
        throw new CollegamentoNonValidoError(
          "L'annotazione ha un verso diverso da quello dell'accesso."
        )
      }
      if (
        accesso.cerCode &&
        chiaveConfrontoCer(accesso.cerCode) !== chiaveConfrontoCer(radice.cerCode)
      ) {
        throw new CollegamentoNonValidoError(
          "Il codice CER dell'accesso è diverso da quello dell'annotazione."
        )
      }
      const stato = (await leggiMovimentiCollegati(tx, tenantId, [radice.id])).get(radice.id)
      if (stato?.annullato) throw new CollegamentoNonValidoError("L'annotazione è annullata.")

      const esistente = await tx.collegamentoAccesso.findFirst({
        where: {
          tenantId,
          revocatoIl: null,
          OR: [{ accessoId, tipo: 'MOVIMENTO' }, { movimentoId: radice.id }],
        },
        select: { id: true },
      })
      if (esistente) throw new StatoAccessoNonValidoError(MSG_GIA_COLLEGATO)
      const c = await tx.collegamentoAccesso.create({
        data: {
          tenantId,
          accessoId,
          registroId: accesso.registroId,
          verso: accesso.verso,
          tipo: 'MOVIMENTO',
          movimentoId: radice.id,
          creatoDa: utente.id,
        },
      })
      await scriviAuditPese(
        tx,
        tenantId,
        utente.id,
        'PESA_COLLEGAMENTO_CREATO',
        'Accesso alla pesa collegato al registro',
        { accessoId, collegamentoId: c.id, tipo: 'MOVIMENTO' }
      )
      return leggiVistaAccesso(tx, tenantId, accessoId, this.adesso())
    })
  }

  async revoca(
    tenantId: string,
    utente: UtentePesa,
    collegamentoId: string,
    motivo: string
  ): Promise<AccessoVista> {
    if (!RUOLI_RESPONSABILE_PESA.includes(utente.ruolo)) {
      throw new RuoloPesaInsufficienteError(
        "Solo un amministratore dell'azienda può revocare un collegamento."
      )
    }
    const testo = motivo?.trim() ?? ''
    if (!testo) throw new DatiPesaNonValidiError(['Il motivo della revoca è obbligatorio.'])
    if (testo.length > 500) {
      throw new DatiPesaNonValidiError(['Il motivo può avere al massimo 500 caratteri.'])
    }
    return this.esegui(tenantId, async tx => {
      const prima = await tx.collegamentoAccesso.findFirst({
        where: { id: collegamentoId, tenantId },
        select: { accessoId: true },
      })
      if (!prima) throw new CollegamentoNonTrovatoError()
      await bloccaAccesso(tx, tenantId, prima.accessoId)
      // Rilettura sotto lock: un'altra revoca potrebbe averci preceduto.
      const c = await tx.collegamentoAccesso.findFirst({
        where: { id: collegamentoId, tenantId },
        select: { id: true, accessoId: true, tipo: true, revocatoIl: true },
      })
      if (!c) throw new CollegamentoNonTrovatoError()
      if (c.revocatoIl)
        throw new StatoAccessoNonValidoError('Il collegamento è già stato revocato.')
      const adesso = this.adesso()
      await tx.collegamentoAccesso.update({
        where: { id: collegamentoId },
        data: { revocatoDa: utente.id, revocatoIl: adesso, motivoRevoca: testo },
      })
      await scriviAuditPese(
        tx,
        tenantId,
        utente.id,
        'PESA_COLLEGAMENTO_REVOCATO',
        'Collegamento di un accesso alla pesa revocato',
        { accessoId: c.accessoId, collegamentoId, tipo: c.tipo, motivoLunghezza: testo.length }
      )
      return leggiVistaAccesso(tx, tenantId, c.accessoId, adesso)
    })
  }

  /**
   * D12: peso da usare per la conferma di consegna di un FIR, preso dal netto di un accesso
   * CHIUSO di CARICO, espresso nell'unita' del FIR. Crea il collegamento FIR se manca. Il ruolo
   * lo verifica il controller; l'azienda e' quella del contesto.
   */
  async pesoPerConsegnaFir(
    tenantId: string,
    utenteId: string,
    firId: string,
    accessoId: string
  ): Promise<number> {
    return this.esegui(tenantId, async tx => {
      const accesso = await bloccaAccesso(tx, tenantId, accessoId)
      this.richiediChiuso(accesso)
      if (accesso.verso !== 'CARICO') {
        throw new CollegamentoNonValidoError(
          'Il peso della pesa si usa per la consegna solo con un accesso di carico.'
        )
      }
      const fir = await this.leggiFirCollegabile(tx, tenantId, firId)
      if (fir.status !== 'AWAITING_RECEIVER') {
        throw new CollegamentoNonValidoError(
          'Il peso della pesa si usa per la consegna solo con un FIR in transito.'
        )
      }
      if (fir.rentriNumeroFir?.trim()) {
        throw new CollegamentoNonValidoError(
          'Il FIR è legato a RENTRI: il peso della pesa non si usa per la consegna.'
        )
      }
      const netto = (await leggiVistaAccesso(tx, tenantId, accessoId, this.adesso())).netto
      if (netto.stato !== 'CALCOLATO' || netto.nettoKg === null) {
        throw new CollegamentoNonValidoError("L'accesso non ha un netto calcolato.")
      }
      const peso = nettoNellUnitaFir(netto.nettoKg, fir.unit)
      if (peso === null) {
        throw new CollegamentoNonValidoError(
          `Il FIR è in ${fir.unit}: il peso della pesa (kg) non si converte.`
        )
      }
      await this.collegaFirSottoLock(tx, tenantId, utenteId, accesso, firId, true)
      await scriviAuditPese(
        tx,
        tenantId,
        utenteId,
        'FIR_PESO_DA_ACCESSO',
        'Peso del FIR preso da un accesso alla pesa',
        { accessoId, nettoKg: netto.nettoKg, pesoFir: peso, unita: fir.unit }
      )
      return peso
    })
  }

  // ---------------------------------------------------------------------------------------------

  private richiediOperatore(utente: UtentePesa): void {
    if (!RUOLI_OPERATORE_PESA.includes(utente.ruolo)) {
      throw new RuoloPesaInsufficienteError('Non hai il permesso di collegare un accesso.')
    }
  }

  private richiediChiuso(accesso: Accesso): void {
    if (accesso.stato !== 'CHIUSO') throw new StatoAccessoNonValidoError(MSG_SOLO_CHIUSO)
  }

  private async leggiFirCollegabile(tx: Prisma.TransactionClient, tenantId: string, firId: string) {
    const fir = await tx.fIR.findFirst({
      where: { id: firId, tenantId },
      select: {
        id: true,
        status: true,
        firNumber: true,
        rentriNumeroFir: true,
        rentriStatoFormulario: true,
        unit: true,
      },
    })
    if (!fir) throw new FirNonTrovatoError()
    if (firAnnullato(fir)) throw new CollegamentoNonValidoError('Il FIR è annullato.')
    if (!(STATI_FIR_EMESSI as readonly string[]).includes(fir.status)) {
      throw new CollegamentoNonValidoError(
        (STATI_FIR_IN_BOZZA as readonly string[]).includes(fir.status)
          ? "Il FIR è ancora una bozza: si collega dopo l'emissione."
          : 'Il FIR non è in uno stato a cui si possa collegare un accesso.'
      )
    }
    return fir
  }

  /** Crea il collegamento FIR se manca; gia' collegato allo stesso FIR e' un successo. */
  private async collegaFirSottoLock(
    tx: Prisma.TransactionClient,
    tenantId: string,
    utenteId: string,
    accesso: Accesso,
    firId: string,
    /** true: gia' collegato allo stesso FIR e' un successo e il FIR e' gia' stato verificato */
    idempotente = false
  ): Promise<void> {
    this.richiediChiuso(accesso)
    if (!idempotente) await this.leggiFirCollegabile(tx, tenantId, firId)
    const esistente = await tx.collegamentoAccesso.findFirst({
      where: {
        tenantId,
        revocatoIl: null,
        OR: [{ accessoId: accesso.id, tipo: 'FIR' }, { firId }],
      },
      select: { id: true, accessoId: true, firId: true },
    })
    if (esistente) {
      if (idempotente && esistente.accessoId === accesso.id && esistente.firId === firId) return
      throw new StatoAccessoNonValidoError(MSG_GIA_COLLEGATO)
    }
    const c = await tx.collegamentoAccesso.create({
      data: {
        tenantId,
        accessoId: accesso.id,
        registroId: accesso.registroId,
        verso: accesso.verso,
        tipo: 'FIR',
        firId,
        creatoDa: utenteId,
      },
    })
    await scriviAuditPese(
      tx,
      tenantId,
      utenteId,
      'PESA_COLLEGAMENTO_CREATO',
      'Accesso alla pesa collegato a un FIR',
      { accessoId: accesso.id, collegamentoId: c.id, tipo: 'FIR' }
    )
  }

  private esegui<R>(
    tenantId: string,
    fn: (tx: Prisma.TransactionClient) => Promise<R>
  ): Promise<R> {
    return nelContestoTenant(tenantId, async () => {
      try {
        return await this.prisma.$transaction(fn, { timeout: 15_000, maxWait: 5_000 })
      } catch (err) {
        // Qui l'unico vincolo unico che si puo' violare e' uno degli indici dei collegamenti.
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
          throw new StatoAccessoNonValidoError(MSG_GIA_COLLEGATO)
        }
        throw await traduciErroreDatabase(err)
      }
    })
  }
}
