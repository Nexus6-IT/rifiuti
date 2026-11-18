import type { AnagraficaComunicazioniSede, Prisma, PrismaClient } from '@prisma/client'
import type { TracciatoDati } from '../../domain/comunicazioni/dati-tracciato'

/**
 * Lettore dei dettagli per i tracciati a record (CONOU, COBAT, O.R.R., O.R.SO. dettagliata, 4.9c-f
 * A5). Dati i movimenti gia' letti da `leggiMovimentiOrso`, carica in poche query FISSE (una per
 * tipo, mai una per movimento) quanto serve alle controparti: FIR, trasportatore del FIR, sedi con
 * la ditta e la sede legale, anagrafica per le comunicazioni, trasportatori e destinatari di
 * anagrafica, dati del tracciato per radice. Solo lettura.
 */

export type DbDettagli = Pick<
  PrismaClient,
  | 'fIR'
  | 'fIRTransporter'
  | 'sedeDitta'
  | 'ditta'
  | 'anagraficaComunicazioniSede'
  | 'trasportatore'
  | 'destinatario'
  | 'produttore'
  | 'datiTracciatoMovimento'
>

export interface FirDettaglio {
  id: string
  firNumero: string | null
  transportDate: Date
  actualArrivalDate: Date | null
  producerSedeId: string | null
  /** Produttore di anagrafica: ripiego per la sede dei FIR creati prima della migration delle sedi. */
  producerId: string | null
  receiverSedeId: string | null
  producerCodiceFiscale: string | null
  carrierCodiceFiscale: string | null
  receiverCodiceFiscale: string | null
  producerPartitaIva: string
  carrierPartitaIva: string
  receiverPartitaIva: string
  producerName: string
  carrierName: string
  receiverName: string
  producerAddress: string
  receiverAddress: string
  carrierId: string | null
  receiverId: string | null
  carrierVehiclePlate: string
  wasteOperationCode: string | null
  /** Primo trasportatore del FIR (`FIRTransporter` di ordine 1), se registrato. */
  trasportatore1: {
    codiceFiscale: string | null
    partitaIva: string | null
    numeroIscrizioneAlbo: string | null
    mezzo: string | null
  } | null
}

export interface DittaDettaglio {
  id: string
  ragioneSociale: string
  partitaIva: string | null
  codiceFiscale: string | null
}

export interface SedeDettaglio {
  id: string
  dittaId: string
  denominazione: string | null
  via: string
  civico: string
  cap: string
  comune: string
  provincia: string
  telefono: string | null
  principale: boolean
  /** Sede attiva (le sedi non si cancellano, si disattivano). */
  attiva: boolean
  ditta: DittaDettaglio
  /** Dati per le comunicazioni; `null` se la sede non ne ha. */
  anagrafica: AnagraficaComunicazioniSede | null
}

export interface TrasportatoreDettaglio {
  id: string
  sedeId: string | null
  dittaId: string | null
  numeroIscrizione: string
}

export interface DestinatarioDettaglio {
  id: string
  sedeId: string | null
  dittaId: string | null
  numeroAutorizzazione: string
}

export interface DettagliTracciato {
  /** Per id del FIR. */
  fir: ReadonlyMap<string, FirDettaglio>
  /** Per id della sede. */
  sedi: ReadonlyMap<string, SedeDettaglio>
  /** Sede legale (principale) di ogni ditta coinvolta, per id della ditta. */
  sedeLegalePerDitta: ReadonlyMap<string, SedeDettaglio>
  trasportatori: ReadonlyMap<string, TrasportatoreDettaglio>
  destinatari: ReadonlyMap<string, DestinatarioDettaglio>
  /** Dati del tracciato per radice del movimento (solo se richiesto il tracciato). */
  datiTracciato: ReadonlyMap<string, Prisma.JsonValue>
  /** Produttori di anagrafica per id, con la loro sede (ripiego per i FIR senza `producerSedeId`). */
  produttori: ReadonlyMap<string, { id: string; sedeId: string }>
  /**
   * Sedi delle ditte la cui ragione sociale coincide con la denominazione della controparte di un
   * movimento senza FIR (chiave: `chiaveControparte`). Solo per le denominazioni richieste.
   */
  sediPerControparte: ReadonlyMap<string, readonly SedeDettaglio[]>
}

/** Chiave di confronto fra la denominazione scritta nel registro e la ragione sociale di una ditta. */
export const chiaveControparte = (nome: string): string =>
  nome.trim().replace(/\s+/g, ' ').toLowerCase()

/** Parola piu' lunga di un nome (per una ricerca `contains` che non dipende dagli spazi). */
const parolaPiuLunga = (nome: string): string =>
  nome.split(/\s+/).reduce((a, b) => (b.length > a.length ? b : a), '')

