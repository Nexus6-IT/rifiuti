/**
 * Genera l'esportazione XML firmata del registro (eREGI E6, T1). NESSUNA scrittura verso RENTRI qui:
 * il file nasce sul database; la validazione e' un passo a parte e non puo' invalidare la generazione.
 *
 * Sequenza:
 * 1. guardie sul registro (collegato a RENTRI, non in chiusura ne' chiuso) e, se manca, download e
 *    salvataggio dell'eREGI (una volta sola: il suo digest e' il primo `Ref` di ogni esportazione);
 * 2. risoluzione del certificato dell'azienda PRIMA di ogni scrittura (senza certificato: errore, nessun file);
 * 3. in UNA transazione sotto advisory lock per registro: catena delle esportazioni, intervallo
 *    (dalla precedente + 1 fino all'ultima annotazione CONTIGUA e TRADUCIBILE, al piu'
 *    `ANNOTAZIONI_PER_ESPORTAZIONE`, di UN solo anno), lettura e traduzione (riuso di F2-9),
 *    costruzione e firma, salvataggio. Due richieste insieme: la seconda aspetta il lock e trova
 *    l'esportazione gia' fatta (idempotenza sul `progressivo_a`);
 * 4. a transazione chiusa, se richiesto e gli invii sono attivi, avvia la validazione verso RENTRI.
 *
 * Fail-closed: un'annotazione non traducibile ferma l'intervallo (e il pannello ne mostra il motivo),
 * un'anomalia della catena o della numerazione blocca tutto senza produrre un file. Una esportazione
 * rifiutata da RENTRI (in qualunque punto della catena) blocca le successive finche' una persona non decide (puo' avere un errore che
 * le successive ereditano nella catena).
 */
import { Inject, Injectable, Optional } from '@nestjs/common'
import type { Prisma } from '@prisma/client'
import { TenantContext } from '../../../core/context/tenant-context'
import { LoggerService } from '../../../core/logger/logger.service'
import { RegistroNonTrovatoError } from '../../registro/registri.service'
import { PrismaService } from '../../../infrastructure/persistence/prisma.service'
import { EregiNonValidoError, leggiEregi } from '../../../infrastructure/rentri/eregi/leggi-eregi'
import { RentriAnagraficheClient } from '../../../infrastructure/rentri/rentri-anagrafiche.client'
import { RentriCredentialResolver } from '../../../infrastructure/rentri/rentri-credential.resolver'
import {
  RegistroRentriChiusoError,
  RegistroNonCollegatoRentriError,
} from './errori-azioni-rentri-registro'
import {
  CatenaEsportazioniNonCoerenteError,
  EregiNonDisponibileError,
  EsportazioneRifiutataInCatenaError,
} from './errori-esportazioni-registro-rentri'
import { inviiRegistroAttivi } from './invii-registro-attivi'
import { LettoreAnnotazioniRentri } from './lettore-annotazioni-rentri'
import {
  traduciAnnotazione,
  type AnnotazionePerRentri,
  type EsitoTraduzione,
} from './mappa-registrazione-rentri'
import { comprimiXml, costruisciEsportazioneRegistro } from './costruisci-esportazione-registro'
import { ordinaCatena } from './ordina-catena-esportazioni'
import { TRADUTTORE_REGISTRAZIONE_RENTRI } from './trasmetti-lotto-registro.use-case'
import { ValidaEsportazioneRegistroRentriUseCase } from './valida-esportazione-registro-rentri.use-case'
import type { VoceRegistro } from './serializza-registro-xml'

type Tx = Prisma.TransactionClient

/**
 * Tetto di annotazioni per file: tiene il file ben sotto i 10 MB di RENTRI e la transazione breve.
 * Oltre, l'esportazione si ripete e prosegue dal numero successivo (la catena continua).
 */
export const ANNOTAZIONI_PER_ESPORTAZIONE = 1000

/** Token del tetto per file, iniettabile (solo per i test: in produzione vale `ANNOTAZIONI_PER_ESPORTAZIONE`). */
export const TETTO_ANNOTAZIONI_ESPORTAZIONE = 'TETTO_ANNOTAZIONI_ESPORTAZIONE'

