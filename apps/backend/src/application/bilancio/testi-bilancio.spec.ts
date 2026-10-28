import { fontiBilancio, lacune, tonnellate } from './testi-bilancio'
import { periodoBilancio } from './periodo-bilancio'
import type { BloccoBilancio } from './bilancio.types'

describe('tonnellate', () => {
  it('tonnellate: 1234567 kg -> "1.234,567 t"', () => {
    expect(tonnellate(1234567)).toBe('1.234,567 t')
  })
})

describe('lacune', () => {
  it('NESSUN_MOVIMENTO', () => {
    expect(lacune.nessunMovimento()).toEqual({
      blocco: 'PRODOTTO',
      codice: 'NESSUN_MOVIMENTO',
      testo: 'Nessun movimento vigente nel registro per il periodo: i totali sono a zero.',
    })
  })

  it('UNITA_NON_CONVERTITE singolare e plurale', () => {
    expect(lacune.unitaNonConvertite(1)).toEqual({
      blocco: 'PRODOTTO',
      codice: 'UNITA_NON_CONVERTITE',
      testo:
        "Un movimento in un'unità diversa da kg e t (litri, m³ o altro) non ha il peso specifico: non è nei totali.",
    })
    expect(lacune.unitaNonConvertite(3).testo).toBe(
      '3 movimenti in unità diverse da kg e t (litri, m³ o altro) non hanno il peso specifico: non sono nei totali.'
    )
  })

  it('STIMA_PESO_SPECIFICO', () => {
    expect(lacune.stimaPesoSpecifico(1500)).toEqual({
      blocco: 'PRODOTTO',
      codice: 'STIMA_PESO_SPECIFICO',
      testo:
        '1,5 t vengono da litri o m³ convertiti con il peso specifico delle integrazioni del MUD: sono una stima.',
    })
  })

  it('ESCLUSI_COME_NEL_MUD con e senza movimenti non in kg', () => {
    const base =
      '2 t del registro non sono conteggiati, con le stesse regole del MUD (causali escluse, FIR annullati o in bozza, doppi dello stesso FIR, rifiuti ricevuti da terzi): i motivi sono nella pagina MUD.'
    expect(lacune.esclusiComeNelMud(2000, 0)).toEqual({
      blocco: 'PRODOTTO',
      codice: 'ESCLUSI_COME_NEL_MUD',
      testo: base,
    })
    expect(lacune.esclusiComeNelMud(2000, 1).testo).toBe(
      base + ' Un altro movimento escluso non è in kg.'
    )
    expect(lacune.esclusiComeNelMud(2000, 4).testo).toBe(
      base + ' Altri 4 movimenti esclusi non sono in kg.'
    )
  })

  it('CONFRONTO_PARZIALE', () => {
    expect(lacune.confrontoParziale(2024, 2025, 9000, 10000)).toEqual({
      blocco: 'PRODOTTO',
      codice: 'CONFRONTO_PARZIALE',
      testo:
        'Il confronto con il 2024 conta solo i movimenti in kg e t, senza pesi specifici e senza togliere i doppi dello stesso FIR: per il 2025 risultano 9 t invece di 10 t.',
    })
  })

  it('OPERAZIONE_DA_VERIFICARE singolare e plurale, con i movimenti senza kg', () => {
    expect(lacune.operazioneDaVerificare(500, 1)).toEqual({
      blocco: 'DESTINAZIONE',
      codice: 'OPERAZIONE_DA_VERIFICARE',
      testo:
        '0,5 t (1 movimento) hanno recupero o smaltimento dedotto dal FIR o non indicato: sono la quota da verificare.',
    })
    expect(lacune.operazioneDaVerificare(2500, 3).testo).toBe(
      '2,5 t (3 movimenti) hanno recupero o smaltimento dedotto dal FIR o non indicato: sono la quota da verificare.'
    )
    expect(lacune.operazioneDaVerificare(500, 3, 1).testo).toBe(
      '0,5 t (3 movimenti) hanno recupero o smaltimento dedotto dal FIR o non indicato: sono la quota da verificare. Un movimento in litri, m³ o altra unità non ha i kg: non è in questa quota.'
    )
    expect(lacune.operazioneDaVerificare(500, 5, 2).testo).toContain(
      ' 2 movimenti in litri, m³ o altra unità non hanno i kg: non sono in questa quota.'
    )
  })

  it('SCARICHI_NON_RICONCILIATI', () => {
    expect(lacune.scarichiNonRiconciliati(13000, 11000)).toEqual({
      blocco: 'DESTINAZIONE',
      codice: 'SCARICHI_NON_RICONCILIATI',
      testo:
        "Gli scarichi vigenti avviati a terzi sommano 13 t nel registro, mentre recupero e smaltimento del MUD sommano 11 t (il MUD toglie i doppi dello stesso FIR e le ricopie): la quota in operazioni preliminari (R13/D15) e il confronto con l'anno precedente sono una stima.",
    })
  })

  it('PRELIMINARI_NON_COERENTI', () => {
    expect(lacune.preliminariNonCoerenti()).toEqual({
      blocco: 'DESTINAZIONE',
      codice: 'PRELIMINARI_NON_COERENTI',
      testo:
        'La quota in operazioni preliminari (R13/D15) supera il totale di recupero o di smaltimento: probabilmente ci sono scarichi doppi dello stesso FIR. Verificare nella pagina MUD.',
    })
  })

  it('MESI_SENZA_MOVIMENTI', () => {
    expect(lacune.mesiSenzaMovimenti([2, 8, 12])).toEqual({
      blocco: 'MESI',
      codice: 'MESI_SENZA_MOVIMENTI',
      testo:
        'Mesi senza movimenti: febbraio, agosto, dicembre. Un mese senza produzione è possibile: verificare che non manchino annotazioni.',
    })
  })

  it('SEGNALE_NON_DISPONIBILE', () => {
    expect(lacune.segnaleNonDisponibile('ritardiRegistro')).toEqual({
      blocco: 'SEGNALI',
      codice: 'SEGNALE_NON_DISPONIBILE',
      testo: 'Ritardi del registro: conteggio non ancora disponibile.',
    })
    expect(lacune.segnaleNonDisponibile('firSenzaRiscontro').testo).toBe(
      'FIR senza riscontro: conteggio non ancora disponibile.'
    )
    expect(lacune.segnaleNonDisponibile('avvisiDeposito').testo).toBe(
      'Avvisi del deposito temporaneo: conteggio non ancora disponibile.'
    )
  })
})