export interface RichiestaDettagli {
  tenantId: string
  movimenti: ReadonlyArray<{
    firId: string | null
    radiceId: string
    /** Sede della controparte scelta nel form: si carica anche senza FIR e senza nome. */
    sedeControparteId?: string | null
  }>
  /** Se presente si leggono anche i dati del tracciato per movimento. */
  tracciato?: TracciatoDati
  /**
   * Denominazioni della controparte dei movimenti senza FIR (O.R.SO. dettagliata): si cercano le
   * ditte con quella ragione sociale (senza distinzione di maiuscole) e le loro sedi.
   */
  controparti?: ReadonlyArray<string>
}

const univoci = (v: ReadonlyArray<string | null | undefined>): string[] => [
  ...new Set(v.filter((x): x is string => typeof x === 'string' && x !== '')),
]

export async function leggiDettagliTracciato(
  db: DbDettagli,
  r: RichiestaDettagli
): Promise<DettagliTracciato> {
  const { tenantId } = r
  const firIds = univoci(r.movimenti.map(m => m.firId))
  const radici = univoci(r.movimenti.map(m => m.radiceId))

  const [firRighe, trasportatori1, datiRighe] = await Promise.all([
    firIds.length
      ? db.fIR.findMany({
          where: { tenantId, id: { in: firIds } },
          select: {
            id: true,
            firNumber: true,
            transportDate: true,
            actualArrivalDate: true,
            producerSedeId: true,
            producerId: true,
            receiverSedeId: true,
            producerCodiceFiscale: true,
            carrierCodiceFiscale: true,
            receiverCodiceFiscale: true,
            producerPartitaIva: true,
            carrierPartitaIva: true,
            receiverPartitaIva: true,
            producerName: true,
            carrierName: true,
            receiverName: true,
            producerAddress: true,
            receiverAddress: true,
            carrierId: true,
            receiverId: true,
            carrierVehiclePlate: true,
            wasteOperationCode: true,
          },
        })
      : Promise.resolve([]),
    firIds.length
      ? db.fIRTransporter.findMany({
          where: { tenantId, firId: { in: firIds }, ordine: 1 },
          select: {
            firId: true,
            codiceFiscale: true,
            partitaIva: true,
            numeroIscrizioneAlbo: true,
            mezzo: true,
          },
        })
      : Promise.resolve([]),
    r.tracciato && radici.length
      ? db.datiTracciatoMovimento.findMany({
          where: { tenantId, tracciato: r.tracciato, movimentoOriginaleId: { in: radici } },
          select: { movimentoOriginaleId: true, dati: true },
        })
      : Promise.resolve([]),
  ])

  const carrierIds = univoci(firRighe.map(f => f.carrierId))
  const receiverIds = univoci(firRighe.map(f => f.receiverId))
  const [trasportatoriRighe, destinatariRighe] = await Promise.all([
    carrierIds.length
      ? db.trasportatore.findMany({
          where: { tenantId, id: { in: carrierIds } },
          select: { id: true, sedeId: true, dittaId: true, numeroIscrizione: true },
        })
      : Promise.resolve([]),
    receiverIds.length
      ? db.destinatario.findMany({
          where: { tenantId, id: { in: receiverIds } },
          select: { id: true, sedeId: true, dittaId: true, numeroAutorizzazione: true },
        })
      : Promise.resolve([]),
  ])

  // Produttori dei FIR senza `producerSedeId` (creati prima del 31/10): la sede è quella di anagrafica.
  const produttoreIds = univoci(firRighe.flatMap(f => (f.producerSedeId ? [] : [f.producerId])))
  const produttoriRighe = produttoreIds.length
    ? await db.produttore.findMany({
        where: { tenantId, id: { in: produttoreIds } },
        select: { id: true, sedeId: true },
      })
    : []

  const sedeIds = univoci([
    ...r.movimenti.map(m => m.sedeControparteId),
    ...firRighe.flatMap(f => [f.producerSedeId, f.receiverSedeId]),
    ...produttoriRighe.map(p => p.sedeId),
    ...trasportatoriRighe.map(t => t.sedeId),
    ...destinatariRighe.map(d => d.sedeId),
  ])
  const nomiControparti = univoci(
    (r.controparti ?? []).map(n => n.trim().replace(/\s+/g, ' ')).filter(n => n !== '')
  )
  // N2: la ragione sociale in anagrafica puo' avere spazi doppi o ai bordi, quindi un'uguaglianza
  // sul nome compattato non la trova. La ricerca per `contains` sulla parola piu' lunga di ogni nome
  // (insensibile alle maiuscole e agli spazi) restringe i candidati; il confronto esatto, compattato
  // da entrambi i lati, e' fatto in memoria.
  const chiaviControparti = new Set(nomiControparti.map(chiaveControparte))
  const ditteControparti = nomiControparti.length
    ? (
        await db.ditta.findMany({
          where: {
            tenantId,
            OR: nomiControparti.map(n => ({
              ragioneSociale: { contains: parolaPiuLunga(n), mode: 'insensitive' as const },
            })),
          },
          select: { id: true, ragioneSociale: true },
        })
      ).filter(d => chiaviControparti.has(chiaveControparte(d.ragioneSociale)))
    : []
  const [sediIds, sediControparti] = await Promise.all([
    sedeIds.length
      ? db.sedeDitta.findMany({ where: { tenantId, id: { in: sedeIds } } })
      : Promise.resolve([]),
    ditteControparti.length
      ? db.sedeDitta.findMany({
          where: { tenantId, dittaId: { in: ditteControparti.map(d => d.id) } },
        })
      : Promise.resolve([]),
  ])
  const sediBase = [...new Map([...sediIds, ...sediControparti].map(s => [s.id, s])).values()]
  const dittaIds = univoci([
    ...sediBase.map(s => s.dittaId),
    ...trasportatoriRighe.map(t => t.dittaId),
    ...destinatariRighe.map(d => d.dittaId),
  ])
  const [sediLegali, ditte] = await Promise.all([
    dittaIds.length
      ? db.sedeDitta.findMany({ where: { tenantId, dittaId: { in: dittaIds }, principale: true } })
      : Promise.resolve([]),
    dittaIds.length
      ? db.ditta.findMany({
          where: { tenantId, id: { in: dittaIds } },
          select: { id: true, ragioneSociale: true, partitaIva: true, codiceFiscale: true },
        })
      : Promise.resolve([]),
  ])
  const tutteLeSedi = [...new Map([...sediBase, ...sediLegali].map(s => [s.id, s])).values()]
  const anagrafiche = tutteLeSedi.length
    ? await db.anagraficaComunicazioniSede.findMany({
        where: { tenantId, sedeDittaId: { in: tutteLeSedi.map(s => s.id) } },
      })
    : []

  const dittaPerId = new Map(ditte.map(d => [d.id, d]))
  const anagraficaPerSede = new Map(anagrafiche.map(a => [a.sedeDittaId, a]))
  const sedi = new Map<string, SedeDettaglio>()
  for (const s of tutteLeSedi) {
    const ditta = dittaPerId.get(s.dittaId)
    if (!ditta) continue
    sedi.set(s.id, {
      id: s.id,
      dittaId: s.dittaId,
      denominazione: s.denominazione,
      via: s.via,
      civico: s.civico,
      cap: s.cap,
      comune: s.comune,
      provincia: s.provincia,
      telefono: s.telefono,
      principale: s.principale,
      attiva: s.attiva,
      ditta,
      anagrafica: anagraficaPerSede.get(s.id) ?? null,
    })
  }
  const sedeLegalePerDitta = new Map<string, SedeDettaglio>()
  for (const s of sediLegali) {
    const d = sedi.get(s.id)
    if (d) sedeLegalePerDitta.set(s.dittaId, d)
  }

  const trasportatore1PerFir = new Map(trasportatori1.map(t => [t.firId, t]))
  const fir = new Map<string, FirDettaglio>()
  for (const f of firRighe) {
    const t = trasportatore1PerFir.get(f.id)
    fir.set(f.id, {
      id: f.id,
      firNumero: f.firNumber?.trim() || null,
      transportDate: f.transportDate,
      actualArrivalDate: f.actualArrivalDate,
      producerSedeId: f.producerSedeId,
      producerId: f.producerId,
      receiverSedeId: f.receiverSedeId,
      producerCodiceFiscale: f.producerCodiceFiscale,
      carrierCodiceFiscale: f.carrierCodiceFiscale,
      receiverCodiceFiscale: f.receiverCodiceFiscale,
      producerPartitaIva: f.producerPartitaIva,
      carrierPartitaIva: f.carrierPartitaIva,
      receiverPartitaIva: f.receiverPartitaIva,
      producerName: f.producerName,
      carrierName: f.carrierName,
      receiverName: f.receiverName,
      producerAddress: f.producerAddress,
      receiverAddress: f.receiverAddress,
      carrierId: f.carrierId,
      receiverId: f.receiverId,
      carrierVehiclePlate: f.carrierVehiclePlate,
      wasteOperationCode: f.wasteOperationCode,
      trasportatore1: t
        ? {
            codiceFiscale: t.codiceFiscale,
            partitaIva: t.partitaIva,
            numeroIscrizioneAlbo: t.numeroIscrizioneAlbo,
            mezzo: t.mezzo,
          }
        : null,
    })
  }

  const sediPerControparte = new Map<string, SedeDettaglio[]>()
  for (const d of ditteControparti) {
    const chiave = chiaveControparte(d.ragioneSociale)
    const elenco = sediPerControparte.get(chiave) ?? []
    for (const s of sedi.values()) if (s.dittaId === d.id) elenco.push(s)
    sediPerControparte.set(chiave, elenco)
  }

  return {
    fir,
    sedi,
    sedeLegalePerDitta,
    trasportatori: new Map(trasportatoriRighe.map(t => [t.id, t])),
    destinatari: new Map(destinatariRighe.map(d => [d.id, d])),
    datiTracciato: new Map(datiRighe.map(d => [d.movimentoOriginaleId, d.dati])),
    produttori: new Map(produttoriRighe.map(p => [p.id, p])),
    sediPerControparte,
  }
}
