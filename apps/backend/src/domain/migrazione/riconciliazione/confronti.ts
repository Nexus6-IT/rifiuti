/**
 * Confronti 1-5 della riconciliazione (piano import 3.6, I8): funzioni pure
 * (sorgente, destinazione) -> esito tipato. Il confronto 6 (campione a mano) sta in `campione.ts`.
 *
 * Regole: kg e m3 sono somme separate, mai sommate; soglia 0,001 kg sulle quantita'; un confronto che
 * si dovrebbe fare ma non si puo' verificare e' `NON_VERIFICATO` e porta una voce `DIFFERENZA`
 * accettabile con motivo (mai un `OK` silenzioso). Nessun valore personale.
 */
import {
  AmbitoLotto,
  ConfrontoRiconciliazione,
  EsitoConfronto,
  GiacenzaAttesa,
  RapportoDestinazione,
  SOGLIA_KG,
  Valore,
  VerificaRentri,
  VoceConfronto,
} from './tipi'

/** Il sottoinsieme del rapporto sorgente (`RapportoSorgente`) che serve ai confronti. */
export interface SorgenteRiconciliazione {
  readonly archivio: string
  readonly confronto1: {
    readonly movimentiPerOper: ReadonlyArray<{
      oper: string
      tipo: string
      attivi: number
      annullati: number
    }>
    readonly formulariPerStato: ReadonlyArray<{ stato: string; conteggio: number }>
  }
  readonly confronto2: {
    readonly righe: ReadonlyArray<{
      anno: number | null
      cer: string
      tipo: string
      movimenti: number
      kgnum: number
      mcnum: number
    }>
  }
  readonly confronto4: {
    readonly registri: ReadonlyArray<{
      anno: number
      conteggio: number
      buchiTotali: number
      duplicati: readonly number[]
    }>
  }
  readonly confronto5: {
    readonly renRegistrazioni:
      | { readonly presente: false }
      | { readonly presente: true; readonly conIdRentri: number }
  }
}

export interface IngressiConfronti {
  readonly sorgente: SorgenteRiconciliazione
  readonly destinazione: RapportoDestinazione
  /** Giacenze attese al taglio per CER (da `migrazione:prepara`); assenti = confronto 3 non verificato. */
  readonly giacenzeAttese?: readonly GiacenzaAttesa[]
  /** Verifiche in sola lettura su RENTRI; assenti = non eseguite. */
  readonly verificheRentri?: readonly VerificaRentri[]
}

const TABELLE_ANAGRAFICHE = [
  'Ditta',
  'SedeDitta',
  'Produttore',
  'Trasportatore',
  'Destinatario',
  'Automezzo',
]

function ambitiPresenti(d: RapportoDestinazione): ReadonlySet<AmbitoLotto> {
  return new Set(
    d.lotti.filter(l => l.stato === 'COMPLETATO' || l.stato === 'IN_CORSO').map(l => l.ambito)
  )
}

const arrotonda = (n: number): number => Math.round(n * 1000) / 1000

function voce(
  chiave: string,
  descrizione: string,
  sorgente: Valore,
  destinazione: Valore,
  tolleranza = 0
): VoceConfronto {
  let uguali: boolean
  if (typeof sorgente === 'number' && typeof destinazione === 'number') {
    uguali = Math.abs(sorgente - destinazione) < (tolleranza > 0 ? tolleranza : 0.5)
  } else uguali = sorgente === destinazione
  return { chiave, descrizione, sorgente, destinazione, esito: uguali ? 'OK' : 'DIFFERENZA' }
}

function esitoDa(voci: readonly VoceConfronto[]): EsitoConfronto {
  return voci.some(v => v.esito === 'DIFFERENZA') ? 'DIFFERENZE' : 'OK'
}

function nonApplicabile(
  numero: ConfrontoRiconciliazione['numero'],
  titolo: string,
  nota: string
): ConfrontoRiconciliazione {
  return { numero, titolo, esito: 'NON_APPLICABILE', nota, voci: [] }
}

