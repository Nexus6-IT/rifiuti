/**
 * Scritture degli abbinamenti carico-scarico (4.6, Task 5): proposta FIFO alla registrazione di
 * uno scarico, override manuale e ricalcolo. Tutte da chiamare DENTRO una transazione: ognuna
 * prende da sola i lock della giacenza (D6, `chiaveLockGiacenza`, rientranti), poi rilegge
 * l'ambito con `leggiAmbitiAbbinamento` e applica le funzioni pure di
 * `domain/waste-movement/abbinamento-carichi`.
 *
 * I riferimenti sono sempre alla RADICE della catena di correzione (D1).
 */
import { BadRequestException, NotFoundException } from '@nestjs/common'
import type { Prisma } from '@prisma/client'
import { formattaQuantita } from '../../core/format/formatta-quantita'
import {
  proponiAbbinamenti,
  residui,
  validaRigheManuali,
  type CaricoAbbinabile,
  type ClasseStoccaggio,
  type RigaAbbinamento,
  type ScaricoAbbinabile,
} from '../../domain/waste-movement/abbinamento-carichi'
import { cerSoloCifre } from '../../domain/waste-movement/cer-registro'
import { millesimiFifo } from '../../domain/waste-movement/fifo-deposito'
import { chiaveLockGiacenza } from '../registro/chiave-lock-giacenza'
import {
  leggiAmbitiAbbinamento,
  radiceScarico,
  type AmbitoAbbinamento,
} from './lettore-abbinamenti'

const MSG_INDETERMINATA =
  "Il rifiuto è in stoccaggio sia R13 sia D15: indica l'abbinamento a mano (Giacenze → Abbinamenti)."

