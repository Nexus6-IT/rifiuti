import { Injectable } from '@nestjs/common'
import { LoggerService } from '../../core/logger/logger.service'
import { DomainException } from '../../domain/shared/domain-exception'
import { IFIRRepository } from '../../domain/fir/repositories/fir-repository.interface'
import { RENTRIApiClient } from '../../infrastructure/rentri/rentri-api.client'
import { GetAzioniDisponibiliUseCase } from './get-azioni-disponibili.use-case'
import {
  CompletaOperazioneConFirmaUseCase,
  EsitoCompletamentoFirma,
} from './completa-operazione-con-firma.use-case'

/** Parametri di {@link AnnullaFIRRentriUseCase.execute}. */
export interface ComandoAnnullaFIRRentri {
  firId: string
  tenantId: string
  motivo: string
  correlationId?: string
}

/** Esito di {@link AnnullaFIRRentriUseCase.execute}. */
export interface EsitoAnnullaFIRRentri {
  esitoFirma: EsitoCompletamentoFirma
  /** `true` solo se `POST /note-annullamento` è stato inviato con successo. */
  noteInviate: boolean
}

/**
 * Annulla un formulario RENTRI, con nota (R3 Task 5) — l'ultima operazione di
 * scrittura del ciclo di vita coperta da questo piano.
 *
 * A differenza dell'accettazione (Task 4), questa operazione ha **DUE**
 * chiamate di scrittura verso l'ente, non una:
 * 1. `POST /{numero_fir}/annulla-fir` (`docs/contracts/rentri/formulari.yaml`,
 *    righe 1232-1329 — **non** `/annulla`, deprecato riga 1136), che innesca
 *    la firma remota (stato `FirmaAnnullamento`).
 * 2. `POST /{numero_fir}/note-annullamento` (righe 1642-1738), **solo dopo**
 *    che il formulario è confermato `Annullato` presso l'ente — e SENZA
 *    alcuna firma successiva (il contratto non documenta uno stato `Firma*`
 *    dopo questa chiamata).
 *
 * **Sequenza fail-closed, in ordine:**
 * 1. Precondizioni sul FIR (esiste, tenant coincide, legato a RENTRI).
 * 2. Validazione locale del motivo (non vuoto, non oltre 1024 caratteri —
 *    vincolo dell'ente, `NoteAnnullamentoModel.note`) — PRIMA di qualunque
 *    rete.
 * 3. Precondizione da `/azioni`: {@link GetAzioniDisponibiliUseCase} deve
 *    riportare `'Annulla'` — se assente, NESSUNA chiamata a
 *    `annullaFormulario`.
 * 4. `RENTRIApiClient.annullaFormulario` — se l'ente rifiuta (`esito.errore`),
 *    errore di dominio leggibile, NESSUNA chiamata a
 *    `CompletaOperazioneConFirmaUseCase`.
 * 5. {@link CompletaOperazioneConFirmaUseCase} chiude il ciclo scrivi→firma→
 *    esito. Se l'esito NON è `COMPLETATA` (IN_ATTESA/SCADUTA/RIFIUTATA), è
 *    propagato COSÌ COM'È al chiamante — **NESSUNA** chiamata a
 *    `note-annullamento` (il formulario non è ancora `Annullato` presso
 *    l'ente).
 * 6. Se `COMPLETATA` ma `statoFormulario !== 'Annullato'`: errore di dominio
 *    leggibile — l'ente ha concluso la firma ma non nello stato atteso.
 * 7. Se `COMPLETATA` con `statoFormulario === 'Annullato'`: il FIR viene
 *    **ricaricato** dal repository — l'istanza in mano dal punto 1 è
 *    obsoleta, perché `CompletaOperazioneConFirmaUseCase` ha caricato,
 *    riconciliato e salvato la SUA propria istanza internamente.
 * 8. Precondizione da `/azioni`, **di nuovo** (lo stato è appena cambiato):
 *    deve comparire `'NoteAnnullamento'`. Assente → errore di dominio
 *    leggibile — il formulario è annullato presso l'ente ma la nota NON può
 *    più essere aggiunta.
 * 9. `RENTRIApiClient.inviaNoteAnnullamento`. Se `esito.errore` → errore di
 *    dominio leggibile che **dichiara che l'annullamento presso l'ente è
 *    comunque avvenuto** (non annulla la scrittura già avvenuta).
 * 10. Persiste localmente il motivo sul FIR ricaricato
 *     (`FIR.registraNoteAnnullamentoRentri`) e salva.
 *
 * ## ⚠️ LIMITE NOTO — nessuna ripresa della sola nota
 *
 * Se `note-annullamento` fallisce (punto 9) o non è più disponibile
 * (punto 8), l'annullamento presso l'ente **è comunque avvenuto**:
 * rilanciare `execute()` da capo ripeterebbe `annulla-fir`, che l'ente
 * rifiuterebbe (l'operazione `Annulla` non è più nella lista azioni di un
 * formulario già `Annullato`). Non esiste, in questo task, un modo per
 * "solo riprovare la nota": è un limite esplicito, non silenzioso.
 */
