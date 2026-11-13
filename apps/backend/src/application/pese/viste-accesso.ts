// Costruzione delle viste di un accesso (D15): pesate con rettifiche, netto di D6, verifica
// delle impronte (D5), nomi degli operatori con UNA sola `user.findMany`. Solo lettura.
// Non contiene `puoOperare`/`puoRettificare`: dipendono dal ruolo e li aggiunge il controller.
// I collegamenti portano il documento (FIR o testa vigente dell'annotazione) e il confronto col netto.
import { Prisma } from '@prisma/client'
import {
  calcolaNetto,
  type EsitoNetto,
  type PesataPerNetto,
  type QualitaNetto,
} from '../../domain/pese/netto-accesso'
import { improntaPesata, improntaRettifica } from '../../domain/pese/impronta-pesata'
import { validaPesataManuale } from '../../domain/pese/regole-pesata'
import { giornoItaliano } from '../../core/time/anno-italiano'
import {
  confrontaConDocumento,
  type ConfrontoDocumento,
} from '../../domain/pese/confronto-documento'
import { etichettaFir } from '../../domain/fir/stati-fir'
import { chiavePubblicaDaBase64 } from '../../domain/pese/agenti/credenziali-agente'
import { leggiPayloadLettura } from '../../domain/pese/agenti/payload-lettura'
import { avvisiLettura } from '../../domain/pese/agenti/regole-lettura'
import { AccessoNonTrovatoError } from './errori-pese'
import { leggiMovimentiCollegati } from './movimenti-collegati'
import { AVVISO_ALIBI_ESTERNO } from './pesate-scrittura'

export const AVVISO_NON_INTEGRA = "Dato alterato fuori dall'applicazione."

export interface RettificaVista {
  id: string
  numero: number
  pesoPrecedenteKg: number
  pesoNuovoKg: number
  motivo: string
  autore: string | null
  createdAt: string
  allegato: AllegatoVistaPesa | null
  integra: boolean
}

export interface AllegatoVistaPesa {
  id: string
  nomeFile: string
  mimeType: string
  dimensioneByte: number
}

export const AVVISO_FIRMA_NON_VERIFICATA = 'Firma della lettura non verificata.'

/**
 * Riverifica la firma di una lettura: i byte conservati (`payload`, UTF-8) con la chiave pubblica
 * dell'agente. `false` se la chiave manca o la firma non corrisponde (o il contenuto e' stato alterato).
 */
export function firmaLetturaValida(
  lettura: { payload: string; firma: string },
  chiavePubblicaB64: string | null
): boolean {
  const chiave = chiavePubblicaB64 ? chiavePubblicaDaBase64(chiavePubblicaB64) : null
  if (!chiave) return false
  return leggiPayloadLettura(
    Buffer.from(lettura.payload, 'utf8').toString('base64'),
    lettura.firma,
    chiave
  ).ok
}

export interface PesataVista {
  id: string
  ordine: number
  fonte: string
  pesoOriginaleKg: number
  pesoEffettivoKg: number
  rettifiche: RettificaVista[]
  strumento: { id: string; descrizione: string; matricola: string | null } | null
  strumentoEsterno: string | null
  alibiId: string | null
  oraStrumento: string | null
  oraRicezione: string
  /** Lettura firmata da cui la pesata e' copiata (fonti STRUMENTO e SIMULATA), altrimenti null. */
  letturaId: string | null
  /** Firma della lettura riverificata con la chiave dell'agente; null se la pesata non ha lettura. */
  firmaValida: boolean | null
  /** Descrizione dell'agente che ha letto lo strumento. */
  agente: string | null
  operatore: string | null
  motivo: string | null
  allegato: AllegatoVistaPesa | null
  integra: boolean
  avvisi: string[]
}

/** Stato del FIR nella lingua del dominio (la persistenza usa l'enum inglese). */
const STATO_FIR_VISTA: Record<string, string> = {
  DRAFT: 'BOZZA',
  AWAITING_PRODUCER: 'BOZZA',
  AWAITING_CARRIER: 'EMESSO',
  AWAITING_RECEIVER: 'IN_TRANSITO',
  COMPLETED: 'CONSEGNATO',
  SYNCED_TO_RENTRI: 'CONSEGNATO',
  CANCELLED: 'ANNULLATO',
}

export interface CollegamentoVista {
  id: string
  tipo: string
  fir?: {
    id: string
    numero: string
    stato: string
    quantita: number
    unita: string
    pesoEffettivo: number | null
  }
  movimento?: {
    id: string
    numero: string
    numeroVigente: string | null
    quantita: number | null
    unita: string | null
    annullato: boolean
  }
  /** Netto della pesa contro la quantita' del documento; null se l'annotazione e' annullata. */
  confronto: ConfrontoDocumento | null
  creatoIl: string
  revocatoIl: string | null
  motivoRevoca: string | null
}

