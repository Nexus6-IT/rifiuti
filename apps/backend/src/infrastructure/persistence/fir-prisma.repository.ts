/**
 * FIR Prisma Repository - Infrastructure Layer
 * Implementazione concreta del repository FIR con Prisma ORM
 */

import { Injectable, Logger } from '@nestjs/common'
import { createHash } from 'crypto'
import {
  FIRStatus as PrismaFIRStatus,
  RENTRISyncStatus as PrismaRENTRISyncStatus,
  RentriOrigineLegame as PrismaRentriOrigineLegame,
} from '@prisma/client'
import {
  FIR,
  FIRStato,
  FirmaDigitale,
  FirmeDigitali,
  RentriOrigineLegame,
} from '../../domain/fir/aggregates/fir.aggregate'
import {
  IFIRRepository,
  FIRSearchFilters,
} from '../../domain/fir/repositories/fir-repository.interface'
import { UnitaMisura } from '../../domain/fir/value-objects/quantita'
import { RENTRISyncStatus } from '../../domain/fir/rentri-sync-status.vo'
import { PrismaService } from './prisma.service'

@Injectable()
export class FIRPrismaRepository implements IFIRRepository {
  private static readonly logger = new Logger(FIRPrismaRepository.name)

  constructor(private readonly prisma: PrismaService) {}

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
    // Public access without tenant filter - used for signature verification
    const record = await this.prisma.fIR.findUnique({
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

  async findByStato(stato: FIRStato, tenantId?: string): Promise<FIR[]> {
    const where: any = {
      status: this.statoToDb(stato),
    }

    if (tenantId) {
      where.tenantId = tenantId
    }

    const records = await this.prisma.fIR.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: FIRPrismaRepository.FIR_INCLUDE,
    })

    return records.map((r: any) => this.toDomain(r))
  }

