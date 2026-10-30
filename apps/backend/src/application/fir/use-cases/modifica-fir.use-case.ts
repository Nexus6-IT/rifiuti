/**
 * Modifica FIR Use Case - Application Layer (Fase 2 pezzo 4, piano D6-D11)
 *
 * Sostituisce il contenuto di una bozza. Il caso d'uso prepara il contenuto (CER verificato, parti
 * risolte, tratte) e lascia all'aggregate la decisione su cosa e' cambiato; il repository e'
 * l'arbitro finale sotto lock (stato, firme, versione), perche' cio' che qui si legge puo' essere
 * gia' vecchio.
 */

import { FIR, ParteFIR, TrattaTrasportoFIR } from '../../../domain/fir/aggregates/fir.aggregate'
import { IFIRModificaBozzaRepository } from '../../../domain/fir/repositories/fir-modifica-bozza.port'
import { ICERRepository } from '../../../domain/cer/repositories/cer-repository.interface'
import { ProduttoreRepository } from '../../../domain/registry/repositories/produttore.repository'
import { TrasportatoreRepository } from '../../../domain/registry/repositories/trasportatore.repository'
import { DestinatarioRepository } from '../../../domain/registry/repositories/destinatario.repository'
import { Result } from '../../../core/application/result'
import {
  DomainError,
  FirModificatoNelFrattempoError,
  FirNonModificabileError,
  FirNonTrovatoError,
  SedeNonValidaPerRuoloError,
  MetodoLocaleNonConsentitoSuFirLegatoError,
} from '../../../core/domain/errors'
import { ModificaFIRCommand } from '../commands/modifica-fir.command'
import { LoggerService } from '../../../core/logger/logger.service'
import { verificaCerPerFormulario } from '../verifica-cer-formulario'
import {
  snapshotProduttore,
  snapshotTrasportatore,
  snapshotDestinatario,
  snapshotTratta,
} from '../snapshot-parti'

export class ModificaFIRUseCase {
  constructor(
    private readonly firRepository: IFIRModificaBozzaRepository,
    private readonly cerRepository: ICERRepository,
    private readonly produttoreRepository: ProduttoreRepository,
    private readonly trasportatoreRepository: TrasportatoreRepository,
    private readonly destinatarioRepository: DestinatarioRepository,
    private readonly logger: LoggerService
  ) {}

