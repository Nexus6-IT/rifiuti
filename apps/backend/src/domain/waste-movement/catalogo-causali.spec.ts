import {
  CatalogoCausali,
  type RigaCausaleAzienda,
  type RigaCausaleSistema,
} from './catalogo-causali'
import { righeCausaliSistema } from '../../application/registro/causali/catalogo-causali.fixture'

// Oracolo: le mappe di oggi di mud-regole.ts (ruolo) e operazioneDaCausale, scritte a mano.
const ATTESO: Array<[string, 'CARICO' | 'SCARICO', string, 'R' | 'D' | null, string | null]> = [
  ['PRODUZIONE_INTERNA', 'CARICO', 'PRODOTTO', null, 'DT'],
  ['INGRESSO_ESTERNO', 'CARICO', 'RICEVUTO_DA_TERZI', null, 'T*'],
  ['RICLASSIFICAZIONE', 'CARICO', 'ESCLUSO', null, null],
  ['RECUPERO_PARZIALE', 'CARICO', 'PRODOTTO', null, null],
  ['ALTRO_CARICO', 'CARICO', 'ESCLUSO', null, null],
  ['CONFERIMENTO_TRASPORTATORE', 'SCARICO', 'AVVIATO', null, 'aT'],
  ['AVVIO_RECUPERO', 'SCARICO', 'AVVIATO', 'R', 'aT'],
  ['AVVIO_SMALTIMENTO', 'SCARICO', 'AVVIATO', 'D', 'aT'],
  ['CESSIONE', 'SCARICO', 'AVVIATO', null, 'aT'],
  ['RICLASSIFICAZIONE', 'SCARICO', 'ESCLUSO', null, null],
  ['ALTRO_SCARICO', 'SCARICO', 'ESCLUSO', null, null],
]

function propria(
  id: string,
  codice: string,
  verso: 'CARICO' | 'SCARICO',
  validaDal: string,
  validaAl: string | null,
  extra: Partial<RigaCausaleAzienda> = {}
): RigaCausaleAzienda {
  return {
    id,
    natura: 'PROPRIA',
    codice,
    verso,
    descrizione: `Descrizione ${id}`,
    ruoloMud: 'ESCLUSO',
    codiceRentri: null,
    operazione: null,
    ordine: 100,
    validaDal,
    validaAl,
    ...extra,
  }
}

function disattivazione(codice: string, verso: 'CARICO' | 'SCARICO'): RigaCausaleAzienda {
  return {
    id: `dis-${codice}-${verso}`,
    natura: 'DISATTIVAZIONE',
    codice,
    verso,
    descrizione: null,
    ruoloMud: null,
    codiceRentri: null,
    operazione: null,
    ordine: 100,
    validaDal: null,
    validaAl: null,
  }
}

const GIORNO = '2026-06-15'

