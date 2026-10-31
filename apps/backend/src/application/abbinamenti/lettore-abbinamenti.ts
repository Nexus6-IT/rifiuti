/**
 * Lettore dell'ambito degli abbinamenti carico-scarico (4.6, Task 4).
 *
 * Un ambito e' un CER (sulle sole cifre) in una famiglia di unita dentro UN registro: lo stesso
 * insieme su cui lavora il FIFO del deposito. Legge le TESTE vigenti dei movimenti, ma identifica
 * ogni movimento con la RADICE della catena di correzione (gli abbinamenti puntano alla radice:
 * una rettifica non li rompe); quantita, data, classe e numero sono quelli della testa.
 *
 * Numero di query indipendente da quanti movimenti ci sono (nessun N+1): una `$queryRaw` per i
 * movimenti vigenti, le giacenze iniziali, le righe di abbinamento del registro e il catalogo delle
 * causali (2 query); una query in piu solo se esistono righe con entrambi i capi fuori ambito.
 */
import type { Prisma } from '@prisma/client'
import { giornoItaliano } from '../../core/time/anno-italiano'
import { PrismaService } from '../../infrastructure/persistence/prisma.service'
import {
  classeAttesaScarico,
  classeStoccaggio,
  type CaricoAbbinabile,
  type ChiaveCarico,
  type ClasseStoccaggio,
  type RigaAbbinamento,
  type ScaricoAbbinabile,
} from '../../domain/waste-movement/abbinamento-carichi'
import {
  cerCanonico,
  cerSoloCifre,
  chiaveConfrontoCer,
} from '../../domain/waste-movement/cer-registro'
import {
  confrontaEventiFifo,
  famigliaFifo,
  millesimiFifo,
  quantitaFifo,
  type EventoFifo,
} from '../../domain/waste-movement/fifo-deposito'
import { normalizzaUnitaRegistro } from '../../domain/waste-movement/unita-misura-registro'
import { sqlVigente } from '../../domain/waste-movement/vigenza'
import { leggiApertureRegistro } from '../registro/aperture-registro'
import { caricaCatalogoCausali } from '../registro/causali/catalogo-causali.repository'

export type ClientAbbinamenti = Prisma.TransactionClient | PrismaService

export interface AmbitoAbbinamento {
  registroId: string
  chiaveCer: string
  /** canonico della testa piu recente */
  cerCode: string
  famiglia: string
  /** 'kg' per la massa */
  unita: string
  /** stoccaggio R13/D15 + giacenze iniziali dell'ambito */
  carichi: CaricoAbbinabile[]
  /** tutti gli scarichi vigenti dell'ambito */
  scarichi: ScaricoAbbinabile[]
  /** righe che puntano a scarichi o carichi dell'ambito */
  righe: RigaAbbinamento[]
  /** solo le righe strutturalmente valide (vigenza, famiglia, ambito): su queste si calcolano i residui */
  righeValide: RigaAbbinamento[]
  /** id delle righe strutturalmente non valide (un capo non vigente, famiglia o ambito sbagliati) */
  righeMorteIds: string[]
  /** righe che violano I-ABB (D2) */
  righeIncoerenti: Array<{ id: string; motivo: string }>
  /** classi presenti fra i carichi */
  classi: ClasseStoccaggio[]
  diStoccaggio: boolean
}

export interface OpzioniLettoreAbbinamenti {
  logger?: { warn(messaggio: string): void }
}