  async execute(command: ModificaFIRCommand): Promise<Result<FIR>> {
    // RLS limita gia' la lettura all'azienda corrente; il confronto esplicito protegge anche
    // chi chiama senza contesto. Nessun id nel messaggio (404 uguale per "assente" e "altrui").
    const fir = await this.firRepository.findById(command.firId)
    if (!fir || fir.tenantId !== command.tenantId) {
      throw new FirNonTrovatoError()
    }

    // Prima "non modificabile" (piu' informativo), poi la versione (D10).
    const motivo = fir.motivoNonModificabile()
    if (motivo) throw new FirNonModificabileError(motivo)
    if (command.versione !== fir.versione) throw new FirModificatoNelFrattempoError(fir.id)

    // CER: sempre le verifiche di un formulario nuovo, anche se il CER non cambia (D7).
    const cer = await verificaCerPerFormulario(this.cerRepository, command.rifiuto.cerCode)
    if (cer.isFailure) return Result.fail<FIR>(cer.error)

    // Parti: stesso id e snapshot esistente = snapshot congelato, nessuna lettura del registro;
    // id diverso (o snapshot assente, FIR legacy) = nuovo snapshot dal registro (D7).
    const partiRisnapshottate: string[] = []

    let produttore: ParteFIR
    try {
      const gia = await this.parteConSede(
        command.produttoreId === fir.produttoreId ? fir.produttore : null,
        command.produttoreSedeId,
        sedeId =>
          sedeId
            ? this.produttoreRepository.findById(command.produttoreId, { sedeId })
            : this.produttoreRepository.findById(command.produttoreId)
      )
      if (!gia) return Result.fail<FIR>(`Produttore not found: ${command.produttoreId}`)
      produttore = gia.parte ?? snapshotProduttore(gia.ruolo!)
      if (!gia.parte) partiRisnapshottate.push('produttore')
    } catch (error) {
      if (error instanceof SedeNonValidaPerRuoloError) return Result.fail<FIR>(error.message)
      throw error
    }

    let trasportatore: ParteFIR
    if (command.trasportatoreId === fir.trasportatoreId && fir.trasportatore) {
      trasportatore = fir.trasportatore
    } else {
      const t = await this.trasportatoreRepository.findById(command.trasportatoreId)
      if (!t) return Result.fail<FIR>(`Trasportatore not found: ${command.trasportatoreId}`)
      trasportatore = snapshotTrasportatore(t)
      partiRisnapshottate.push('trasportatore')
    }

    let destinatario: ParteFIR
    try {
      const gia = await this.parteConSede(
        command.destinatarioId === fir.destinatarioId ? fir.destinatario : null,
        command.destinatarioSedeId,
        sedeId =>
          sedeId
            ? this.destinatarioRepository.findById(command.destinatarioId, { sedeId })
            : this.destinatarioRepository.findById(command.destinatarioId)
      )
      if (!gia) return Result.fail<FIR>(`Destinatario not found: ${command.destinatarioId}`)
      destinatario = gia.parte ?? snapshotDestinatario(gia.ruolo!)
      if (!gia.parte) partiRisnapshottate.push('destinatario')
    } catch (error) {
      if (error instanceof SedeNonValidaPerRuoloError) return Result.fail<FIR>(error.message)
      throw error
    }

    // Tratte: stesso trasportatore gia' presente = snapshot esistente (con nuovo ordine e tipo);
    // trasportatore nuovo = lettura dal registro. Se la chiave (trasportatore, tipo, ordine) non
    // cambia, l'aggregate lascia comunque le righe esistenti (con mezzo e data).
    const esistenti = fir.trasportatoriAggiuntivi
    const trasportatoriAggiuntivi: TrattaTrasportoFIR[] = []
    for (const tratta of command.trasportatoriAggiuntivi ?? []) {
      const gia = esistenti.find(e => e.trasportatoreId === tratta.trasportatoreId)
      if (gia) {
        trasportatoriAggiuntivi.push({
          ...gia,
          ordine: tratta.ordine,
          tipoTratta: tratta.tipoTratta,
        })
        continue
      }
      const carrier = await this.trasportatoreRepository.findById(tratta.trasportatoreId)
      if (!carrier) return Result.fail<FIR>(`Trasportatore not found: ${tratta.trasportatoreId}`)
      trasportatoriAggiuntivi.push(snapshotTratta(carrier, tratta.ordine, tratta.tipoTratta))
    }

    let campiModificati: string[]
    try {
      campiModificati = fir.modificaBozza({
        produttoreId: command.produttoreId,
        trasportatoreId: command.trasportatoreId,
        destinatarioId: command.destinatarioId,
        produttore,
        trasportatore,
        destinatario,
        rifiuto: { ...command.rifiuto, cerCode: cer.value },
        trasportatoriAggiuntivi,
        annotazioni: command.annotazioni,
        provenienza: command.provenienza,
        tipoTrattaPrincipale: command.tipoTrattaPrincipale,
      })
    } catch (error) {
      // Il guard RENTRI dell'aggregate diventa lo stesso 409 del repository (D10).
      // Errori D10 gia' tipizzati: devono arrivare al filtro (409), non diventare un 400.
      if (
        error instanceof FirNonModificabileError ||
        error instanceof FirModificatoNelFrattempoError
      ) {
        throw error
      }
      if (error instanceof MetodoLocaleNonConsentitoSuFirLegatoError) {
        // Il testo originale resta nel log; al client va il messaggio del motivo.
        this.logger.warn('Modifica locale rifiutata su FIR legato a RENTRI', {
          firId: fir.id,
          causa: error.message,
        })
        throw new FirNonModificabileError('LEGATO_RENTRI')
      }
      if (error instanceof DomainError) {
        return Result.fail<FIR>(error.message)
      }
      throw error
    }

    // Nessun cambiamento: niente scrittura, niente versione, niente audit (D9).
    if (campiModificati.length === 0) return Result.ok<FIR>(fir)

    await this.firRepository.salvaModificaBozza(fir, command.versione, {
      userId: command.userId,
      campiModificati,
      // Solo le parti il cui snapshot e' stato riletto E che risultano cambiate.
      partiRisnapshottate: partiRisnapshottate.filter(p => campiModificati.includes(p)),
    })
    return Result.ok<FIR>(fir)
  }

  /**
   * Parte di produttore o destinatario nella modifica di una bozza (F2-10 D9.6). `esistente` e'
   * lo snapshot del FIR se il ruolo e' lo stesso, altrimenti `null`. Restituisce `{ parte }` se lo
   * snapshot resta, `{ ruolo }` (letto dal registro) se va rifatto, `null` se il ruolo non esiste.
   *
   * Le cinque regole:
   *  1. stesso ruolo, sede del DTO assente: si conserva lo snapshot (anche per i FIR vecchi);
   *  2. stesso ruolo, sede del DTO uguale a quella del FIR: invariato;
   *  3. stesso ruolo, FIR senza sede (precedente alla migration) e sede del DTO uguale alla
   *     predefinita del ruolo: invariato, il FIR era stato creato su quella sede;
   *  4. stesso ruolo, sede diversa: nuovo snapshot da quella sede;
   *  5. ruolo cambiato (o snapshot assente): sede indicata o predefinita del nuovo ruolo.
   */
  private async parteConSede<R extends { sedeId: string }>(
    esistente: ParteFIR | null | undefined,
    sedeDto: string | undefined,
    leggi: (sedeId?: string) => Promise<R | null>
  ): Promise<{ parte?: ParteFIR; ruolo?: R } | null> {
    if (esistente) {
      if (!sedeDto || sedeDto === esistente.sedeId) return { parte: esistente }
      if (!esistente.sedeId) {
        const predefinita = await leggi()
        if (!predefinita) return null
        if (predefinita.sedeId === sedeDto) return { parte: esistente }
      }
    }
    const ruolo = await leggi(sedeDto)
    return ruolo ? { ruolo } : null
  }
}