/** Una differenza accettabile che segnala un confronto dovuto ma non verificabile. */
function nonVerificato(
  numero: ConfrontoRiconciliazione['numero'],
  titolo: string,
  motivo: string,
  voci: readonly VoceConfronto[] = []
): ConfrontoRiconciliazione {
  return {
    numero,
    titolo,
    esito: 'NON_VERIFICATO',
    nota: motivo,
    voci: [
      ...voci,
      {
        chiave: 'non-verificato',
        descrizione: motivo,
        sorgente: null,
        destinazione: null,
        esito: 'DIFFERENZA',
      },
    ],
  }
}

/** Un movimento ENTRAMBI conta una volta come carico e una come scarico. */
const comeCarico = (tipo: string): boolean => tipo === 'CARICO' || tipo === 'ENTRAMBI'
const comeScarico = (tipo: string): boolean => tipo === 'SCARICO' || tipo === 'ENTRAMBI'

// --- Confronto 1: conteggi ---------------------------------------------------------------------

export function confronto1(i: IngressiConfronti): ConfrontoRiconciliazione {
  const titolo = 'Conteggi per tabella e verso'
  const { sorgente: s, destinazione: d } = i
  const ambiti = ambitiPresenti(d)
  if (ambiti.size === 0) return nonApplicabile(1, titolo, 'nessun lotto caricato')
  const voci: VoceConfronto[] = []

  // Coerenza interna: le righe che portano l'id del lotto sono quelle che il caricatore ha contato.
  const perAmbito = (a: AmbitoLotto) =>
    d.lotti.filter(l => l.ambito === a).reduce((somma, l) => somma + l.inserite, 0)
  const righe = (tabelle: readonly string[]) =>
    tabelle.reduce((somma, t) => somma + (d.righePerTabella[t] ?? 0), 0)
  const tabellePerAmbito: ReadonlyArray<[AmbitoLotto, readonly string[]]> = [
    ['ANAGRAFICHE', TABELLE_ANAGRAFICHE],
    ['REGISTRO', ['WasteMovement']],
    ['GIACENZE', ['GiacenzaIniziale']],
    ['FIR', ['FIR']],
  ]
  for (const [ambito, tabelle] of tabellePerAmbito) {
    if (!ambiti.has(ambito)) continue
    voci.push(
      voce(
        `lotto-${ambito.toLowerCase()}`,
        `Righe con l'id del lotto ${ambito} contro le inserite dal caricatore`,
        perAmbito(ambito),
        righe(tabelle)
      )
    )
  }

  if (ambiti.has('REGISTRO')) {
    const carichi = s.confronto1.movimentiPerOper
      .filter(o => comeCarico(o.tipo))
      .reduce((n, o) => n + o.attivi, 0)
    const scarichi = s.confronto1.movimentiPerOper
      .filter(o => comeScarico(o.tipo))
      .reduce((n, o) => n + o.attivi, 0)
    voci.push(
      voce(
        'movimenti-carico',
        'Movimenti attivi di carico: WinWaste contro WasteFlow',
        carichi,
        d.movimentiPerVerso.CARICO
      ),
      voce(
        'movimenti-scarico',
        'Movimenti attivi di scarico: WinWaste contro WasteFlow',
        scarichi,
        d.movimentiPerVerso.SCARICO
      )
    )
  }
  if (ambiti.has('FIR')) {
    voci.push(
      voce(
        'fir',
        'Formulari: WinWaste contro WasteFlow (i FIR digitali si riacquisiscono da RENTRI)',
        s.confronto1.formulariPerStato.reduce((n, f) => n + f.conteggio, 0),
        d.firImportati
      )
    )
  }
  return { numero: 1, titolo, esito: esitoDa(voci), voci }
}

// --- Confronto 2: totali per CER, anno e verso -------------------------------------------------