const AUTORE_PREDEFINITO = 'WasteFlow'
const MOTIVO_NUMERO_MANCANTE =
  'Manca l’annotazione con questo numero nel registro: la numerazione non è continua.'

export interface SintesiEsportazione {
  id: string
  anno: number
  progressivoDa: number
  progressivoA: number
  numeroRegistrazioni: number
  dataCreazione: Date
  precedenteId: string | null
  firmato: boolean
  stato: string
  digestValue: string | null
  createdAt: Date
}

export interface FermataEsportazione {
  anno: number
  progressivo: number
  /** Motivi in italiano, senza dati fiscali ne' id (quelli di `traduciAnnotazione`). */
  motivi: string[]
}

export type EsitoGenerazioneEsportazione =
  | { esito: 'CREATA'; esportazione: SintesiEsportazione; fermataA: FermataEsportazione | null }
  | { esito: 'NIENTE_DA_ESPORTARE'; esportazione: SintesiEsportazione | null }
  | ({ esito: 'BLOCCATA' } & FermataEsportazione)

export interface OpzioniGenerazione {
  /** Utente che ha chiesto l'esportazione (`null` per un job). */
  creataDa: string | null
  /** Avvia la validazione verso RENTRI dopo la generazione (predefinito `true`). */
  valida?: boolean
}

const selezioneSintesi = {
  id: true,
  anno: true,
  progressivoDa: true,
  progressivoA: true,
  numeroRegistrazioni: true,
  dataCreazione: true,
  precedenteId: true,
  firmato: true,
  stato: true,
  digestValue: true,
  createdAt: true,
} as const

@Injectable()
export class GeneraEsportazioneRegistroRentriUseCase {
  constructor(
    private readonly prisma: PrismaService,
    private readonly lettore: LettoreAnnotazioniRentri,
    private readonly anagrafiche: RentriAnagraficheClient,
    private readonly credenziali: RentriCredentialResolver,
    private readonly validatore: ValidaEsportazioneRegistroRentriUseCase,
    private readonly logger: LoggerService,
    // Solo per i test: in produzione resta `traduciAnnotazione`.
    @Optional()
    @Inject(TRADUTTORE_REGISTRAZIONE_RENTRI)
    private readonly traduci: (a: AnnotazionePerRentri) => EsitoTraduzione = traduciAnnotazione,
    // Solo per i test: in produzione resta `ANNOTAZIONI_PER_ESPORTAZIONE`.
    @Optional()
    @Inject(TETTO_ANNOTAZIONI_ESPORTAZIONE)
    private readonly tetto: number = ANNOTAZIONI_PER_ESPORTAZIONE
  ) {
    this.logger.setContext('GeneraEsportazioneRegistroRentriUseCase')
  }

  private nelTenant<R>(
    tenantId: string,
    fn: (tx: Tx) => Promise<R>,
    opzioni?: { timeout: number; maxWait: number }
  ): Promise<R> {
    return TenantContext.run({ tenantId }, async () => await this.prisma.$transaction(fn, opzioni))
  }

  /**
   * @throws RegistroNonTrovatoError registro assente o di un'altra azienda
   * @throws RegistroNonCollegatoRentriError / RegistroRentriChiusoError 409
   * @throws EregiNonDisponibileError 502 l'eREGI di RENTRI non e' utilizzabile
   * @throws TenantSenzaCertificatoRentriError 422 l'azienda non ha un certificato RENTRI
   * @throws EsportazioneRifiutataInCatenaError / CatenaEsportazioniNonCoerenteError 409
   * @throws EsportazioneRegistroNonValidaError le annotazioni non producono un XML valido
   * @throws RentriApiError il download dell'eREGI e' stato rifiutato da RENTRI
   */
  async genera(
    tenantId: string,
    registroId: string,
    opzioni: OpzioniGenerazione
  ): Promise<EsitoGenerazioneEsportazione> {
    const stato = await this.nelTenant(tenantId, tx =>
      this.leggiStatoRegistro(tx, tenantId, registroId)
    )
    // Registro senza annotazioni: niente da esportare, nessuna chiamata a RENTRI.
    if (!(await this.haAnnotazioni(tenantId, registroId))) {
      return { esito: 'NIENTE_DA_ESPORTARE', esportazione: null }
    }
    if (stato.eregXml === null) {
      await this.scaricaEregi(tenantId, registroId, stato.identificativo)
    }
    // Certificato risolto PRIMA di ogni scrittura: senza, errore e nessun file.
    const materiale = await this.credenziali.resolve(tenantId)

    const esito = await this.nelTenant(
      tenantId,
      tx => this.generaInTransazione(tx, tenantId, registroId, opzioni, materiale),
      { timeout: 120_000, maxWait: 30_000 }
    )

    if (esito.esito === 'CREATA' && opzioni.valida !== false && inviiRegistroAttivi()) {
      try {
        await this.validatore.valida(tenantId, esito.esportazione.id)
      } catch (errore) {
        // La generazione e' riuscita e il file e' salvato: un guasto della validazione non la annulla.
        this.logger.warn('Validazione dell esportazione non avviata', {
          tipo: errore instanceof Error ? errore.name : 'sconosciuto',
        })
      }
    }
    return esito
  }

