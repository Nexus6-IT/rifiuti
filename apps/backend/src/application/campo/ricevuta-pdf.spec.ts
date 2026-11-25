import { createHash } from 'crypto'
import { pngDiProva } from '../../test-support/png-di-prova'
import {
  DICITURA_NON_SOSTITUISCE_FIR,
  DICITURA_FIRMA_SEMPLICE,
  calcolaContenutoSha256,
  definizioneRicevuta,
  generaPdfRicevuta,
  type DatiRicevuta,
  type IngressoRicevuta,
} from './ricevuta-pdf'

const dati: DatiRicevuta = {
  versione: 1,
  azienda: 'Trasporti Prova SRL',
  trasportatore: 'Trasporti Prova SRL',
  autista: 'Luca Bianchi',
  targa: 'AB123CD',
  dataRitiro: '2026-12-01',
  cliente: 'Officina Rossi SNC',
  indirizzoCliente: 'Via Roma 1 - 70100 Bari (BA)',
  cerCode: '130208*',
  descrizione: 'Altri oli per motori, ingranaggi e lubrificazione',
  quantitaPresunta: '250.00',
  unita: 'KG',
}

const ingresso = (): IngressoRicevuta => {
  const firma = pngDiProva()
  return {
    ricevutaUuid: '11111111-1111-4111-8111-111111111111',
    ritiroId: '22222222-2222-4222-8222-222222222222',
    dati,
    firmatarioNome: 'Mario Rossi',
    firmatoIl: new Date('2026-12-01T08:30:00.000Z'),
    ricevutoIl: new Date('2026-12-01T08:31:10.000Z'),
    firmaPng: firma,
    firmaSha256: createHash('sha256').update(firma).digest('hex'),
  }
}

const testi = (nodo: unknown, acc: string[] = []): string[] => {
  if (typeof nodo === 'string') acc.push(nodo)
  else if (Array.isArray(nodo)) nodo.forEach(n => testi(n, acc))
  else if (nodo && typeof nodo === 'object') {
    for (const [k, v] of Object.entries(nodo)) {
      if (k === 'image') continue
      testi(v, acc)
    }
  }
  return acc
}

describe('ricevuta di ritiro — PDF', () => {
  it('il contenuto stampato porta la dicitura «non sostituisce il FIR» e la natura della firma', () => {
    const i = ingresso()
    const def = definizioneRicevuta(i, calcolaContenutoSha256(i))
    const tutto = testi(def.content).join('\n')
    expect(DICITURA_NON_SOSTITUISCE_FIR).toMatch(/non sostituisce il FIR/i)
    expect(tutto).toContain(DICITURA_NON_SOSTITUISCE_FIR)
    expect(tutto).toContain(DICITURA_FIRMA_SEMPLICE)
    expect(DICITURA_FIRMA_SEMPLICE).toMatch(/non è una firma (elettronica )?qualificata/i)
    expect(tutto).toContain('Mario Rossi')
    expect(tutto).toContain('Officina Rossi SNC')
    expect(tutto).toContain('130208*')
    expect(tutto).toContain('Quantità presunta')
    expect(tutto).toContain(calcolaContenutoSha256(i))
  })

  it('l’impronta del contenuto e deterministica e cambia se cambia uno qualsiasi dei dati firmati', () => {
    const a = ingresso()
    expect(calcolaContenutoSha256(a)).toMatch(/^[0-9a-f]{64}$/)
    expect(calcolaContenutoSha256(ingresso())).toBe(calcolaContenutoSha256(a))
    expect(calcolaContenutoSha256({ ...a, firmatarioNome: 'Mario Rossi Jr' })).not.toBe(
      calcolaContenutoSha256(a)
    )
    expect(
      calcolaContenutoSha256({ ...a, dati: { ...dati, quantitaPresunta: '251.00' } })
    ).not.toBe(calcolaContenutoSha256(a))
    expect(calcolaContenutoSha256({ ...a, firmaSha256: 'f'.repeat(64) })).not.toBe(
      calcolaContenutoSha256(a)
    )
    expect(
      calcolaContenutoSha256({ ...a, firmatoIl: new Date('2026-12-01T08:31:00.000Z') })
    ).not.toBe(calcolaContenutoSha256(a))
  })

  it('un nome o un indirizzo con caratteri speciali non rompe la definizione', () => {
    const i = { ...ingresso(), firmatarioNome: 'Zoë <b>Ñandú</b> "O\'Brien"' }
    expect(() => definizioneRicevuta(i, calcolaContenutoSha256(i))).not.toThrow()
  })

  it('genera un PDF vero (%PDF) entro il tetto della colonna', async () => {
    const i = ingresso()
    const pdf = await generaPdfRicevuta(i, calcolaContenutoSha256(i))
    expect(pdf.subarray(0, 5).toString('ascii')).toBe('%PDF-')
    expect(pdf.length).toBeGreaterThan(2000)
    expect(pdf.length).toBeLessThan(1_048_576)
  })
})
