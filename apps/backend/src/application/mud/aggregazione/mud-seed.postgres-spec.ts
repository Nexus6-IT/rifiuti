/**
 * Seed comuni degli spec Postgres del MUD (D17 punto 4): azienda, sede, registro, aperture,
 * movimenti, FIR con firma del trasportatore e anagrafiche di destinatari e trasportatori.
 *
 * Non è uno spec (il nome non finisce in `.spec.ts`, escluso da tsc-build e jest come l'oracolo).
 * Tutto si scrive col client proprietario (`wasteflow`) e si pulisce per `tenantId`.
 * `creaSoggettoMud` delega a `creaDittaConRuolo` (F2-10): ditta, sede e riga di ruolo.
 */
import { randomUUID } from 'crypto'
import type { PrismaClient } from '@prisma/client'
import { creaDittaConRuolo } from '../../../test-support/anagrafiche-di-test'

export interface AziendaMud {
  tenantId: string
  registroId: string
  unitaLocaleId: string
  utenteId: string
}

export interface DatiSoggettoMud {
  ragioneSociale: string
  partitaIva: string
  /** numero di autorizzazione (destinatario) o di iscrizione all'Albo (trasportatore) */
  numero?: string
  via?: string
  civico?: string
  cap?: string
  comune?: string
  provincia?: string
}

let contatore = 0

/** Destinatario o trasportatore con le colonne di oggi; restituisce l'id. */
export async function creaSoggettoMud(
  client: PrismaClient,
  tenantId: string,
  ruolo: 'DESTINATARIO' | 'TRASPORTATORE',
  dati: DatiSoggettoMud
): Promise<string> {
  const { ruoloId } = await creaDittaConRuolo(client, tenantId, ruolo, {
    ragioneSociale: dati.ragioneSociale,
    partitaIva: dati.partitaIva,
    numeroDocumento: dati.numero,
    via: dati.via,
    civico: dati.civico,
    cap: dati.cap ?? '20100',
    comune: dati.comune ?? 'Milano',
    provincia: dati.provincia ?? 'MI',
  })
  return ruoloId
}

/** Azienda con una sede principale, il suo registro e un utente (per FIR e aperture). */
export async function creaAziendaMud(
  client: PrismaClient,
  sigla: string,
  profilo: { city?: string; province?: string; atecoCode?: string } = {}
): Promise<AziendaMud> {
  const suffisso = `${Date.now()}${++contatore}`.slice(-9)
  const t = await client.tenant.create({
    data: {
      partitaIva: `${sigla.slice(0, 2).toUpperCase()}${suffisso}`,
      ragioneSociale: `MUD ${sigla} SRL`,
      country: 'IT',
      city: profilo.city ?? 'Milano',
      province: profilo.province ?? 'MI',
      atecoCode: profilo.atecoCode ?? '38.11.00',
    },
  })
  const sede = await client.rentriUnitaLocale.create({
    data: {
      tenantId: t.id,
      numIscrSito: `OP0001MS${String(contatore).padStart(6, '0')}-MI0001`,
      denominazione: 'Sede principale',
      principale: true,
    },
  })
  const registro = await client.registroRifiuti.create({
    data: { tenantId: t.id, descrizione: 'Registro cronologico', unitaLocaleId: sede.id },
  })
  const utente = await client.user.create({
    data: {
      tenantId: t.id,
      keycloakId: `keycloak-mud-${randomUUID()}`,
      fiscalCode: 'RSSMRA80A01H501U',
      firstName: 'Mario',
      lastName: 'Rossi',
      email: `mud-${randomUUID()}@example.com`,
      role: 'ADMIN',
    },
  })
  return { tenantId: t.id, registroId: registro.id, unitaLocaleId: sede.id, utenteId: utente.id }
}

export async function creaApertura(
  client: PrismaClient,
  az: AziendaMud,
  o: { cerCode: string; quantita: number; unita: string; data: string }
): Promise<void> {
  await client.giacenzaIniziale.create({
    data: {
      tenantId: az.tenantId,
      registroId: az.registroId,
      cerCode: o.cerCode,
      quantita: o.quantita,
      unita: o.unita,
      dataRiferimento: new Date(`${o.data}T00:00:00Z`),
      impostatoDa: az.utenteId,
    },
  })
}

export interface DatiMovimento {
  tipo?: 'ORDINARIA' | 'RETTIFICA' | 'ANNULLAMENTO'
  type: 'CARICO' | 'SCARICO'
  causale: string
  causaleAziendaId?: string
  cerCode: string
  quantita: number
  /** giorno `AAAA-MM-GG` (ore 08:00 UTC) */
  giorno: string
  /** istante ISO che sostituisce `giorno` (per i confini dell'anno italiano) */
  istante?: string
  /** unità di misura (predefinita KG) */
  unita?: string
  firId?: string
  operationCode?: string
  counterpartName?: string
  counterpartAddress?: string
  descrizione?: string
  /** predecessore (solo per correzioni) */
  rettificatoId?: string
  /** radice della catena (solo per correzioni) */
  originaleId?: string
}