export function confronto2(i: IngressiConfronti): ConfrontoRiconciliazione {
  const titolo = 'Totali per CER, anno, verso e unita'
  if (!ambitiPresenti(i.destinazione).has('REGISTRO'))
    return nonApplicabile(2, titolo, 'nessun lotto del registro')
  let senzaAnno = 0
  const attesi = new Map<string, { kg: number; m3: number }>()
  const somma = (chiave: string, kg: number, m3: number) => {
    const v = attesi.get(chiave) ?? { kg: 0, m3: 0 }
    v.kg += kg
    v.m3 += m3
    attesi.set(chiave, v)
  }
  for (const r of i.sorgente.confronto2.righe) {
    if (r.anno === null) {
      senzaAnno += r.movimenti
      continue
    }
    if (comeCarico(r.tipo)) somma(`${r.anno}|${r.cer}|CARICO`, r.kgnum, r.mcnum)
    if (comeScarico(r.tipo)) somma(`${r.anno}|${r.cer}|SCARICO`, r.kgnum, r.mcnum)
  }
  const trovati = new Map<string, { kg: number; m3: number }>()
  for (const t of i.destinazione.totali) trovati.set(`${t.anno}|${t.cer}|${t.verso}`, t)
  const voci: VoceConfronto[] = []
  if (senzaAnno > 0)
    voci.push(
      voce('senza-anno', 'Movimenti WinWaste senza data (non confrontabili per anno)', senzaAnno, 0)
    )
  for (const k of [...new Set([...attesi.keys(), ...trovati.keys()])].sort()) {
    const a = attesi.get(k)
    const t = trovati.get(k)
    voci.push(
      voce(`${k}|kg`, `Kg ${k}`, a ? arrotonda(a.kg) : 0, t ? arrotonda(t.kg) : 0, SOGLIA_KG),
      voce(`${k}|m3`, `m3 ${k}`, a ? arrotonda(a.m3) : 0, t ? arrotonda(t.m3) : 0, SOGLIA_KG)
    )
  }
  return { numero: 2, titolo, esito: esitoDa(voci), voci }
}

// --- Confronto 3: giacenza al taglio -----------------------------------------------------------

export function confronto3(i: IngressiConfronti): ConfrontoRiconciliazione {
  const titolo = 'Giacenza al taglio per CER'
  const d = i.destinazione
  if (!ambitiPresenti(d).has('GIACENZE'))
    return nonApplicabile(3, titolo, 'nessun lotto delle giacenze')
  const perCer = new Map<string, number>()
  for (const g of d.giacenze) perCer.set(g.cer, (perCer.get(g.cer) ?? 0) + g.kg)
  const voci: VoceConfronto[] = []
  const negative = d.giacenze.filter(g => g.kg < 0).length
  voci.push(voce('negative', 'Giacenze iniziali negative', 0, negative))
  if (!i.giacenzeAttese) {
    return nonVerificato(
      3,
      titolo,
      'giacenza attesa al taglio non fornita: confronto con il ricalcolo da RELAZ non eseguito',
      voci
    )
  }
  const attese = new Map<string, number>()
  for (const g of i.giacenzeAttese) attese.set(g.cer, (attese.get(g.cer) ?? 0) + g.kg)
  for (const cer of [...new Set([...attese.keys(), ...perCer.keys()])].sort()) {
    voci.push(
      voce(
        `cer|${cer}`,
        `Giacenza al taglio ${cer} (kg)`,
        arrotonda(attese.get(cer) ?? 0),
        arrotonda(perCer.get(cer) ?? 0),
        SOGLIA_KG
      )
    )
  }
  return { numero: 3, titolo, esito: esitoDa(voci), voci }
}

// --- Confronto 4: numerazione ------------------------------------------------------------------