export interface AccessoVista {
  id: string
  numero: string
  registro: { id: string; descrizione: string }
  verso: string
  modo: string
  stato: string
  automezzo: { id: string; targa: string; targaRimorchio: string | null } | null
  targa: string | null
  targaRimorchio: string | null
  cerCode: string | null
  descrizione: string | null
  note: string | null
  apertoIl: string
  chiusoIl: string | null
  annullatoIl: string | null
  motivoAnnullamento: string | null
  pesate: PesataVista[]
  netto: EsitoNetto
  collegamenti: CollegamentoVista[]
  avvisi: string[]
  giaRegistrata?: true
}

export interface AccessoRiepilogo {
  id: string
  numero: string
  stato: string
  verso: string
  modo: string
  targa: string | null
  cerCode: string | null
  apertoIl: string
  nettoKg: number | null
  qualita: QualitaNetto | null
  manuale: boolean
  /** almeno una pesata arrivata da uno strumento (reale o simulata) */
  daStrumento: boolean
  /** almeno una pesata SIMULATA: non e' un peso reale */
  simulato: boolean
  rettificato: boolean
  collegato: boolean
}

type PesataConRettifiche = Prisma.PromiseReturnType<typeof leggiPesate>

const leggiPesate = (tx: Prisma.TransactionClient, tenantId: string, accessoIds: string[]) =>
  tx.pesata.findMany({
    where: { tenantId, accessoId: { in: accessoIds } },
    include: { rettifiche: { orderBy: { numero: 'asc' } } },
    orderBy: [{ accessoId: 'asc' }, { ordine: 'asc' }],
  })

function comePerNetto(p: PesataConRettifiche[number]): PesataPerNetto {
  return {
    ordine: p.ordine === 1 ? 1 : 2,
    fonte: p.fonte,
    pesoKg: Number(p.pesoKg),
    rettifiche: p.rettifiche.map(r => ({ numero: r.numero, pesoNuovoKg: Number(r.pesoNuovoKg) })),
    stabile: p.stabile,
    taraAggiornataIl: p.taraAggiornataIl ? p.taraAggiornataIl.toISOString() : null,
  }
}

export function nettoDelleRighe(
  verso: 'CARICO' | 'SCARICO',
  modo: 'DOPPIA' | 'TARA_ANAGRAFICA' | 'SINGOLA',
  pesate: PesataConRettifiche,
  adesso: Date
): EsitoNetto {
  return calcolaNetto(verso, modo, pesate.map(comePerNetto), giornoItaliano(adesso))
}

