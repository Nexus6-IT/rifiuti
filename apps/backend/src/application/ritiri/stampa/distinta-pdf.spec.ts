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
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4]).toString('base64')
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

  it('nome file senza caratteri spuri', () => {
    expect(nomeFileDistinta(dati([]))).toBe('distinta-ritiri-2026-11-12-AB123CD.pdf')
  })
})
