import { Prisma } from '@prisma/client'
import type { ErroreDocumento, Segnalazione } from './codici'
import { TOLLERANZE_SDI } from './costanti-fiscali'
import type { RigaDocumentoCalcolata, RiepilogoIvaCalcolato } from './tipi'

/**
 * Controlli di coerenza degli importi che lo SDI fa sul file (spec §6.12, §17.4): dominio puro.
 * Una violazione e' `IMPORTI_NON_COERENTI`, mai un file scartato piu' tardi.
 */

const D = (v: string): Prisma.Decimal => new Prisma.Decimal(v)

/**
 * `PrezzoTotale` secondo la formula SDI: `PrezzoUnitario × Π(1 − sᵢ/100) × Quantita`, con gli
 * sconti `SC` in percentuale nell'ordine dato. Otto decimali (arrotondamento a meta' per eccesso).
 */
export function prezzoTotaleSdi(
  prezzoUnitario: string,
  quantita: string,
  sconti: readonly string[]
): string {
  let fattore = new Prisma.Decimal(1)
  for (const s of sconti) fattore = fattore.times(new Prisma.Decimal(1).minus(D(s).div(100)))
  return D(prezzoUnitario)
    .times(fattore)
    .times(D(quantita))
    .toDecimalPlaces(8, Prisma.Decimal.ROUND_HALF_UP)
    .toFixed(8)
}

/** Cascata normalizzata («10+5») -> percentuali; vuoto o nullo -> nessuna. */
function scontiDellaRiga(sconto: string | null): string[] {
  return sconto === null || sconto === '' ? [] : sconto.split('+')
}

const chiaveRiepilogo = (aliquota: string, natura: string | null): string =>
  `${D(aliquota).toFixed()}|${natura ?? ''}`

const nomeRiepilogo = (aliquota: string, natura: string | null): string =>
  `${D(aliquota).toFixed()}%${natura === null ? '' : ` ${natura}`}`

/**
 * Controlla `PrezzoTotale` (00423), `ImponibileImporto` (00422), `Imposta` (00421) e
 * `ImportoTotaleDocumento` (somma di imponibile e imposta dei riepiloghi, bollo addebitato
 * compreso perche' e' gia' una riga del riepilogo N1: non si somma una seconda volta). Restituisce
 * una segnalazione per ogni violazione; il dettaglio nomina il controllo, mai id.
 */
export function controllaCoerenzaSdi(d: {
  righe: readonly RigaDocumentoCalcolata[]
  riepiloghi: readonly RiepilogoIvaCalcolato[]
  totaleDocumento: string
}): Segnalazione<ErroreDocumento>[] {
  const errori: Segnalazione<ErroreDocumento>[] = []
  const violazione = (dettaglio: string): void => {
    errori.push({ codice: 'IMPORTI_NON_COERENTI', dettaglio })
  }

  const sommaRighe = new Map<string, Prisma.Decimal>()
  for (const r of d.righe) {
    const atteso = prezzoTotaleSdi(r.prezzoUnitario, r.quantita ?? '1', scontiDellaRiga(r.sconto))
    if (D(r.prezzoTotale).minus(D(atteso)).abs().greaterThan(D(TOLLERANZE_SDI.prezzoTotale))) {
      violazione(`PrezzoTotale linea ${r.numeroLinea} (controllo 00423)`)
    }
    const k = chiaveRiepilogo(r.aliquotaIva, r.naturaIva)
    sommaRighe.set(k, (sommaRighe.get(k) ?? new Prisma.Decimal(0)).plus(D(r.prezzoTotale)))
  }

  let totale = new Prisma.Decimal(0)
  for (const r of d.riepiloghi) {
    const nome = nomeRiepilogo(r.aliquota, r.natura)
    const somma = sommaRighe.get(chiaveRiepilogo(r.aliquota, r.natura)) ?? new Prisma.Decimal(0)
    if (D(r.imponibile).minus(somma).abs().greaterThan(D(TOLLERANZE_SDI.imponibile))) {
      violazione(`ImponibileImporto riepilogo ${nome} (controllo 00422)`)
    }
    const impostaAttesa = D(r.imponibile).times(D(r.aliquota)).div(100)
    if (D(r.imposta).minus(impostaAttesa).abs().greaterThan(D(TOLLERANZE_SDI.imposta))) {
      violazione(`Imposta riepilogo ${nome} (controllo 00421)`)
    }
    totale = totale.plus(D(r.imponibile)).plus(D(r.imposta))
  }
  // Ogni riga deve avere il suo riepilogo.
  const conRiepilogo = new Set(d.riepiloghi.map(r => chiaveRiepilogo(r.aliquota, r.natura)))
  for (const k of sommaRighe.keys()) {
    if (!conRiepilogo.has(k)) violazione('Riepilogo IVA mancante per una riga (controllo 00422)')
  }

  if (!D(d.totaleDocumento).equals(totale)) {
    violazione('ImportoTotaleDocumento diverso dalla somma dei riepiloghi')
  }
  return errori
}