/** Vista completa di un accesso dell'azienda; AccessoNonTrovatoError se manca. */
export async function leggiVistaAccesso(
  tx: Prisma.TransactionClient,
  tenantId: string,
  accessoId: string,
  adesso: Date = new Date()
): Promise<AccessoVista> {
  const accesso = await tx.accessoPesa.findFirst({
    where: { id: accessoId, tenantId },
    include: {
      registro: { select: { id: true, descrizione: true } },
      automezzo: { select: { id: true, targa: true, targaRimorchio: true } },
      collegamenti: { orderBy: { creatoIl: 'asc' } },
    },
  })
  if (!accesso) throw new AccessoNonTrovatoError()
  const pesate = await leggiPesate(tx, tenantId, [accessoId])

  const allegatoIds = new Set<string>()
  const strumentoIds = new Set<string>()
  const utenteIds = new Set<string>()
  for (const p of pesate) {
    if (p.allegatoId) allegatoIds.add(p.allegatoId)
    if (p.strumentoId) strumentoIds.add(p.strumentoId)
    if (p.operatoreId) utenteIds.add(p.operatoreId)
    for (const r of p.rettifiche) {
      if (r.allegatoId) allegatoIds.add(r.allegatoId)
      utenteIds.add(r.autoreId)
    }
  }
  const letturaIds = [...new Set(pesate.flatMap(p => (p.letturaId ? [p.letturaId] : [])))]
  const letture = letturaIds.length
    ? await tx.letturaPesa.findMany({
        where: { tenantId, id: { in: letturaIds } },
        select: {
          id: true,
          agenteId: true,
          payload: true,
          firma: true,
          oraAgente: true,
          oraStrumento: true,
          oraRicezione: true,
          simulata: true,
        },
      })
    : []
  const agentiIds = [...new Set(letture.map(l => l.agenteId))]
  const agenti = agentiIds.length
    ? await tx.agentePesa.findMany({
        where: { tenantId, id: { in: agentiIds } },
        select: { id: true, chiavePubblica: true, descrizione: true },
      })
    : []
  const perLettura = new Map(letture.map(l => [l.id, l]))
  const perAgente = new Map(agenti.map(a => [a.id, a]))
  const esterni = pesate.filter(p => p.strumentoEsterno && p.alibiId)
  type Doppione = {
    id: string
    strumentoEsterno: string | null
    alibiId: string | null
    createdAt: Date
  }
  const nessuno: Doppione[] = []
  const [allegati, strumenti, utenti, doppioniAlibi] = await Promise.all([
    allegatoIds.size
      ? tx.allegatoPesa.findMany({
          where: { tenantId, id: { in: [...allegatoIds] } },
          select: { id: true, nomeFile: true, mimeType: true, dimensioneByte: true, sha256: true },
        })
      : [],
    strumentoIds.size
      ? tx.strumentoPesa.findMany({ where: { tenantId, id: { in: [...strumentoIds] } } })
      : [],
    utenteIds.size
      ? tx.user.findMany({
          where: { id: { in: [...utenteIds] } },
          select: { id: true, firstName: true, lastName: true },
        })
      : [],
    esterni.length
      ? tx.pesata.findMany({
          where: {
            tenantId,
            strumentoEsterno: { in: esterni.map(p => p.strumentoEsterno as string) },
            alibiId: { in: esterni.map(p => p.alibiId as string) },
          },
          select: { id: true, strumentoEsterno: true, alibiId: true, createdAt: true },
        })
      : nessuno,
  ])
  const perAllegato = new Map(allegati.map(a => [a.id, a]))
  const perStrumento = new Map(strumenti.map(s => [s.id, s]))
  const nomi = new Map(utenti.map(u => [u.id, `${u.firstName} ${u.lastName}`.trim()]))
  const vistaAllegato = (id: string | null): AllegatoVistaPesa | null => {
    const a = id ? perAllegato.get(id) : undefined
    return a
      ? { id: a.id, nomeFile: a.nomeFile, mimeType: a.mimeType, dimensioneByte: a.dimensioneByte }
      : null
  }

  const viste: PesataVista[] = pesate.map(p => {
    const sha = (id: string | null) => (id ? (perAllegato.get(id)?.sha256 ?? null) : null)
    const integraPesata =
      improntaPesata({
        tenantId: p.tenantId,
        accessoId: p.accessoId,
        ordine: p.ordine,
        fonte: p.fonte,
        strumentoId: p.strumentoId,
        strumentoEsterno: p.strumentoEsterno,
        alibiId: p.alibiId,
        pesoKg: p.pesoKg.toFixed(2),
        stabile: p.stabile,
        oraStrumento: p.oraStrumento,
        oraRicezione: p.oraRicezione,
        operatoreId: p.operatoreId,
        allegatoSha256: sha(p.allegatoId),
        automezzoId: p.automezzoId,
        taraAggiornataIl: p.taraAggiornataIl,
        chiaveIdempotenza: p.chiaveIdempotenza,
        letturaId: p.letturaId,
        firmaAgente: p.firmaAgente,
      }) === p.impronta
    const rettifiche = p.rettifiche.map<RettificaVista>(r => ({
      id: r.id,
      numero: r.numero,
      pesoPrecedenteKg: Number(r.pesoPrecedenteKg),
      pesoNuovoKg: Number(r.pesoNuovoKg),
      motivo: r.motivo,
      autore: nomi.get(r.autoreId) ?? null,
      createdAt: r.createdAt.toISOString(),
      allegato: vistaAllegato(r.allegatoId),
      integra:
        improntaRettifica({
          tenantId: r.tenantId,
          pesataId: r.pesataId,
          numero: r.numero,
          pesoPrecedenteKg: r.pesoPrecedenteKg.toFixed(2),
          pesoNuovoKg: r.pesoNuovoKg.toFixed(2),
          motivo: r.motivo,
          autoreId: r.autoreId,
          allegatoSha256: sha(r.allegatoId),
          createdAt: r.createdAt,
        }) === r.impronta,
    }))
    const strumento = p.strumentoId ? (perStrumento.get(p.strumentoId) ?? null) : null
    // Gli avvisi di D7 si ricalcolano come al momento della pesata (adesso = ora di ricezione).
    const avvisi =
      p.fonte === 'MANUALE'
        ? validaPesataManuale({
            pesoKg: Number(p.pesoKg),
            oraStrumento: null,
            adesso: p.oraRicezione,
            strumento: strumento
              ? {
                  portataMaxKg:
                    strumento.portataMaxKg === null ? null : Number(strumento.portataMaxKg),
                  divisioneKg:
                    strumento.divisioneKg === null ? null : Number(strumento.divisioneKg),
                  dataUltimaVerificazione: strumento.dataUltimaVerificazione
                    ? strumento.dataUltimaVerificazione.toISOString().slice(0, 10)
                    : null,
                  attivo: true,
                }
              : null,
          }).avvisi
        : []
    if (
      p.strumentoEsterno &&
      p.alibiId &&
      doppioniAlibi.some(
        d =>
          d.id !== p.id &&
          d.strumentoEsterno === p.strumentoEsterno &&
          d.alibiId === p.alibiId &&
          d.createdAt.getTime() < p.createdAt.getTime()
      )
    ) {
      avvisi.push(AVVISO_ALIBI_ESTERNO)
    }
    const lettura = p.letturaId ? (perLettura.get(p.letturaId) ?? null) : null
    const agente = lettura ? (perAgente.get(lettura.agenteId) ?? null) : null
    // Una pesata da lettura e' valida solo se la firma della lettura si riverifica ora.
    const firmaValida = p.letturaId
      ? lettura !== null &&
        firmaLetturaValida(lettura, agente?.chiavePubblica ?? null) &&
        lettura.firma === p.firmaAgente
      : null
    if (lettura) avvisi.push(...avvisiLettura(lettura))
    if (firmaValida === false) avvisi.push(AVVISO_FIRMA_NON_VERIFICATA)
    if (!integraPesata || rettifiche.some(r => !r.integra)) avvisi.push(AVVISO_NON_INTEGRA)
    const perNetto = comePerNetto(p)
    return {
      id: p.id,
      ordine: p.ordine,
      fonte: p.fonte,
      pesoOriginaleKg: Number(p.pesoKg),
      pesoEffettivoKg:
        perNetto.rettifiche.length > 0
          ? perNetto.rettifiche.reduce((a, b) => (b.numero > a.numero ? b : a)).pesoNuovoKg
          : perNetto.pesoKg,
      rettifiche,
      strumento: strumento
        ? { id: strumento.id, descrizione: strumento.descrizione, matricola: strumento.matricola }
        : null,
      strumentoEsterno: p.strumentoEsterno,
      alibiId: p.alibiId,
      oraStrumento: p.oraStrumento ? p.oraStrumento.toISOString() : null,
      oraRicezione: p.oraRicezione.toISOString(),
      letturaId: p.letturaId,
      firmaValida,
      agente: agente?.descrizione ?? null,
      operatore: p.operatoreId ? (nomi.get(p.operatoreId) ?? null) : null,
      motivo: p.motivoManuale,
      allegato: vistaAllegato(p.allegatoId),
      integra: integraPesata && rettifiche.every(r => r.integra),
      avvisi,
    }
  })

  // Un accesso chiuso si valuta al giorno della chiusura (avviso "tara vecchia"), non a oggi.
  const netto = nettoDelleRighe(accesso.verso, accesso.modo, pesate, accesso.chiusoIl ?? adesso)
  const collegamenti = await vistaCollegamenti(tx, tenantId, accesso.collegamenti, netto.nettoKg)
  const avvisiAccesso = [...netto.avvisi]
  if (viste.some(v => !v.integra)) avvisiAccesso.push(AVVISO_NON_INTEGRA)
  return {
    id: accesso.id,
    numero: `${accesso.numero}/${accesso.anno}`,
    registro: { id: accesso.registro.id, descrizione: accesso.registro.descrizione },
    verso: accesso.verso,
    modo: accesso.modo,
    stato: accesso.stato,
    automezzo: accesso.automezzo,
    targa: accesso.targa,
    targaRimorchio: accesso.targaRimorchio,
    cerCode: accesso.cerCode,
    descrizione: accesso.descrizione,
    note: accesso.note,
    apertoIl: accesso.apertoIl.toISOString(),
    chiusoIl: accesso.chiusoIl ? accesso.chiusoIl.toISOString() : null,
    annullatoIl: accesso.annullatoIl ? accesso.annullatoIl.toISOString() : null,
    motivoAnnullamento: accesso.motivoAnnullamento,
    pesate: viste,
    netto,
    collegamenti,
    avvisi: avvisiAccesso,
  }
}