/** Advisory lock per ogni CER (chiavi distinte, in ordine lessicografico: nessun deadlock). */
export async function bloccaAmbiti(
  tx: Prisma.TransactionClient,
  registroId: string,
  cer: string[]
): Promise<void> {
  const chiavi = [...new Set(cer.map(c => chiaveLockGiacenza(registroId, c)))].sort()
  for (const chiave of chiavi) {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${chiave}))`
  }
}

/** Classe con cui uno scarico entra nella partizione automatica (D7 e domanda 3). */
export function classeEffettiva(
  a: AmbitoAbbinamento,
  s: ScaricoAbbinabile
): ClasseStoccaggio | null {
  return s.classeAttesa ?? (a.classi.length === 1 ? a.classi[0] : null)
}

/** Carichi della partizione: la classe e, se l'ambito ha una sola classe, le giacenze iniziali. */
export function carichiDellaClasse(
  a: AmbitoAbbinamento,
  classe: ClasseStoccaggio
): CaricoAbbinabile[] {
  return a.carichi.filter(
    c =>
      c.classe === classe || (c.classe === null && a.classi.length === 1 && a.classi[0] === classe)
  )
}

const sottrai = (x: number, y: number): number => (millesimiFifo(x) - millesimiFifo(y)) / 1000

function sommaDi(righe: RigaAbbinamento[], scaricoRadiceId: string): number {
  return (
    righe
      .filter(r => r.scaricoRadiceId === scaricoRadiceId)
      .reduce((s, r) => s + millesimiFifo(r.quantita), 0) / 1000
  )
}

type RigaNuova = Omit<RigaAbbinamento, 'origine'>

async function inserisciRighe(
  tx: Prisma.TransactionClient,
  a: AmbitoAbbinamento,
  tenantId: string,
  righe: RigaNuova[],
  origine: 'AUTOMATICO' | 'MANUALE',
  userId: string | null
): Promise<void> {
  if (righe.length === 0) return
  await tx.abbinamentoCaricoScarico.createMany({
    data: righe.map(r => ({
      tenantId,
      registroId: a.registroId,
      scaricoId: r.scaricoRadiceId,
      caricoId: r.carico.startsWith('M:') ? r.carico.slice(2) : null,
      giacenzaInizialeId: r.carico.startsWith('A:') ? r.carico.slice(2) : null,
      famiglia: a.famiglia,
      quantita: r.quantita.toFixed(3),
      origine,
      creatoDa: userId,
    })),
  })
}

async function cancellaRighe(tx: Prisma.TransactionClient, ids: string[]): Promise<void> {
  if (ids.length === 0) return
  await tx.abbinamentoCaricoScarico.deleteMany({ where: { id: { in: ids } } })
}

/** Stessa normalizzazione del lettore: cifre del CER e codice operazione senza spazi/punti, maiuscolo. */
async function haStoccaggioOAbbinamenti(
  tx: Prisma.TransactionClient,
  tenantId: string,
  registroId: string,
  cerCode: string
): Promise<boolean> {
  const cifre = cerSoloCifre(cerCode)
  const r = await tx.$queryRaw<Array<{ si: boolean }>>`
    SELECT (
      EXISTS (
        SELECT 1 FROM waste_movements wm
        WHERE wm.tenant_id = ${tenantId}::uuid AND wm.registro_id = ${registroId}::uuid
          AND wm.type = 'CARICO'
          AND regexp_replace(wm.cer_code, '[^0-9]', '', 'g') = ${cifre}
          AND upper(regexp_replace(COALESCE(wm.operation_code, ''), '[[:space:].]', '', 'g'))
              IN ('R13', 'D15')
      )
      OR EXISTS (
        SELECT 1 FROM abbinamenti_carico_scarico a
        JOIN waste_movements s ON s.id = a.scarico_id AND s.tenant_id = a.tenant_id
        WHERE a.tenant_id = ${tenantId}::uuid AND a.registro_id = ${registroId}::uuid
          AND regexp_replace(s.cer_code, '[^0-9]', '', 'g') = ${cifre}
      )
    ) AS si`
  return r[0]?.si === true
}

/**
 * Subito dopo l'insert di uno scarico: proposta FIFO sui residui attuali dei carichi della sua
 * partizione (con giorno <= al suo: lo garantisce l'ordine del FIFO). Restituisce gli avvisi.
 */
export async function abbinaNuovoScarico(
  tx: Prisma.TransactionClient,
  p: { tenantId: string; registroId: string; scaricoId: string; userId: string | null }
): Promise<string[]> {
  const m = await tx.wasteMovement.findFirst({
    where: { id: p.scaricoId, tenantId: p.tenantId, registroId: p.registroId, type: 'SCARICO' },
    select: { cerCode: true, movimentoOriginaleId: true },
  })
  if (!m) return []
  // Pre-controllo leggero (hot path della registrazione): un registro ordinario, senza carichi
  // R13/D15 ne righe di abbinamento per quel CER, non paga ne lock ne letture dell'ambito.
  // E' un sovrainsieme di `diStoccaggio` (carico anche non vigente): nel dubbio si prosegue.
  if (!(await haStoccaggioOAbbinamenti(tx, p.tenantId, p.registroId, m.cerCode))) return []
  await bloccaAmbiti(tx, p.registroId, [m.cerCode])
  const radiceId = m.movimentoOriginaleId ?? p.scaricoId
  const ambiti = await leggiAmbitiAbbinamento(tx, p.tenantId, {
    registroId: p.registroId,
    cer: m.cerCode,
  })
  const a = ambiti.find(x => x.scarichi.some(s => s.radiceId === radiceId))
  if (!a || !a.diStoccaggio) return []
  const s = a.scarichi.find(x => x.radiceId === radiceId) as ScaricoAbbinabile

  const classe = classeEffettiva(a, s)
  if (!classe) return a.classi.length > 1 ? [MSG_INDETERMINATA] : []

  // i residui si calcolano solo sulle righe strutturalmente valide: una riga morta non blocca
  const rimasti = residui(a.carichi, a.righeValide)
  const { righe, scoperti } = proponiAbbinamenti({
    carichi: carichiDellaClasse(a, classe).map(c => ({
      chiave: c.chiave,
      evento: c.evento,
      residuo: Math.max(rimasti.get(c.chiave) ?? 0, 0),
    })),
    scarichi: [
      {
        radiceId,
        evento: s.evento,
        daCoprire: Math.max(sottrai(s.evento.quantita, sommaDi(a.righeValide, radiceId)), 0),
      },
    ],
  })
  await inserisciRighe(tx, a, p.tenantId, righe, 'AUTOMATICO', p.userId)

  const scoperto = scoperti.get(radiceId) ?? 0
  if (scoperto <= 0) return []
  const coperto = sottrai(s.evento.quantita, scoperto)
  if (millesimiFifo(coperto) <= 0) {
    return [
      `Nessun carico in stoccaggio ${classe} è disponibile per questo scarico: completa l'abbinamento da Giacenze → Abbinamenti.`,
    ]
  }
  return [
    `Lo scarico è coperto dai carichi in stoccaggio ${classe} solo per ${formattaQuantita(coperto)} ${a.unita}: completa l'abbinamento da Giacenze → Abbinamenti.`,
  ]
}

