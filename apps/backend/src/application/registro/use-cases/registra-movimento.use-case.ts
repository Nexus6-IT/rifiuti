import { ConflictException, Injectable, Optional } from '@nestjs/common'
import { Prisma, WasteMovement as WasteMovementRecord } from '@prisma/client'
import { PrismaService } from '../../../infrastructure/persistence/prisma.service'
import { LoggerService } from '../../../core/logger/logger.service'
import { Result } from '../../../core/application/result'
import {
  DomainError,
  FirGiaRegistratoError,
  FirGiaRegistratoInAltroRegistroError,
  INDICAZIONE_FIR_ANNULLATO,
} from '../../../core/domain/errors'
import { RegistraMovimentoCommand } from '../commands/registra-movimento.command'
import {
  WasteMovement,
  TERMINE_REGISTRAZIONE_PRODUTTORE_GG,
} from '../../../domain/waste-movement/waste-movement.entity'
import {
  annoSolareItaliano,
  formattaDataItaliana,
  giornoItaliano,
} from '../../../core/time/anno-italiano'
import { collegabilitaFir, etichettaFir } from '../../../domain/fir/stati-fir'
import { formattaQuantita } from '../../../core/format/formatta-quantita'
import {
  normalizzaUnitaRegistro,
  simboloUnita,
} from '../../../domain/waste-movement/unita-misura-registro'
import { giacenzaDisponibileAl } from '../giacenza-disponibile'
import { validaDatiMovimento } from '../valida-dati-movimento'
import { confermaVersioneAzienda } from '../causali/catalogo-causali.repository'
import {
  bloccaProgressivo,
  inserisciAnnotazione,
  numeraAnnotazione,
} from '../numerazione-annotazione'
import { chiaveLockGiacenza } from '../chiave-lock-giacenza'
import { stessiDatiRicopia } from '../ricopia-fir'
import {
  abbinaNuovoScarico,
  haStoccaggioOAbbinamenti,
} from '../../abbinamenti/abbinamenti-scrittura'
import { segnalaErroreJob } from '../../../core/monitoring/segnala-errore-job'
import { RegistriService, RegistroVista } from '../registri.service'
import {
  agganciaLegameSenzaFallire,
  ATTESA_CONNESSIONE_REGISTRAZIONE_MS,
  TIMEOUT_TRANSAZIONE_REGISTRAZIONE_MS,
  validaDatiLegame,
  type FatturazioneRegistrazione,
} from '../../legami-movimento/aggancio-registro'
import { PropostaLegameService } from '../../legami-movimento/proposta-legame.service'

/** Avviso all'operatore quando l'abbinamento FIFO di uno scarico appena registrato e' fallito. */
export const AVVISO_ABBINAMENTO_NON_RIUSCITO =
  "Scarico registrato ma non abbinato: usare 'Abbina con FIFO i non abbinati' nella pagina Abbinamenti."

const MSG_ERRORE_REGISTRAZIONE =
  "Errore durante la registrazione del movimento. Riprova; se il problema persiste contatta l'assistenza."

/**
 * Chiave di ricopia della ricopia ordinaria di un FIR (C-W-03, come WinWaste).
 *
 * L'indice unico è (tenant, fir_id_ricopia, type, ricopia_chiave): dallo stesso FIR
 * possono nascere più movimenti dello stesso verso purché con chiavi diverse.
 * Schema delle chiavi riservate:
 * - `''`                   ricopia ordinaria (un movimento per FIR e tipo);
 * - `prod:<unitaLocaleId>` quota di un produttore percentuale;
 * - `cer:<cer>`            carico generato da un trattamento;
 * - `dett:<n>`             dettaglio senza altra chiave.
 * La chiave la impone il flusso, mai l'utente; oggi nessun flusso ne usa una diversa
 * da `''`, quindi per i produttori la regola resta "una ricopia per FIR e tipo".
 */
export const RICOPIA_ORDINARIA = ''

export interface MovimentoRegistrato {
  id: string
  tenantId: string
  /** Registro (per sede) in cui il movimento è annotato. */
  registroId: string
  progressiveNumber: number
  progressiveYear: number
  type: string
  movementDate: Date
  registrationDate: Date
  causale: string
  /** Descrizione della causale nel catalogo dell'azienda (il codice se non e' piu' in catalogo). */
  causaleDescrizione: string
  cerCode: string
  wasteDescription?: string
  quantity: number
  unit: string
  wastePhysicalState?: string
  wasteHazardClasses?: string
  operationCode?: string
  counterpartName?: string
  counterpartAddress?: string
  firId?: string
  recordedByUserId?: string
  entryHash: string
  notes?: string
  /** Segnala all'operatore se la registrazione supera i termini di legge. */
  fuoriTermine: boolean
  ritardoGg: number
  /** Avvisi non bloccanti per l'operatore (vuoto se non ce ne sono). */
  avvisi: string[]
  /**
   * Blocco «Fatturazione» (fase 4.3): presente solo se la causale e' fatturabile e la fatturazione
   * e' attiva per il giorno del movimento. Mai presente nel retry di una ricopia gia' registrata.
   */
  fatturazione?: FatturazioneRegistrazione
  /**
   * Vero se il FIR era già ricopiato con gli stessi dati: si restituisce il movimento
   * esistente e non se ne crea un secondo (retry idempotente).
   */
  giaRegistrato: boolean
}