async function vistaCollegamenti(
  tx: Prisma.TransactionClient,
  tenantId: string,
  righe: {
    id: string
    tipo: string
    firId: string | null
    movimentoId: string | null
    creatoIl: Date
    revocatoIl: Date | null
    motivoRevoca: string | null
  }[],
  nettoKg: number | null
): Promise<CollegamentoVista[]> {
  if (righe.length === 0) return []
  const firIds = righe.flatMap(c => (c.firId ? [c.firId] : []))
  const radiceIds = righe.flatMap(c => (c.movimentoId ? [c.movimentoId] : []))
  const [fir, movimenti] = await Promise.all([
    firIds.length
      ? tx.fIR.findMany({
          where: { tenantId, id: { in: firIds } },
          select: {
            id: true,
            firNumber: true,
            rentriNumeroFir: true,
            status: true,
            quantity: true,
            unit: true,
            effectiveWeight: true,
          },
        })
      : [],
    leggiMovimentiCollegati(tx, tenantId, radiceIds),
  ])
  const perFir = new Map(fir.map(f => [f.id, f]))
  return righe.map<CollegamentoVista>(c => {
    const base = {
      id: c.id,
      tipo: c.tipo,
      creatoIl: c.creatoIl.toISOString(),
      revocatoIl: c.revocatoIl ? c.revocatoIl.toISOString() : null,
      motivoRevoca: c.motivoRevoca,
    }
    const f = c.firId ? perFir.get(c.firId) : undefined
    if (f) {
      const quantita = Number(f.quantity)
      return {
        ...base,
        fir: {
          id: f.id,
          numero: etichettaFir({
            id: f.id,
            firNumber: f.firNumber,
            rentriNumeroFir: f.rentriNumeroFir,
          }),
          stato: STATO_FIR_VISTA[f.status] ?? 'BOZZA',
          quantita,
          unita: f.unit,
          pesoEffettivo: f.effectiveWeight === null ? null : Number(f.effectiveWeight),
        },
        // Il peso gia' scritto alla consegna (se c'e') e' il dato del documento.
        confronto: confrontaConDocumento(
          nettoKg,
          f.effectiveWeight === null ? quantita : Number(f.effectiveWeight),
          f.unit
        ),
      }
    }
    const m = c.movimentoId ? movimenti.get(c.movimentoId) : undefined
    if (m) {
      return {
        ...base,
        movimento: {
          id: m.radiceId,
          numero: m.numero,
          numeroVigente: m.numeroVigente,
          quantita: m.quantita,
          unita: m.unita,
          annullato: m.annullato,
        },
        confronto:
          m.quantita === null || m.unita === null
            ? null
            : confrontaConDocumento(nettoKg, m.quantita, m.unita),
      }
    }
    return { ...base, confronto: null }
  })
}

