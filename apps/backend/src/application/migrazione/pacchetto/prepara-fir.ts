/**
 * `migrazione:prepara`, ambito FIR (I5): FORMULARI (+ AUTOMEZZI per la targa, XRENTRIFIRTRASMESSI per
 * l'IDRENTRI) -> fasi `fir` (cartacei e vidimati da WinWaste) e `fir-digitali` (solo elenco). Pura:
 * niente Prisma ne' NestJS, gira sulla workstation.
 *
 * REGOLE (piano I5, T1-T3):
 *  - `firNumber` e' `FORMU` cosi' com'e': MAI rinominato, neppure se duplicato (l'avviso
 *    `FIR_NUMBER_DUPLICATO` qui e la collisione bloccante in `--verifica` lato server).
 *  - `C7`: `''`, `R` e `9` sono FIR; `A` (annullato) e le richieste del portale (`0 1 2 3 4 8ELIMINATA`)
 *    sono scarti tipati.
 *  - FIR DIGITALI (`C6` = `DIGITALE` o `INVIATO A RENTRI ...`): NON si copiano. Vanno nell'elenco
 *    `fir-digitali` (numero + IDRENTRI) e si riacquisiscono da RENTRI con `migrazione:riacquisisci-fir`.
 *  - Stato dedotto: `COMPLETED` con data di fine trasporto e peso a destino, altrimenti
 *    `AWAITING_RECEIVER` (`deduciStatoFir`).
 *  - Le parti si riagganciano con l'indice di `prepara-anagrafiche` e la STESSA regola della chiave
 *    sede (`chiaveSedeDaSoggettoUnita`). Un sito proprio (`X...`) e' una sede della mappa; se non c'e'
 *    il FIR e' scartato (lo snapshot non si inventa).
 *  - Scarti e avvisi sono conteggi per codice, mai valori.
 *
 * FORME PRESUNTE (da riverificare sul primo `.bak`): `MEZ` = codice mezzo (4) del trasportatore
 * (`PRECOD` di AUTOMEZZI = `TRAS`), `DATF` `gg-mm-aaaa`, `FORMU` dei digitali = numero RENTRI.
 */
import {
  chiaveAutomezzo,
  chiaveSedeDaSoggettoUnita,
} from '../../../domain/migrazione/chiavi-legacy'
import { esRimorchio, normalizzaTarga } from '../../../domain/migrazione/winwaste/anagrafica'
import { deduciStatoFir } from '../../../domain/migrazione/winwaste/fir'
import { RecordFormulario } from '../../../domain/migrazione/winwaste/record'
import { SoggettoMovimento } from '../../../domain/migrazione/winwaste/soggetto'
import { ElementoLettura, StagingAperto } from '../staging/lettore-staging'
import { parsaFormulari } from '../staging/parser/formulari'
import { sorgenteDa } from '../staging/parser/scarti'
import { MappaImport } from './mappa-import'
import { IndiceAnagrafiche, VoceConteggio } from './prepara-anagrafiche'
import { ParteFir, RecordFir, RecordFirDigitale } from './record-fir'

export type CodiceAvvisoFir =
  | 'FIR_NUMBER_DUPLICATO'
  | 'SEDE_NON_RISOLTA'
  | 'TARGA_NON_RISOLTA'
  | 'DESCRIZIONE_OMESSA'
  | 'FIR_DIGITALE_SENZA_ID_RENTRI'
  | 'FIR_DIGITALE_SENZA_UNITA_LOCALE'

export interface RisultatoFir {
  readonly fir: readonly RecordFir[]
  readonly firDigitali: readonly RecordFirDigitale[]
  /** Codici di scarto dei FIR (e quelli del parser di FORMULARI), con la tabella. */
  readonly scarti: ReadonlyArray<VoceConteggio<string>>
  readonly avvisi: ReadonlyArray<VoceConteggio<CodiceAvvisoFir>>
}

type Campi = Readonly<Record<string, string | null>>
const T = (v: string | null | undefined): string => (v ?? '').trim()
// eslint-disable-next-line no-control-regex
const CONTROLLO = /[\u0000-\u001f\u007f]/

class Contatori<C extends string> {
  private readonly m = new Map<string, { tabella: string; codice: C; conteggio: number }>()
  conta(tabella: string, codice: C): void {
    const k = `${tabella}|${codice}`
    const v = this.m.get(k)
    if (v) v.conteggio++
    else this.m.set(k, { tabella, codice, conteggio: 1 })
  }
  elenco(): Array<VoceConteggio<C>> {
    return [...this.m.values()]
  }
}

async function* righe(staging: StagingAperto, tabella: string): AsyncGenerator<Campi> {
  if (!staging.ha(tabella)) return
  for await (const el of staging.leggi(tabella) as AsyncGenerator<ElementoLettura>) {
    if (el.tipo === 'riga') yield el.riga.campi
  }
}