/** Sostituisce tutte le righe di uno scarico con righe MANUALE validate (elenco vuoto: lo scollega). */
export async function salvaAbbinamentoManuale(
  tx: Prisma.TransactionClient,
  p: {
    tenantId: string
    scaricoRadiceId: string
    userId: string
    righe: Array<{ caricoId?: string; giacenzaInizialeId?: string; quantita: number }>
  }
): Promise<{ avvisi: string[] }> {
  const radice = await radiceScarico(tx, p.tenantId, p.scaricoRadiceId)
  if (!radice) throw new NotFoundException('Scarico non trovato')
  await bloccaAmbiti(tx, radice.registroId, [radice.cerCode])
  const ambiti = await leggiAmbitiAbbinamento(tx, p.tenantId, {
    registroId: radice.registroId,
    cer: radice.cerCode,
  })
  const a = ambiti.find(x => x.scarichi.some(s => s.radiceId === radice.radiceId))
  const s = a?.scarichi.find(x => x.radiceId === radice.radiceId)
  if (!a || !s) throw new NotFoundException('Scarico non trovato')

  if (p.righe.some(r => Boolean(r.caricoId) === Boolean(r.giacenzaInizialeId))) {
    throw new BadRequestException('Indica per ogni riga un carico oppure una giacenza iniziale.')
  }
  const righe = p.righe.map(r => ({
    carico: r.caricoId ? `M:${r.caricoId}` : `A:${r.giacenzaInizialeId}`,
    quantita: r.quantita,
  }))
  const rimasti = residui(
    a.carichi,
    a.righeValide.filter(r => r.scaricoRadiceId !== radice.radiceId)
  )
  const esito = validaRigheManuali({
    scarico: s,
    righe,
    candidati: a.carichi,
    residuoEsclusoScarico: rimasti,
  })
  if (esito.errori.length > 0) throw new BadRequestException(esito.errori.join(' '))

  const precedenti = await tx.abbinamentoCaricoScarico.findMany({
    where: { tenantId: p.tenantId, scaricoId: radice.radiceId },
    select: { id: true },
  })
  await cancellaRighe(
    tx,
    precedenti.map(r => r.id)
  )
  await inserisciRighe(
    tx,
    a,
    p.tenantId,
    righe.map(r => ({ scaricoRadiceId: radice.radiceId, ...r })),
    'MANUALE',
    p.userId
  )
  const etichetta = new Map(
    a.carichi.map(c => [c.chiave, c.numero ?? `giacenza iniziale del ${c.evento.giorno}`])
  )
  await tx.activityLog.create({
    data: {
      tenantId: p.tenantId,
      userId: p.userId,
      action: 'ABBINAMENTO_SCARICO_MODIFICATO',
      description: `Abbinamento dello scarico n. ${s.numero} modificato a mano: ${righe.length} righe`,
      metadata: {
        scarico: s.numero,
        cerCode: a.cerCode,
        righePrecedenti: precedenti.length,
        righe: righe.map(r => ({
          carico: etichetta.get(r.carico) ?? null,
          quantita: r.quantita,
        })),
      },
    },
  })
  return { avvisi: esito.avvisi }
}