/** Vista di un'annotazione salvata (condivisa con le correzioni). */
export function movimentoDaRecord(
  record: WasteMovementRecord,
  ritardoGg: number,
  causaleDescrizione: string = record.causale
): Omit<MovimentoRegistrato, 'avvisi' | 'giaRegistrato'> {
  return {
    id: record.id,
    tenantId: record.tenantId,
    registroId: record.registroId,
    progressiveNumber: record.progressiveNumber,
    progressiveYear: record.progressiveYear,
    type: record.type,
    movementDate: record.movementDate,
    registrationDate: record.registrationDate,
    causale: record.causale,
    causaleDescrizione,
    cerCode: record.cerCode,
    wasteDescription: record.wasteDescription ?? undefined,
    quantity: Number(record.quantity),
    unit: record.unit,
    wastePhysicalState: record.wastePhysicalState ?? undefined,
    wasteHazardClasses: record.wasteHazardClasses ?? undefined,
    operationCode: record.operationCode ?? undefined,
    counterpartName: record.counterpartName ?? undefined,
    counterpartAddress: record.counterpartAddress ?? undefined,
    firId: record.firId ?? undefined,
    recordedByUserId: record.recordedByUserId ?? undefined,
    entryHash: record.entryHash,
    notes: record.notes ?? undefined,
    fuoriTermine: ritardoGg > 0,
    ritardoGg,
  }
}

/**
 * Use case per la registrazione di un movimento nel registro cronologico
 * di carico/scarico. Art. 190 D.Lgs 152/2006, DM 59/2023.
 *
 * Assegna automaticamente il numero progressivo per registro/anno sotto advisory lock,
 * per evitare race condition in ambienti multi-worker. Registrazioni su registri (sedi)
 * diversi non si aspettano: nessun lock a livello di azienda dentro la transazione.
 *
 * Calcola e persiste l'hash SHA-256 di vidimazione digitale (art. 4 DM 59/2023).
 *
 * Per uno SCARICO di massa verifica la giacenza del CER dentro la transaction, sotto
 * lock: blocca se il saldo complessivo (in kg) del registro non copre lo scarico; se lo copre ma
 * non alla data dello scarico, lo registra e restituisce un avviso in `avvisi`.
 *
 * Un FIR si ricopia una sola volta per tipo di movimento: ripetere la stessa ricopia
 * restituisce il movimento esistente (`giaRegistrato: true`), una ricopia con dati
 * diversi è rifiutata (FirGiaRegistratoError).
 */
/**
 * Codice Prisma (`P2xxx`) o SQLSTATE (5 caratteri) di un errore, se c'e': sono identificativi
 * fissi, senza valori dell'utente. Altrimenti stringa vuota.
 */
function codiceErroreSicuro(err: unknown): string {
  const e = err as { code?: unknown; meta?: { code?: unknown } } | null
  const forma = /^[0-9A-Z]{5}$/
  for (const c of [e?.code, e?.meta?.code]) {
    if (typeof c === 'string' && forma.test(c)) return c
  }
  return ''
}

@Injectable()
export class RegistraMovimentoUseCase {
  /** Proposta e scrittura del legame (iniettata; se manca, creata su `prisma`). */
  private readonly propostaLegami: PropostaLegameService

  constructor(
    private readonly prisma: PrismaService,
    private readonly logger: LoggerService,
    private readonly registri: RegistriService,
    @Optional() propostaLegami?: PropostaLegameService
  ) {
    this.logger.setContext(RegistraMovimentoUseCase.name)
    this.propostaLegami = propostaLegami ?? new PropostaLegameService(prisma)
  }