interface RigaMovimento {
  id: string
  radice_id: string
  type: string
  cer_code: string
  unit: string
  quantity: Prisma.Decimal | number | string
  movement_date: Date
  progressive_year: number
  progressive_number: number
  radice_year: number
  radice_number: number
  operation_code: string | null
  causale: string
  causale_azienda_id: string | null
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const numeroDi = (anno: number, numero: number): string => `${numero}/${anno}`

/** Ambiti del registro (o di un solo CER), con carichi, scarichi, righe e righe incoerenti. */
export async function leggiAmbitiAbbinamento(
  client: ClientAbbinamenti,
  tenantId: string,
  filtro: { registroId: string; cer?: string },
  opzioni: OpzioniLettoreAbbinamenti = {}
): Promise<AmbitoAbbinamento[]> {
  const { registroId, cer } = filtro
  const logger = opzioni.logger
  const cifre = cer !== undefined ? cerSoloCifre(cer) : null
  const movimenti = cifre
    ? await client.$queryRaw<RigaMovimento[]>`
        SELECT wm.id::text AS id, r.id::text AS radice_id, wm.type::text AS type, wm.cer_code,
               wm.unit, wm.quantity, wm.movement_date, wm.progressive_year, wm.progressive_number,
               r.progressive_year AS radice_year, r.progressive_number AS radice_number,
               wm.operation_code, wm.causale, wm.causale_azienda_id::text AS causale_azienda_id
        FROM waste_movements wm
        JOIN waste_movements r ON r.id = COALESCE(wm.movimento_originale_id, wm.id)
          AND r.tenant_id = wm.tenant_id
        WHERE wm.tenant_id = ${tenantId}::uuid AND wm.registro_id = ${registroId}::uuid
          AND ${sqlVigente('wm')}
          AND regexp_replace(wm.cer_code, '[^0-9]', '', 'g') = ${cifre}`
    : await client.$queryRaw<RigaMovimento[]>`
        SELECT wm.id::text AS id, r.id::text AS radice_id, wm.type::text AS type, wm.cer_code,
               wm.unit, wm.quantity, wm.movement_date, wm.progressive_year, wm.progressive_number,
               r.progressive_year AS radice_year, r.progressive_number AS radice_number,
               wm.operation_code, wm.causale, wm.causale_azienda_id::text AS causale_azienda_id
        FROM waste_movements wm
        JOIN waste_movements r ON r.id = COALESCE(wm.movimento_originale_id, wm.id)
          AND r.tenant_id = wm.tenant_id
        WHERE wm.tenant_id = ${tenantId}::uuid AND wm.registro_id = ${registroId}::uuid
          AND ${sqlVigente('wm')}`

  const chiaveFiltro = cer !== undefined ? chiaveConfrontoCer(cer) : null
  const aperture = (await leggiApertureRegistro(client, tenantId, { registroId })).filter(
    a => chiaveFiltro === null || chiaveConfrontoCer(a.cerCode) === chiaveFiltro
  )
  const righeDb = await client.abbinamentoCaricoScarico.findMany({
    where: { tenantId, registroId },
    select: {
      id: true,
      scaricoId: true,
      caricoId: true,
      giacenzaInizialeId: true,
      famiglia: true,
      quantita: true,
      origine: true,
    },
  })
  const catalogo = await caricaCatalogoCausali(client, tenantId)

  // --- ambiti ---
  const ambiti = new Map<string, AmbitoAbbinamento>()
  const piuRecente = new Map<string, EventoFifo>()
  const ambitoDi = (cerCode: string, unita: string): AmbitoAbbinamento => {
    const chiaveCer = chiaveConfrontoCer(cerCode)
    const famiglia = famigliaFifo(unita)
    const k = `${chiaveCer}|${famiglia}`
    let a = ambiti.get(k)
    if (!a) {
      a = {
        registroId,
        chiaveCer,
        cerCode: cerCanonico(cerCode),
        famiglia,
        unita: famiglia === 'KG' ? 'kg' : normalizzaUnitaRegistro(unita).unita,
        carichi: [],
        scarichi: [],
        righe: [],
        righeValide: [],
        righeMorteIds: [],
        righeIncoerenti: [],
        classi: [],
        diStoccaggio: false,
      }
      ambiti.set(k, a)
    }
    return a
  }

  /** carichi vigenti non di stoccaggio (radice -> ambito), per motivare le righe incoerenti */
  const caricoNonStoccaggio = new Map<string, AmbitoAbbinamento>()
  const scaricoPerRadice = new Map<string, AmbitoAbbinamento>()
  const caricoPerChiave = new Map<ChiaveCarico, AmbitoAbbinamento>()
  const ambitoCarichi = new Map<ChiaveCarico, CaricoAbbinabile>()
  const scarichiPerRadice = new Map<string, ScaricoAbbinabile>()

  for (const m of movimenti) {
    const quantita = quantitaFifo(Number(m.quantity), m.unit)
    if (!(quantita > 0) || millesimiFifo(quantita) <= 0) {
      logger?.warn(`Movimento ${m.id} saltato dagli abbinamenti: quantita non utilizzabile`)
      continue
    }
    const giorno = giornoItaliano(m.movement_date)
    const ordine = m.radice_year * 1e7 + m.radice_number
    const ambito = ambitoDi(m.cer_code, m.unit)
    // cerCode canonico: quello della testa piu recente (giorno, poi ordine)
    const evento: EventoFifo = {
      tipo: m.type === 'CARICO' ? 'CARICO' : 'SCARICO',
      giorno,
      quantita,
      origine: 'MOVIMENTO',
      ordine,
      riferimento: { id: m.radice_id, numero: numeroDi(m.progressive_year, m.progressive_number) },
    }
    const k = `${ambito.chiaveCer}|${ambito.famiglia}`
    const prec = piuRecente.get(k)
    if (!prec || confrontaEventiFifo(prec, evento) < 0) {
      piuRecente.set(k, evento)
      ambito.cerCode = cerCanonico(m.cer_code)
    }
    const numero = numeroDi(m.progressive_year, m.progressive_number)
    if (evento.tipo === 'CARICO') {
      const classe = classeStoccaggio(m.operation_code)
      if (!classe) {
        caricoNonStoccaggio.set(m.radice_id, ambito)
        continue
      }
      const c: CaricoAbbinabile = { chiave: `M:${m.radice_id}`, evento, classe, numero }
      ambito.carichi.push(c)
      caricoPerChiave.set(c.chiave, ambito)
      ambitoCarichi.set(c.chiave, c)
    } else {
      const operazione =
        catalogo.comportamento('SCARICO', m.causale, giorno, m.causale_azienda_id)?.operazione ??
        null
      const s: ScaricoAbbinabile = {
        radiceId: m.radice_id,
        evento,
        classeAttesa: classeAttesaScarico(m.operation_code, operazione),
        numero,
      }
      ambito.scarichi.push(s)
      scaricoPerRadice.set(s.radiceId, ambito)
      scarichiPerRadice.set(s.radiceId, s)
    }
  }

  for (const a of aperture) {
    const quantita = quantitaFifo(a.quantita, a.unita)
    const id = a.id ?? `${a.registroId}:${a.cerCode}:${a.unita}`
    if (!(quantita > 0) || millesimiFifo(quantita) <= 0) {
      logger?.warn(`Apertura ${id} saltata dagli abbinamenti: quantita non utilizzabile`)
      continue
    }
    const ambito = ambitoDi(a.cerCode, a.unita)
    const c: CaricoAbbinabile = {
      chiave: `A:${id}`,
      evento: {
        tipo: 'CARICO',
        giorno: a.dataRiferimento,
        quantita,
        origine: 'APERTURA',
        ordine: 0,
        riferimento: { id },
      },
      classe: null,
    }
    ambito.carichi.push(c)
    caricoPerChiave.set(c.chiave, ambito)
    ambitoCarichi.set(c.chiave, c)
  }

  // --- righe ---
  const righeDelRegistro = righeDb.map(r => ({
    id: r.id,
    scaricoId: r.scaricoId,
    chiave: r.caricoId ? `M:${r.caricoId}` : `A:${r.giacenzaInizialeId}`,
    famiglia: r.famiglia,
    quantita: Number(r.quantita),
    origine: r.origine,
  }))
  const filtrato = cer !== undefined
  const neutro = (cosa: 'carico' | 'scarico'): string =>
    filtrato ? `${cosa} non più vigente o di un altro rifiuto` : `${cosa} non più vigente`

  /** Controlli strutturali (vigenza, famiglia, ambito): non dipendono dalle somme. */
  function motivoStrutturale(r: (typeof righeDelRegistro)[number]): string | null {
    const s = scarichiPerRadice.get(r.scaricoId)
    if (!s) return neutro('scarico')
    if (scaricoPerRadice.get(r.scaricoId)?.famiglia !== r.famiglia) {
      return 'famiglia di unità diversa dallo scarico'
    }
    const c = ambitoCarichi.get(r.chiave)
    if (!c) {
      if (caricoNonStoccaggio.has(r.chiave.slice(2))) return 'carico senza operazione R13 o D15'
      return r.chiave.startsWith('A:') ? 'giacenza iniziale non trovata' : neutro('carico')
    }
    if (caricoPerChiave.get(r.chiave) !== scaricoPerRadice.get(r.scaricoId)) {
      return 'carico di un altro rifiuto'
    }
    return null
  }

  type RigaLetta = (typeof righeDelRegistro)[number]
  const attribuite: Array<{ r: RigaLetta; ambito: AmbitoAbbinamento }> = []
  const orfane: RigaLetta[] = []
  for (const r of righeDelRegistro) {
    const ambito =
      scaricoPerRadice.get(r.scaricoId) ??
      caricoPerChiave.get(r.chiave) ??
      (r.chiave.startsWith('M:') ? caricoNonStoccaggio.get(r.chiave.slice(2)) : undefined)
    if (ambito) attribuite.push({ r, ambito })
    else orfane.push(r)
  }

  // Righe con entrambi i capi fuori dall'ambito (es. entrambe le catene annullate): si ricava il
  // CER dallo scarico con UNA query (numero fisso) per non farle sparire.
  if (orfane.length > 0) {
    const ids = [...new Set(orfane.map(r => r.scaricoId))]
    const trovati = await client.$queryRaw<Array<{ id: string; cer_code: string; unit: string }>>`
      SELECT id::text AS id, cer_code, unit
      FROM waste_movements
      WHERE tenant_id = ${tenantId}::uuid AND registro_id = ${registroId}::uuid
        AND id = ANY(${ids}::uuid[])`
    const perId = new Map(trovati.map(t => [t.id, t]))
    for (const r of orfane) {
      const t = perId.get(r.scaricoId)
      if (!t) continue
      if (chiaveFiltro !== null && chiaveConfrontoCer(t.cer_code) !== chiaveFiltro) continue
      attribuite.push({ r, ambito: ambitoDi(t.cer_code, t.unit) })
    }
  }

  // Le somme contano solo le righe strutturalmente valide: una riga morta non fa risultare
  // incoerente una riga buona.
  const motivi = new Map<string, string | null>()
  const perScarico = new Map<string, number>()
  const perCarico = new Map<ChiaveCarico, number>()
  for (const { r } of attribuite) {
    const m = motivoStrutturale(r)
    motivi.set(r.id, m)
    if (m) continue
    const q = millesimiFifo(r.quantita)
    perScarico.set(r.scaricoId, (perScarico.get(r.scaricoId) ?? 0) + q)
    perCarico.set(r.chiave, (perCarico.get(r.chiave) ?? 0) + q)
  }

  for (const { r, ambito } of attribuite) {
    const rigaLetta: RigaAbbinamento = {
      scaricoRadiceId: r.scaricoId,
      carico: r.chiave,
      quantita: r.quantita,
      origine: r.origine,
    }
    ambito.righe.push(rigaLetta)
    if (motivi.get(r.id)) ambito.righeMorteIds.push(r.id)
    else ambito.righeValide.push(rigaLetta)
    let motivo = motivi.get(r.id) ?? null
    if (motivo && !scarichiPerRadice.has(r.scaricoId) && !ambitoCarichi.has(r.chiave)) {
      // entrambi i capi fuori dall'ambito
      if (!caricoNonStoccaggio.has(r.chiave.slice(2))) {
        motivo = filtrato ? neutro('scarico') : 'scarico e carico non più vigenti'
      }
    }
    if (!motivo) {
      const s = scarichiPerRadice.get(r.scaricoId) as ScaricoAbbinabile
      const c = ambitoCarichi.get(r.chiave) as CaricoAbbinabile
      if (confrontaEventiFifo(c.evento, s.evento) > 0) motivo = 'carico successivo allo scarico'
      else if ((perScarico.get(r.scaricoId) ?? 0) > millesimiFifo(s.evento.quantita)) {
        motivo = 'abbinato oltre la quantità dello scarico'
      } else if ((perCarico.get(r.chiave) ?? 0) > millesimiFifo(c.evento.quantita)) {
        motivo = 'abbinato oltre la quantità del carico'
      }
    }
    if (motivo) ambito.righeIncoerenti.push({ id: r.id, motivo })
  }

  for (const a of ambiti.values()) {
    a.classi = [
      ...new Set(a.carichi.map(c => c.classe).filter((c): c is ClasseStoccaggio => c !== null)),
    ].sort()
    a.diStoccaggio = a.classi.length > 0 || a.righe.length > 0
  }
  return [...ambiti.values()].sort((x, y) =>
    `${x.chiaveCer}|${x.famiglia}` < `${y.chiaveCer}|${y.famiglia}` ? -1 : 1
  )
}

/** Risolve un id qualunque della catena dello scarico: null se non esiste, non e uno scarico o e di un'altra azienda. */
export async function radiceScarico(
  client: ClientAbbinamenti,
  tenantId: string,
  id: string
): Promise<{ radiceId: string; registroId: string; cerCode: string } | null> {
  if (!UUID.test(id)) return null
  const m = await client.wasteMovement.findFirst({
    where: { id, tenantId, type: 'SCARICO' },
    select: { id: true, movimentoOriginaleId: true, registroId: true, cerCode: true },
  })
  if (!m) return null
  return {
    radiceId: m.movimentoOriginaleId ?? m.id,
    registroId: m.registroId,
    cerCode: cerCanonico(m.cerCode),
  }
}

/**
 * Righe e scarichi (numero, giorno) che usano la radice di un carico. Si contano solo le righe il
 * cui scarico ha una testa vigente: una riga orfana (scarico annullato in deroga, dato storico
 * incoerente) e' un limite noto e non blocca la correzione del carico.
 */
export async function righeDelCarico(
  client: ClientAbbinamenti,
  tenantId: string,
  caricoRadiceId: string
): Promise<
  Array<{
    scaricoRadiceId: string
    numeroScarico: string
    giornoScarico: string
    quantita: number
    famiglia: string
  }>
> {
  if (!UUID.test(caricoRadiceId)) return []
  const righe = await client.$queryRaw<
    Array<{
      scarico_id: string
      anno: number
      numero: number
      data: Date
      quantita: Prisma.Decimal | number | string
      famiglia: string
    }>
  >`
    SELECT a.scarico_id::text AS scarico_id,
           COALESCE(h.progressive_year, r.progressive_year) AS anno,
           COALESCE(h.progressive_number, r.progressive_number) AS numero,
           COALESCE(h.movement_date, r.movement_date) AS data,
           a.quantita, a.famiglia
    FROM abbinamenti_carico_scarico a
    JOIN waste_movements r ON r.id = a.scarico_id AND r.tenant_id = a.tenant_id
    LEFT JOIN waste_movements h
      ON COALESCE(h.movimento_originale_id, h.id) = a.scarico_id
     AND h.tenant_id = a.tenant_id AND h.registro_id = r.registro_id AND ${sqlVigente('h')}
    WHERE a.tenant_id = ${tenantId}::uuid AND a.carico_id = ${caricoRadiceId}::uuid
      AND h.id IS NOT NULL
    ORDER BY COALESCE(h.movement_date, r.movement_date), a.scarico_id`
  return righe.map(r => ({
    scaricoRadiceId: r.scarico_id,
    numeroScarico: numeroDi(r.anno, r.numero),
    giornoScarico: giornoItaliano(r.data),
    quantita: Number(r.quantita),
    famiglia: r.famiglia,
  }))
}