export function confronto4(i: IngressiConfronti): ConfrontoRiconciliazione {
  const titolo = 'Numerazione del registro'
  const d = i.destinazione
  if (!ambitiPresenti(d).has('REGISTRO'))
    return nonApplicabile(4, titolo, 'nessun lotto del registro')
  const perAnno = (
    righe: ReadonlyArray<{ anno: number; conteggio: number; buchiTotali: number }>
  ): Map<number, { conteggio: number; buchi: number }> => {
    const m = new Map<number, { conteggio: number; buchi: number }>()
    for (const r of righe) {
      const v = m.get(r.anno) ?? { conteggio: 0, buchi: 0 }
      v.conteggio += r.conteggio
      v.buchi += r.buchiTotali
      m.set(r.anno, v)
    }
    return m
  }
  const sorg = perAnno(i.sorgente.confronto4.registri)
  const dest = perAnno(d.numerazione)
  const voci: VoceConfronto[] = []
  for (const anno of [...new Set([...sorg.keys(), ...dest.keys()])].sort()) {
    voci.push(
      voce(
        `anno|${anno}|conteggio`,
        `Annotazioni numerate nel ${anno}`,
        sorg.get(anno)?.conteggio ?? 0,
        dest.get(anno)?.conteggio ?? 0
      ),
      voce(
        `anno|${anno}|buchi`,
        `Buchi di numerazione nel ${anno}`,
        sorg.get(anno)?.buchi ?? 0,
        dest.get(anno)?.buchi ?? 0
      )
    )
  }
  const duplicatiSorgente = i.sorgente.confronto4.registri.reduce(
    (n, r) => n + r.duplicati.length,
    0
  )
  voci.push(
    voce(
      'collisioni',
      `Numeri doppi nel registro (${duplicatiSorgente} segnalati in WinWaste, 0 ammessi qui)`,
      0,
      d.collisioniNumerazione
    )
  )
  return { numero: 4, titolo, esito: esitoDa(voci), voci }
}

// --- Confronto 5: RENTRI -----------------------------------------------------------------------

export function confronto5(i: IngressiConfronti): ConfrontoRiconciliazione {
  const titolo = 'RENTRI: identificativi e blocco dell invio'
  const d = i.destinazione
  if (!ambitiPresenti(d).has('REGISTRO'))
    return nonApplicabile(5, titolo, 'nessun lotto del registro')
  const voci: VoceConfronto[] = [
    voce('non-bloccati', 'Movimenti importati non bloccati all invio', 0, d.rentri.nonBloccati),
  ]
  const ren = i.sorgente.confronto5.renRegistrazioni
  if (ren.presente) {
    voci.push(
      voce(
        'con-identificativo',
        'Registrazioni con identificativo RENTRI: WinWaste contro righe da riconciliare',
        ren.conIdRentri,
        d.rentri.conIdentificativo
      )
    )
  }
  const verifiche = i.verificheRentri
  if (d.rentri.identificativi.length > 0) {
    if (!verifiche) {
      return nonVerificato(
        5,
        titolo,
        'verifica in sola lettura su RENTRI non eseguita per gli identificativi importati',
        voci
      )
    }
    const per = (e: VerificaRentri['esito']) => verifiche.filter(v => v.esito === e).length
    voci.push(
      voce(
        'verifica-presenti',
        'Identificativi trovati su RENTRI (sola lettura)',
        d.rentri.identificativi.length,
        per('PRESENTE')
      ),
      voce('verifica-assenti', 'Identificativi non trovati su RENTRI', 0, per('ASSENTE')),
      voce(
        'verifica-non-raggiungibili',
        'Identificativi non verificabili per errore di RENTRI',
        0,
        per('NON_RAGGIUNGIBILE')
      )
    )
  }
  return { numero: 5, titolo, esito: esitoDa(voci), voci }
}

export function confrontiDa1A5(i: IngressiConfronti): ConfrontoRiconciliazione[] {
  return [confronto1(i), confronto2(i), confronto3(i), confronto4(i), confronto5(i)]
}