  private async haAnnotazioni(tenantId: string, registroId: string): Promise<boolean> {
    return this.nelTenant(
      tenantId,
      async tx =>
        (await tx.wasteMovement.findFirst({
          where: { tenantId, registroId },
          select: { id: true },
        })) !== null
    )
  }

  private async leggiStatoRegistro(tx: Tx, tenantId: string, registroId: string) {
    const registro = await tx.registroRifiuti.findFirst({
      where: { id: registroId, tenantId },
      select: {
        identificativoRentri: true,
        rentriChiusoIl: true,
        rentriChiusuraRichiestaIl: true,
        eregXml: true,
        eregDigest: true,
      },
    })
    if (!registro) {
      throw new RegistroNonTrovatoError()
    }
    if (registro.identificativoRentri === null) throw new RegistroNonCollegatoRentriError()
    if (registro.rentriChiusuraRichiestaIl !== null) {
      throw new RegistroRentriChiusoError(
        'La chiusura del registro su RENTRI è in corso: attendi che venga confermata o annullata.'
      )
    }
    return {
      identificativo: registro.identificativoRentri,
      eregXml: registro.eregXml,
      eregDigest: registro.eregDigest,
    }
  }

  /** Scarica l'eREGI, lo controlla (stesso registro) e lo salva se ancora assente. */
  private async scaricaEregi(
    tenantId: string,
    registroId: string,
    identificativo: string
  ): Promise<void> {
    const { xml } = await this.anagrafiche.scaricaVidimazioneXml(identificativo, tenantId)
    let dati
    try {
      dati = leggiEregi(xml)
    } catch (e) {
      if (e instanceof EregiNonValidoError) throw new EregiNonDisponibileError('forma inattesa')
      throw e
    }
    if (dati.identificativo !== identificativo) {
      throw new EregiNonDisponibileError('appartiene a un altro registro')
    }
    const adesso = new Date()
    const richiesta = new Date(dati.dataRichiesta)
    if (Number.isNaN(richiesta.getTime())) throw new EregiNonDisponibileError('data non leggibile')
    // `eregXml: null` nel where: due download insieme non si sovrascrivono (il primo vince).
    await this.nelTenant(tenantId, tx =>
      tx.registroRifiuti.updateMany({
        where: { id: registroId, tenantId, eregXml: null },
        data: {
          eregXml: xml,
          eregDigest: dati.digest,
          eregDataRichiesta: richiesta,
          eregScaricatoIl: adesso,
        },
      })
    )
  }