  async execute(command: RegistraMovimentoCommand): Promise<Result<MovimentoRegistrato>> {
    // 0. Causale coerente col tipo, CER normalizzato e a catalogo, date non future
    // (validazioni condivise con la rettifica).
    const validazione = await validaDatiMovimento(this.prisma, command)
    if (validazione.errore !== undefined) return Result.fail(validazione.errore)
    const cerCode = validazione.cerCode

    // 0c. Blocco «Fatturazione»: un numero scritto male e' un errore del client e si rifiuta prima
    // di scrivere qualsiasi cosa (il legame, poi, non puo' piu' far fallire la registrazione).
    // Un'eccezione HTTP (400 con il suo codice, es. QUANTITA_NON_VALIDA) arriva intatta al client.
    validaDatiLegame(command.legame)

    // 0d. Se è indicato un FIR collegato, deve esistere e appartenere al tenant.
    // Evita movimenti con FK penzolante verso un formulario inesistente.
    if (command.firId) {
      const fir = await this.prisma.fIR.findFirst({
        where: { id: command.firId, tenantId: command.tenantId },
        select: {
          id: true,
          status: true,
          firNumber: true,
          rentriNumeroFir: true,
          rentriStatoFormulario: true,
        },
      })
      if (!fir) {
        return Result.fail(
          `FIR collegato non trovato o non appartenente al tenant: ${command.firId}`
        )
      }
      // Il FIR deve essere collegabile: emesso (o con numero RENTRI) e non annullato.
      const collegabilita = collegabilitaFir(fir)
      if (!collegabilita.collegabile) {
        const etichetta = etichettaFir(fir)
        switch (collegabilita.motivo) {
          case 'BOZZA':
            return Result.fail(
              `Il FIR ${etichetta} è ancora in bozza: si registra nel registro solo dopo l'emissione. ` +
                `Se il trasporto è già avvenuto con un altro formulario, registra lo scarico senza collegare questo FIR.`
            )
          case 'ANNULLATO':
            return Result.fail(
              `Il FIR ${etichetta} è annullato: non si può collegare a un movimento del registro.`
            )
          case 'STATO_SCONOSCIUTO':
            return Result.fail(
              `Il FIR ${etichetta} ha uno stato non riconosciuto (${fir.status ?? 'assente'}): ` +
                `non si può collegare a un movimento; contattare l'assistenza.`
            )
          default: {
            // Un nuovo motivo in CollegabilitaFir deve avere qui il suo messaggio.
            const motivoNonGestito: never = collegabilita.motivo
            return Result.fail(`Motivo di non collegabilità non gestito: ${motivoNonGestito}`)
          }
        }
      }
    }

    // 2. Assegnazione numero progressivo (transazionale con SELECT FOR UPDATE)
    // Anno solare italiano (non quello del fuso del processo): il progressivo riparte
    // alle 00:00 italiane del 1° gennaio.
    const anno = annoSolareItaliano(command.registrationDate)

    // Registri dell'azienda pronti PRIMA della transazione: la creazione prende il suo lock in una
    // transazione propria e breve, mai annidato con quelli di numerazione e giacenza.
    try {
      await this.registri.preparaRegistri(command.tenantId, command.registroId)
    } catch (err) {
      if (err instanceof DomainError) return Result.fail(err.message)
      this.logger.error(`Preparazione dei registri non riuscita: ${err.message}`)
      return Result.fail(MSG_ERRORE_REGISTRAZIONE)
    }

    let movimento: MovimentoRegistrato
    try {
      movimento = await this.prisma.$transaction(
        async tx => {
          const inizioTransazione = Date.now()
          // Ricopia del FIR, per prima (ordine fisso dei lock: FIR, progressivo, giacenza):
          // un retry di uno scarico deve trovare il movimento già registrato prima del
          // controllo di giacenza, che altrimenti lo respingerebbe per la quantità che lui
          // stesso ha consumato. Senza registroId vale la ricopia esistente, ovunque sia: la si
          // cerca PRIMA di risolvere il registro (che potrebbe chiedere di indicarlo).
          // Il registro (sola lettura, nessun lock) si risolve prima solo se e' indicato.
          let registro: RegistroVista | undefined
          const risolviRegistro = () =>
            command.firId
              ? this.registri.risolviPerFir(tx, command.tenantId, command.registroId)
              : this.registri.risolvi(tx, command.tenantId, command.registroId)
          if (command.registroId || !command.firId) registro = await risolviRegistro()
          if (command.firId) {
            const esistente = await this.ricopiaEsistente(tx, command, cerCode, registro)
            if (esistente) {
              // Ritardo dalle date del movimento esistente, non da quelle del retry.
              return {
                ...this.movimentoDaRecord(
                  esistente,
                  this.ritardoGg(esistente),
                  esistente.causale === command.causale
                    ? validazione.causaleDescrizione
                    : esistente.causale
                ),
                avvisi: await this.avvisiDopoRicopia(tx, command.tenantId, esistente.id),
                giaRegistrato: true,
              }
            }
            registro ??= await risolviRegistro()
          }
          const registroMovimento = registro as RegistroVista

          // Lock per-registro/anno: serializza le numerazioni dello stesso registro in transazioni
          // concorrenti (vedi bloccaProgressivo).
          await bloccaProgressivo(tx, registroMovimento.id, anno)

          // Controllo di giacenza per SCARICO, sotto il lock della giacenza del CER e
          // dentro la transaction: due scarichi concorrenti (anche di anni diversi, quindi
          // con lock del progressivo diversi) non possono leggere la stessa giacenza.
          const avvisi =
            command.type === 'SCARICO'
              ? await this.verificaGiacenza(tx, command, cerCode, registroMovimento.id)
              : []

          // Causale propria dell'azienda: la versione scelta deve essere ancora valida alla data
          // dell'operazione, riletta con FOR KEY SHARE (dopo i lock del progressivo e della giacenza,
          // prima dell'insert): una modifica concorrente della causale attende o fa fallire con 409.
          if (validazione.causaleAziendaId !== null) {
            await confermaVersioneAzienda(
              tx,
              command.tenantId,
              validazione.causaleAziendaId,
              giornoItaliano(command.movementDate)
            )
          }

          // Progressivo e hash dell'annotazione precedente, letti sotto il lock del progressivo.
          const { progressivo: nextProgressivo, hashPrecedente } = await numeraAnnotazione(
            tx,
            registroMovimento.id,
            anno
          )

          // 3. Costruzione entità di dominio (con validazioni)
          const entity = WasteMovement.create({
            tenantId: command.tenantId,
            registroId: registroMovimento.id,
            progressiveNumber: nextProgressivo,
            progressiveYear: anno,
            type: command.type,
            movementDate: command.movementDate,
            registrationDate: command.registrationDate,
            causale: command.causale,
            cerCode: cerCode,
            wasteDescription: command.wasteDescription,
            quantity: command.quantity,
            unit: command.unit,
            wastePhysicalState: command.wastePhysicalState,
            wasteHazardClasses: command.wasteHazardClasses,
            operationCode: command.operationCode,
            counterpartName: command.counterpartName,
            counterpartAddress: command.counterpartAddress,
            firId: command.firId,
            recordedByUserId: command.userId,
            notes: command.notes,
            hashPrecedente,
          })

          const ritardoGg = entity.ritardoRegistrazioneGg

          // 4. Persistenza
          const record = await inserisciAnnotazione(tx, {
            tenantId: entity.tenantId,
            registroId: entity.registroId,
            progressiveNumber: entity.progressiveNumber,
            progressiveYear: entity.progressiveYear,
            type: entity.type,
            movementDate: entity.movementDate,
            registrationDate: entity.registrationDate,
            causale: entity.causale,
            causaleAziendaId: validazione.causaleAziendaId,
            cerCode: entity.cerCode,
            wasteDescription: entity.wasteDescription,
            quantity: entity.quantity,
            unit: entity.unit,
            wastePhysicalState: entity.wastePhysicalState,
            wasteHazardClasses: entity.wasteHazardClasses,
            operationCode: entity.operationCode,
            counterpartName: entity.counterpartName,
            counterpartAddress: entity.counterpartAddress,
            firId: entity.firId,
            // Solo i movimenti registrati da qui in poi: lo storico resta NULL, e
            // l'indice unico (tenant, fir_id_ricopia, type, ricopia_chiave) ignora i NULL.
            firIdRicopia: command.firId,
            ricopiaChiave: RICOPIA_ORDINARIA,
            recordedByUserId: entity.recordedByUserId,
            entryHash: entity.entryHash,
            notes: entity.notes,
          })

          // 4.6: proposta FIFO degli abbinamenti carico-scarico, nella stessa transazione (D10).
          // Decisione di Graziano del 31/10/2026: un errore qui NON annulla la registrazione. Il
          // matching gira dentro un SAVEPOINT: se fallisce (anche con un errore SQL che manderebbe in
          // abort la transazione) si torna al savepoint, lo scarico resta registrato e risulta
          // NON_ABBINATO, con avviso, audit e log. Si completa da Abbinamenti.
          if (command.type === 'SCARICO') {
            avvisi.push(
              ...(await this.abbinaSenzaFallire(tx, command, registroMovimento.id, {
                scaricoId: record.id,
                cerCode: record.cerCode,
                movimentoOriginaleId: record.movimentoOriginaleId ?? null,
              }))
            )
          }

          // 4.7: legame movimento-cliente-prezzo (fase 4.3), dopo l'abbinamento. Come l'abbinamento
          // gira in un SAVEPOINT: un errore qui NON annulla la registrazione (anti-obiettivo della
          // spec: mai bloccare il registro per un problema commerciale).
          const aggancio = await agganciaLegameSenzaFallire(tx, {
            tenantId: command.tenantId,
            userId: command.userId ?? null,
            registroId: registroMovimento.id,
            type: command.type,
            movimentoId: record.movimentoOriginaleId ?? record.id,
            fatturabile: validazione.fatturabile,
            causale: record.causale,
            causaleAziendaId: validazione.causaleAziendaId,
            cerCode: record.cerCode,
            movementDate: record.movementDate,
            unit: record.unit,
            quantity: new Prisma.Decimal(record.quantity).toFixed(),
            firId: record.firId ?? null,
            legame: command.legame,
            proposta: this.propostaLegami,
            trascorsoMs: Date.now() - inizioTransazione,
            logger: this.logger,
          })
          avvisi.push(...aggancio.avvisi)

          return {
            ...this.movimentoDaRecord(record, ritardoGg, validazione.causaleDescrizione),
            avvisi,
            ...(aggancio.fatturazione ? { fatturazione: aggancio.fatturazione } : {}),
            giaRegistrato: false,
          }
        },
        {
          // Timeout esplicito: con quello di default (5 s) le registrazioni in fila sul lock del
          // progressivo scadrebbero se il legame attende il suo tetto (mai bloccare il registro).
          timeout: TIMEOUT_TRANSAZIONE_REGISTRAZIONE_MS,
          maxWait: ATTESA_CONNESSIONE_REGISTRAZIONE_MS,
        }
      )
    } catch (err) {
      if (err instanceof GiacenzaInsufficienteError || err instanceof DomainError) {
        return Result.fail(err.message)
      }
      // Unica eccezione HTTP raggiungibile qui: il 409 CAUSALE_MODIFICATA di confermaVersioneAzienda.
      // Arriva al client intatta, con stato e corpo; qualunque altra HttpException inattesa segue
      // il percorso generico (log e Result.fail).
      if (err instanceof ConflictException) throw err
      const doppio = await this.messaggioRicopiaDoppia(err, command)
      if (doppio) return Result.fail(doppio)
      // Errore inatteso: il dettaglio resta nel log (senza dati personali), all'utente un testo generico.
      this.logger.error(`Errore registrazione movimento: ${err.message}`)
      return Result.fail(MSG_ERRORE_REGISTRAZIONE)
    }

    if (movimento.giaRegistrato) {
      this.logger.info(
        `Ricopia del FIR ${command.firId} già registrata nel movimento ` +
          `#${movimento.progressiveYear}/${movimento.progressiveNumber}: nessun nuovo movimento`
      )
      return Result.ok(movimento)
    }

    if (movimento.fuoriTermine) {
      this.logger.warn(
        `Movimento ${movimento.progressiveYear}/${movimento.progressiveNumber} ` +
          `registrato con ${movimento.ritardoGg} gg di ritardo sul termine di legge ` +
          `(${TERMINE_REGISTRAZIONE_PRODUTTORE_GG} gg) per tenant ${command.tenantId}`
      )
    }

    this.logger.info(
      `Movimento registrato: ${movimento.type} ` +
        `#${movimento.progressiveYear}/${movimento.progressiveNumber} ` +
        `CER ${movimento.cerCode} qty ${movimento.quantity} ${movimento.unit}`
    )

    return Result.ok(movimento)
  }

