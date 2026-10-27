import {
  BadRequestException,
  ConflictException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common'
import { Prisma, WasteMovement as WasteMovementRecord } from '@prisma/client'
import { PrismaService } from '../../../infrastructure/persistence/prisma.service'
import { LoggerService } from '../../../core/logger/logger.service'
import { annoSolareItaliano, giornoItaliano } from '../../../core/time/anno-italiano'
import { formattaQuantita } from '../../../core/format/formatta-quantita'
import { cerSoloCifre } from '../../../domain/waste-movement/cer-registro'
import { etichettaFir } from '../../../domain/fir/stati-fir'
import {
  WasteMovement,
  WasteMovementType,
  hashAnnotazioneV2,
} from '../../../domain/waste-movement/waste-movement.entity'
import { chiaveLockGiacenza } from '../chiave-lock-giacenza'
import { saldiRegistroCer, SaldiRegistroCer } from '../giacenza-disponibile'
import {
  bloccaProgressivo,
  inserisciAnnotazione,
  numeraAnnotazione,
} from '../numerazione-annotazione'
import { validaDatiMovimento } from '../valida-dati-movimento'
import {
  caricaCatalogoCausali,
  confermaVersioneAzienda,
} from '../causali/catalogo-causali.repository'
import { MovimentoRegistrato, movimentoDaRecord } from './registra-movimento.use-case'

type TipoCorrezione = 'RETTIFICA' | 'ANNULLAMENTO'

/** Dati completi nuovi di una rettifica (R4): tipo e registro restano quelli dell'originale. */
export interface DatiRettifica {
  movementDate: Date
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
  notes?: string
}

interface InputCorrezione {
  tenantId: string
  userId: string
  /** Annotazione da correggere (deve essere la testa vigente della sua catena). */
  movimentoId: string
  motivo: string
  /** Conferma di chi sa che la correzione tocca anni gia presentati al MUD (R10). */
  confermaAnnoPresentato?: boolean
}

export interface RettificaMovimentoInput extends InputCorrezione {
  dati: DatiRettifica
}

export type AnnullaMovimentoInput = InputCorrezione

export interface MovimentoCorretto extends Omit<MovimentoRegistrato, 'avvisi' | 'giaRegistrato'> {
  tipoAnnotazione: string
  movimentoRettificatoId: string | undefined
  movimentoOriginaleId: string | undefined
  motivoAnnotazione: string | undefined
}

export interface EsitoCorrezione {
  movimento: MovimentoCorretto
  avvisi: string[]
}

/** Dati che la nuova annotazione porta (rettifica: quelli nuovi; annullamento: copia alla lettera). */
interface DatiAnnotazione {
  type: WasteMovementType
  causale: string
  /** Versione della causale aziendale (null per le causali di sistema). */
  causaleAziendaId: string | null
  /** Descrizione per la risposta (assente: vale il codice). */
  causaleDescrizione?: string
  cerCode: string
  wasteDescription: string | null
  quantity: Prisma.Decimal | number
  unit: string
  wastePhysicalState: string | null
  wasteHazardClasses: string | null
  operationCode: string | null
  counterpartName: string | null
  counterpartAddress: string | null
  movementDate: Date
  notes: string | null
}

/** Soglia di tolleranza sui saldi in kg (arrotondati al grammo). */
const EPS_KG = 0.0005
const MOTIVO_MASSIMO = 500
/**
 * Prisma 5 mette in `meta.target` i nomi delle COLONNE (`['movimento_rettificato_id']`), non quello del
 * vincolo: si riconosce dalla colonna, come per la ricopia del FIR.
 */
const COLONNA_GIA_CORRETTA = /movimento_?rettificato_?id/i

/**
 * Rettifica e annullamento di un'annotazione del registro (Fase 2 pezzo 3): mai UPDATE ne' DELETE,
 * ma una NUOVA annotazione con numero proprio, collegata al predecessore (`movimentoRettificatoId`)
 * e alla radice della catena (`movimentoOriginaleId`). Si corregge solo la testa vigente.
 *
 * Una sola transazione; ordine dei lock fisso come la registrazione: progressivo
 * `<registro>-<anno corrente>`, poi giacenza di ogni CER toccato in ordine lessicografico della
 * chiave. Sotto lock si rilegge l'originale e se ne verifica la vigenza.
 *
 * Gli errori sono eccezioni Nest (R14), come `GiacenzeInizialiService`.
 */
@Injectable()
export class CorreggiMovimentoUseCase {
  constructor(
    private readonly prisma: PrismaService,
    private readonly logger: LoggerService
  ) {
    this.logger.setContext(CorreggiMovimentoUseCase.name)
  }

  rettifica(input: RettificaMovimentoInput): Promise<EsitoCorrezione> {
    return this.correggi('RETTIFICA', input, input.dati)
  }

  annulla(input: AnnullaMovimentoInput): Promise<EsitoCorrezione> {
    return this.correggi('ANNULLAMENTO', input)
  }

  private async correggi(
    tipo: TipoCorrezione,
    input: InputCorrezione,
    datiRettifica?: DatiRettifica
  ): Promise<EsitoCorrezione> {
    const motivo = (input.motivo ?? '').trim()
    if (motivo.length < 1 || motivo.length > MOTIVO_MASSIMO) {
      throw new BadRequestException(`Il motivo è obbligatorio (da 1 a ${MOTIVO_MASSIMO} caratteri)`)
    }
    const { tenantId, movimentoId } = input

    let esito: EsitoCorrezione
    let versioneCausale: string | null = null
    try {
      esito = await this.prisma.$transaction(async tx => {
        // 1. Lettura per id + azienda: un id di un'altra azienda e' un 404 (mai un 403).
        const letto = await tx.wasteMovement.findFirst({ where: { id: movimentoId, tenantId } })
        if (!letto) throw new NotFoundException('Movimento non trovato')

        // 2. Dati della nuova annotazione. La rettifica li valida come la registrazione ordinaria;
        // l'annullamento copia alla lettera (devono poter annullare anche righe storiche con CER
        // non normalizzato o fuori catalogo).
        const dati = await this.datiNuovi(tx, tipo, letto, datiRettifica)

        // 3. Lock: progressivo dell'anno corrente, poi giacenza dei CER toccati (R7).
        const adesso = new Date()
        const anno = annoSolareItaliano(adesso)
        await bloccaProgressivo(tx, letto.registroId, anno)
        const cerToccati = cerDaControllare(letto.cerCode, dati.cerCode)
        const chiavi = [
          ...new Set(cerToccati.map(cer => chiaveLockGiacenza(letto.registroId, cer))),
        ].sort()
        for (const chiave of chiavi) {
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${chiave}))`
        }

        // 4. Rilettura sotto lock e vigenza: una correzione concorrente ha gia fatto il suo corso.
        const originale = await tx.wasteMovement.findFirst({ where: { id: movimentoId, tenantId } })
        if (!originale) throw new NotFoundException('Movimento non trovato')
        const gia = await tx.wasteMovement.count({
          where: { tenantId, movimentoRettificatoId: originale.id },
        })
        if (originale.tipoAnnotazione === 'ANNULLAMENTO' || gia > 0) {
          throw new ConflictException(
            `Il movimento n. ${numeroDi(originale)} non è più vigente: è già stato rettificato o ` +
              'annullato. La correzione si applica alla registrazione vigente.'
          )
        }
        const radice = await this.radiceDellaCatena(tx, tenantId, originale)

        // 5. MUD gia presentato (R10). Una corsa con la presentazione (lock `mud-report|tenant|anno`
        // non preso) e' accettata: il file presentato non si tocca comunque.
        const avvisi: string[] = []
        const avvisoMud = await this.controllaMudPresentato(
          tx,
          tenantId,
          originale.movementDate,
          dati.movementDate,
          input.confermaAnnoPresentato === true
        )
        if (avvisoMud) avvisi.push(avvisoMud)

        // 6. Saldi PRIMA (R6), per ogni CER toccato.
        const prima = await this.saldi(tx, tenantId, originale.registroId, cerToccati)

        // 6b. Rettifica con causale propria dell'azienda: la versione risolta alla nuova data deve
        // essere ancora valida (riletta con FOR KEY SHARE dopo i lock, prima dell'insert; C8).
        // L'annullamento copia la coppia (causale, versione) della testa e non la conferma (C9).
        if (tipo === 'RETTIFICA' && dati.causaleAziendaId !== null) {
          await confermaVersioneAzienda(
            tx,
            tenantId,
            dati.causaleAziendaId,
            giornoItaliano(dati.movementDate)
          )
        }

        // 7. Numerazione e hash v2 concatenato.
        const { progressivo, hashPrecedente } = await numeraAnnotazione(
          tx,
          originale.registroId,
          anno
        )
        const entryHash = this.calcolaHash(tipo, {
          hashPrecedente,
          originale,
          dati,
          anno,
          progressivo,
          adesso,
          userId: input.userId,
        })

        // 8. Insert. La radice e' quella del predecessore: coincide con lui alla prima correzione.
        const record = await inserisciAnnotazione(tx, {
          tenantId,
          registroId: originale.registroId,
          progressiveNumber: progressivo,
          progressiveYear: anno,
          type: originale.type,
          movementDate: dati.movementDate,
          registrationDate: adesso,
          causale: dati.causale,
          causaleAziendaId: dati.causaleAziendaId,
          cerCode: dati.cerCode,
          wasteDescription: dati.wasteDescription,
          quantity: dati.quantity,
          unit: dati.unit,
          wastePhysicalState: dati.wastePhysicalState,
          wasteHazardClasses: dati.wasteHazardClasses,
          operationCode: dati.operationCode,
          counterpartName: dati.counterpartName,
          counterpartAddress: dati.counterpartAddress,
          firId: originale.firId,
          // La correzione non e' la ricopia: l'indice unico della ricopia non la vede.
          firIdRicopia: null,
          ricopiaChiave: '',
          recordedByUserId: input.userId,
          entryHash,
          notes: dati.notes,
          tipoAnnotazione: tipo,
          movimentoRettificatoId: originale.id,
          movimentoOriginaleId: radice.id,
          motivoAnnotazione: motivo,
        })

        // 9. Saldi DOPO: blocco (rollback) o avvisi.
        const dopo = await this.saldi(tx, tenantId, originale.registroId, cerToccati)
        avvisi.push(...valutaSaldi(tipo, prima, dopo))

        // 10. Per l'annullamento di una ricopia di FIR: il FIR non si potra piu ricopiare.
        if (tipo === 'ANNULLAMENTO' && radice.firIdRicopia) {
          avvisi.push(await this.avvisoFirNonRicopiabile(tx, tenantId, radice.firIdRicopia))
        }

        // 11. Audit nella stessa transazione (R12).
        await tx.activityLog.create({
          data: {
            tenantId,
            userId: input.userId,
            action:
              tipo === 'RETTIFICA'
                ? 'REGISTRO_MOVIMENTO_RETTIFICATO'
                : 'REGISTRO_MOVIMENTO_ANNULLATO',
            description:
              `Movimento n. ${numeroDi(originale)} ` +
              `${tipo === 'RETTIFICA' ? 'rettificato' : 'annullato'} dal n. ${numeroDi(record)}: ${motivo}`,
            metadata: {
              predecessoreId: originale.id,
              predecessoreNumero: numeroDi(originale),
              radiceId: radice.id,
              radiceNumero: numeroDi(radice),
              correzioneId: record.id,
              correzioneNumero: numeroDi(record),
              registroId: record.registroId,
              motivo,
            },
          },
        })

        versioneCausale = record.causaleAziendaId
        return { movimento: vistaCorrezione(record, dati.causaleDescrizione), avvisi }
      })
    } catch (err) {
      throw await this.traduciErrore(err, tenantId, movimentoId)
    }

    if (tipo === 'ANNULLAMENTO') {
      esito.movimento.causaleDescrizione = await this.descrizioneCausale(
        tenantId,
        esito.movimento,
        versioneCausale
      )
    }

    this.logger.info(
      `Movimento ${tipo === 'RETTIFICA' ? 'rettificato' : 'annullato'}: ` +
        `#${esito.movimento.progressiveYear}/${esito.movimento.progressiveNumber}`
    )
    return esito
  }

  /**
   * Descrizione della causale per la risposta dell'annullamento (C9, M8): il catalogo si legge dopo
   * il commit, perche' il risultato dell'annullamento non ne dipende. Fuori catalogo, o se la
   * lettura fallisce, vale il codice.
   */
  private async descrizioneCausale(
    tenantId: string,
    m: Pick<MovimentoCorretto, 'type' | 'causale' | 'movementDate'>,
    versioneId: string | null
  ): Promise<string> {
    try {
      const catalogo = await caricaCatalogoCausali(this.prisma, tenantId)
      const verso = m.type === 'CARICO' ? 'CARICO' : 'SCARICO'
      return catalogo.descrizione(verso, m.causale, giornoItaliano(m.movementDate), versioneId)
    } catch {
      return m.causale
    }
  }

  /** Dati della nuova annotazione, e per la rettifica le validazioni della registrazione ordinaria. */
  private async datiNuovi(
    tx: Prisma.TransactionClient,
    tipo: TipoCorrezione,
    originale: WasteMovementRecord,
    r: DatiRettifica | undefined
  ): Promise<DatiAnnotazione> {
    if (tipo === 'ANNULLAMENTO' || !r) {
      return {
        type: originale.type,
        causale: originale.causale,
        causaleAziendaId: originale.causaleAziendaId,
        cerCode: originale.cerCode,
        wasteDescription: originale.wasteDescription,
        quantity: originale.quantity,
        unit: originale.unit,
        wastePhysicalState: originale.wastePhysicalState,
        wasteHazardClasses: originale.wasteHazardClasses,
        operationCode: originale.operationCode,
        counterpartName: originale.counterpartName,
        counterpartAddress: originale.counterpartAddress,
        movementDate: originale.movementDate,
        notes: originale.notes,
      }
    }
    const validazione = await validaDatiMovimento(tx, {
      tenantId: originale.tenantId,
      type: originale.type,
      causale: r.causale,
      cerCode: r.cerCode,
      movementDate: r.movementDate,
      // La rettifica e' annotata ora: la sua data di registrazione e' l'istante corrente.
      registrationDate: new Date(),
      // La causale della testa: se non cambia si risolve per data, anche se nel frattempo e' stata
      // disattivata (la correzione della sola quantita' deve riuscire).
      causaleAttuale: { codice: originale.causale, versioneId: originale.causaleAziendaId },
    })
    if (validazione.errore !== undefined) throw new BadRequestException(validazione.errore)
    // Validazioni dell'entita' (quantita > 0, registrazione non prima dell'operazione): prima dei lock
    // e del controllo MUD, cosi chi ha un MUD presentato non conferma per poi ricevere un 400.
    try {
      WasteMovement.create({
        tenantId: originale.tenantId,
        registroId: originale.registroId,
        progressiveNumber: 0,
        progressiveYear: annoSolareItaliano(new Date()),
        type: originale.type,
        movementDate: r.movementDate,
        registrationDate: new Date(),
        causale: r.causale,
        cerCode: validazione.cerCode,
        quantity: Number(r.quantity),
        unit: r.unit,
        hashPrecedente: '',
      })
    } catch (err) {
      throw new BadRequestException((err as Error).message)
    }
    return {
      type: originale.type,
      causale: r.causale,
      causaleAziendaId: validazione.causaleAziendaId,
      causaleDescrizione: validazione.causaleDescrizione,
      cerCode: validazione.cerCode,
      wasteDescription: r.wasteDescription ?? null,
      quantity: r.quantity,
      unit: r.unit,
      wastePhysicalState: r.wastePhysicalState ?? null,
      wasteHazardClasses: r.wasteHazardClasses ?? null,
      operationCode: r.operationCode ?? null,
      counterpartName: r.counterpartName ?? null,
      counterpartAddress: r.counterpartAddress ?? null,
      movementDate: r.movementDate,
      notes: r.notes ?? null,
    }
  }

  /**
   * Radice della catena: la `ORDINARIA` da cui parte. Per una `ORDINARIA` e' lei stessa; per una
   * correzione e' `movimentoOriginaleId`, che il database non obbliga a essere una ordinaria e che
   * qui si verifica: una catena incoerente e' un errore interno, mai una correzione sulla radice sbagliata.
   */
  private async radiceDellaCatena(
    tx: Prisma.TransactionClient,
    tenantId: string,
    originale: WasteMovementRecord
  ): Promise<WasteMovementRecord> {
    if (originale.tipoAnnotazione === 'ORDINARIA') return originale
    const radice = originale.movimentoOriginaleId
      ? await tx.wasteMovement.findFirst({
          where: { id: originale.movimentoOriginaleId, tenantId },
        })
      : null
    if (!radice || radice.tipoAnnotazione !== 'ORDINARIA') {
      this.logger.error(
        'Catena di correzioni incoerente: radice assente o non ordinaria',
        undefined,
        {
          movimentoId: originale.id,
        }
      )
      throw new InternalServerErrorException(
        'La catena delle correzioni di questo movimento non è coerente: contattare l’assistenza.'
      )
    }
    return radice
  }

  private async saldi(
    tx: Prisma.TransactionClient,
    tenantId: string,
    registroId: string,
    cer: string[]
  ): Promise<Map<string, SaldiRegistroCer>> {
    const m = new Map<string, SaldiRegistroCer>()
    for (const cerCode of cer) {
      m.set(cerSoloCifre(cerCode), await saldiRegistroCer(tx, { tenantId, registroId, cerCode }))
    }
    return m
  }

  /**
   * R10: ogni anno >= min(anno della data della testa, anno della data nuova) con un MUD
   * `SUBMITTED` o `ARCHIVED` (la correzione cambia anche i saldi al 31/12 degli anni successivi).
   * Senza conferma e' un 409; con la conferma torna l'avviso.
   */
  private async controllaMudPresentato(
    tx: Prisma.TransactionClient,
    tenantId: string,
    dataTesta: Date,
    dataNuova: Date,
    confermato: boolean
  ): Promise<string | undefined> {
    const daAnno = Math.min(annoSolareItaliano(dataTesta), annoSolareItaliano(dataNuova))
    const presentati = await tx.mUDReport.findMany({
      where: { tenantId, year: { gte: daAnno }, status: { in: ['SUBMITTED', 'ARCHIVED'] } },
      select: { year: true },
      orderBy: { year: 'asc' },
    })
    if (presentati.length === 0) return undefined
    const anni = elencoAnni(presentati.map(p => p.year))
    if (!confermato) {
      throw new ConflictException({
        error: 'REGISTRO_ANNO_MUD_PRESENTATO',
        message:
          `Il MUD ${anni} risulta già presentato: la correzione cambia i dati di quegli anni ` +
          'ma non il file già presentato. Conferma per procedere.',
      })
    }
    return (
      `Il MUD ${anni} risulta già presentato: la correzione cambia i dati di quegli anni ` +
      'ma non il file già presentato, che non è stato modificato.'
    )
  }

  private calcolaHash(
    tipo: TipoCorrezione,
    p: {
      hashPrecedente: string
      originale: WasteMovementRecord
      dati: DatiAnnotazione
      anno: number
      progressivo: number
      adesso: Date
      userId: string
    }
  ): string {
    const comuni = {
      hashPrecedente: p.hashPrecedente,
      registroId: p.originale.registroId,
      anno: p.anno,
      numero: p.progressivo,
      tipoAnnotazione: tipo,
      movimentoRettificatoId: p.originale.id,
    }
    if (tipo === 'ANNULLAMENTO') {
      // Copia alla lettera: nessuna entita' di dominio (le sue validazioni respingerebbero
      // le righe storiche), solo l'hash.
      return hashAnnotazioneV2({
        ...comuni,
        type: p.dati.type,
        cerCode: p.dati.cerCode,
        quantita: p.dati.quantity,
        unit: p.dati.unit,
        movementDate: p.dati.movementDate,
        causale: p.dati.causale,
      })
    }
    try {
      return WasteMovement.create({
        tenantId: p.originale.tenantId,
        registroId: p.originale.registroId,
        progressiveNumber: p.progressivo,
        progressiveYear: p.anno,
        type: p.dati.type,
        movementDate: p.dati.movementDate,
        registrationDate: p.adesso,
        causale: p.dati.causale,
        cerCode: p.dati.cerCode,
        quantity: Number(p.dati.quantity),
        unit: p.dati.unit,
        hashPrecedente: p.hashPrecedente,
        tipoAnnotazione: tipo,
        movimentoRettificatoId: p.originale.id,
      }).entryHash
    } catch (err) {
      // Quantita' non positiva, data di registrazione prima dell'operazione, causale incoerente.
      throw new BadRequestException((err as Error).message)
    }
  }

  private async avvisoFirNonRicopiabile(
    tx: Prisma.TransactionClient,
    tenantId: string,
    firId: string
  ): Promise<string> {
    const fir = await tx.fIR.findFirst({
      where: { id: firId, tenantId },
      select: { id: true, firNumber: true, rentriNumeroFir: true },
    })
    const numero = fir ? etichettaFir(fir) : 'collegato'
    return (
      `Questa registrazione veniva dalla ricopia del FIR ${numero}: dopo l'annullamento il FIR non ` +
      `si può ricopiare di nuovo nel registro. Se il movimento va registrato, registralo a mano.`
    )
  }

  private async traduciErrore(
    err: unknown,
    tenantId: string,
    movimentoId: string
  ): Promise<unknown> {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      // Con questo driver `meta.target` puo' essere null (verificato su Postgres reale): se il
      // target non c'e' si controlla direttamente se il movimento ha ormai una correzione.
      const conTarget = COLONNA_GIA_CORRETTA.test(JSON.stringify(err.meta?.target ?? ''))
      const giaCorretto =
        conTarget ||
        (await this.prisma.wasteMovement
          .count({ where: { tenantId, movimentoRettificatoId: movimentoId } })
          .catch(() => 0)) > 0
      if (giaCorretto) {
        return new ConflictException(
          'Il movimento è già stato rettificato o annullato: la correzione si applica alla ' +
            'registrazione vigente.'
        )
      }
      // Sul progressivo non deve accadere: la numerazione e' sotto lock.
      this.logger.error(`Violazione di unicità inattesa nella correzione: ${err.message}`)
      return new InternalServerErrorException('Errore durante la correzione del movimento')
    }
    if (
      err instanceof BadRequestException ||
      err instanceof ConflictException ||
      err instanceof NotFoundException ||
      err instanceof InternalServerErrorException
    ) {
      return err
    }
    this.logger.error(`Errore nella correzione del movimento: ${(err as Error)?.message}`)
    return err
  }
}

/** CER da controllare: quello dell'originale e, se cambia (sulle sole cifre), il nuovo. */
function cerDaControllare(originale: string, nuovo: string): string[] {
  return cerSoloCifre(originale) === cerSoloCifre(nuovo) ? [originale] : [originale, nuovo]
}

const numeroDi = (r: Pick<WasteMovementRecord, 'progressiveNumber' | 'progressiveYear'>) =>
  `${r.progressiveNumber}/${r.progressiveYear}`

/** Cifre del CER nella forma canonica "NN NN NN". */
function cerLeggibile(cifre: string): string {
  return `${cifre.slice(0, 2)} ${cifre.slice(2, 4)} ${cifre.slice(4, 6)}`
}

function elencoAnni(anni: number[]): string {
  if (anni.length <= 1) return anni.join('')
  return `${anni.slice(0, -1).join(', ')} e ${anni[anni.length - 1]}`
}

/**
 * R6: confronto fra saldi prima e dopo l'insert, per ogni CER toccato.
 * - blocco (409) se il saldo complessivo dopo e' negativo e peggiora, salvo carichi (o aperture)
 *   in unita non di massa: allora avviso, come per lo scarico;
 * - avviso se il saldo minimo giornaliero peggiora sotto zero (ordine delle date incoerente).
 * Limite dichiarato: con uno storico gia negativo il confronto sul minimo globale puo lasciar
 * passare senza avviso un peggioramento in un altro giorno.
 */
function valutaSaldi(
  tipo: TipoCorrezione,
  prima: Map<string, SaldiRegistroCer>,
  dopo: Map<string, SaldiRegistroCer>
): string[] {
  const avvisi: string[] = []
  const cosa = tipo === 'RETTIFICA' ? 'La rettifica' : "L'annullamento"
  for (const [cifre, d] of dopo) {
    const p = prima.get(cifre) as SaldiRegistroCer
    const peggiora =
      d.saldoComplessivoKg < -EPS_KG && d.saldoComplessivoKg < p.saldoComplessivoKg - EPS_KG
    if (peggiora) {
      if (d.unitaNonDiMassaCaricate.length > 0) {
        avvisi.push(
          `Il CER ${cerLeggibile(cifre)} ha carichi registrati in ${d.unitaNonDiMassaCaricate.join(', ')} che ` +
            `non si possono confrontare con i kg: la correzione è registrata, ma la ` +
            'giacenza va verificata a mano.'
        )
        continue
      }
      throw new ConflictException(
        `${cosa} lascerebbe il CER ${cerLeggibile(cifre)} con una giacenza negativa di ` +
          `${formattaQuantita(-d.saldoComplessivoKg)} kg: i carichi che restano non coprono gli ` +
          'scarichi già registrati. Correggi prima gli scarichi collegati.'
      )
    }
    if (
      d.saldoMinimoGiornalieroKg < -EPS_KG &&
      d.saldoMinimoGiornalieroKg < p.saldoMinimoGiornalieroKg - EPS_KG
    ) {
      avvisi.push(
        `La correzione è registrata, ma per il CER ${cerLeggibile(cifre)} il registro risulta sotto zero ` +
          `(${formattaQuantita(d.saldoMinimoGiornalieroKg)} kg) in almeno un giorno: ` +
          'un carico che copre gli scarichi ha una data successiva. Verifica le date.'
      )
    }
  }
  return avvisi
}

function vistaCorrezione(
  record: WasteMovementRecord,
  causaleDescrizione?: string
): MovimentoCorretto {
  return {
    ...movimentoDaRecord(record, 0, causaleDescrizione),
    tipoAnnotazione: record.tipoAnnotazione,
    movimentoRettificatoId: record.movimentoRettificatoId ?? undefined,
    movimentoOriginaleId: record.movimentoOriginaleId ?? undefined,
    motivoAnnotazione: record.motivoAnnotazione ?? undefined,
  }
}