/** Righe dell'elenco: netto, qualita' e stato dei collegamenti in due letture per pagina. */
export async function leggiRiepiloghi(
  tx: Prisma.TransactionClient,
  tenantId: string,
  accessi: {
    id: string
    numero: number
    anno: number
    stato: string
    verso: 'CARICO' | 'SCARICO'
    modo: 'DOPPIA' | 'TARA_ANAGRAFICA' | 'SINGOLA'
    targa: string | null
    cerCode: string | null
    apertoIl: Date
    chiusoIl: Date | null
  }[],
  adesso: Date = new Date()
): Promise<AccessoRiepilogo[]> {
  if (accessi.length === 0) return []
  const ids = accessi.map(a => a.id)
  const [pesate, attivi] = await Promise.all([
    leggiPesate(tx, tenantId, ids),
    tx.collegamentoAccesso.findMany({
      where: { tenantId, accessoId: { in: ids }, revocatoIl: null },
      select: { accessoId: true },
    }),
  ])
  const collegati = new Set(attivi.map(c => c.accessoId))
  return accessi.map(a => {
    const sue = pesate.filter(p => p.accessoId === a.id)
    const netto = nettoDelleRighe(a.verso, a.modo, sue, a.chiusoIl ?? adesso)
    return {
      id: a.id,
      numero: `${a.numero}/${a.anno}`,
      stato: a.stato,
      verso: a.verso,
      modo: a.modo,
      targa: a.targa,
      cerCode: a.cerCode,
      apertoIl: a.apertoIl.toISOString(),
      nettoKg: netto.nettoKg,
      qualita: netto.qualita,
      manuale: netto.manuale,
      daStrumento: sue.some(p => p.fonte === 'STRUMENTO' || p.fonte === 'SIMULATA'),
      simulato: netto.simulato,
      rettificato: netto.rettificato,
      collegato: collegati.has(a.id),
    }
  })
}
