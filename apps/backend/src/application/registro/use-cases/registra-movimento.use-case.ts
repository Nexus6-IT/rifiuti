import { Injectable } from '@nestjs/common'
import { Prisma, WasteMovement as WasteMovementRecord } from '@prisma/client'
import { PrismaService } from '../../../infrastructure/persistence/prisma.service'
import { LoggerService } from '../../../core/logger/logger.service'
import { Result } from '../../../core/application/result'
import { DomainError, FirGiaRegistratoError } from '../../../core/domain/errors'
import { RegistraMovimentoCommand } from '../commands/registra-movimento.command'
import {
  WasteMovement,
  CAUSALI_CARICO,
  CAUSALI_SCARICO,
  CausaleMovimento,
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
import { stessiDatiRicopia } from '../ricopia-fir'

export interface MovimentoRegistrato {
  id: string
  tenantId: string
  progressiveNumber: number
  progressiveYear: number
  type: string
  movementDate: Date
  registrationDate: Date
  causale: string
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
   * Vero se il FIR era già ricopiato con gli stessi dati: si restituisce il movimento
   * esistente e non se ne crea un secondo (retry idempotente).
   */
  giaRegistrato: boolean
}

/**
 * Use case per la registrazione di un movimento nel registro cronologico
 * di carico/scarico. Art. 190 D.Lgs 152/2006, DM 59/2023.
 *
 * Assegna automaticamente il numero progressivo per tenant/anno tramite
 * SELECT ... FOR UPDATE per evitare race condition in ambienti multi-worker.
 *
 * Calcola e persiste l'hash SHA-256 di vidimazione digitale (art. 4 DM 59/2023).
 *
 * Per uno SCARICO di massa verifica la giacenza del CER dentro la transaction, sotto
 * lock: blocca se il saldo complessivo (in kg) non copre lo scarico; se lo copre ma
 * non alla data dello scarico, lo registra e restituisce un avviso in `avvisi`.
 *
 * Un FIR si ricopia una sola volta per tipo di movimento: ripetere la stessa ricopia
 * restituisce il movimento esistente (`giaRegistrato: true`), una ricopia con dati
 * diversi è rifiutata (FirGiaRegistratoError).
 */
@Injectable()
export class RegistraMovimentoUseCase {
  constructor(
    private readonly prisma: PrismaService,
    private readonly logger: LoggerService
  ) {
    this.logger.setContext(RegistraMovimentoUseCase.name)
  }

  async execute(command: RegistraMovimentoCommand): Promise<Result<MovimentoRegistrato>> {
    // 0. Validazione causale anticipata (prima di qualunque operazione DB)
    if (command.type === 'CARICO') {
      if (!CAUSALI_CARICO.includes(command.causale as (typeof CAUSALI_CARICO)[number])) {
        return Result.fail(
          `Causale non valida per CARICO: ${command.causale}. Valori: ${CAUSALI_CARICO.join(', ')}`
        )
      }
    } else {
      if (!CAUSALI_SCARICO.includes(command.causale as (typeof CAUSALI_SCARICO)[number])) {
        return Result.fail(
          `Causale non valida per SCARICO: ${command.causale}. Valori: ${CAUSALI_SCARICO.join(', ')}`
        )
      }
    }

    // 0b. Validazione codice CER contro il catalogo ufficiale.
    // Normalizza al formato canonico "NN NN NN" (con "*" per i pericolosi) e
    // verifica che esista in catalogo: un CER inesistente non è registrabile.
    const cerCode = this.normalizeCerCode(command.cerCode)
    const cerEsiste = await this.cerCodeExists(cerCode)
    if (!cerEsiste) {
      return Result.fail(`Codice CER non valido: ${command.cerCode}`)
    }

    // 0c. Le date di operazione/registrazione non possono essere nel futuro.
    // Il confronto è fra giorni del calendario italiano: il frontend manda date senza ora
    // (AAAA-MM-GG), che il backend legge come mezzanotte UTC, cioè l'01:00 o le 02:00
    // italiane. Confrontando gli istanti, la data di oggi fra le 00:00 e quell'ora
    // risulterebbe nel futuro.
    const oggi = giornoItaliano(new Date())
    if (giornoItaliano(command.movementDate) > oggi) {
      return Result.fail(
        `La data dell'operazione non può essere nel futuro: ` +
          `${formattaDataItaliana(command.movementDate)}`
      )
    }
    if (giornoItaliano(command.registrationDate) > oggi) {
      return Result.fail(
        `La data di registrazione non può essere nel futuro: ` +
          `${formattaDataItaliana(command.registrationDate)}`
      )
    }

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
          default:
            return Result.fail(
              `Il FIR ${etichetta} ha uno stato non riconosciuto (${fir.status ?? 'assente'}): ` +
                `non si può collegare a un movimento; contattare l'assistenza.`
            )
        }
      }
    }

    // 2. Assegnazione numero progressivo (transazionale con SELECT FOR UPDATE)
    // Anno solare italiano (non quello del fuso del processo): il progressivo riparte
    // alle 00:00 italiane del 1° gennaio.
    const anno = annoSolareItaliano(command.registrationDate)

    let movimento: MovimentoRegistrato
    try {
      movimento = await this.prisma.$transaction(async tx => {
        // Ricopia del FIR, per prima (ordine fisso dei lock: FIR, progressivo, giacenza):
        // un retry di uno scarico deve trovare il movimento già registrato prima del
        // controllo di giacenza, che altrimenti lo respingerebbe per la quantità che lui
        // stesso ha consumato.
        if (command.firId) {
          const esistente = await this.ricopiaEsistente(tx, command, cerCode)
          if (esistente) {
            // Ritardo dalle date del movimento esistente, non da quelle del retry.
            return {
              ...this.movimentoDaRecord(esistente, this.ritardoGg(esistente)),
              avvisi: [],
              giaRegistrato: true,
            }
          }
        }

        // Advisory lock per-tenant/anno: serializza le numerazioni dello stesso
        // tenant in transazioni concorrenti senza usare FOR UPDATE su aggregati
        // (PostgreSQL 0A000: "FOR UPDATE is not allowed with aggregate functions").
        // pg_advisory_xact_lock è rilasciato automaticamente al commit/rollback.
        const lockKey = `${command.tenantId}-${anno}`
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${lockKey}))`

        // Controllo di giacenza per SCARICO, sotto il lock della giacenza del CER e
        // dentro la transaction: due scarichi concorrenti (anche di anni diversi, quindi
        // con lock del progressivo diversi) non possono leggere la stessa giacenza.
        const avvisi =
          command.type === 'SCARICO' ? await this.verificaGiacenza(tx, command, cerCode) : []

        const [row] = await tx.$queryRaw<Array<{ max_num: number | null }>>`
          SELECT MAX(progressive_number) AS max_num
          FROM waste_movements
          WHERE tenant_id = ${command.tenantId}::uuid
            AND progressive_year = ${anno}
        `
        const nextProgressivo = (row.max_num ?? 0) + 1

        // 3. Costruzione entità di dominio (con validazioni)
        const entity = WasteMovement.create({
          tenantId: command.tenantId,
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
        })

        const ritardoGg = entity.ritardoRegistrazioneGg

        // 4. Persistenza
        const record = await tx.wasteMovement.create({
          data: {
            tenantId: entity.tenantId,
            progressiveNumber: entity.progressiveNumber,
            progressiveYear: entity.progressiveYear,
            type: entity.type,
            movementDate: entity.movementDate,
            registrationDate: entity.registrationDate,
            causale: entity.causale,
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
            // l'indice unico (tenant, fir_id_ricopia, type) ignora i NULL.
            firIdRicopia: command.firId,
            recordedByUserId: entity.recordedByUserId,
            entryHash: entity.entryHash,
            notes: entity.notes,
          },
        })

        return { ...this.movimentoDaRecord(record, ritardoGg), avvisi, giaRegistrato: false }
      })
    } catch (err) {
      if (err instanceof GiacenzaInsufficienteError || err instanceof DomainError) {
        return Result.fail(err.message)
      }
      const doppio = await this.messaggioRicopiaDoppia(err, command)
      if (doppio) return Result.fail(doppio)
      this.logger.error(`Errore registrazione movimento: ${err.message}`)
      return Result.fail(`Errore durante la registrazione: ${err.message}`)
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
    cerCode: string
  ): Promise<WasteMovementRecord | null> {
    const { tenantId, firId, type } = command
    const chiaveFir = `fir-registro|${tenantId}|${firId}`
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${chiaveFir}))`

    const ricopie = await tx.wasteMovement.findMany({
      where: { tenantId, firId, type },
      orderBy: { createdAt: 'asc' },
    })
    if (ricopie.length === 0) return null

    const stessa = ricopie.find(r =>
      stessiDatiRicopia(r, {
        cerCode,
        quantity: command.quantity,
        unit: command.unit,
        movementDate: command.movementDate,
      })
    )
    if (!stessa) {
      throw new FirGiaRegistratoError(ricopie[0].progressiveNumber, ricopie[0].progressiveYear)
    }
    return stessa
  }

  /**
   * Rete di sicurezza per l'indice unico (tenant, fir_id_ricopia, type): il lock del FIR
   * rende il doppio raro, ma se arriva si risponde come per una ricopia con dati diversi.
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
    const esistente = await this.prisma.wasteMovement.findFirst({
      where: { tenantId: command.tenantId, firIdRicopia: command.firId, type: command.type },
      select: { progressiveNumber: true, progressiveYear: true },
    })
    if (!esistente) return null
    return new FirGiaRegistratoError(esistente.progressiveNumber, esistente.progressiveYear).message
  }

  /** Ritardo sul termine di legge calcolato dalle date di un movimento salvato. */
  private ritardoGg(record: WasteMovementRecord): number {
    const m = this.movimentoDaRecord(record, 0)
    return WasteMovement.reconstitute({
      ...m,
      type: record.type,
      causale: m.causale as CausaleMovimento,
    }).ritardoRegistrazioneGg
  }

  private movimentoDaRecord(
    record: WasteMovementRecord,
    ritardoGg: number
  ): Omit<MovimentoRegistrato, 'avvisi' | 'giaRegistrato'> {
    return {
      id: record.id,
      tenantId: record.tenantId,
      progressiveNumber: record.progressiveNumber,
      progressiveYear: record.progressiveYear,
      type: record.type,
      movementDate: record.movementDate,
      registrationDate: record.registrationDate,
      causale: record.causale,
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
   * Normalizza un codice CER al formato canonico del catalogo "NN NN NN"
   * (con "*" finale per i pericolosi). Accetta input senza spazi ("200301")
   * o con spaziatura irregolare; se il formato non è 6 cifre lascia invariato
   * (la validazione di esistenza fallirà con messaggio chiaro).
   */
  private normalizeCerCode(raw: string): string {
    if (!raw) return raw
    const trimmed = raw.trim().toUpperCase()
    const hazardous = trimmed.includes('*')
    const digits = trimmed.replace(/[^0-9]/g, '')
    if (digits.length !== 6) return trimmed
    const spaced = `${digits.slice(0, 2)} ${digits.slice(2, 4)} ${digits.slice(4, 6)}`
    return hazardous ? `${spaced}*` : spaced
  }

  /**
   * Verifica che il codice CER esista nel catalogo ufficiale. Il catalogo
   * memorizza i pericolosi con "*" finale: l'operatore potrebbe ometterlo,
   * quindi accetta il match sia con sia senza asterisco.
   */
  private async cerCodeExists(cerCode: string): Promise<boolean> {
    const withoutStar = cerCode.replace(/\*$/, '')
    const withStar = `${withoutStar}*`
    const count = await this.prisma.cERCode.count({
      where: { code: { in: [withoutStar, withStar] } },
    })
    return count > 0
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
    cerCode: string
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
    // dello stesso CER del tenant, con e senza asterisco. `cerCode` arriva già da
    // normalizeCerCode ("NN NN NN" per ogni formato di 6 cifre), quindi la chiave
    // individua lo stesso CER che giacenzaDisponibileAl confronta sulle sole cifre.
    const cerSenzaStella = cerCode.replace(/\*$/, '')
    const chiaveGiacenza = `giacenza|${tenantId}|${cerSenzaStella}`
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${chiaveGiacenza}))`

    const g = await giacenzaDisponibileAl(tx, { tenantId, cerCode, alla: command.movementDate })
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
  'Se il rifiuto era già in deposito prima di iniziare a usare il registro, registra il ' +
  'carico mancante con la causale Altro carico (non viene contato come prodotto nel MUD); ' +
  'se è stato prodotto ora, usa Produzione interna.'

/** Scarico non registrabile per giacenza: il messaggio arriva all'utente così com'è. */
class GiacenzaInsufficienteError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'GiacenzaInsufficienteError'
  }
}