/**
 * Ricalcolo per registro (facoltativo un CER). `NON_ABBINATI` riempie solo gli scarichi senza
 * righe, sui residui; `AUTOMATICI` cancella le righe AUTOMATICO, tiene le MANUALE e rifa il resto.
 */
export async function ricalcolaAbbinamenti(
  tx: Prisma.TransactionClient,
  p: {
    tenantId: string
    registroId: string
    cer?: string
    modalita: 'NON_ABBINATI' | 'AUTOMATICI'
    userId: string
    logger?: { warn(messaggio: string): void }
  }
): Promise<{
  scarichiAbbinati: number
  righeScritte: number
  righeCancellate: number
  avvisi: string[]
}> {
  let cerDaBloccare: string[]
  if (p.cer !== undefined) {
    cerDaBloccare = [p.cer]
  } else {
    const [mov, gia] = await Promise.all([
      tx.wasteMovement.findMany({
        where: { tenantId: p.tenantId, registroId: p.registroId },
        distinct: ['cerCode'],
        select: { cerCode: true },
      }),
      tx.giacenzaIniziale.findMany({
        where: { tenantId: p.tenantId, registroId: p.registroId },
        distinct: ['cerCode'],
        select: { cerCode: true },
      }),
    ])
    cerDaBloccare = [...mov, ...gia].map(r => r.cerCode)
  }
  await bloccaAmbiti(tx, p.registroId, cerDaBloccare)
  const bloccate = new Set(cerDaBloccare.map(c => chiaveLockGiacenza(p.registroId, c)))
  const ambiti = await leggiAmbitiAbbinamento(tx, p.tenantId, {
    registroId: p.registroId,
    cer: p.cer,
  })

  let righeScritte = 0
  let righeCancellate = 0
  const abbinati = new Set<string>()
  let indeterminati = 0
  let daCompletare = 0

  for (const a of ambiti) {
    if (!a.diStoccaggio) continue
    // Senza CER i lock si prendono PRIMA di leggere: un CER comparso nel frattempo non e'
    // bloccato, quindi lo si salta (il ricalcolo successivo lo prendera') invece di scrivere
    // senza lock.
    if (!bloccate.has(chiaveLockGiacenza(a.registroId, a.cerCode))) {
      p.logger?.warn('Ricalcolo abbinamenti: ambito comparso durante il ricalcolo, saltato')
      continue
    }
    const idsScarichi = a.scarichi.map(s => s.radiceId)
    // solo le righe valide contano: uno scarico con sole righe morte e da riabbinare
    const conRighe = new Set(a.righeValide.map(r => r.scaricoRadiceId))
    // Scarichi lasciati come sono: con righe MANUALE (la scelta dell'operatore non si completa
    // in silenzio) o con classe indeterminata (nessuna partizione automatica li riguarda).
    const intoccabili = new Set<string>()
    if (p.modalita === 'AUTOMATICI') {
      for (const r of a.righe) if (r.origine === 'MANUALE') intoccabili.add(r.scaricoRadiceId)
      for (const s of a.scarichi) if (classeEffettiva(a, s) === null) intoccabili.add(s.radiceId)
    }
    let tenute: RigaAbbinamento[]
    let daCancellare: string[] = []
    if (p.modalita === 'AUTOMATICI') {
      tenute = a.righeValide.filter(r => intoccabili.has(r.scaricoRadiceId))
      const auto = await tx.abbinamentoCaricoScarico.findMany({
        where: {
          tenantId: p.tenantId,
          registroId: p.registroId,
          origine: 'AUTOMATICO',
          OR: [
            { scaricoId: { in: idsScarichi.filter(id => !intoccabili.has(id)) } },
            // righe morte (un capo non vigente, famiglia o ambito sbagliati)
            { id: { in: a.righeMorteIds } },
          ],
        },
        select: { id: true, scaricoId: true },
      })
      // le AUTOMATICO morte si cancellano anche per gli scarichi intoccabili (le MANUALE mai)
      const morte = new Set(a.righeMorteIds)
      daCancellare = auto
        .filter(r => !intoccabili.has(r.scaricoId) || morte.has(r.id))
        .map(r => r.id)
    } else {
      // NON_ABBINATI: le righe morte restano dove sono, ma non contano nei residui
      tenute = a.righeValide
    }
    const rimasti = residui(a.carichi, tenute)
    const nuove: RigaNuova[] = []

    for (const classe of ['R13', 'D15'] as const) {
      const scarichi = a.scarichi
        .filter(s => classeEffettiva(a, s) === classe)
        .filter(s => !intoccabili.has(s.radiceId))
        .filter(s => p.modalita === 'AUTOMATICI' || !conRighe.has(s.radiceId))
        .map(s => ({
          radiceId: s.radiceId,
          evento: s.evento,
          daCoprire: Math.max(sottrai(s.evento.quantita, sommaDi(tenute, s.radiceId)), 0),
        }))
        .filter(s => millesimiFifo(s.daCoprire) > 0)
      if (scarichi.length === 0) continue
      const { righe, scoperti } = proponiAbbinamenti({
        carichi: carichiDellaClasse(a, classe).map(c => ({
          chiave: c.chiave,
          evento: c.evento,
          residuo: Math.max(rimasti.get(c.chiave) ?? 0, 0),
        })),
        scarichi,
      })
      nuove.push(...righe)
      daCompletare += scoperti.size
    }
    // scarichi a classe indeterminata ancora da coprire (quelli gia' coperti non si segnalano)
    indeterminati += a.scarichi.filter(
      s =>
        classeEffettiva(a, s) === null &&
        (p.modalita === 'AUTOMATICI' || !conRighe.has(s.radiceId)) &&
        millesimiFifo(sottrai(s.evento.quantita, sommaDi(a.righeValide, s.radiceId))) > 0
    ).length

    await cancellaRighe(tx, daCancellare)
    await inserisciRighe(tx, a, p.tenantId, nuove, 'AUTOMATICO', p.userId)
    righeCancellate += daCancellare.length
    righeScritte += nuove.length
    for (const r of nuove) abbinati.add(r.scaricoRadiceId)
  }

  const avvisi: string[] = []
  if (indeterminati > 0) {
    avvisi.push(
      indeterminati === 1
        ? "1 scarico con il rifiuto in stoccaggio sia R13 sia D15 non è stato abbinato: indica l'abbinamento a mano (Giacenze → Abbinamenti)."
        : `${indeterminati} scarichi con il rifiuto in stoccaggio sia R13 sia D15 non sono stati abbinati: indica l'abbinamento a mano (Giacenze → Abbinamenti).`
    )
  }
  if (daCompletare > 0) {
    avvisi.push(
      daCompletare === 1
        ? "1 scarico non è coperto del tutto dai carichi: completa l'abbinamento da Giacenze → Abbinamenti."
        : `${daCompletare} scarichi non sono coperti del tutto dai carichi: completa l'abbinamento da Giacenze → Abbinamenti.`
    )
  }

  const esito = { scarichiAbbinati: abbinati.size, righeScritte, righeCancellate, avvisi }
  await tx.activityLog.create({
    data: {
      tenantId: p.tenantId,
      userId: p.userId,
      action: 'ABBINAMENTI_RICALCOLATI',
      description: `Abbinamenti ricalcolati (${p.modalita === 'AUTOMATICI' ? 'automatici' : 'scarichi non abbinati'}): ${righeScritte} righe scritte, ${righeCancellate} cancellate`,
      metadata: {
        modalita: p.modalita,
        cerCode: p.cer ?? null,
        scarichiAbbinati: abbinati.size,
        righeScritte,
        righeCancellate,
      },
    },
  })
  return esito
}