type Ruolo = 'PRODUTTORE' | 'TRASPORTATORE' | 'DESTINATARIO'
type EsitoParte = { parte: ParteFir } | { scarto: string }

export async function preparaFir(
  staging: StagingAperto,
  mappa: MappaImport,
  anagrafiche: { readonly indice: IndiceAnagrafiche }
): Promise<RisultatoFir> {
  const scarti = new Contatori<string>()
  const avvisi = new Contatori<CodiceAvvisoFir>()
  const fir: RecordFir[] = []
  const firDigitali: RecordFirDigitale[] = []
  if (!staging.ha('FORMULARI')) {
    return { fir, firDigitali, scarti: [], avvisi: [] }
  }
  const { indice } = anagrafiche

  // Targhe: chiave automezzo -> targa (i rimorchi non sono mezzi di un FIR).
  const targhe = new Map<string, string>()
  for await (const c of righe(staging, 'AUTOMEZZI')) {
    if (esRimorchio(c.RIMORCHIO)) continue
    const targa = normalizzaTarga(c.TARGA)
    if (!targa) continue
    try {
      const k = chiaveAutomezzo(mappa.ditta, T(c.PRECOD), T(c.COD))
      if (!targhe.has(k)) targhe.set(k, targa)
    } catch {
      /* chiave non valida: il mezzo era gia' stato scartato da ANAGRAFICHE */
    }
  }
  // IDRENTRI per numero di FIR (le trasmissioni annullate non contano).
  const idRentri = new Map<string, string>()
  for await (const c of righe(staging, 'XRENTRIFIRTRASMESSI')) {
    if (T(c.XSEANNULLATO).toUpperCase() === 'X') continue
    const numero = T(c.NUMEROFIR)
    const id = T(c.IDRENTRI)
    if (numero !== '' && id !== '' && !idRentri.has(numero)) idRentri.set(numero, id)
  }

  const ulMappa = (s: SoggettoMovimento) =>
    mappa.unitaLocali.find(u => u.legacy.toUpperCase() === `${s.codice}.${s.unita}`.toUpperCase())

  function parteDa(
    s: SoggettoMovimento | null,
    ruolo: Ruolo,
    obbligatoria: boolean
  ): EsitoParte | null {
    if (s === null) return obbligatoria ? { scarto: `${ruolo}_ASSENTE` } : null
    const r = indice.risolvi(s.codice)
    if (r.tipo === 'ambiguo') return { scarto: `${ruolo}_AMBIGUO` }
    if (r.tipo === 'sconosciuto') return { scarto: `${ruolo}_NON_RISOLTO` }
    if (r.tipo === 'proprio') {
      const u = ulMappa(s)
      return u
        ? { parte: { tipo: 'propria', sedeId: u.sedeId } }
        : { scarto: `${ruolo}_PROPRIO_NON_IN_MAPPA` }
    }
    const { tenuto } = r
    let sedeKey: string | null = null
    try {
      sedeKey = chiaveSedeDaSoggettoUnita(mappa.ditta, { soggetto: s.codice }, s.unita, {
        precPerCod: indice.precPerCod(s.codice),
        precTenuto: tenuto.prec,
      })
    } catch {
      sedeKey = null
    }
    if (sedeKey === null || !indice.haSede(sedeKey)) {
      sedeKey = indice.sedePredefinita(tenuto.dittaKey)
      avvisi.conta('FORMULARI', 'SEDE_NON_RISOLTA')
    }
    const tipoRuolo =
      ruolo === 'PRODUTTORE'
        ? 'produttore'
        : ruolo === 'TRASPORTATORE'
          ? 'trasportatore'
          : 'destinatario'
    return {
      parte: {
        tipo: 'ditta',
        dittaKey: tenuto.dittaKey,
        dittaId: tenuto.dittaId,
        sedeKey,
        ruoloKey: indice.ruoloKey(tipoRuolo, tenuto.dittaKey),
      },
    }
  }

  const esito = await parsaFormulari(sorgenteDa(staging, 'FORMULARI'), {
    ditta: mappa.ditta,
    anno: mappa.anno,
  })
  for (const s of esito.scarti) scarti.conta('FORMULARI', s.codice)

  const contaNumeri = new Map<string, number>()
  for (const rec of esito.record as readonly RecordFormulario[]) {
    // 1. non sono FIR da portare
    if (rec.annullato || rec.statoFir === 'ANNULLATO') {
      scarti.conta('FORMULARI', 'FIR_ANNULLATO')
      continue
    }
    if (rec.statoFir === 'PORTALE') {
      scarti.conta('FORMULARI', 'RICHIESTA_PORTALE')
      continue
    }
    // 2. il numero e' obbligatorio e non si tocca
    if (rec.formu === '') {
      scarti.conta('FORMULARI', 'FORMU_ASSENTE')
      continue
    }
    if (rec.formu.length > 50 || CONTROLLO.test(rec.formu)) {
      scarti.conta('FORMULARI', 'FORMU_NON_VALIDO')
      continue
    }
    // 3. digitali: solo l'elenco
    if (rec.digitale) {
      const numero = rec.formu
      if (/\s/.test(numero)) {
        scarti.conta('FORMULARI', 'FORMU_NON_VALIDO')
        continue
      }
      const id = idRentri.get(numero) ?? null
      if (id === null) avvisi.conta('FORMULARI', 'FIR_DIGITALE_SENZA_ID_RENTRI')
      const propria = [rec.produttore, rec.trasportatore, rec.destinatario]
        .map(s => (s === null ? undefined : ulMappa(s)))
        .find(u => u !== undefined && u.unitaLocaleId !== null)
      if (!propria) avvisi.conta('FORMULARI', 'FIR_DIGITALE_SENZA_UNITA_LOCALE')
      firDigitali.push({
        legacyKey: rec.legacyKey,
        numeroFir: numero,
        idRentri: id,
        unitaLocaleId: propria?.unitaLocaleId ?? null,
      })
      continue
    }
    // 4. cartacei e vidimati da WinWaste
    const data = rec.dataDocumento ?? rec.data
    if (data === null) {
      scarti.conta('FORMULARI', 'DATA_ASSENTE')
      continue
    }
    if (rec.cer === null) {
      scarti.conta('FORMULARI', 'CER_ASSENTE')
      continue
    }
    const netto = rec.nettoKg === null ? null : Math.round(rec.nettoKg * 100) / 100
    // FIR senza peso a destino (tipicamente in viaggio al taglio): NON importato, con codice dedicato.
    // `firs.quantity` e' NOT NULL e l'aggregato rifiuta quantita' <= 0: importarlo 'senza quantita'
    // richiede una decisione di modello (nullable) o un segnaposto. Da registrare a mano (runbook).
    if (netto === null || netto <= 0) {
      scarti.conta('FORMULARI', 'FIR_IN_VIAGGIO_SENZA_PESO')
      continue
    }
    if (netto >= 100_000_000) {
      scarti.conta('FORMULARI', 'QUANTITA_NON_VALIDA')
      continue
    }
    const produttore = parteDa(rec.produttore, 'PRODUTTORE', true)
    const trasportatore = parteDa(rec.trasportatore, 'TRASPORTATORE', false)
    const destinatario = parteDa(rec.destinatario, 'DESTINATARIO', true)
    const sbagliata = [produttore, trasportatore, destinatario].find(
      p => p !== null && 'scarto' in p
    )
    if (sbagliata && 'scarto' in sbagliata) {
      scarti.conta('FORMULARI', sbagliata.scarto)
      continue
    }
    const { stato, dataFine } = deduciStatoFir({ datf: rec.grezzo.DATF ?? null, nettoKg: netto })
    let targa = ''
    if (rec.trasportatore) {
      const mez = T(rec.grezzo.MEZ)
      let trovata: string | undefined
      if (mez !== '') {
        try {
          trovata = targhe.get(
            chiaveAutomezzo(
              mappa.ditta,
              `${rec.trasportatore.codice}.${rec.trasportatore.unita}`,
              mez
            )
          )
        } catch {
          trovata = undefined
        }
      }
      if (trovata) targa = trovata
      else if (mez !== '') avvisi.conta('FORMULARI', 'TARGA_NON_RISOLTA')
    }
    const des = T(rec.grezzo.DES)
    const descrizione = des.length > 500 || CONTROLLO.test(des) ? '' : des
    if (descrizione !== des) avvisi.conta('FORMULARI', 'DESCRIZIONE_OMESSA')
    contaNumeri.set(rec.formu, (contaNumeri.get(rec.formu) ?? 0) + 1)
    fir.push({
      legacyKey: rec.legacyKey,
      firNumber: rec.formu,
      stato,
      dataTrasporto: data,
      dataFine,
      cerCode: rec.cer.codice,
      pericoloso: rec.cer.pericoloso,
      descrizione,
      quantitaKg: netto,
      targa,
      operazione: rec.moda.toUpperCase().startsWith('R') ? 'RECOVERY' : 'DISPOSAL',
      produttore: (produttore as { parte: ParteFir }).parte,
      trasportatore: trasportatore === null ? null : (trasportatore as { parte: ParteFir }).parte,
      destinatario: (destinatario as { parte: ParteFir }).parte,
    })
  }
  for (const n of contaNumeri.values())
    for (let i = 1; i < n; i++) avvisi.conta('FORMULARI', 'FIR_NUMBER_DUPLICATO')
  return { fir, firDigitali, scarti: scarti.elenco(), avvisi: avvisi.elenco() }
}