@Injectable()
export class AnnullaFIRRentriUseCase {
  constructor(
    private readonly firRepository: IFIRRepository,
    private readonly getAzioniDisponibiliUseCase: GetAzioniDisponibiliUseCase,
    private readonly rentriApiClient: RENTRIApiClient,
    private readonly completaOperazioneConFirmaUseCase: CompletaOperazioneConFirmaUseCase,
    private readonly logger: LoggerService
  ) {
    this.logger.setContext('AnnullaFIRRentriUseCase')
  }

  async execute(comando: ComandoAnnullaFIRRentri): Promise<EsitoAnnullaFIRRentri> {
    const { firId, tenantId, motivo, correlationId } = comando

    // --- 1. Precondizioni sul FIR, PRIMA di qualunque validazione o rete ---

    const fir = await this.firRepository.findById(firId)
    if (!fir) {
      throw DomainException.notFound('FIR', firId)
    }
    if (fir.tenantId !== tenantId) {
      throw new DomainException('Unauthorized access to FIR', 'UNAUTHORIZED')
    }
    if (!fir.rentriNumeroFir) {
      throw DomainException.businessRuleViolation(
        'FIR_NON_LEGATO_RENTRI',
        "Questo FIR non è ancora legato a un formulario RENTRI: non c'è alcun formulario da annullare presso l'ente."
      )
    }

    // --- 2. Validazione locale del motivo, PRIMA di contattare l'ente ---

    if (!motivo || motivo.trim() === '') {
      throw DomainException.businessRuleViolation(
        'MOTIVO_ANNULLAMENTO_MANCANTE',
        "Il motivo dell'annullamento è obbligatorio: verrà trasmesso all'ente come nota di annullamento."
      )
    }
    if (motivo.length > 1024) {
      throw DomainException.businessRuleViolation(
        'MOTIVO_ANNULLAMENTO_TROPPO_LUNGO',
        'Il motivo non può superare 1024 caratteri (vincolo del formulario RENTRI).'
      )
    }

    // --- 3. Precondizione da /azioni: 'Annulla' deve comparire ---

    const { azioni } = await this.getAzioniDisponibiliUseCase.execute(
      firId,
      tenantId,
      correlationId
    )
    const annullamentoDisponibile = azioni.some(azione => azione.operazione === 'Annulla')
    if (!annullamentoDisponibile) {
      throw DomainException.businessRuleViolation(
        'ANNULLAMENTO_NON_DISPONIBILE',
        'Questo formulario non è (più) nella fase in cui può essere annullato: nessuna operazione è stata inviata a RENTRI.'
      )
    }

    const numeroFir = fir.rentriNumeroFir

    // --- 4. Avvio dell'annullamento presso l'ente ---

    const esitoAnnullaFir = await this.rentriApiClient.annullaFormulario(tenantId, numeroFir)

    if (esitoAnnullaFir.errore) {
      throw DomainException.businessRuleViolation(
        'ANNULLAMENTO_RENTRI_RIFIUTATO',
        `L'ente ha rifiutato l'annullamento del formulario ${numeroFir}. ` +
          `Dettaglio della validazione RENTRI: ${JSON.stringify(esitoAnnullaFir.validazione)}`
      )
    }

    this.logger.info('Annullamento RENTRI avviato: formulario in attesa di firma', {
      firId,
      tenantId,
      numeroFir,
      correlationId,
    })

    // --- 5. Chiusura del ciclo con la firma remota RENTRI (R3 Task 3) ---

    const esitoFirma = await this.completaOperazioneConFirmaUseCase.execute({
      firId,
      tenantId,
      tipoOperazione: 'ANNULLAMENTO',
      correlationId,
    })

    if (esitoFirma.esito !== 'COMPLETATA') {
      // Né errore né successo definitivo: nessuna nota inviata, nessuno
      // stato ulteriore modificato. Il chiamante distingue l'esito dal tipo.
      return { esitoFirma, noteInviate: false }
    }

    if (esitoFirma.statoFormulario !== 'Annullato') {
      throw DomainException.businessRuleViolation(
        'ANNULLAMENTO_STATO_INATTESO',
        `L'ente ha concluso la firma del formulario ${numeroFir}, ma lo stato risultante è ` +
          `'${esitoFirma.statoFormulario}', non 'Annullato' come atteso: le note di annullamento non sono state inviate.`
      )
    }

    // --- 6. Il FIR va ricaricato: CompletaOperazioneConFirmaUseCase ha
    // caricato, riconciliato e salvato la SUA propria istanza internamente,
    // l'istanza del punto 1 è ormai obsoleta ---

    const firAggiornato = await this.firRepository.findById(firId)
    if (!firAggiornato) {
      throw new DomainException(
        `FIR ${firId} non più trovato dopo la conferma dell'annullamento presso l'ente: ` +
          "l'annullamento è comunque avvenuto, ma non è stato possibile registrare la nota localmente.",
        'FIR_NON_TROVATO_DOPO_ANNULLAMENTO'
      )
    }

    // --- 7. Precondizione da /azioni, DI NUOVO: lo stato è appena cambiato ---

    const { azioni: azioniPostAnnullamento } = await this.getAzioniDisponibiliUseCase.execute(
      firId,
      tenantId,
      correlationId
    )
    const noteAnnullamentoDisponibili = azioniPostAnnullamento.some(
      azione => azione.operazione === 'NoteAnnullamento'
    )
    if (!noteAnnullamentoDisponibili) {
      throw DomainException.businessRuleViolation(
        'NOTE_ANNULLAMENTO_NON_DISPONIBILI',
        "Il formulario è stato annullato presso l'ente, ma non è più possibile aggiungere le note " +
          'di annullamento: la motivazione non è stata trasmessa.'
      )
    }

    // --- 8. Trasmissione delle note di annullamento ---

    const esitoNote = await this.rentriApiClient.inviaNoteAnnullamento(tenantId, numeroFir, motivo)

    if (esitoNote.errore) {
      throw DomainException.businessRuleViolation(
        'NOTE_ANNULLAMENTO_RENTRI_RIFIUTATE',
        "Il formulario è stato annullato presso l'ente, ma le note di annullamento sono state " +
          `rifiutate. Dettaglio: ${JSON.stringify(esitoNote.validazione)}`
      )
    }

    // --- 9. Persistenza locale del motivo, sul FIR ricaricato ---

    firAggiornato.registraNoteAnnullamentoRentri(motivo)
    await this.firRepository.save(firAggiornato)

    this.logger.info(
      'Annullamento RENTRI completato: note di annullamento trasmesse e registrate',
      {
        firId,
        tenantId,
        numeroFir,
        correlationId,
      }
    )

    return { esitoFirma, noteInviate: true }
  }
}
