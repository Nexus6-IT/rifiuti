import {
  definizioneDistinta,
  FIR_NON_GENERATO,
  logoValido,
  nomeFileDistinta,
  ordinaRigheDistinta,
  sceglieModelloDistinta,
  type DatiDistinta,
  type ModelloStampaDistinta,
  type RigaDistinta,
} from './distinta-pdf'

const riga = (o: Partial<RigaDistinta> = {}): RigaDistinta => ({
  fascia: 'MATTINA',
  ordineGiro: 1,
  produttore: 'Rossi Srl',
  indirizzoSede: 'Via Roma 1, Roma',
  cerCode: '150101',
  quantitaPresunta: '1250.5',
  numeroFir: null,
  ...o,
})
const dati = (righe: RigaDistinta[]): DatiDistinta => ({
  data: '2026-11-12',
  automezzo: { targa: 'AB 123 CD', descrizione: 'Iveco' },
  righe,
})
const modello = (o: Partial<ModelloStampaDistinta> = {}): ModelloStampaDistinta => ({
  ambito: 'DISTINTA_RITIRI',
  logoBase64: null,
  headerText: 'Intestazione custom',
  footerText: 'Piè custom',
  primaryColor: '#112233',
  secondaryColor: '#445566',
  ...o,
})
const testo = (d: unknown) => JSON.stringify(d)

describe('distinta dei ritiri, definizione pura', () => {
  it('mostra data, mezzo, produttore, sede, CER e quantita` in formato italiano', () => {
    const t = testo(definizioneDistinta(dati([riga()]), null))
    expect(t).toContain('12/11/2026')
    expect(t).toContain('AB 123 CD - Iveco')
    expect(t).toContain('Rossi Srl')
    expect(t).toContain('Via Roma 1, Roma')
    expect(t).toContain('150101')
    expect(t).toContain('1.250,5')
  })

  it('senza FIR scrive «FIR non generato», con FIR il numero', () => {
    const t = testo(definizioneDistinta(dati([riga(), riga({ numeroFir: 'XYZ123/26' })]), null))
    expect(t.split(FIR_NON_GENERATO)).toHaveLength(2)
    expect(t).toContain('XYZ123/26')
  })

  it('ordina per fascia, poi ordine giro (senza in fondo), poi produttore', () => {
    const r = ordinaRigheDistinta([
      riga({ produttore: 'D', fascia: null, ordineGiro: null }),
      riga({ produttore: 'C', fascia: 'POMERIGGIO', ordineGiro: 1 }),
      riga({ produttore: 'B', fascia: 'MATTINA', ordineGiro: null }),
      riga({ produttore: 'A', fascia: 'MATTINA', ordineGiro: 2 }),
    ])
    expect(r.map(x => x.produttore)).toEqual(['A', 'B', 'C', 'D'])
  })

  it('con piu mezzi ordina prima per mezzo (senza mezzo in fondo), poi per giro', () => {
    const r = ordinaRigheDistinta([
      riga({ produttore: 'B1', mezzo: 'BB222BB', ordineGiro: 1 }),
      riga({ produttore: 'N1', mezzo: null, ordineGiro: 1 }),
      riga({ produttore: 'A2', mezzo: 'AA111AA', ordineGiro: 2 }),
      riga({ produttore: 'A1', mezzo: 'AA111AA', ordineGiro: 1 }),
    ])
    expect(r.map(x => x.produttore)).toEqual(['A1', 'A2', 'B1', 'N1'])
  })

  it('tutti i mezzi: un blocco con la targa per mezzo, e uno «Senza mezzo»; un mezzo solo: nessun blocco', () => {
    const righe = [
      riga({ produttore: 'B1', mezzo: 'BB222BB' }),
      riga({ produttore: 'N1', mezzo: null }),
      riga({ produttore: 'A1', mezzo: 'AA111AA' }),
    ]
    const t = testo(definizioneDistinta({ ...dati(righe), automezzo: null }, null))
    const pos = (x: string) => t.indexOf(x)
    expect(pos('Mezzo: AA111AA')).toBeGreaterThan(-1)
    expect(pos('Mezzo: AA111AA')).toBeLessThan(pos('A1'))
    expect(pos('A1')).toBeLessThan(pos('Mezzo: BB222BB'))
    expect(pos('Mezzo: BB222BB')).toBeLessThan(pos('B1'))
    expect(pos('B1')).toBeLessThan(pos('Senza mezzo'))
    expect(pos('Senza mezzo')).toBeLessThan(pos('N1'))
    const unico = testo(definizioneDistinta(dati(righe), null))
    expect(unico).not.toContain('Senza mezzo')
    expect(unico).not.toContain('Mezzo: AA111AA')
  })

  it('senza righe indica che non ci sono ritiri', () => {
    expect(testo(definizioneDistinta(dati([]), null))).toContain('Nessun ritiro programmato')
  })

  it('applica intestazione, piè di pagina e colori del modello', () => {
    const def = definizioneDistinta(dati([riga()]), modello())
    expect(testo(def)).toContain('Intestazione custom')
    expect(testo(def)).toContain('#112233')
    const footer = (def.footer as (p: number, t: number) => unknown)(2, 3)
    expect(testo(footer)).toContain('Piè custom')
    expect(testo(footer)).toContain('Pagina 2 di 3')
  })

  it('un colore non esadecimale ricade sul predefinito', () => {
    const t = testo(definizioneDistinta(dati([riga()]), modello({ primaryColor: 'red;x' })))
    expect(t).not.toContain('red;x')
  })

  it('sceglie DISTINTA_RITIRI, poi GENERALE, poi nessuno', () => {
    const g = modello({ ambito: 'GENERALE' })
    const d = modello({ ambito: 'DISTINTA_RITIRI' })
    expect(sceglieModelloDistinta([g, d])).toBe(d)
    expect(sceglieModelloDistinta([modello({ ambito: 'FIR' }), g])).toBe(g)
    expect(sceglieModelloDistinta([modello({ ambito: 'FIR' })])).toBeNull()
  })

  it('il logo con magic bytes sbagliati non finisce nel PDF', () => {
    const png =
      'data:image/png;base64,' +
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2]).toString('base64')
    const falso = 'data:image/png;base64,' + Buffer.from('not an image!').toString('base64')
    expect(logoValido(png)).toBe(png)
    expect(logoValido(falso)).toBeNull()
    expect(testo(definizioneDistinta(dati([riga()]), modello({ logoBase64: png })))).toContain(
      '"image"'
    )
    expect(
      testo(definizioneDistinta(dati([riga()]), modello({ logoBase64: falso })))
    ).not.toContain('"image"')
  })

  it("il logo come base64 puro (senza data:) e' accettato e diventa data URL", () => {
    const puro = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2]).toString(
      'base64'
    )
    expect(logoValido(puro)).toBe(`data:image/png;base64,${puro}`)
  })

  it('nome file senza caratteri spuri', () => {
    expect(nomeFileDistinta(dati([]))).toBe('distinta-ritiri-2026-11-12-AB123CD.pdf')
  })
})