export async function creaMovimento(
  client: PrismaClient,
  az: AziendaMud,
  o: DatiMovimento
): Promise<{ id: string }> {
  const tipo = o.tipo ?? 'ORDINARIA'
  const quando = new Date(o.istante ?? `${o.giorno}T08:00:00Z`)
  const m = await client.wasteMovement.create({
    data: {
      tenantId: az.tenantId,
      registroId: az.registroId,
      progressiveYear: quando.getUTCFullYear(),
      progressiveNumber: ++contatore,
      type: o.type,
      movementDate: quando,
      registrationDate: quando,
      causale: o.causale,
      causaleAziendaId: o.causaleAziendaId ?? null,
      cerCode: o.cerCode,
      quantity: o.quantita,
      unit: o.unita ?? 'KG',
      firId: o.firId,
      operationCode: o.operationCode ?? null,
      counterpartName: o.counterpartName ?? null,
      counterpartAddress: o.counterpartAddress ?? null,
      wasteDescription: o.descrizione ?? null,
      tipoAnnotazione: tipo,
      movimentoRettificatoId: tipo === 'ORDINARIA' ? null : o.rettificatoId,
      movimentoOriginaleId: tipo === 'ORDINARIA' ? null : o.originaleId,
      motivoAnnotazione: tipo === 'ORDINARIA' ? null : 'correzione di prova',
    },
  })
  return { id: m.id }
}

/** FIR emesso con la firma del trasportatore (presa in carico avvenuta qui). */
export async function creaFirConFirma(
  client: PrismaClient,
  az: AziendaMud,
  o: {
    numero: string
    giornoTrasporto: string
    destinatarioId: string
    destinatario: DatiSoggettoMud
    trasportatoreId: string
    trasportatore: DatiSoggettoMud
    cerCode: string
    quantita: number
    codiceOperazione?: string
  }
): Promise<string> {
  const trasporto = new Date(`${o.giornoTrasporto}T08:00:00Z`)
  const fir = await client.fIR.create({
    data: {
      tenantId: az.tenantId,
      firNumber: o.numero,
      status: 'COMPLETED',
      producerUserId: az.utenteId,
      producerPartitaIva: '01234567890',
      producerName: 'Produttore di prova',
      producerAddress: 'Via Roma 1, Milano',
      carrierId: o.trasportatoreId,
      carrierPartitaIva: o.trasportatore.partitaIva,
      carrierName: o.trasportatore.ragioneSociale,
      carrierVehiclePlate: 'AB123CD',
      receiverId: o.destinatarioId,
      receiverPartitaIva: o.destinatario.partitaIva,
      receiverName: o.destinatario.ragioneSociale,
      receiverAddress: 'Via Roma 1, Milano',
      cerCode: o.cerCode,
      wasteDescription: 'Rifiuto di prova',
      wasteCategory: 'NON_PERICOLOSO',
      quantity: o.quantita,
      wasteOperationType: 'RECOVERY',
      wasteOperationCode: o.codiceOperazione ?? 'R13',
      transportDate: trasporto,
    },
  })
  await client.fIRSignature.create({
    data: {
      firId: fir.id,
      tenantId: az.tenantId,
      userId: az.utenteId,
      role: 'TRASPORTATORE',
      signedAt: trasporto,
      signatureValue: 'firma-di-prova',
      certificateHash: 'a'.repeat(64),
      documentHash: 'b'.repeat(64),
    },
  })
  return fir.id
}

/** Causale aziendale (versione vigente dal giorno indicato); restituisce l'id della versione. */
export async function creaCausaleAzienda(
  client: PrismaClient,
  tenantId: string,
  o: { codice: string; verso: 'CARICO' | 'SCARICO'; ruolo: string; dal: string }
): Promise<string> {
  const righe = await client.$queryRawUnsafe<{ id: string }[]>(
    `INSERT INTO causali_registro_azienda
       (tenant_id, natura, codice, verso, descrizione, ruolo_mud, valida_dal, creato_da, fatturabile, updated_at)
     VALUES ($1::uuid, 'PROPRIA', $2, $3::waste_movement_type, 'Prova', $4::ruolo_mud_causale,
             $5::date, $6::uuid, false, now())
     RETURNING id::text AS id`,
    tenantId,
    o.codice,
    o.verso,
    o.ruolo,
    o.dal,
    randomUUID()
  )
  return righe[0].id
}

/** Pulizia per `tenantId` (mai senza filtro), nell'ordine delle chiavi esterne. */
export async function pulisciAziendeMud(client: PrismaClient, tenantIds: string[]): Promise<void> {
  if (tenantIds.length === 0) return
  const where = { tenantId: { in: tenantIds } }
  await client.wasteMovement.deleteMany({ where })
  await client.giacenzaIniziale.deleteMany({ where })
  await client.fIRSignature.deleteMany({ where })
  await client.fIR.deleteMany({ where })
  await client.causaleRegistroAzienda.deleteMany({ where })
  await client.destinatario.deleteMany({ where })
  await client.trasportatore.deleteMany({ where })
  await client.sedeDitta.deleteMany({ where })
  await client.ditta.deleteMany({ where })
  await client.registroRifiuti.deleteMany({ where })
  await client.rentriUnitaLocale.deleteMany({ where })
  await client.user.deleteMany({ where })
  await client.tenant.deleteMany({ where: { id: { in: tenantIds } } })
}