describe('CatalogoCausali', () => {
  const sistema = righeCausaliSistema()

  describe('comportamento delle 11 causali di sistema', () => {
    const catalogo = new CatalogoCausali(sistema, [])

    it.each(ATTESO)(
      '%s (%s): ruolo %s, operazione %s, RENTRI %s',
      (codice, verso, ruolo, op, rentri) => {
        const d = catalogo.comportamento(verso, codice, GIORNO)
        expect(d).not.toBeNull()
        expect(d!.ruoloMud).toBe(ruolo)
        expect(d!.operazione).toBe(op)
        expect(d!.codiceRentri).toBe(rentri)
        expect(d!.origine).toBe('SISTEMA')
        expect(d!.versioneId).toBeNull()
      }
    )

    it('le righe del fixture sono esattamente 11', () => {
      expect(sistema).toHaveLength(11)
    })

    it('RICLASSIFICAZIONE si risolve per verso', () => {
      expect(catalogo.comportamento('CARICO', 'RICLASSIFICAZIONE', GIORNO)!.verso).toBe('CARICO')
      expect(catalogo.comportamento('SCARICO', 'RICLASSIFICAZIONE', GIORNO)!.verso).toBe('SCARICO')
    })

    it('codice sconosciuto -> null', () => {
      expect(catalogo.comportamento('CARICO', 'INVENTATA', GIORNO)).toBeNull()
    })

    it('verso sbagliato (CESSIONE su CARICO) -> null', () => {
      expect(catalogo.comportamento('CARICO', 'CESSIONE', GIORNO)).toBeNull()
    })

    it('una causale AZ_ senza versione nel catalogo -> null', () => {
      expect(catalogo.comportamento('SCARICO', 'AZ_NON_ESISTE', GIORNO)).toBeNull()
    })
  })

  describe('disattivazione', () => {
    it("la disattivazione dell'azienda rende la causale DISATTIVATA ma il comportamento non cambia", () => {
      const catalogo = new CatalogoCausali(sistema, [disattivazione('CESSIONE', 'SCARICO')])
      expect(catalogo.selezionabile('SCARICO', 'CESSIONE', GIORNO)).toEqual({
        ok: false,
        motivo: 'DISATTIVATA',
      })
      expect(catalogo.comportamento('SCARICO', 'CESSIONE', GIORNO)!.ruoloMud).toBe('AVVIATO')
    })

    it('la disattivazione vale solo per il verso indicato', () => {
      const catalogo = new CatalogoCausali(sistema, [
        disattivazione('RICLASSIFICAZIONE', 'SCARICO'),
      ])
      expect(catalogo.selezionabile('SCARICO', 'RICLASSIFICAZIONE', GIORNO).ok).toBe(false)
      expect(catalogo.selezionabile('CARICO', 'RICLASSIFICAZIONE', GIORNO).ok).toBe(true)
    })

    it('attiva = false di sistema: DISATTIVATA e comportamento invariato', () => {
      const righe: RigaCausaleSistema[] = sistema.map(r =>
        r.codice === 'ALTRO_CARICO' ? { ...r, attiva: false } : r
      )
      const catalogo = new CatalogoCausali(righe, [])
      expect(catalogo.selezionabile('CARICO', 'ALTRO_CARICO', GIORNO)).toEqual({
        ok: false,
        motivo: 'DISATTIVATA',
      })
      expect(catalogo.comportamento('CARICO', 'ALTRO_CARICO', GIORNO)!.ruoloMud).toBe('ESCLUSO')
    })

    it("una causale di sistema attiva e non disattivata e' selezionabile", () => {
      const catalogo = new CatalogoCausali(sistema, [])
      const esito = catalogo.selezionabile('SCARICO', 'AVVIO_RECUPERO', GIORNO)
      expect(esito.ok).toBe(true)
      if (esito.ok) expect(esito.definizione.operazione).toBe('R')
    })
  })

  describe('selezionabile: codici non selezionabili', () => {
    const catalogo = new CatalogoCausali(sistema, [
      propria('v1', 'AZ_SOLO_SCARICO', 'SCARICO', '2026-01-01', null),
    ])

    it('SCONOSCIUTA', () => {
      expect(catalogo.selezionabile('CARICO', 'INVENTATA', GIORNO)).toEqual({
        ok: false,
        motivo: 'SCONOSCIUTA',
      })
    })

    it("VERSO per un codice di sistema presente solo nell'altro verso", () => {
      expect(catalogo.selezionabile('CARICO', 'CESSIONE', GIORNO)).toEqual({
        ok: false,
        motivo: 'VERSO',
      })
      expect(catalogo.selezionabile('SCARICO', 'PRODUZIONE_INTERNA', GIORNO)).toEqual({
        ok: false,
        motivo: 'VERSO',
      })
    })

    it("VERSO per un codice aziendale presente solo nell'altro verso", () => {
      expect(catalogo.selezionabile('CARICO', 'AZ_SOLO_SCARICO', GIORNO)).toEqual({
        ok: false,
        motivo: 'VERSO',
      })
    })

    it("una AZ_ mai creata e' SCONOSCIUTA", () => {
      expect(catalogo.selezionabile('SCARICO', 'AZ_MAI_CREATA', GIORNO)).toEqual({
        ok: false,
        motivo: 'SCONOSCIUTA',
      })
    })
  })

  describe('versioni della causale aziendale', () => {
    const catalogo = new CatalogoCausali(sistema, [
      propria('v1', 'AZ_PROVA', 'SCARICO', '2026-03-01', '2026-05-31', {
        ruoloMud: 'ESCLUSO',
        codiceRentri: 'I',
      }),
      propria('v2', 'AZ_PROVA', 'SCARICO', '2026-06-01', null, {
        ruoloMud: 'AVVIATO',
        codiceRentri: 'aT',
        operazione: 'R',
      }),
    ])

    it("il giorno prima di valida_dal non e' valida (FUORI_VALIDITA, comportamento null)", () => {
      expect(catalogo.selezionabile('SCARICO', 'AZ_PROVA', '2026-02-28')).toEqual({
        ok: false,
        motivo: 'FUORI_VALIDITA',
      })
      expect(catalogo.comportamento('SCARICO', 'AZ_PROVA', '2026-02-28')).toBeNull()
    })

    it("il giorno di valida_dal e' valida", () => {
      expect(catalogo.comportamento('SCARICO', 'AZ_PROVA', '2026-03-01')!.versioneId).toBe('v1')
    })

    it("il giorno di valida_al e' ancora valida", () => {
      expect(catalogo.comportamento('SCARICO', 'AZ_PROVA', '2026-05-31')!.versioneId).toBe('v1')
    })

    it('il giorno dopo valida_al vale la versione successiva', () => {
      const d = catalogo.comportamento('SCARICO', 'AZ_PROVA', '2026-06-01')!
      expect(d.versioneId).toBe('v2')
      expect(d.ruoloMud).toBe('AVVIATO')
      expect(d.operazione).toBe('R')
      expect(d.origine).toBe('AZIENDA')
    })

    it("chiusa e senza successore: il giorno dopo valida_al non e' valida", () => {
      const solo = new CatalogoCausali(sistema, [
        propria('v1', 'AZ_CHIUSA', 'CARICO', '2026-03-01', '2026-05-31'),
      ])
      expect(solo.selezionabile('CARICO', 'AZ_CHIUSA', '2026-05-31').ok).toBe(true)
      expect(solo.selezionabile('CARICO', 'AZ_CHIUSA', '2026-06-01')).toEqual({
        ok: false,
        motivo: 'FUORI_VALIDITA',
      })
    })

    it('versioneId esplicito vince sulla data', () => {
      const d = catalogo.comportamento('SCARICO', 'AZ_PROVA', '2026-06-20', 'v1')!
      expect(d.versioneId).toBe('v1')
      expect(d.codiceRentri).toBe('I')
      // anche fuori dalla validita' della versione
      expect(catalogo.comportamento('SCARICO', 'AZ_PROVA', '2025-01-01', 'v2')!.versioneId).toBe(
        'v2'
      )
    })

    it('versioneId con codice o verso diversi -> null', () => {
      expect(catalogo.comportamento('SCARICO', 'AZ_ALTRA', GIORNO, 'v1')).toBeNull()
      expect(catalogo.comportamento('CARICO', 'AZ_PROVA', GIORNO, 'v1')).toBeNull()
    })

    it('versioneId sconosciuto -> null', () => {
      expect(catalogo.comportamento('SCARICO', 'AZ_PROVA', GIORNO, 'zzz')).toBeNull()
    })

    it("la disattivazione non tocca una causale propria ne' il comportamento", () => {
      const c = new CatalogoCausali(sistema, [
        propria('v1', 'AZ_X', 'CARICO', '2026-01-01', null, { ruoloMud: 'PRODOTTO' }),
        disattivazione('CESSIONE', 'SCARICO'),
      ])
      expect(c.selezionabile('CARICO', 'AZ_X', GIORNO).ok).toBe(true)
    })
  })

  describe('opzioni', () => {
    it('sono ordinate per ordine, sistema prima di azienda, poi codice; senza disattivate', () => {
      const catalogo = new CatalogoCausali(sistema, [
        disattivazione('CESSIONE', 'SCARICO'),
        propria('b', 'AZ_BBB', 'SCARICO', '2026-01-01', null, { ordine: 20 }),
        propria('a', 'AZ_AAA', 'SCARICO', '2026-01-01', null, { ordine: 20 }),
        propria('c', 'AZ_CCC', 'SCARICO', '2026-01-01', null, { ordine: 5 }),
        propria('f', 'AZ_FUTURA', 'SCARICO', '2027-01-01', null),
      ])
      const codici = catalogo.opzioni('SCARICO', GIORNO).map(o => o.codice)
      expect(codici).toEqual([
        'AZ_CCC', // ordine 5
        'CONFERIMENTO_TRASPORTATORE', // 10
        'AVVIO_RECUPERO', // 20, sistema prima
        'AZ_AAA', // 20
        'AZ_BBB', // 20
        'AVVIO_SMALTIMENTO', // 30
        // CESSIONE (40) disattivata
        'RICLASSIFICAZIONE', // 50
        'ALTRO_SCARICO', // 60
      ])
    })

    it('contiene solo il verso richiesto e le 5 di CARICO senza altre personalizzazioni', () => {
      const catalogo = new CatalogoCausali(sistema, [])
      expect(catalogo.opzioni('CARICO', GIORNO).map(o => o.codice)).toEqual([
        'PRODUZIONE_INTERNA',
        'INGRESSO_ESTERNO',
        'RICLASSIFICAZIONE',
        'RECUPERO_PARZIALE',
        'ALTRO_CARICO',
      ])
    })

    it('esclude le righe di sistema con attiva = false', () => {
      const righe = sistema.map(r => (r.codice === 'ALTRO_SCARICO' ? { ...r, attiva: false } : r))
      const catalogo = new CatalogoCausali(righe, [])
      expect(catalogo.opzioni('SCARICO', GIORNO).map(o => o.codice)).not.toContain('ALTRO_SCARICO')
    })
  })

  describe('descrizione', () => {
    const catalogo = new CatalogoCausali(sistema, [
      propria('v1', 'AZ_PROVA', 'SCARICO', '2026-01-01', null, { descrizione: 'Mia causale' }),
    ])

    it('di sistema, aziendale e fallback sul codice', () => {
      expect(catalogo.descrizione('SCARICO', 'CESSIONE', GIORNO)).toBe('Cessione a terzi')
      expect(catalogo.descrizione('SCARICO', 'AZ_PROVA', GIORNO)).toBe('Mia causale')
      expect(catalogo.descrizione('SCARICO', 'AZ_PROVA', GIORNO, 'v1')).toBe('Mia causale')
      expect(catalogo.descrizione('CARICO', 'CESSIONE', GIORNO)).toBe('CESSIONE')
      expect(catalogo.descrizione('SCARICO', 'AZ_PROVA', '2020-01-01')).toBe('AZ_PROVA')
    })

    it('una causale disattivata conserva la descrizione (elenco dei movimenti storici)', () => {
      const c = new CatalogoCausali(sistema, [disattivazione('CESSIONE', 'SCARICO')])
      expect(c.descrizione('SCARICO', 'CESSIONE', GIORNO)).toBe('Cessione a terzi')
    })
  })
})
