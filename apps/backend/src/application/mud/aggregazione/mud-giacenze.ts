import { cerCanonico, chiaveConfrontoCer } from '../../../domain/waste-movement/cer-registro'
import type { MudRifiutoLine } from '../export/mud-export.types'
import {
  CHIAVE_AZIENDA,
  dichiarazioneDelRegistro,
  type ContestoSedi,
  type MudDichiarazione,
  type MudUnitaLocaleAnagrafica,
} from './mud-dichiarazioni'
import { chiaveGiacenza, type IntegrazioniMud } from './mud-integrazioni'

// Giacenze al 31/12 per dichiarazione e CER (Fase 2 pezzo 8, D8 e D9). Funzioni pure: il servizio
// legge i saldi e i carichi ricevuti da terzi, qui si decide dove scriverli e come ripartirli.

const arrotonda3 = (n: number): number => Math.round(n * 1000) / 1000

/** Sotto mezzo grammo il saldo è rumore dell'aritmetica (stessa soglia di oggi). */
const SOGLIA_KG = 0.0005

/** Saldo di un registro per un CER, senza filtro di positività (lo applica `giacenzeDelleDichiarazioni`). */
export interface SaldoRegistro {
  registroId: string
  /** CER canonico, con l'asterisco se il rifiuto è pericoloso */
  cerCode6: string
  kg: number
  pericoloso: boolean
}

/** CER che un registro ha ricevuto da terzi fino al 31/12 (carico con ruolo RICEVUTO_DA_TERZI). */
export interface RicevutoDaTerzi {
  registroId: string
  cerCode: string
}

export type MotivoNonDichiarata = 'NESSUN_MOVIMENTO' | 'RICEVUTO_DA_TERZI'

export interface VoceNonDichiarata {
  /** CER canonico, con l'asterisco se pericoloso */
  cerCode: string
  kg: number
  motivo: MotivoNonDichiarata
}

/** Giacenze di una dichiarazione che il file non scrive (un solo avviso per dichiarazione). */
export interface GiacenzeNonDichiarate {
  chiave: string
  unitaLocale: MudUnitaLocaleAnagrafica | null
  /** ordinate per CER */
  voci: VoceNonDichiarata[]
}

/** Giacenza scritta con una destinazione stimata: da segnalare all'utente (D9 punti 3 e 4). */
export interface EsitoRipartizione {
  tipo: 'RIPARTITA' | 'DESTINAZIONE_NON_INDICATA'
  chiave: string
  unitaLocale: MudUnitaLocaleAnagrafica | null
  /** 6 cifre */
  cer6: string
  /** CER canonico, con l'asterisco se pericoloso */
  cerCode: string
  kg: number
  recuperoKg: number
  smaltimentoKg: number
}

export interface EsitoGiacenze {
  /** righe nuove di ogni dichiarazione (chiave = id sede o CHIAVE_AZIENDA), stesso ordine */
  righe: Map<string, MudRifiutoLine[]>
  nonDichiarate: GiacenzeNonDichiarate[]
  ripartizioni: EsitoRipartizione[]
  /** kg scritti nelle righe: con i kg non dichiarati dà il totale delle giacenze positive */
  kgScritti: number
}

interface SaldoAttribuito {
  chiave: string
  unitaLocale: MudUnitaLocaleAnagrafica | null
  kg: number
  pericoloso: boolean
}

const chiaveDi = (d: Pick<MudDichiarazione, 'unitaLocale'>): string =>
  d.unitaLocale.id ?? CHIAVE_AZIENDA