  async save(fir: FIR): Promise<void> {
    const data = this.toPersistence(fir)
    // Le relazioni obbligatorie (tenant, producerUser) vanno fornite a Prisma in
    // forma `connect`, non come FK scalari: l'upsert con write annidati usa
    // l'input "checked" che richiede la relazione (altrimenti: "Argument
    // `tenant` is missing"). Si estraggono quindi gli scalari e si collega.
    const { tenantId, producerUserId, ...scalars } = data

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
    await this.prisma.fIR.upsert({
      where: { id: fir.id },
      create: createData,
      update: scalars,
    })

    await this.persistSignatures(fir)
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
  private async persistSignatures(fir: FIR): Promise<void> {
    const candidati: Array<{ role: string; firma?: FirmaDigitale }> = [
      { role: FIRPrismaRepository.RUOLO_PRODUTTORE, firma: fir.firme.produttore },
      { role: FIRPrismaRepository.RUOLO_TRASPORTATORE, firma: fir.firme.trasportatore },
      { role: FIRPrismaRepository.RUOLO_DESTINATARIO, firma: fir.firme.destinatario },
    ]

    for (const { role, firma } of candidati) {
      if (!firma) continue
      // Senza userId non si può valorizzare la FK obbligatoria
      // fir_signatures.user_id. Non dovrebbe accadere nel flusso reale (i tre
      // use-case lifecycle valorizzano sempre userId dal comando). Non si fa
      // fallire la transizione di stato del FIR, ma NON si scarta in silenzio:
      // una firma persa senza traccia e' esattamente il difetto che questa
      // pipeline sta correggendo — chi legge i log deve poterlo scoprire.
      if (!firma.userId) {
        FIRPrismaRepository.logger.warn(
          `Firma ${role} del FIR ${fir.id} NON persistita: userId assente. ` +
            "La transizione di stato prosegue, ma la firma non sara' rileggibile."
        )
        continue
      }

      const existing = await this.prisma.fIRSignature.findFirst({ where: { firId: fir.id, role } })
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

      await this.prisma.fIRSignature.create({
        data: {
          firId: fir.id,
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

  /** Mappa i trasportatori aggiuntivi dell'aggregate in righe `FIRTransporter`. */
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
      },
    })
  }

  async existsNumeroProgressivo(numeroProgressivo: string): Promise<boolean> {
    const count = await this.prisma.fIR.count({
      where: { firNumber: numeroProgressivo },
    })
    return count > 0
  }

  async generateNumeroProgressivo(tenantId: string, anno: number): Promise<string> {
    // Calcola il prossimo progressivo dal MASSIMO firNumber esistente per
    // tenant/anno, escludendo le BOZZE (firNumber = NULL).
    // count() falsava il risultato perché include le bozze senza numero assegnato.
    const ultimo = await this.prisma.fIR.findFirst({
      where: {
        tenantId,
        firNumber: { not: null },
        createdAt: {
          gte: new Date(anno, 0, 1),
          lt: new Date(anno + 1, 0, 1),
        },
      },
      orderBy: { firNumber: 'desc' },
      select: { firNumber: true },
    })

    let nextNum = 1
    if (ultimo?.firNumber) {
      // Formato atteso: FIR-YYYY-NNNNNN  →  l'ultimo segmento è il progressivo.
      const parts = ultimo.firNumber.split('-')
      const parsed = parseInt(parts[parts.length - 1], 10)
      if (!isNaN(parsed)) {
        nextNum = parsed + 1
      }
    }

    return `FIR-${anno}-${String(nextNum).padStart(6, '0')}`
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
        record.producerContact
      ),
      trasportatore: this.partyFromRecord(
        record.carrierId,
        record.carrierName,
        record.carrierPartitaIva,
        undefined,
        record.carrierContact,
        record.carrierVehiclePlate
      ),
      destinatario: this.partyFromRecord(
        record.receiverId,
        record.receiverName,
        record.receiverPartitaIva,
        record.receiverAddress,
        record.receiverContact
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
    })

    // Restore state (using reflection - in production use proper reconstitution)
    Object.assign(fir, {
      _id: record.id,
      _stato: this.statoFromDb(record.status), // Map FIRStatus (DB) -> FIRStato (dominio)
      _numeroProgressivo: record.firNumber,
      _dataPresaCarico: record.transportDate,
      _dataConsegna: record.actualArrivalDate,
      _pesoEffettivo: record.effectiveWeight ? Number(record.effectiveWeight) : null,
      _firme: this.firmeFromRecord(record.signatures),
      _createdAt: record.createdAt,
      _annotazioni: record.wasteNotes || null,
      _fourthCopyReturnedAt: record.fourthCopyReturnedAt || null,
      _fourthCopyNotes: record.fourthCopyNotes || null,
      // Legame RENTRI: senza questa ricostruzione i getter rentriNumeroFir/
      // rentriSyncStatus/... tornerebbero sempre ai valori di default
      // dell'aggregate appena creato, anche se scritti correttamente da save
      // (il tranello descritto nel Task 3: scrittura ok, lettura dimenticata).
      _rentriSyncStatus: this.rentriSyncStatusFromRecord(record),
      _rentriNumeroFir: record.rentriNumeroFir || null,
      _rentriTransazioneId: record.rentriTransazioneId || null,
      _rentriOrigineLegame: (record.rentriOrigineLegame as RentriOrigineLegame) || null,
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
    targaVeicolo?: string | null
  ) {
    if (!ragioneSociale && !partitaIva && !registroId) return undefined
    return {
      registroId: registroId || undefined,
      ragioneSociale: ragioneSociale || '',
      partitaIva: partitaIva || '',
      indirizzo: indirizzo || undefined,
      contatto: contatto || undefined,
      targaVeicolo: targaVeicolo || undefined,
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
      carrierId: trasportatore?.registroId || fir.trasportatoreId || undefined,
      carrierUserId: undefined, // il trasportatore è un'anagrafica, non uno User
      carrierPartitaIva: trasportatore?.partitaIva || '',
      carrierName: trasportatore?.ragioneSociale || '',
      carrierVehiclePlate: trasportatore?.targaVeicolo || '', // dato di trasporto, compilato alla presa in carico
      carrierContact: trasportatore?.contatto || undefined,
      receiverId: destinatario?.registroId || fir.destinatarioId || undefined,
      receiverUserId: undefined, // il destinatario è un'anagrafica, non uno User
      receiverPartitaIva: destinatario?.partitaIva || '',
      receiverName: destinatario?.ragioneSociale || '',
      receiverAddress: destinatario?.indirizzo || '',
      receiverContact: destinatario?.contatto || undefined,
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
      quantity: fir.rifiuto.quantita.valore,
      unit: fir.rifiuto.quantita.unitaMisura,
      transportDate: fir.dataPresaCarico || new Date(),
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
      rentriNextRetryAt: fir.needsRENTRIRetry() ? fir.getNextRENTRIRetryAt() : null,
      rentriNumeroFir: fir.rentriNumeroFir ?? null,
      rentriTransazioneId: fir.rentriTransazioneId ?? null,
      rentriOrigineLegame: fir.rentriOrigineLegame
        ? (fir.rentriOrigineLegame as unknown as PrismaRentriOrigineLegame)
        : null,
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