describe('fontiBilancio', () => {
  const oggi = new Date('2026-10-28T10:00:00Z')
  const fonti = fontiBilancio(periodoBilancio(2026, oggi), oggi)
  const R = 'Dal registro di carico e scarico, movimenti al 28/10/2026'

  it('ogni blocco ha la sua fonte con la data del periodo', () => {
    expect(fonti.PRODOTTO).toBe(
      `${R}: carichi vigenti con causale di produzione, con le regole del MUD.`
    )
    expect(fonti.DESTINAZIONE).toBe(
      `${R}: scarichi vigenti avviati a terzi; recupero o smaltimento dal codice operazione del movimento, poi dalla causale, poi dal FIR, come nel MUD.`
    )
    expect(fonti.PRINCIPALI).toBe(`${R}: prodotto per codice EER.`)
    expect(fonti.PERICOLOSI).toBe(`${R}: prodotto con codice EER pericoloso (asterisco).`)
    expect(fonti.MUD).toBe(
      "Stato registrato nella pagina MUD; scadenza dal tracciato dell'anno, altrimenti il 30 aprile."
    )
    expect(fonti.MESI).toBe(`${R}: mesi con almeno un movimento vigente.`)
    expect(fonti.GIACENZA).toBe(`${R}: carichi e giacenze iniziali meno scarichi, solo kg e t.`)
    expect(fonti.SEGNALI).toBe('Conteggi al 28/10/2026.')
  })

  it('anno chiuso: la data è il 31 dicembre', () => {
    const f = fontiBilancio(periodoBilancio(2025, oggi), oggi)
    expect(f.PRODOTTO).toContain('movimenti al 31/12/2025')
    expect(f.SEGNALI).toBe('Conteggi al 28/10/2026.')
  })

  it('nessun testo usa dichiarazione o attestazione', () => {
    const testi = [
      ...Object.values(fonti),
      lacune.nessunMovimento().testo,
      lacune.unitaNonConvertite(1).testo,
      lacune.unitaNonConvertite(2).testo,
      lacune.stimaPesoSpecifico(1).testo,
      lacune.esclusiComeNelMud(1, 1).testo,
      lacune.confrontoParziale(2024, 2025, 1, 2).testo,
      lacune.operazioneDaVerificare(1, 2, 1).testo,
      lacune.scarichiNonRiconciliati(2, 1).testo,
      lacune.preliminariNonCoerenti().testo,
      lacune.mesiSenzaMovimenti([1]).testo,
      lacune.segnaleNonDisponibile('avvisiDeposito').testo,
    ]
    for (const t of testi) expect(t).not.toMatch(/dichiar|attest|certific/i)
    const blocchi: BloccoBilancio[] = Object.keys(fonti) as BloccoBilancio[]
    expect(blocchi).toHaveLength(8)
  })
})