  /**
   * Primo lock dell'ordine fisso, poi le ricopie dello stesso FIR e tipo (lette per
   * `fir_id`, quindi anche quelle storiche, anche se doppie). Restituisce quella con gli
   * stessi dati del comando; se ce ne sono ma nessuna coincide, FirGiaRegistratoError
   * con la prima; null se il FIR non è ancora ricopiato.
   */
  private async ricopiaEsistente(
    tx: Prisma.TransactionClient,
    command: RegistraMovimentoCommand,
    cerCode: string,
    registro: RegistroVista | undefined
  ): Promise<WasteMovementRecord | null> {
    const { tenantId, firId, type } = command
    const chiaveFir = `fir-registro|${tenantId}|${firId}`
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${chiaveFir}))`

    const ricopie = await tx.wasteMovement.findMany({
      where: {
        tenantId,
        firId,
        type,
        ricopiaChiave: RICOPIA_ORDINARIA,
        tipoAnnotazione: 'ORDINARIA',
      },
      orderBy: { createdAt: 'asc' },
    })
    if (ricopie.length === 0) return null

    // D10: un FIR si ricopia una sola volta per azienda. Un retry che chiede esplicitamente un
    // registro diverso da quello della ricopia esistente non è un retry: si rifiuta.
    const altroRegistro = registro ? ricopie.find(r => r.registroId !== registro.id) : undefined
    if (command.registroId && altroRegistro) {
      throw new FirGiaRegistratoInAltroRegistroError(
        altroRegistro.progressiveNumber,
        altroRegistro.progressiveYear,
        await this.denominazioneSeVariRegistri(tx, tenantId, altroRegistro.registroId),
        await this.statoDopoRicopia(tx, tenantId, altroRegistro.id)
      )
    }

    const stessa = ricopie.find(r =>
      stessiDatiRicopia(r, {
        cerCode,
        quantity: command.quantity,
        unit: command.unit,
        movementDate: command.movementDate,
      })
    )
    if (!stessa) {
      throw new FirGiaRegistratoError(
        ricopie[0].progressiveNumber,
        ricopie[0].progressiveYear,
        await this.denominazioneSeVariRegistri(tx, tenantId, ricopie[0].registroId),
        await this.statoDopoRicopia(tx, tenantId, ricopie[0].id)
      )
    }
    return stessa
  }

  /**
   * Avviso per il retry identico di una ricopia la cui catena non e' piu' vigente: il movimento
   * restituito come "gia registrato" non e' quello che conta (rettificato: si indica quale; annullato:
   * il FIR non si ricopia piu).
   */
  /**
   * Abbinamento FIFO di uno scarico appena scritto, protetto da un SAVEPOINT. Restituisce gli
   * avvisi: quelli dell'abbinamento, oppure l'avviso di "non abbinato" se e' fallito.
   * Il log e l'audit non riportano dati personali ne' il messaggio dell'errore (che potrebbe
   * contenere valori), solo il tipo.
   */
  private async abbinaSenzaFallire(
    tx: Prisma.TransactionClient,
    command: RegistraMovimentoCommand,
    registroId: string,
    scarico: { scaricoId: string; cerCode: string; movimentoOriginaleId: string | null }
  ): Promise<string[]> {
    // Pre-controllo leggero: un registro ordinario (senza carichi R13/D15 ne' abbinamenti per quel
    // CER) non apre il SAVEPOINT e non paga round-trip in piu'. E' lo stesso controllo che
    // `abbinaNuovoScarico` fa all'ingresso: sui registri di stoccaggio si ripete, e' una lettura.
    if (!(await haStoccaggioOAbbinamenti(tx, command.tenantId, registroId, scarico.cerCode))) {
      return []
    }
    // Testo costante (nessun dato dell'utente): `$executeRawUnsafe` evita di contare come advisory lock.
    await tx.$executeRawUnsafe('SAVEPOINT abbinamento')
    try {
      const avvisi = await abbinaNuovoScarico(tx, {
        tenantId: command.tenantId,
        registroId,
        scaricoId: scarico.scaricoId,
        userId: command.userId ?? null,
        cerCode: scarico.cerCode,
        movimentoOriginaleId: scarico.movimentoOriginaleId,
      })
      await tx.$executeRawUnsafe('RELEASE SAVEPOINT abbinamento')
      return avvisi
    } catch (err) {
      await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT abbinamento')
      const tipo = err instanceof Error ? err.name : 'sconosciuto'
      const codice = codiceErroreSicuro(err)
      // Un errore "pulito": il messaggio dell'originale potrebbe riportare valori (dati personali).
      const sicuro = new Error(
        `Abbinamento FIFO non riuscito (${tipo}${codice ? ` ${codice}` : ''})`
      )
      this.logger.error(
        'Abbinamento FIFO dello scarico non riuscito: lo scarico resta registrato e non abbinato',
        sicuro,
        { tenantId: command.tenantId, registroId, tipoErrore: tipo, codice }
      )
      // Il segnale a Bugsink parte subito, prima del commit: se la transazione fallisce piu' avanti
      // (e la registrazione non resta) puo' risultare spurio.
      segnalaErroreJob('abbinamentoNuovoScarico', sicuro, { tenantId: command.tenantId })
      await tx.activityLog.create({
        data: {
          tenantId: command.tenantId,
          userId: command.userId ?? null,
          action: 'ABBINAMENTO_NON_RIUSCITO',
          description:
            'Abbinamento automatico dello scarico non riuscito: scarico registrato non abbinato',
          metadata: { tipoErrore: tipo, codice },
        },
      })
      return [AVVISO_ABBINAMENTO_NON_RIUSCITO]
    }
  }

  private async avvisiDopoRicopia(
    tx: Prisma.TransactionClient,
    tenantId: string,
    id: string
  ): Promise<string[]> {
    const testa = await tx.wasteMovement.findFirst({
      where: { tenantId, movimentoOriginaleId: id, correzioni: { none: {} } },
      select: { tipoAnnotazione: true, progressiveNumber: true, progressiveYear: true },
    })
    if (!testa) return []
    if (testa.tipoAnnotazione === 'ANNULLAMENTO') return [INDICAZIONE_FIR_ANNULLATO]
    return [
      `Questo movimento è stato poi rettificato con n. ${testa.progressiveNumber}/${testa.progressiveYear}: ` +
        'i dati vigenti sono quelli della rettifica.',
    ]
  }

  /**
   * Se la ricopia ordinaria `id` non e' piu' vigente, come e' finita: la testa della sua catena
   * dice se e' stata rettificata o annullata. Undefined se e' ancora vigente.
   */
  private async statoDopoRicopia(
    tx: Prisma.TransactionClient | PrismaService,
    tenantId: string,
    id: string
  ): Promise<'rettificato' | 'annullato' | undefined> {
    const testa = await tx.wasteMovement.findFirst({
      where: { tenantId, movimentoOriginaleId: id, correzioni: { none: {} } },
      select: { tipoAnnotazione: true },
    })
    if (!testa) return undefined
    return testa.tipoAnnotazione === 'ANNULLAMENTO' ? 'annullato' : 'rettificato'
  }

  /** Denominazione del registro, solo se l'azienda ne ha più di uno (altrimenti sarebbe rumore). */
  private async denominazioneSeVariRegistri(
    tx: Prisma.TransactionClient,
    tenantId: string,
    registroId: string
  ): Promise<string | undefined> {
    const registri = await tx.registroRifiuti.findMany({
      where: { tenantId },
      include: { unitaLocale: { select: { denominazione: true } } },
    })
    if (registri.length < 2) return undefined
    const r = registri.find(x => x.id === registroId)
    return r ? (r.unitaLocale?.denominazione ?? r.descrizione) : undefined
  }

  /**
   * Rete di sicurezza per l'indice unico (tenant, fir_id_ricopia, type, ricopia_chiave):
   * il lock del FIR rende il doppio raro, ma se arriva si risponde come per una ricopia con dati diversi.
   * Null se l'errore non è quella violazione.
   */
  private async messaggioRicopiaDoppia(
    err: unknown,
    command: RegistraMovimentoCommand
  ): Promise<string | null> {
    if (
      !command.firId ||
      !(err instanceof Prisma.PrismaClientKnownRequestError) ||
      err.code !== 'P2002' ||
      !/fir_?id_?ricopia/i.test(JSON.stringify(err.meta?.target ?? ''))
    ) {
      return null
    }
    let esistente: {
      id: string
      progressiveNumber: number
      progressiveYear: number
      registroId: string
    } | null
    let denominazione: string | undefined
    let poi: 'rettificato' | 'annullato' | undefined
    try {
      esistente = await this.prisma.wasteMovement.findFirst({
        where: {
          tenantId: command.tenantId,
          firIdRicopia: command.firId,
          type: command.type,
          ricopiaChiave: RICOPIA_ORDINARIA,
          tipoAnnotazione: 'ORDINARIA',
        },
        select: { id: true, progressiveNumber: true, progressiveYear: true, registroId: true },
      })
      if (esistente) {
        denominazione = await this.denominazioneSeVariRegistri(
          this.prisma,
          command.tenantId,
          esistente.registroId
        )
        poi = await this.statoDopoRicopia(this.prisma, command.tenantId, esistente.id)
      }
    } catch (lettura) {
      // Siamo già nella gestione di un errore: chi chiama risponde col messaggio generico.
      this.logger.error(`Lettura della ricopia doppia non riuscita: ${lettura?.message}`)
      return null
    }
    if (!esistente) return null
    return new FirGiaRegistratoError(
      esistente.progressiveNumber,
      esistente.progressiveYear,
      denominazione,
      poi
    ).message
  }

  /** Ritardo sul termine di legge calcolato dalle date di un movimento salvato. */
  private ritardoGg(record: WasteMovementRecord): number {
    const m = this.movimentoDaRecord(record, 0)
    return WasteMovement.reconstitute({
      ...m,
      type: record.type,
    }).ritardoRegistrazioneGg
  }

  private movimentoDaRecord(
    record: WasteMovementRecord,
    ritardoGg: number,
    causaleDescrizione?: string
  ): Omit<MovimentoRegistrato, 'avvisi' | 'giaRegistrato'> {
    return movimentoDaRecord(record, ritardoGg, causaleDescrizione)
  }

  /**
   * Controllo di giacenza di uno SCARICO, da chiamare dentro la transaction dopo il
   * lock del progressivo. Blocca (GiacenzaInsufficienteError) se il saldo complessivo
   * del CER non copre lo scarico; se lo copre ma non alla data dello scarico, restituisce
   * un avviso e lo scarico si registra. Le unità non di massa non si controllano.
   */
  private async verificaGiacenza(
    tx: Prisma.TransactionClient,
    command: RegistraMovimentoCommand,
    cerCode: string,
    registroId: string
  ): Promise<string[]> {
    const { tenantId } = command
    const u = normalizzaUnitaRegistro(command.unit)
    if (!u.massa || u.fattoreKg === null) {
      this.logger.warn('Scarico in unità non di massa: controllo di giacenza saltato', {
        tenantId,
        cerCode,
        unit: command.unit,
      })
      return []
    }

    // Terzo lock dell'ordine fisso (FIR, progressivo, giacenza): serializza gli scarichi
    // dello stesso CER dello stesso registro, con e senza asterisco, e le scritture delle giacenze
    // iniziali (stessa chiave, vedi chiaveLockGiacenza). Gli scarichi in unita' non di massa non
    // prendono il lock (si ritorna prima): corsa innocua perche' non si controllano.
    const chiaveGiacenza = chiaveLockGiacenza(registroId, cerCode)
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${chiaveGiacenza}))`

    const g = await giacenzaDisponibileAl(tx, {
      tenantId,
      registroId,
      cerCode,
      alla: command.movementDate,
    })
    const fattore = u.fattoreKg
    const richiestoKg = command.quantity * fattore

    // Fail-closed: senza un saldo leggibile lo scarico non si registra.
    if (!Number.isFinite(g?.saldoComplessivoKg) || !Number.isFinite(g?.disponibileAllaDataKg)) {
      this.logger.error('Giacenza non verificabile: valori non numerici', undefined, {
        tenantId,
        cerCode,
        giacenza: g,
      })
      throw new GiacenzaInsufficienteError(
        `Impossibile verificare la giacenza per CER ${cerCode}: riprovare; ` +
          `se il problema persiste, contattare l'assistenza.`
      )
    }

    const um = simboloUnita(u)
    if (g.saldoComplessivoKg + 1e-9 < richiestoKg) {
      const nonDiMassa = g.unitaNonDiMassaCaricate ?? []
      if (nonDiMassa.length > 0) {
        // Carichi in litri o m³ non si confrontano con i kg: bloccare su un saldo di zero
        // spingerebbe a registrare un secondo carico dello stesso rifiuto in un registro
        // immutabile. Si registra e si avvisa che la giacenza va verificata a mano.
        const avviso =
          `Il CER ${cerCode} ha carichi registrati in ${nonDiMassa.join(', ')} che non si ` +
          `possono confrontare con i kg: lo scarico è registrato, ma la giacenza va verificata ` +
          `a mano (i carichi in kg o tonnellate coprono ` +
          `${formattaQuantita(Math.max(0, g.saldoComplessivoKg) / fattore)} ${um}).`
        this.logger.warn('Scarico in kg registrato con carichi in unità non di massa', {
          tenantId,
          cerCode,
          unitaNonDiMassaCaricate: nonDiMassa,
        })
        return [avviso]
      }
      const dettaglio =
        g.saldoComplessivoKg >= 0
          ? `nel registro restano ${formattaQuantita(g.saldoComplessivoKg / fattore)} ${um}, ` +
            `richiesti ${formattaQuantita(command.quantity)} ${um}.`
          : `il registro risulta già sotto zero di ` +
            `${formattaQuantita(-g.saldoComplessivoKg / fattore)} ${um}, quindi nessuno ` +
            `scarico è registrabile finché non si registrano i carichi mancanti.`
      throw new GiacenzaInsufficienteError(
        `Giacenza insufficiente per CER ${cerCode}: ${dettaglio} ${RIMEDIO_CARICO_MANCANTE}`
      )
    }

    if (g.disponibileAllaDataKg + 1e-9 < richiestoKg) {
      // Confronto fra giorni (vincoloAl è la mezzanotte UTC del giorno), mai fra istanti.
      const limiteSuccessivo =
        g.vincoloAl.toISOString().slice(0, 10) > giornoItaliano(command.movementDate)
      const avviso =
        `Lo scarico è datato ${formattaDataItaliana(command.movementDate)}, ma a quella data ` +
        `il registro ha disponibili ` +
        `${formattaQuantita(Math.max(0, g.disponibileAllaDataKg) / fattore)} ${um}` +
        (limiteSuccessivo
          ? ` (il limite viene dal saldo del ${formattaDataItaliana(g.vincoloAl)})`
          : '') +
        `: il carico che lo copre è annotato con una data successiva. ` +
        `Lo scarico resta registrato con questa data.`
      this.logger.warn('Scarico registrato con un ordine di date incoerente', {
        tenantId,
        cerCode,
        movementDate: command.movementDate,
        avviso,
      })
      return [avviso]
    }

    return []
  }
}

const RIMEDIO_CARICO_MANCANTE =
  'Se il rifiuto era già in deposito prima di iniziare a usare il registro, inserisci la ' +
  'giacenza iniziale del registro (Registro → Giacenze iniziali); se è stato prodotto ora, ' +
  'usa Produzione interna.'

/** Scarico non registrabile per giacenza: il messaggio arriva all'utente così com'è. */
class GiacenzaInsufficienteError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'GiacenzaInsufficienteError'
  }
}
