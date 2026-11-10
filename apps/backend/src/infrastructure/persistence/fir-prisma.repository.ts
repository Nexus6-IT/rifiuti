/**
 * FIR Prisma Repository - Infrastructure Layer
 * Implementazione concreta del repository FIR con Prisma ORM
 */

import { ABBONAMENTO_OPERATIVO_DEL_GRUPPO } from '../../application/billing/contratto-gruppo.service'
import { Injectable, Logger } from '@nestjs/common'
import { createHash } from 'crypto'
import { Prisma } from '@prisma/client'
import {
  FIRStatus as PrismaFIRStatus,
  RENTRISyncStatus as PrismaRENTRISyncStatus,
  RentriOrigineLegame as PrismaRentriOrigineLegame,
  RentriStatoFormulario as PrismaRentriStatoFormulario,
} from '@prisma/client'
import {
  FIR,
  FIRStato,
  FirmaDigitale,
  FirmeDigitali,
  RentriOrigineLegame,
  StatoFormulario,
  ProvenienzaRifiuto,
  TipoTratta,
} from '../../domain/fir/aggregates/fir.aggregate'
import {
  IFIRRepository,
  FIRSearchFilters,
  OpzioniSalvataggioFir,
} from '../../domain/fir/repositories/fir-repository.interface'
import {
  IFIRModificaBozzaRepository,
  AuditModificaBozza,
} from '../../domain/fir/repositories/fir-modifica-bozza.port'
import { UnitaMisura } from '../../domain/fir/value-objects/quantita'
import { RENTRISyncStatus } from '../../domain/fir/rentri-sync-status.vo'
import {
  FirAnnullatoNelFrattempoError,
  FirModificatoNelFrattempoError,
  FirNonTrovatoError,
  FirNonModificabileError,
  FormularioGiaAgganciatoError,
  FirmaSenzaUtenteError,
  FirNonPiuInBozzaError,
} from '../../core/domain/errors'
import { formattaNumeroFir } from '../../domain/fir/numero-fir'
import {
  STATI_FIR_EMESSI,
  STATI_FIR_IN_BOZZA,
  STATO_RENTRI_ANNULLATO,
} from '../../domain/fir/stati-fir'
import { PrismaService } from './prisma.service'
import { PrismaSistemaService } from './prisma-sistema.service'
import { escludiPiattaforma } from '../../core/context/azienda-piattaforma'

@Injectable()
export class FIRPrismaRepository implements IFIRRepository, IFIRModificaBozzaRepository {
  private static readonly logger = new Logger(FIRPrismaRepository.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly sistema: PrismaSistemaService
  ) {}

  // Ruoli usati dalle firme del CICLO DI VITA (questo repository), in italiano
  // e volutamente distinti dai ruoli inglesi ('PRODUCER'/'CARRIER'/'RECEIVER')
  // usati dal sottosistema crittografico (SignatureFIRRepository / QES): le due
  // famiglie di firme condividono la tabella `fir_signatures` ma NON devono
  // collidere sullo stesso (firId, role), altrimenti il controllo di idempotenza
  // dell'altro repository salterebbe la firma qualificata reale.
  private static readonly RUOLO_PRODUTTORE = 'PRODUTTORE'
  private static readonly RUOLO_TRASPORTATORE = 'TRASPORTATORE'
  private static readonly RUOLO_DESTINATARIO = 'DESTINATARIO'

  // Metodo dichiarato per le firme "applicative" del ciclo di vita: NON è una
  // firma digitale qualificata a norma (nessun valore legale probatorio) — è
  // solo un'attestazione firmatario+certificato inserita a mano dall'operatore.
  // Valore volutamente diverso da 'ECDSA-SHA256'/'RSA-SHA256' (quelli sono
  // riservati alle firme crittografiche reali del sottosistema QES).
  private static readonly LIFECYCLE_SIGNATURE_METHOD = 'APPLICATIVA-NON-QUALIFICATA'

  // Carica sempre i trasportatori aggiuntivi (tratte intermodali) ordinati, così
  // che lo snapshot del FIR sia completo ovunque venga ricostruito l'aggregate.
  // Include anche `signatures`: senza questa relazione le firme del ciclo di
  // vita (_firme) tornerebbero sempre vuote al reload, anche se scritte
  // correttamente da `save` (era esattamente il difetto — vedi persistSignatures).
  // Cast ad any: la relazione è disponibile dopo `prisma generate` sullo schema
  // aggiornato (modello FIRTransporter/FIRSignature).
  private static readonly FIR_INCLUDE: any = {
    transportersAggiuntivi: { orderBy: { ordine: 'asc' } },
    signatures: { orderBy: { signedAt: 'asc' } },
  }

  // Mappatura stato dominio (italiano) <-> enum Prisma `FIRStatus` (inglese).
  // Il dominio resta in italiano; la persistenza usa l'enum del DB. Senza questa
  // mappatura Prisma rifiuta il valore (es. "BOZZA" non e' un FIRStatus valido).
  private static readonly STATO_TO_DB: Record<FIRStato, PrismaFIRStatus> = {
    [FIRStato.BOZZA]: PrismaFIRStatus.DRAFT,
    [FIRStato.EMESSO]: PrismaFIRStatus.AWAITING_CARRIER,
    [FIRStato.IN_TRANSITO]: PrismaFIRStatus.AWAITING_RECEIVER,
    [FIRStato.CONSEGNATO]: PrismaFIRStatus.COMPLETED,
    [FIRStato.ANNULLATO]: PrismaFIRStatus.CANCELLED,
  }

  private static readonly DB_TO_STATO: Record<string, FIRStato> = {
    [PrismaFIRStatus.DRAFT]: FIRStato.BOZZA,
    [PrismaFIRStatus.AWAITING_PRODUCER]: FIRStato.BOZZA,
    [PrismaFIRStatus.AWAITING_CARRIER]: FIRStato.EMESSO,
    [PrismaFIRStatus.AWAITING_RECEIVER]: FIRStato.IN_TRANSITO,
    [PrismaFIRStatus.COMPLETED]: FIRStato.CONSEGNATO,
    [PrismaFIRStatus.SYNCED_TO_RENTRI]: FIRStato.CONSEGNATO,
    [PrismaFIRStatus.CANCELLED]: FIRStato.ANNULLATO,
  }

  private statoToDb(stato: FIRStato): PrismaFIRStatus {
    return FIRPrismaRepository.STATO_TO_DB[stato] ?? PrismaFIRStatus.DRAFT
  }

  private statoFromDb(status: string): FIRStato {
    return FIRPrismaRepository.DB_TO_STATO[status] ?? FIRStato.BOZZA
  }

  async findById(id: string): Promise<FIR | null> {
    // Usa il client RLS-aware: con TenantContext attivo l'estensione inietta il
    // `tenantId` reale (findFirst), evitando di restituire FIR di altri tenant
    // tramite un id noto. Senza contesto (job di sistema) è un no-op = by-id.
    const record = await this.prisma.db.fIR.findFirst({
      where: { id },
      include: FIRPrismaRepository.FIR_INCLUDE,
    })

    if (!record) return null

    return this.toDomain(record)
  }