  private async generaInTransazione(
    tx: Tx,
    tenantId: string,
    registroId: string,
    opzioni: OpzioniGenerazione,
    materiale: { certificatePem: string; privateKeyPem: string }
  ): Promise<EsitoGenerazioneEsportazione> {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'rentri-esportazione|' + registroId}))`

    // Ricontrollo sotto lock: la chiusura puo' essere stata prenotata nel frattempo.
    const registro = await this.leggiStatoRegistro(tx, tenantId, registroId)
    if (registro.eregXml === null) {
      throw new EregiNonDisponibileError('non ancora scaricato')
    }

    // Catena VIVA: le esportazioni sostituite (`SOSTITUITA`) restano per audit ma non ne fanno parte.
    const salvate = await tx.esportazioneRegistroRentri.findMany({
      where: { tenantId, registroId, stato: { not: 'SOSTITUITA' } },
      select: selezioneSintesi,
    })
    const catena = ordinaCatena(salvate)
    const ultima = catena.length > 0 ? catena[catena.length - 1] : null
    // Un anello rifiutato in QUALUNQUE posizione (anche tardivo, con la successiva gia' generata): la
    // catena continuerebbe a citarlo.
    if (catena.some(e => e.stato === 'RIFIUTATA')) throw new EsportazioneRifiutataInCatenaError()
    if (catena.some(e => !e.firmato || e.digestValue === null)) {
      throw new CatenaEsportazioniNonCoerenteError('contiene un anello non firmato')
    }

    // Cursore: anno e primo progressivo ancora da esportare.
    const cursore = await this.trovaCursore(tx, tenantId, registroId, ultima)
    if (cursore === null) {
      return {
        esito: 'NIENTE_DA_ESPORTARE',
        esportazione: ultima ? this.sintesi(ultima) : null,
      }
    }
    await this.controllaCompletezza(tx, tenantId, registroId, cursore, catena)

    // Run contiguo di annotazioni dal cursore.
    const candidate = await tx.wasteMovement.findMany({
      where: {
        tenantId,
        registroId,
        progressiveYear: cursore.anno,
        progressiveNumber: {
          gte: cursore.progressivo,
          lt: cursore.progressivo + this.tetto,
        },
      },
      orderBy: { progressiveNumber: 'asc' },
      select: {
        id: true,
        progressiveNumber: true,
        createdAt: true,
        recordedByUser: { select: { firstName: true, lastName: true } },
      },
    })
    const contigue: typeof candidate = []
    for (const c of candidate) {
      if (c.progressiveNumber !== cursore.progressivo + contigue.length) break
      contigue.push(c)
    }
    // Un numero mancante nella finestra letta (esiste un numero piu' alto ma non il successivo).
    const buco: FermataEsportazione | null =
      candidate.length > contigue.length
        ? {
            anno: cursore.anno,
            progressivo: cursore.progressivo + contigue.length,
            motivi: [MOTIVO_NUMERO_MANCANTE],
          }
        : null
    if (contigue.length === 0) return { esito: 'BLOCCATA', ...(buco as FermataEsportazione) }

    const annotazioni = await this.lettore.leggi(
      tx,
      tenantId,
      registroId,
      contigue.map(c => c.id)
    )
    const voci: VoceRegistro[] = []
    let fermata: FermataEsportazione | null = null
    for (let i = 0; i < annotazioni.length; i++) {
      const t = this.traduci(annotazioni[i])
      if (!t.ok) {
        fermata = { anno: cursore.anno, progressivo: cursore.progressivo + i, motivi: t.motivi }
        break
      }
      const origine = contigue[i]
      const nome = origine.recordedByUser
        ? `${origine.recordedByUser.firstName} ${origine.recordedByUser.lastName}`.trim()
        : ''
      voci.push({
        corpo: t.corpo,
        autore: nome || AUTORE_PREDEFINITO,
        identificativoTemporale: origine.createdAt.toISOString(),
      })
    }
    if (voci.length === 0 && fermata) return { esito: 'BLOCCATA', ...fermata }
    // Una fermata per annotazione non traducibile precede sempre il buco di numerazione (viene prima).
    fermata = fermata ?? buco
    // Se il tetto per file ha troncato l'intervallo non c'e' fermata: il giro successivo prosegue dal numero che segue.

    // La data di creazione cresce sempre lungo la catena (millisecondo di margine sull'ultima).
    let dataCreazione = new Date()
    if (ultima && dataCreazione.getTime() <= ultima.dataCreazione.getTime()) {
      dataCreazione = new Date(ultima.dataCreazione.getTime() + 1)
    }

    const costruita = await costruisciEsportazioneRegistro({
      eregXml: registro.eregXml,
      precedenti: catena.map(e => ({
        digestValue: e.digestValue as string,
        dataCreazione: e.dataCreazione,
      })),
      anno: cursore.anno,
      progressivoDa: cursore.progressivo,
      voci,
      dataCreazione,
      materiale,
    })

    const creata = await tx.esportazioneRegistroRentri.create({
      data: {
        tenantId,
        registroId,
        anno: cursore.anno,
        progressivoDa: cursore.progressivo,
        progressivoA: costruita.progressivoA,
        numeroRegistrazioni: costruita.numeroRegistrazioni,
        dataCreazione,
        precedenteId: ultima?.id ?? null,
        digestValue: costruita.digestValue,
        sha256File: costruita.sha256File,
        xml: comprimiXml(costruita.xml),
        firmato: true,
        certificatoSha256: costruita.certificatoSha256,
        creataDa: opzioni.creataDa,
      },
      select: selezioneSintesi,
    })
    this.logger.info('Esportazione del registro generata', {
      registrazioni: costruita.numeroRegistrazioni,
      anno: cursore.anno,
    })
    return { esito: 'CREATA', esportazione: this.sintesi(creata), fermataA: fermata }
  }

  /**
   * Primo (anno, progressivo) non ancora esportato, o `null` se il registro e' tutto esportato.
   * Senza esportazioni: il primo numero dell'anno piu' vecchio. Con esportazioni: il successivo
   * della precedente se esiste, altrimenti il primo numero dell'anno seguente che ha annotazioni.
   */
  private async trovaCursore(
    tx: Tx,
    tenantId: string,
    registroId: string,
    ultima: { anno: number; progressivoA: number } | null
  ): Promise<{ anno: number; progressivo: number } | null> {
    if (ultima) {
      const stessoAnno = await tx.wasteMovement.findFirst({
        where: {
          tenantId,
          registroId,
          progressiveYear: ultima.anno,
          progressiveNumber: { gt: ultima.progressivoA },
        },
        select: { id: true },
      })
      if (stessoAnno) return { anno: ultima.anno, progressivo: ultima.progressivoA + 1 }
    }
    const primoAnno = await tx.wasteMovement.aggregate({
      where: {
        tenantId,
        registroId,
        ...(ultima ? { progressiveYear: { gt: ultima.anno } } : {}),
      },
      _min: { progressiveYear: true },
    })
    const anno = primoAnno._min.progressiveYear
    if (anno === null) return null
    const primoNumero = await tx.wasteMovement.aggregate({
      where: { tenantId, registroId, progressiveYear: anno },
      _min: { progressiveNumber: true },
    })
    const progressivo = primoNumero._min.progressiveNumber
    return progressivo === null ? null : { anno, progressivo }
  }

  /**
   * Tutte le annotazioni PRIMA del cursore devono essere state esportate: il loro numero deve
   * coincidere con la somma delle registrazioni delle esportazioni salvate. Una differenza (un
   * numero rimasto indietro, una riga manomessa) e' un'anomalia della catena: nessun file.
   */
  private async controllaCompletezza(
    tx: Tx,
    tenantId: string,
    registroId: string,
    cursore: { anno: number; progressivo: number },
    catena: Array<{ numeroRegistrazioni: number }>
  ): Promise<void> {
    const prima = await tx.wasteMovement.count({
      where: {
        tenantId,
        registroId,
        OR: [
          { progressiveYear: { lt: cursore.anno } },
          { progressiveYear: cursore.anno, progressiveNumber: { lt: cursore.progressivo } },
        ],
      },
    })
    const esportate = catena.reduce((somma, e) => somma + e.numeroRegistrazioni, 0)
    if (prima !== esportate) {
      throw new CatenaEsportazioniNonCoerenteError(
        'ci sono annotazioni precedenti non incluse in nessuna esportazione'
      )
    }
  }

  private sintesi(e: SintesiEsportazione): SintesiEsportazione {
    return {
      id: e.id,
      anno: e.anno,
      progressivoDa: e.progressivoDa,
      progressivoA: e.progressivoA,
      numeroRegistrazioni: e.numeroRegistrazioni,
      dataCreazione: e.dataCreazione,
      precedenteId: e.precedenteId,
      firmato: e.firmato,
      stato: e.stato,
      digestValue: e.digestValue,
      createdAt: e.createdAt,
    }
  }
}