/** D8: scrive la giacenza al 31/12 nelle righe delle dichiarazioni, o la dichiara non dichiarata. */
export function giacenzeDelleDichiarazioni(
  saldi: SaldoRegistro[],
  contesto: ContestoSedi,
  dichiarazioni: Array<Pick<MudDichiarazione, 'unitaLocale' | 'righe'>>,
  ricevutiDaTerzi: RicevutoDaTerzi[],
  integrazioni: IntegrazioniMud
): EsitoGiacenze {
  const ordineDi = (chiave: string): number =>
    chiave === CHIAVE_AZIENDA
      ? 1
      : (contesto.progressivi.get(chiave)?.progressivo ?? Number.MAX_SAFE_INTEGER)

  // 1. Saldo per (dichiarazione, CER a 6 cifre): più registri della stessa sede si sommano
  const perDichiarazione = new Map<string, Map<string, SaldoAttribuito>>()
  for (const s of saldi) {
    const a = dichiarazioneDelRegistro(s.registroId, contesto)
    // senza principale i movimenti restano fuori (D2): le giacenze vanno comunque dichiarate
    // come non scritte, sotto la dichiarazione "azienda"
    const chiave = a.tipo === 'dichiarazione' ? a.chiave : CHIAVE_AZIENDA
    const unitaLocale = a.tipo === 'dichiarazione' ? a.unitaLocale : null
    const cer6 = chiaveConfrontoCer(s.cerCode6)
    const gruppo = perDichiarazione.get(chiave) ?? new Map<string, SaldoAttribuito>()
    const prec = gruppo.get(cer6) ?? { chiave, unitaLocale, kg: 0, pericoloso: false }
    gruppo.set(cer6, {
      ...prec,
      kg: prec.kg + s.kg,
      pericoloso: prec.pericoloso || s.pericoloso || s.cerCode6.includes('*'),
    })
    perDichiarazione.set(chiave, gruppo)
  }

  // 2. CER ricevuti da terzi, per dichiarazione
  const ricevuti = new Set<string>()
  for (const r of ricevutiDaTerzi) {
    const a = dichiarazioneDelRegistro(r.registroId, contesto)
    if (a.tipo === 'dichiarazione') ricevuti.add(`${a.chiave}|${chiaveConfrontoCer(r.cerCode)}`)
  }

  const righe = new Map<string, MudRifiutoLine[]>()
  for (const d of dichiarazioni)
    righe.set(
      chiaveDi(d),
      d.righe.map(r => ({ ...r }))
    )

  const nonDichiarate = new Map<string, GiacenzeNonDichiarate>()
  const ripartizioni: EsitoRipartizione[] = []
  let kgScritti = 0
  const nonDichiarata = (s: SaldoAttribuito, cer6: string, motivo: MotivoNonDichiarata) => {
    const voce: VoceNonDichiarata = {
      cerCode: cerCanonico(s.pericoloso ? `${cer6}*` : cer6),
      kg: arrotonda3(s.kg),
      motivo,
    }
    const prec = nonDichiarate.get(s.chiave)
    if (prec) prec.voci.push(voce)
    else nonDichiarate.set(s.chiave, { chiave: s.chiave, unitaLocale: s.unitaLocale, voci: [voce] })
  }

  for (const [chiave, gruppo] of [...perDichiarazione].sort(
    (a, b) => ordineDi(a[0]) - ordineDi(b[0])
  )) {
    for (const [cer6, s] of [...gruppo].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))) {
      if (!(s.kg > SOGLIA_KG)) continue
      const elenco = righe.get(chiave)
      const indice = elenco ? elenco.findIndex(r => chiaveConfrontoCer(r.cerCode) === cer6) : -1
      if (!elenco || indice < 0) {
        nonDichiarata(s, cer6, 'NESSUN_MOVIMENTO')
        continue
      }
      if (ricevuti.has(`${chiave}|${cer6}`)) {
        nonDichiarata(s, cer6, 'RICEVUTO_DA_TERZI')
        continue
      }

      // D9: destinazione
      const kg = arrotonda3(s.kg)
      const riga = elenco[indice]
      const cerCode = cerCanonico(s.pericoloso ? `${cer6}*` : cer6)
      const integrata =
        integrazioni.destinazioniGiacenza[chiaveGiacenza(s.unitaLocale?.id ?? null, cer6)]
      let recupero: number
      let smaltimento: number
      let tipo: EsitoRipartizione['tipo'] | null = null
      if (integrata) {
        recupero = integrata.destinazione === 'R' ? kg : 0
        smaltimento = integrata.destinazione === 'D' ? kg : 0
      } else if (riga.recuperoKg > 0 && riga.smaltimentoKg === 0) {
        recupero = kg
        smaltimento = 0
      } else if (riga.smaltimentoKg > 0 && riga.recuperoKg === 0) {
        recupero = 0
        smaltimento = kg
      } else if (riga.recuperoKg > 0 && riga.smaltimentoKg > 0) {
        recupero = arrotonda3((kg * riga.recuperoKg) / (riga.recuperoKg + riga.smaltimentoKg))
        smaltimento = arrotonda3(kg - recupero)
        // se l'arrotondamento al grammo dà tutto a una componente è come «solo recupero» o
        // «solo smaltimento»: niente avviso con «0 kg» (F4)
        if (recupero > 0 && smaltimento > 0) tipo = 'RIPARTITA'
      } else {
        recupero = 0
        smaltimento = kg
        tipo = 'DESTINAZIONE_NON_INDICATA'
      }
      // nuovo oggetto, e un componente nullo resta assente (mai 0): l'hash della riga non cambia
      elenco[indice] = {
        ...riga,
        ...(recupero > 0 ? { giacenzaRecuperoKg: recupero } : {}),
        ...(smaltimento > 0 ? { giacenzaSmaltimentoKg: smaltimento } : {}),
      }
      kgScritti += kg
      if (tipo) {
        ripartizioni.push({
          tipo,
          chiave,
          unitaLocale: s.unitaLocale,
          cer6,
          cerCode,
          kg,
          recuperoKg: recupero,
          smaltimentoKg: smaltimento,
        })
      }
    }
  }

  return {
    righe,
    nonDichiarate: [...nonDichiarate.values()].sort(
      (a, b) => ordineDi(a.chiave) - ordineDi(b.chiave)
    ),
    ripartizioni,
    kgScritti: arrotonda3(kgScritti),
  }
}