  async findByIdPublic(id: string): Promise<FIR | null> {
    // Sistema: rotta pubblica senza contesto, l'azienda del FIR si conosce solo dopo la lettura
    // (l'id del FIR e' la capability: si restituisce solo cio' che l'endpoint gia' espone).
    const record = await this.sistema.fIR.findUnique({
      where: { id },
      include: FIRPrismaRepository.FIR_INCLUDE,
    })

    if (!record) return null

    return this.toDomain(record)
  }

  async findByNumeroProgressivo(numeroProgressivo: string): Promise<FIR | null> {
    // firNumber è unico solo con tenantId: la ricerca per solo numero resta
    // best-effort finché l'aggregate FIR non porta un tenantId reale (vedi nota
    // in fondo al file).
    const record = await this.prisma.fIR.findFirst({
      where: { firNumber: numeroProgressivo },
      include: FIRPrismaRepository.FIR_INCLUDE,
    })

    if (!record) return null

    return this.toDomain(record)
  }

  async findByTenant(tenantId: string, filters?: FIRSearchFilters): Promise<FIR[]> {
    const where: any = {
      tenantId: tenantId,
    }

    if (filters?.stato) {
      where.status = this.statoToDb(filters.stato as FIRStato)
    }

    if (filters?.cerCode) {
      where.cerCode = filters.cerCode
    }

    if (filters?.dataFrom || filters?.dataTo) {
      where.createdAt = {}
      if (filters.dataFrom) where.createdAt.gte = filters.dataFrom
      if (filters.dataTo) where.createdAt.lte = filters.dataTo
    }

    const records = await this.prisma.fIR.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: FIRPrismaRepository.FIR_INCLUDE,
    })

    return records.map((r: any) => this.toDomain(r))
  }

  async findByIds(ids: string[], tenantId: string): Promise<FIR[]> {
    if (ids.length === 0) return []

    const records = await this.prisma.fIR.findMany({
      where: { id: { in: ids }, tenantId },
      include: FIRPrismaRepository.FIR_INCLUDE,
    })

    return records.map((r: any) => this.toDomain(r))
  }

  /**
   * Prenota la trasmissione RENTRI di un FIR con un solo UPDATE condizionato: la
   * condizione sta nel WHERE, quindi due processi concorrenti non possono vincere
   * entrambi (il secondo UPDATE rilegge la riga dopo il commit del primo e non la
   * trova più prenotabile). Prenotabile: non legato, non annullato (né in locale né
   * all'ente) e in PENDING/FAILED, oppure in SYNCING ma fermo da prima di
   * `sogliaStallo` (o senza data di avvio). Restituisce true se ha vinto.
   */
  async prenotaTrasmissioneRentri(
    firId: string,
    tenantId: string,
    ora: Date,
    sogliaStallo: Date,
    // Solo per i test di concorrenza: permette di tenere la prenotazione dentro una
    // transaction aperta. In produzione si usa il client del repository.
    client: Prisma.TransactionClient = this.prisma
  ): Promise<boolean> {
    if (!(ora.getTime() > sogliaStallo.getTime())) {
      // Con la soglia nel futuro rispetto a "ora" ogni SYNCING risulterebbe scaduto,
      // compresa una prenotazione appena fatta da un altro processo.
      throw new Error('prenotaTrasmissioneRentri: ora deve essere successiva a sogliaStallo')
    }
    const righe = await client.$executeRaw`
      UPDATE firs
      SET rentri_sync_status = 'SYNCING'::rentri_sync_status,
          rentri_sync_avviato_at = ${ora}
      WHERE id = ${firId}::uuid
        AND tenant_id = ${tenantId}::uuid
        AND rentri_numero_fir IS NULL
        AND status <> 'CANCELLED'::fir_status
        AND rentri_stato_formulario::text IS DISTINCT FROM ${STATO_RENTRI_ANNULLATO}
        AND (
          rentri_sync_status IN ('PENDING'::rentri_sync_status, 'FAILED'::rentri_sync_status)
          OR (
            rentri_sync_status = 'SYNCING'::rentri_sync_status
            AND (rentri_sync_avviato_at IS NULL OR rentri_sync_avviato_at < ${sogliaStallo})
          )
        )`
    return righe > 0
  }

  /**
   * Scrive subito la transazione accettata dall'ente (fuori dal ciclo di save
   * dell'aggregate): se il processo muore prima di leggerne l'esito, il recupero la
   * trova. Solo su un FIR ancora in SYNCING, cioè prenotato da chi sta scrivendo.
   */
  async registraTransazioneInAttesa(
    firId: string,
    tenantId: string,
    transazioneId: string,
    avviatoAt: Date
  ): Promise<boolean> {
    // `avviatoAt` è il testimone del tentativo: se nel frattempo la prenotazione è
    // passata a un altro processo (soglia scaduta e riprenotata), la scrittura non
    // deve sovrascrivere la sua transazione e chi chiama lo viene a sapere.
    const righe = await this.prisma.$executeRaw`
      UPDATE firs
      SET rentri_transazione_in_attesa = ${transazioneId},
          rentri_transazione_id = ${transazioneId}
      WHERE id = ${firId}::uuid
        AND tenant_id = ${tenantId}::uuid
        AND rentri_sync_status = 'SYNCING'::rentri_sync_status
        AND rentri_sync_avviato_at = ${avviatoAt}`
    return righe > 0
  }

  /**
   * FIR da riprendere, su tutti i tenant: serve al job di sistema di recupero, per
   * questo non filtra per tenant. Sono:
   * - SYNCING oltre la soglia di stallo (o senza data di avvio);
   * - PENDING emessi, mai avviati (`rentri_sync_avviato_at` nullo), non legati, non
   *   annullati, di aziende in AUTOMATICA o IBRIDA e fermi da oltre la soglia: un FIR
   *   riaperto a PENDING mentre Redis era giu' resterebbe senza job per sempre, ma solo se
   *   aggiornati dopo `pendingAggiornatiDopo` (tetto di eta').
   * I SYNCING vengono per primi: un PENDING che fallisce sempre prima della prenotazione
   *   non deve affamare il recupero degli stalli. Fra i PENDING vengono prima quelli
   *   aggiornati piu' di recente (es. riaperti dal caricamento del certificato), poi i vecchi.
   *   Le aziende in MANUALE non si toccano: li' la trasmissione parte solo a mano.
   * `tenantAmmessi` (aziende col modulo `rentri`, scelte dal job) filtra DENTRO la query, prima del
   *   LIMIT, in entrambi i rami: i FIR di aziende senza modulo non occupano il lotto (niente
   *   starvation). Elenco vuoto = nessun FIR.
   */
  async elencaTrasmissioniRentriSospese(
    sogliaStallo: Date,
    limite: number,
    pendingAggiornatiDopo: Date,
    tenantAmmessi: readonly string[]
  ): Promise<Array<{ firId: string; tenantId: string; stato: 'SYNCING' | 'PENDING' }>> {
    // Sistema: elenco delle aziende con trasmissione automatica (nessuna azienda nota in partenza).
    // La lettura di `tenants` passa da escludiPiattaforma; il join non si scrive in SQL grezzo.
    const aziende = await this.sistema.tenant.findMany({
      where: escludiPiattaforma({
        rentriModalitaLegame: { in: ['AUTOMATICA', 'IBRIDA'] },
        // Come gli altri job RENTRI: solo aziende con abbonamento attivo o in prova, secondo il
        // contratto della radice del gruppo (non la colonna propria della figlia)
        OR: ABBONAMENTO_OPERATIVO_DEL_GRUPPO,
      }),
      select: { id: true },
    })
    const idAziende = aziende.map(a => a.id)

    // Sistema: elenco dei FIR di tutte le aziende per il job di recupero
    const righe = await this.sistema.$queryRaw<
      Array<{ fir_id: string; tenant_id: string; stato: 'SYNCING' | 'PENDING' }>
    >`
      SELECT id::text AS fir_id, tenant_id::text AS tenant_id, rentri_sync_status::text AS stato
      FROM firs
      WHERE tenant_id::text = ANY(${[...tenantAmmessi]}::text[])
        AND ((
          rentri_sync_status = 'SYNCING'::rentri_sync_status
          AND (rentri_sync_avviato_at IS NULL OR rentri_sync_avviato_at < ${sogliaStallo})
        )
        OR (
          rentri_sync_status = 'PENDING'::rentri_sync_status
          AND rentri_sync_avviato_at IS NULL
          AND (updated_at AT TIME ZONE 'UTC') < ${sogliaStallo}
          AND (updated_at AT TIME ZONE 'UTC') > ${pendingAggiornatiDopo}
          AND rentri_numero_fir IS NULL
          AND status = ANY(${[...STATI_FIR_EMESSI]}::text[]::fir_status[])
          AND rentri_stato_formulario::text IS DISTINCT FROM ${STATO_RENTRI_ANNULLATO}
          AND tenant_id::text = ANY(${idAziende}::text[])
        ))
      ORDER BY (rentri_sync_status = 'SYNCING'::rentri_sync_status) DESC,
        CASE WHEN rentri_sync_status = 'SYNCING'::rentri_sync_status
          THEN rentri_sync_avviato_at END NULLS FIRST,
        CASE WHEN rentri_sync_status = 'PENDING'::rentri_sync_status
          THEN updated_at END DESC,
        id
      LIMIT ${limite}`
    return righe.map(r => ({ firId: r.fir_id, tenantId: r.tenant_id, stato: r.stato }))
  }

  async findByRentriNumeroFir(tenantId: string, numeroFir: string): Promise<FIR | null> {
    const record = await this.prisma.fIR.findFirst({
      where: { tenantId, rentriNumeroFir: numeroFir },
      include: FIRPrismaRepository.FIR_INCLUDE,
    })
    return record ? this.toDomain(record) : null
  }

  /**
   * Stato del FIR e firme si scrivono nella stessa transaction: o entrambi o
   * nessuno. Prima l'upsert e le firme erano due scritture separate, e una
   * firma rifiutata dal database lasciava il FIR già avanzato di stato (con il
   * numero assegnato) ma senza firma.
   */
  async save(fir: FIR, opzioni?: OpzioniSalvataggioFir): Promise<void> {
    const nuovaVersione = await this.prisma.$transaction(tx => this.salvaCon(tx, fir, opzioni))
    // L'aggregate si allinea solo a commit avvenuto: una transaction annullata non deve lasciarlo avanti.
    fir.registraVersioneSalvata(nuovaVersione)
  }

  /**
   * Upsert del FIR e firme sullo stesso client (transazionale): usato da `save`
   * e dai chiamanti che devono aggiungere altre scritture alla stessa transaction.
   */
  private async salvaCon(
    client: Prisma.TransactionClient,
    fir: FIR,
    opzioni?: OpzioniSalvataggioFir
  ): Promise<number> {
    // Il controllo sulle firme precede ogni scrittura: un FIR con una firma
    // senza utente non deve nemmeno arrivare all'upsert.
    this.verificaFirmeScrivibili(fir)

    const data = this.toPersistence(fir)
    // Le relazioni obbligatorie (tenant, producerUser) vanno fornite a Prisma in
    // forma `connect`, non come FK scalari: l'upsert con write annidati usa
    // l'input "checked" che richiede la relazione (altrimenti: "Argument
    // `tenant` is missing"). Si estraggono quindi gli scalari e si collega.
    const { tenantId, producerUserId, ...scalars } = data
    const riga = await this.conservaAnnullamentoEnte(client, fir.id, tenantId, scalars)
    // Lock ottimistico: la riga e' bloccata dalla SELECT, quindi il confronto precede ogni scrittura.
    if (riga && opzioni?.verificaVersione && riga.versione !== fir.versione) {
      throw new FirModificatoNelFrattempoError(fir.id)
    }
    // Un FIR gia letto (versione >= 1) la cui riga e sparita non si ricrea con l'upsert.
    if (!riga && opzioni?.verificaVersione && fir.versione >= 1) {
      throw new FirNonTrovatoError()
    }
    const nuovaVersione = riga ? riga.versione + 1 : 1
    scalars.versione = nuovaVersione

    // I trasportatori aggiuntivi (tratte intermodali) sono uno snapshot fissato
    // alla creazione del FIR: si scrivono solo nel ramo `create` dell'upsert, mai
    // negli update (transizioni di stato) per non duplicarli.
    const transportersCreate = this.transportersToCreate(fir)
    const createData: any = {
      ...scalars,
      tenant: { connect: { id: tenantId } },
      producerUser: { connect: { id: producerUserId } },
    }
    if (transportersCreate.length > 0) {
      createData.transportersAggiuntivi = { create: transportersCreate }
    }

    // Le transizioni di stato aggiornano solo i campi scalari: tenant e
    // produttore-utente non cambiano dopo la creazione.
    // `transport_date` e' nel documento firmato: dopo la creazione non si riscrive mai, altrimenti
    // ogni transizione invalida le firme gia' apposte.
    const { transportDate: _soloCreazione, ...scalarsAggiornamento } = scalars
    try {
      await client.fIR.upsert({
        where: { id: fir.id },
        create: createData,
        update: scalarsAggiornamento,
      })
    } catch (error) {
      throw this.translateUniqueConstraintError(error, fir)
    }

    await this.persistSignatures(client, fir, tenantId)
    return nuovaVersione
  }

  /**
   * Un FIR annullato all'ente resta annullato. L'upsert scrive tutti gli scalari con
   * i valori che l'aggregate aveva quando è stato caricato: un salvataggio con dati
   * vecchi (sync RENTRI in background, presa in carico, ...) che si sovrappone a chi
   * scrive 'Annullato' lo riporterebbe indietro, e il FIR tornerebbe collegabile al
   * registro. Il valore salvato si legge nella stessa transaction, con la riga
   * bloccata fino al commit.
   *
   * Lo stesso vale per l'annullamento locale (stato CANCELLED): una copia caricata
   * prima dell'annullamento non può riportare il FIR in uno stato attivo, e il
   * salvataggio si rifiuta con `FirAnnullatoNelFrattempoError`. La SELECT si esegue
   * sempre, anche quando l'aggregate porta già 'Annullato' dell'ente, perché il
   * controllo su CANCELLED non dipende dallo stato RENTRI.
   *
   * Il blocco è `FOR NO KEY UPDATE`, non `FOR UPDATE`: protegge la riga da un altro
   * salvataggio allo stesso modo, ma non entra in conflitto con il `FOR KEY SHARE` che
   * l'insert di un movimento del registro prende sul FIR collegato (`fir_id`,
   * `fir_id_ricopia`), quindi un salvataggio del FIR e una registrazione non si aspettano.
   * La riga si cerca anche per tenant, come ogni altra query del repository.
   *
   * Stessa logica per la prenotazione della trasmissione RENTRI (stato SYNCING,
   * `rentri_sync_avviato_at`, transazione in attesa e contabilità dei tentativi): un
   * aggregate caricato prima della prenotazione e salvato mentre un altro processo sta
   * trasmettendo riscriverebbe PENDING/FAILED e azzererebbe la transazione da
   * riprendere, e il tentativo successivo creerebbe un doppione presso l'ente. Se sul
   * database `rentri_sync_avviato_at` è valorizzato e l'aggregate non lo ha, o ne ha
   * uno più vecchio, queste colonne restano quelle del database; se l'aggregate ha lo
   * stesso avvio (o uno più recente) è lui il proprietario del tentativo e scrive il
   * suo stato. Le altre colonne si scrivono sempre dall'aggregate.
   */
  private async conservaAnnullamentoEnte(
    client: Prisma.TransactionClient,
    firId: string,
    tenantId: string,
    scalars: Record<string, unknown> & { rentriStatoFormulario?: unknown; status?: unknown }
  ): Promise<{ versione: number } | undefined> {
    const righe = await client.$queryRaw<
      Array<{
        stato: string | null
        status: string | null
        sync_status: string
        attempts: number
        ultimo_errore: string | null
        codice_errore: string | null
        prossimo_retry: Date | null
        synced_at: Date | null
        avviato_at: Date | null
        in_attesa: string | null
        transazione_id: string | null
        versione: number
      }>
    >`
      SELECT rentri_stato_formulario AS stato, status::text AS status,
             rentri_sync_status::text AS sync_status,
             rentri_sync_attempts AS attempts,
             rentri_last_sync_error AS ultimo_errore,
             rentri_last_sync_error_code AS codice_errore,
             rentri_next_retry_at AS prossimo_retry,
             rentri_synced_at AS synced_at,
             rentri_sync_avviato_at AS avviato_at,
             rentri_transazione_in_attesa AS in_attesa,
             rentri_transazione_id AS transazione_id,
             versione AS versione
      FROM firs WHERE id = ${firId}::uuid AND tenant_id = ${tenantId}::uuid
      FOR NO KEY UPDATE`
    const riga = righe?.[0]
    if (
      riga?.status === PrismaFIRStatus.CANCELLED &&
      scalars.status !== PrismaFIRStatus.CANCELLED
    ) {
      throw new FirAnnullatoNelFrattempoError(firId)
    }
    if (riga?.stato === STATO_RENTRI_ANNULLATO) {
      scalars.rentriStatoFormulario = STATO_RENTRI_ANNULLATO
    }
    // Prenotazione RENTRI viva: la tiene chi l'ha fatta, non un salvataggio stantio.
    const avviatoAggregate = scalars.rentriSyncAvviatoAt as Date | null | undefined
    if (
      riga?.avviato_at &&
      (!avviatoAggregate || avviatoAggregate.getTime() < riga.avviato_at.getTime())
    ) {
      scalars.rentriSyncStatus = riga.sync_status
      scalars.rentriSyncAttempts = riga.attempts
      scalars.rentriLastSyncError = riga.ultimo_errore
      scalars.rentriLastSyncErrorCode = riga.codice_errore
      scalars.rentriNextRetryAt = riga.prossimo_retry
      scalars.rentriSyncedAt = riga.synced_at
      scalars.rentriSyncAvviatoAt = riga.avviato_at
      scalars.rentriTransazioneInAttesa = riga.in_attesa
      scalars.rentriTransazioneId = riga.transazione_id
    }
    return riga ? { versione: Number(riga.versione) } : undefined
  }

  /**
   * Traduce la violazione Postgres del vincolo di unicità
   * (tenant_id, rentri_numero_fir) — P2002, v. Task 3 R2 — in un errore di
   * dominio leggibile. Senza questa traduzione l'eccezione Prisma grezza
   * risalirebbe fino al controller, che non saprebbe distinguerla da
   * qualunque altro errore di scrittura. Qualunque altro errore Prisma (non
   * il nostro vincolo) viene rilanciato invariato: questo repository non
   * deve mascherare problemi diversi da quello che sa spiegare.
   */
  private translateUniqueConstraintError(error: unknown, fir: FIR): unknown {
    const isUniqueViolationOnRentriNumeroFir =
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002' &&
      (error.meta?.target as string[] | string | undefined)
        ?.toString()
        .includes('rentri_numero_fir')

    if (isUniqueViolationOnRentriNumeroFir && fir.rentriNumeroFir) {
      return new FormularioGiaAgganciatoError(fir.rentriNumeroFir)
    }

    return error
  }

  private firmeCandidate(fir: FIR): Array<{ role: string; firma?: FirmaDigitale }> {
    return [
      { role: FIRPrismaRepository.RUOLO_PRODUTTORE, firma: fir.firme.produttore },
      { role: FIRPrismaRepository.RUOLO_TRASPORTATORE, firma: fir.firme.trasportatore },
      { role: FIRPrismaRepository.RUOLO_DESTINATARIO, firma: fir.firme.destinatario },
    ]
  }

  /**
   * Senza userId non si può valorizzare la FK obbligatoria
   * fir_signatures.user_id. Non dovrebbe accadere nel flusso reale (i tre
   * use-case lifecycle valorizzano sempre userId dal comando): se accade il
   * salvataggio fallisce con un errore esplicito, invece di scartare la firma
   * in silenzio e salvare lo stato senza di essa.
   */
  private verificaFirmeScrivibili(fir: FIR): void {
    for (const { role, firma } of this.firmeCandidate(fir)) {
      if (firma && !firma.userId) throw new FirmaSenzaUtenteError(role, fir.id)
    }
  }

  /**
   * Persiste le firme del ciclo di vita presenti sull'aggregate in
   * `fir_signatures`. Senza questo passaggio le firme applicate da
   * `emetti`/`presaInCarico`/`confermaConsegna` restano solo in memoria e
   * spariscono al primo reload (il difetto che questo repository doveva
   * risolvere).
   *
   * Idempotente: se per quel (firId, role) esiste già una riga non la
   * ricrea/sovrascrive — una firma, una volta apposta, è un fatto storico
   * immutabile.
   *
   * NON sono firme digitali QUALIFICATE a norma (nessun contratto QTSP): ma
   * dal Task 4 (pipeline P3) i campi `signatureValue`/`certificateHash`/
   * `documentHash`/`publicKey` sono valorizzati con l'esito REALE del
   * sottosistema crittografico (DigitalSignatureService, invocato dagli
   * use-case emetti/presaInCarico/confermaConsegna PRIMA della transizione,
   * fail-closed) — non più segnaposto SHA-256 su dati arbitrari. Il fallback
   * sotto (hash calcolato qui) resta solo per retrocompatibilità con
   * FirmaDigitale costruite a mano (es. fixture di test) che non passano dal
   * provider di firma.
   */
  private async persistSignatures(
    client: Prisma.TransactionClient,
    fir: FIR,
    tenantId: string
  ): Promise<void> {
    for (const { role, firma } of this.firmeCandidate(fir)) {
      if (!firma) continue
      // Già escluso da verificaFirmeScrivibili: serve a restringere il tipo.
      if (!firma.userId) throw new FirmaSenzaUtenteError(role, fir.id)

      const existing = await client.fIRSignature.findFirst({ where: { firId: fir.id, role } })
      if (existing) continue

      // Firma crittografica reale (Task 4): gli use-case lifecycle valorizzano
      // sempre questi campi prima di arrivare qui. Il ramo di fallback serve
      // solo a fixture/test che costruiscono FirmaDigitale senza provider.
      const signatureValue = firma.certificato
      const documentHash =
        firma.documentHash ??
        createHash('sha256')
          .update(`${fir.id}|${role}|${firma.timestamp.toISOString()}`)
          .digest('hex')
      const certificateHash =
        firma.certificateHash ?? createHash('sha256').update(signatureValue).digest('hex')
      // Il metodo dichiarato riflette ora l'algoritmo crittografico reale
      // (es. 'ECDSA-SHA256') quando disponibile; la qualificazione legale
      // (sandbox vs QES) resta tracciata separatamente e NON in questo campo.
      const signatureMethod =
        firma.signatureMethod ?? FIRPrismaRepository.LIFECYCLE_SIGNATURE_METHOD

      await client.fIRSignature.create({
        data: {
          firId: fir.id,
          // Stesso tenant del FIR: la chiave esterna composta lo esige.
          tenantId,
          userId: firma.userId,
          role,
          signedAt: firma.timestamp,
          signatureMethod,
          signatureValue,
          certificateHash,
          documentHash,
          signerName: firma.firmatario,
          publicKey: firma.publicKey,
          timestampToken: firma.timestampToken,
        },
      })
    }
  }

  /**
   * Mappa i trasportatori aggiuntivi dell'aggregate in righe `FIRTransporter`.
   * Niente `tenantId`: e' un create annidato nell'upsert del FIR, e Prisma lo
   * ricava dal padre attraverso la relazione composta (passarlo e' un errore).
   */
  private transportersToCreate(fir: FIR): any[] {
    return (fir.trasportatoriAggiuntivi ?? []).map(t => ({
      ordine: t.ordine,
      tipoTratta: t.tipoTratta as any,
      trasportatoreId: t.trasportatoreId || undefined,
      denominazione: t.denominazione,
      partitaIva: t.partitaIva || undefined,
      codiceFiscale: t.codiceFiscale || undefined,
      numeroIscrizioneAlbo: t.numeroIscrizioneAlbo || undefined,
      mezzo: t.mezzo || undefined,
      dataPresaInCarico: t.dataPresaInCarico || undefined,
    }))
  }

  async delete(id: string): Promise<void> {
    // Soft delete by updating status to CANCELLED
    await this.prisma.fIR.update({
      where: { id },
      data: {
        status: PrismaFIRStatus.CANCELLED,
        cancelledAt: new Date(),
        versione: { increment: 1 },
      },
    })
  }

  async existsNumeroProgressivo(numeroProgressivo: string): Promise<boolean> {
    const count = await this.prisma.fIR.count({
      where: { firNumber: numeroProgressivo },
    })
    return count > 0
  }

  /**
   * Emissione con assegnazione del riferimento interno (`FIR-AAAA-NNNNNN`) in una
   * sola transaction. Il lock per tenant e anno di emissione serializza le
   * emissioni concorrenti, che altrimenti leggerebbero lo stesso massimo e
   * assegnerebbero lo stesso numero; il `FOR UPDATE` sulla riga del FIR impedisce
   * di emettere due volte la stessa bozza da due richieste parallele.
   *
   * L'anno si legge dal riferimento, non da `createdAt`: una bozza creata a
   * dicembre ed emessa a gennaio conta nell'anno di emissione. Il massimo è
   * numerico (le stringhe ordinerebbero `FIR-2027-1000000` prima di
   * `FIR-2027-999999`) e ignora i riferimenti fuori formato.
   *
   * È la transaction di emissione in cui il piano
   * `2026-09-12-collegamento-scorta-emissione.md` aggiungerà il consumo del
   * numero vidimato.
   */
  async emettiConNumerazione(
    fir: FIR,
    anno: number,
    applicaEmissione: (numeroProgressivo: string) => void
  ): Promise<string> {
    // Stesso tenant che salvaCon scrive (toPersistence): fallback a produttoreId per i FIR legacy.
    const tenantId = fir.tenantId || fir.produttoreId
    let nuovaVersione = 0
    const numeroEmesso = await this.prisma.$transaction(
      async tx => {
        const chiave = `fir-numero|${tenantId}|${anno}`
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${chiave}))`

        const righe = await tx.$queryRaw<Array<{ status: string }>>`
          SELECT status::text AS status FROM firs
          WHERE id = ${fir.id}::uuid AND tenant_id = ${tenantId}::uuid
          FOR UPDATE`
        // Fail-closed sullo stato grezzo: uno stato che non è esplicitamente una bozza
        // (anche uno sconosciuto, che statoFromDb ricondurrebbe a BOZZA) non si emette.
        const statiBozza: readonly string[] = STATI_FIR_IN_BOZZA
        if (righe.length === 0 || !statiBozza.includes(righe[0].status)) {
          throw new FirNonPiuInBozzaError(fir.id)
        }

        // Al più 9 cifre: entrano sempre in un integer. Un riferimento più lungo (dati
        // importati) è fuori formato, come quelli non numerici, e non blocca l'emissione.
        const [{ max_num }] = await tx.$queryRaw<Array<{ max_num: number | null }>>`
          SELECT MAX(CAST(substring(fir_number FROM '^FIR-[0-9]{4}-([0-9]{1,9})$') AS integer)) AS max_num
          FROM firs
          WHERE tenant_id = ${tenantId}::uuid AND fir_number LIKE ${'FIR-' + anno + '-%'}`
        const numero = formattaNumeroFir(anno, (max_num ?? 0) + 1)

        // Un'eccezione del dominio qui annulla l'intera transaction.
        applicaEmissione(numero)
        // Il FOR UPDATE sopra tiene la riga: la versione letta dall'aggregate deve essere ancora quella.
        nuovaVersione = await this.salvaCon(tx, fir, { verificaVersione: true })
        return numero
      },
      // Lock, verifica, massimo, upsert e firme: più round trip del default di 5 s.
      { timeout: 15000 }
    )
    fir.registraVersioneSalvata(nuovaVersione)
    return numeroEmesso
  }

  /**
   * Salva una bozza modificata (piano D1/D8/D11) in una sola transaction. Il `FOR NO KEY UPDATE`
   * serializza la modifica con l'emissione, la firma QES e ogni altro `salvaCon`: sotto lock si
   * ricontrollano legame RENTRI, stato, firme e versione, perche' lo stato letto dal caso d'uso
   * puo' essere gia' vecchio. Il lock non entra in conflitto con il `FOR KEY SHARE` dei movimenti.
   */
  async salvaModificaBozza(
    fir: FIR,
    versioneAttesa: number,
    audit: AuditModificaBozza
  ): Promise<void> {
    // Senza tenant non si puo' bloccare ne' scrivere nulla: niente ripiego sul produttore.
    const tenantId = fir.tenantId
    if (!tenantId) throw new FirNonTrovatoError()
    const nuovaVersione = await this.prisma.$transaction(
      async tx => {
        const righe = await tx.$queryRaw<
          Array<{
            status: string
            versione: number
            rentri_numero_fir: string | null
            firmato: boolean
          }>
        >`
          SELECT f.status::text AS status, f.versione, f.rentri_numero_fir,
                 EXISTS(SELECT 1 FROM fir_signatures s WHERE s.fir_id = f.id) AS firmato
          FROM firs f
          WHERE f.id = ${fir.id}::uuid AND f.tenant_id = ${tenantId}::uuid
          FOR NO KEY UPDATE OF f`
        const riga = righe?.[0]
        if (!riga) throw new FirNonTrovatoError()

        // Un solo ordine dei motivi, identico a quello dell'aggregate (D1).
        if (riga.rentri_numero_fir) throw new FirNonModificabileError('LEGATO_RENTRI')
        const statiBozza: readonly string[] = STATI_FIR_IN_BOZZA
        if (!statiBozza.includes(riga.status)) throw new FirNonModificabileError('NON_BOZZA')
        if (riga.firmato) throw new FirNonModificabileError('FIRMATO')
        if (riga.status === PrismaFIRStatus.AWAITING_PRODUCER) {
          throw new FirNonModificabileError('IN_ATTESA_FIRMA_PRODUTTORE')
        }
        if (riga.versione !== versioneAttesa) throw new FirModificatoNelFrattempoError(fir.id)

        // Rilegge la riga sotto lo stesso lock (un round trip in piu', accettato): riusa il
        // confronto di versione e l'incremento di `salvaCon` senza duplicarli.
        const versioneSalvata = await this.salvaCon(tx, fir, { verificaVersione: true })

        // `toPersistence` scrive i facoltativi con `|| undefined`, che nell'update di Prisma
        // significa "non toccare": uno svuotamento non arriverebbe mai al database (C1). Il
        // contenuto della bozza si riscrive quindi esplicitamente, con `null` dove e' vuoto.
        await tx.fIR.update({ where: { id: fir.id }, data: this.contenutoBozzaToPersistence(fir) })

        if (fir.tratteModificate) {
          // La chiave esterna composta (fir_id, tenant_id) esige il tenant su ogni riga.
          await tx.fIRTransporter.deleteMany({ where: { firId: fir.id, tenantId } })
          const tratte = this.transportersToCreate(fir).map(t => ({
            ...t,
            firId: fir.id,
            tenantId,
          }))
          if (tratte.length > 0) {
            await tx.fIRTransporter.createMany({ data: tratte })
          }
        }

        await tx.activityLog.create({
          data: {
            tenantId,
            firId: fir.id,
            userId: audit.userId,
            action: 'FIR_BOZZA_MODIFICATA',
            description: 'Bozza del FIR modificata',
            metadata: {
              versionePrecedente: versioneAttesa,
              versioneNuova: versioneSalvata,
              campiModificati: audit.campiModificati,
              partiRisnapshottate: audit.partiRisnapshottate,
            },
          },
        })
        return versioneSalvata
      },
      // Lock, SELECT, upsert, update, tratte e audit: piu' round trip del default di 5 s.
      { timeout: 15000 }
    )
    fir.registraVersioneSalvata(nuovaVersione)
  }

  /**
   * Colonne del contenuto di una bozza, scritte con `null` dove il valore e' vuoto (C1). Solo i
   * campi che il DTO di modifica descrive: `wasteDescription`, `wasteCategory` e
   * `wasteOperationType` (scritti dal proprietario) non compaiono, ne' stato, numero o RENTRI.
   */
  private contenutoBozzaToPersistence(fir: FIR): Prisma.FIRUncheckedUpdateInput {
    const produttore = fir.produttore
    const trasportatore = fir.trasportatore
    const destinatario = fir.destinatario
    return {
      producerId: produttore?.registroId || fir.produttoreId || null,
      producerPartitaIva: produttore?.partitaIva ?? '',
      producerName: produttore?.ragioneSociale ?? '',
      producerAddress: produttore?.indirizzo ?? '',
      producerContact: produttore?.contatto || null,
      // F2-10 D9.6: sede e CF scritti con null dove vuoti (C1 di F2-4: undefined = "non toccare").
      producerSedeId: produttore?.sedeId ?? null,
      producerCodiceFiscale: produttore?.codiceFiscale ?? null,
      carrierId: trasportatore?.registroId || fir.trasportatoreId || null,
      carrierPartitaIva: trasportatore?.partitaIva ?? '',
      carrierName: trasportatore?.ragioneSociale ?? '',
      carrierVehiclePlate: trasportatore?.targaVeicolo ?? '',
      carrierContact: trasportatore?.contatto || null,
      carrierCodiceFiscale: trasportatore?.codiceFiscale ?? null,
      receiverId: destinatario?.registroId || fir.destinatarioId || null,
      receiverPartitaIva: destinatario?.partitaIva ?? '',
      receiverName: destinatario?.ragioneSociale ?? '',
      receiverAddress: destinatario?.indirizzo ?? '',
      receiverContact: destinatario?.contatto || null,
      receiverSedeId: destinatario?.sedeId ?? null,
      receiverCodiceFiscale: destinatario?.codiceFiscale ?? null,
      cerCode: fir.rifiuto.cerCode,
      quantity: fir.rifiuto.quantita.valore,
      unit: fir.rifiuto.quantita.unitaMisura,
      wastePhysicalState: fir.rifiuto.statoFisico || null,
      wasteHazardClasses: fir.rifiuto.caratteristichePericolo || null,
      wastePackageCount: fir.rifiuto.numeroColli ?? null,
      wasteOperationCode: fir.rifiuto.codiceOperazione || null,
      wasteNotes: fir.annotazioni || null,
      provenienza: fir.provenienza ?? null,
      tipoTrattaPrincipale: fir.tipoTrattaPrincipale ?? null,
    }
  }

  async count(filters?: FIRSearchFilters): Promise<number> {
    const where: any = {}

    if (filters?.stato) {
      where.status = this.statoToDb(filters.stato as FIRStato)
    }

    if (filters?.produttoreId) {
      // BUGFIX: prima filtrava la colonna `tenantId` con l'id del produttore
      // (filtro errato). Il produttore è ora referenziato da `producerId`
      // (riferimento al registro, vedi snapshot anagrafico FIR).
      where.producerId = filters.produttoreId
    }

    return this.prisma.fIR.count({ where })
  }

  private toDomain(record: any): FIR {
    // Reconstitute the FIR aggregate from the persisted columns, including the
    // frozen anagrafica snapshots. produttoreId/trasportatoreId/destinatarioId
    // are the registry references (fallback to legacy columns for old rows).
    const fir = FIR.create({
      produttoreId: record.producerId || record.producerUserId || record.tenantId,
      tenantId: record.tenantId,
      rifiuto: {
        cerCode: record.cerCode,
        quantita: Number(record.quantity),
        unitaMisura: record.unit as UnitaMisura,
        statoFisico: record.wastePhysicalState || undefined,
        caratteristichePericolo: record.wasteHazardClasses || undefined,
        numeroColli: record.wastePackageCount || undefined,
        descrizione: record.wasteDescription || undefined,
        categoria: record.wasteCategory || undefined,
        tipoOperazione: record.wasteOperationType || undefined,
        codiceOperazione: record.wasteOperationCode || undefined,
      },
      trasportatoreId: record.carrierId || record.carrierUserId || '',
      destinatarioId: record.receiverId || record.receiverUserId || '',
      creatoDaUserId: record.producerUserId || undefined,
      produttore: this.partyFromRecord(
        record.producerId,
        record.producerName,
        record.producerPartitaIva,
        record.producerAddress,
        record.producerContact,
        undefined,
        record.producerCodiceFiscale,
        record.producerSedeId
      ),
      trasportatore: this.partyFromRecord(
        record.carrierId,
        record.carrierName,
        record.carrierPartitaIva,
        undefined,
        record.carrierContact,
        record.carrierVehiclePlate,
        record.carrierCodiceFiscale
      ),
      destinatario: this.partyFromRecord(
        record.receiverId,
        record.receiverName,
        record.receiverPartitaIva,
        record.receiverAddress,
        record.receiverContact,
        undefined,
        record.receiverCodiceFiscale,
        record.receiverSedeId
      ),
      trasportatoriAggiuntivi: (record.transportersAggiuntivi ?? []).map((t: any) => ({
        ordine: t.ordine,
        tipoTratta: t.tipoTratta,
        trasportatoreId: t.trasportatoreId || undefined,
        denominazione: t.denominazione,
        partitaIva: t.partitaIva || undefined,
        codiceFiscale: t.codiceFiscale || undefined,
        numeroIscrizioneAlbo: t.numeroIscrizioneAlbo || undefined,
        mezzo: t.mezzo || undefined,
        dataPresaInCarico: t.dataPresaInCarico || undefined,
      })),
      provenienza: (record.provenienza as ProvenienzaRifiuto) || undefined,
      tipoTrattaPrincipale: (record.tipoTrattaPrincipale as TipoTratta) || undefined,
    })

    // Restore state (using reflection - in production use proper reconstitution)
    Object.assign(fir, {
      _id: record.id,
      _stato: this.statoFromDb(record.status), // Map FIRStatus (DB) -> FIRStato (dominio)
      _numeroProgressivo: record.firNumber,
      // Colonna dedicata; sui FIR precedenti alla colonna si ripiega sulla data di trasporto.
      _dataPresaCarico: record.presaInCaricoIl ?? record.transportDate,
      _dataConsegna: record.actualArrivalDate,
      _pesoEffettivo: record.effectiveWeight ? Number(record.effectiveWeight) : null,
      _firme: this.firmeFromRecord(record.signatures),
      _createdAt: record.createdAt,
      _annotazioni: record.wasteNotes || null,
      _fourthCopyReturnedAt: record.fourthCopyReturnedAt || null,
      _fourthCopyNotes: record.fourthCopyNotes || null,
      _motivoAnnullamento: record.motivoAnnullamento || null,
      // Legame RENTRI: senza questa ricostruzione i getter rentriNumeroFir/
      // rentriSyncStatus/... tornerebbero sempre ai valori di default
      // dell'aggregate appena creato, anche se scritti correttamente da save
      // (il tranello descritto nel Task 3: scrittura ok, lettura dimenticata).
      _rentriSyncStatus: this.rentriSyncStatusFromRecord(record),
      _rentriNumeroFir: record.rentriNumeroFir || null,
      _rentriTransazioneId: record.rentriTransazioneId || null,
      // Prenotazione e transazione in attesa: stesso tranello, senza lettura
      // tornerebbero sempre null e il recupero ripartirebbe da zero.
      _rentriTransazioneInAttesa: record.rentriTransazioneInAttesa || null,
      _rentriSyncAvviatoAt: record.rentriSyncAvviatoAt ?? null,
      _rentriOrigineLegame: (record.rentriOrigineLegame as RentriOrigineLegame) || null,
      _rentriNumeroFirProposto: record.rentriNumeroFirProposto || null,
      // Stato del formulario presso l'ente: stesso tranello (scrittura e lettura
      // dimenticate), la riconciliazione lo confrontava sempre con null.
      _rentriStatoFormulario: (record.rentriStatoFormulario as StatoFormulario | null) ?? null,
      _versione: record.versione ?? 0,
      _firmePresenti: (record.signatures?.length ?? 0) > 0,
      _inAttesaFirmaProduttore: record.status === 'AWAITING_PRODUCER',
    })

    return fir
  }

  /**
   * Ricostruisce le firme del ciclo di vita (_firme) dalle righe `fir_signatures`
   * incluse nella query. Filtra deliberatamente sui soli ruoli lifecycle
   * (PRODUTTORE/TRASPORTATORE/DESTINATARIO): righe con ruoli del sottosistema
   * crittografico (PRODUCER/CARRIER/RECEIVER) vengono ignorate qui — sono
   * ricostruite dal FIR aggregate crittografico separato (fir.aggregate.ts),
   * non da questo.
   */
  private firmeFromRecord(signatures: any[] | undefined): FirmeDigitali {
    const firme: FirmeDigitali = {}

    for (const sig of signatures ?? []) {
      const firma: FirmaDigitale = {
        firmatario: sig.signerName || '',
        timestamp: sig.signedAt,
        certificato: sig.signatureValue,
        userId: sig.userId,
        documentHash: sig.documentHash,
        certificateHash: sig.certificateHash,
        publicKey: sig.publicKey ?? undefined,
        timestampToken: sig.timestampToken ?? undefined,
        signatureMethod: sig.signatureMethod,
      }

      switch (sig.role) {
        case FIRPrismaRepository.RUOLO_PRODUTTORE:
          firme.produttore = firma
          break
        case FIRPrismaRepository.RUOLO_TRASPORTATORE:
          firme.trasportatore = firma
          break
        case FIRPrismaRepository.RUOLO_DESTINATARIO:
          firme.destinatario = firma
          break
        default:
        // Ruolo non riconosciuto (es. firme crittografiche QES): ignorato.
      }
    }

    return firme
  }

  /** Ricostruisce uno snapshot di parte FIR dai campi persistiti, o null se vuoto. */
  private partyFromRecord(
    registroId?: string | null,
    ragioneSociale?: string | null,
    partitaIva?: string | null,
    indirizzo?: string | null,
    contatto?: string | null,
    targaVeicolo?: string | null,
    codiceFiscale?: string | null,
    sedeId?: string | null
  ) {
    if (!ragioneSociale && !partitaIva && !registroId) return undefined
    return {
      registroId: registroId || undefined,
      ragioneSociale: ragioneSociale || '',
      partitaIva: partitaIva || '',
      indirizzo: indirizzo || undefined,
      contatto: contatto || undefined,
      targaVeicolo: targaVeicolo || undefined,
      codiceFiscale: codiceFiscale || undefined,
      sedeId: sedeId || undefined,
    }
  }

  private toPersistence(fir: FIR): any {
    // Mappa l'aggregate FIR sui campi Prisma. I dati anagrafici vengono presi
    // dagli snapshot congelati (parte del documento legale), non più stringhe
    // vuote. producerUserId = utente creatore (FK a User); producer/carrier/
    // receiverId = riferimento al registro di provenienza dello snapshot.
    const produttore = fir.produttore
    const trasportatore = fir.trasportatore
    const destinatario = fir.destinatario

    return {
      id: fir.id,
      status: this.statoToDb(fir.stato), // Map FIRStato (dominio) -> FIRStatus (DB)
      firNumber: fir.numeroProgressivo,
      // tenantId reale del FIR; fallback a produttoreId per i FIR legacy creati
      // prima dell'introduzione del tenantId sull'aggregate.
      tenantId: fir.tenantId || fir.produttoreId,
      producerUserId: fir.creatoDaUserId || fir.produttoreId,
      producerId: produttore?.registroId || fir.produttoreId || undefined,
      producerPartitaIva: produttore?.partitaIva || '',
      producerName: produttore?.ragioneSociale || '',
      producerAddress: produttore?.indirizzo || '',
      producerContact: produttore?.contatto || undefined,
      producerSedeId: produttore?.sedeId || undefined,
      producerCodiceFiscale: produttore?.codiceFiscale || undefined,
      carrierId: trasportatore?.registroId || fir.trasportatoreId || undefined,
      carrierUserId: undefined, // il trasportatore è un'anagrafica, non uno User
      carrierPartitaIva: trasportatore?.partitaIva || '',
      carrierName: trasportatore?.ragioneSociale || '',
      carrierVehiclePlate: trasportatore?.targaVeicolo || '', // dato di trasporto, compilato alla presa in carico
      carrierContact: trasportatore?.contatto || undefined,
      carrierCodiceFiscale: trasportatore?.codiceFiscale || undefined,
      receiverId: destinatario?.registroId || fir.destinatarioId || undefined,
      receiverUserId: undefined, // il destinatario è un'anagrafica, non uno User
      receiverPartitaIva: destinatario?.partitaIva || '',
      receiverName: destinatario?.ragioneSociale || '',
      receiverAddress: destinatario?.indirizzo || '',
      receiverContact: destinatario?.contatto || undefined,
      receiverSedeId: destinatario?.sedeId || undefined,
      receiverCodiceFiscale: destinatario?.codiceFiscale || undefined,
      cerCode: fir.rifiuto.cerCode,
      wasteDescription: fir.rifiuto.descrizione || '',
      wasteCategory: fir.rifiuto.categoria || '',
      wasteOperationType: fir.rifiuto.tipoOperazione || undefined,
      // Campi obbligatori DM 59/2023 — ora persistiti
      wastePhysicalState: fir.rifiuto.statoFisico || undefined,
      wasteHazardClasses: fir.rifiuto.caratteristichePericolo || undefined,
      wastePackageCount: fir.rifiuto.numeroColli || undefined,
      wasteOperationCode: fir.rifiuto.codiceOperazione || undefined,
      wasteNotes: fir.annotazioni || undefined,
      // Peso effettivo destinatario (4ª copia)
      effectiveWeight: fir.pesoEffettivo ?? undefined,
      fourthCopyReturnedAt: fir.fourthCopyReturnedAt || undefined,
      fourthCopyNotes: fir.fourthCopyNotes || undefined,
      motivoAnnullamento: fir.motivoAnnullamento || undefined,
      quantity: fir.rifiuto.quantita.valore,
      unit: fir.rifiuto.quantita.unitaMisura,
      provenienza: fir.provenienza || undefined,
      tipoTrattaPrincipale: fir.tipoTrattaPrincipale || undefined,
      // Data di trasporto: entra nel documento firmato, quindi la scrive solo la creazione
      // (`salvaCon` la toglie dall'update). Il momento reale della presa in carico sta in
      // `presaInCaricoIl`, scritto solo dopo la firma del trasportatore.
      transportDate: new Date(),
      presaInCaricoIl: fir.firme.trasportatore ? (fir.dataPresaCarico ?? undefined) : undefined,
      actualArrivalDate: fir.dataConsegna,
      ...this.rentriToPersistence(fir),
    }
  }

  /**
   * Mappa il legame RENTRI dell'aggregate sui campi scalari `firs.rentri_*`.
   * Prima di questa modifica NESSUNO di questi otto campi veniva scritto: il
   * legame esisteva solo in memoria e spariva al primo reload — lo stesso
   * difetto già risolto per le firme del ciclo di vita (persistSignatures).
   *
   * `rentriNextRetryAt` viene persistito solo quando esiste davvero un
   * prossimo tentativo pianificato (stato FAILED con retry ancora
   * disponibile): per PENDING/SYNCING/SYNCED/PERMANENTLY_FAILED non c'è un
   * backoff in corso, quindi si scrive `null` invece del valore sempre
   * calcolabile (ma privo di senso) di RENTRISyncStatus.getNextRetryAt().
   */
  private rentriToPersistence(fir: FIR): any {
    const syncStatus = fir.rentriSyncStatus
    return {
      rentriSyncStatus: syncStatus.getStatus() as unknown as PrismaRENTRISyncStatus,
      rentriSyncedAt: syncStatus.getSyncedAt() ?? null,
      rentriSyncAttempts: syncStatus.getAttempts(),
      rentriLastSyncError: syncStatus.getLastError() ?? null,
      rentriLastSyncErrorCode: syncStatus.getLastErrorCode() ?? null,
      rentriNextRetryAt: fir.needsRENTRIRetry() ? fir.getNextRENTRIRetryAt() : null,
      rentriNumeroFir: fir.rentriNumeroFir ?? null,
      rentriTransazioneId: fir.rentriTransazioneId ?? null,
      rentriTransazioneInAttesa: fir.rentriTransazioneInAttesa ?? null,
      rentriSyncAvviatoAt: fir.rentriSyncAvviatoAt ?? null,
      rentriOrigineLegame: fir.rentriOrigineLegame
        ? (fir.rentriOrigineLegame as unknown as PrismaRentriOrigineLegame)
        : null,
      // Legame in attesa di conferma (modalità IBRIDA, R1 Task 2): distinto
      // da rentriNumeroFir, che resta null finché l'utente non conferma.
      rentriNumeroFirProposto: fir.rentriNumeroFirProposto ?? null,
      // Stato del formulario presso RENTRI (applyRentriStato): senza questa
      // riga la colonna restava sempre NULL.
      rentriStatoFormulario: (fir.rentriStatoFormulario ??
        null) as PrismaRentriStatoFormulario | null,
    }
  }

  /**
   * Ricostruisce lo stato di sincronizzazione RENTRI (VO) dai campi scalari
   * persistiti. Il `protocolNumber` del VO coincide, per come è scritto
   * `markRENTRISynced`, con `rentriNumeroFir`: è il valore passato a
   * `markAsSynced(numeroFir)` al momento dell'aggancio, non il deprecato
   * `rentriProtocolNumber` (mai valorizzato, vedi commento nello schema).
   */
  private rentriSyncStatusFromRecord(record: any): RENTRISyncStatus {
    return RENTRISyncStatus.reconstitute({
      status: record.rentriSyncStatus,
      attempts: record.rentriSyncAttempts ?? 0,
      lastError: record.rentriLastSyncError ?? undefined,
      protocolNumber: record.rentriNumeroFir ?? undefined,
      syncedAt: record.rentriSyncedAt ?? undefined,
      lastErrorCode: record.rentriLastSyncErrorCode ?? undefined,
    })
  }
}

/*
 * ISOLAMENTO TENANT DEL FIR (#7):
 *
 * L'aggregate `FIR` porta ora un `tenantId` reale (valorizzato dal tenant
 * dell'utente creatore in CreateFIRUseCase) persistito in `firs.tenant_id`.
 * `findById` usa il client RLS-aware (`this.prisma.db.fIR`): con TenantContext
 * attivo l'estensione inietta il tenant reale, impedendo l'accesso cross-tenant
 * per id noto; senza contesto (job di sistema) resta un lookup by-id.
 *
 * `findByIdPublic` resta volutamente NON filtrato (verifica firma pubblica).
 * I FIR legacy senza tenantId reale ricadono su `produttoreId` (vedi
 * toPersistence) per retro-compatibilità.
 */
