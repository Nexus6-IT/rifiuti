import { ComponentFixture, TestBed } from '@angular/core/testing'
import { By } from '@angular/platform-browser'
import { provideNoopAnimations } from '@angular/platform-browser/animations'
import { bottone, q, scrivi, stabilizza } from '../clienti/tabelle/tabelle-test-utils'
import { Scaglione } from './listino.model'
import { RigaFasceSezioneComponent } from './riga-fasce-sezione.component'
import { RigaForm } from './riga-modulo'

const fascia = (
  ordine: number,
  finoA: string | null,
  prezzo: string,
  tipoCalcolo: Scaglione['tipoCalcolo'] = 'A',
  extra: Partial<Scaglione> = {}
): Scaglione => ({ ordine, finoA, prezzo, sconto: null, provvigione: null, tipoCalcolo, ...extra })

describe('RigaFasceSezioneComponent', () => {
  let fixture: ComponentFixture<RigaFasceSezioneComponent>
  let stato: RigaForm

  const testo = (id: string) => q(id)?.textContent?.replace(/\s+/g, ' ').trim() ?? ''
  const valore = (id: string) => (q<HTMLInputElement>(id) as HTMLInputElement).value
  const scaglioni = () => stato.form.controls.scaglioni.value

  function imposta(id: string, v: string): void {
    const el = q<HTMLSelectElement>(id)!
    el.value = v
    el.dispatchEvent(new Event('change', { bubbles: true }))
  }

  async function monta(opz: { speciale?: boolean; soloLettura?: boolean } = {}): Promise<void> {
    stato = new RigaForm()
    stato.form.patchValue({
      tipo: 'CER',
      cerCode: '20 03 01',
      unitaMisura: 'KG',
      prezzoSpeciale: opz.speciale ?? true,
    })
    fixture = TestBed.createComponent(RigaFasceSezioneComponent)
    fixture.componentRef.setInput('stato', stato)
    fixture.componentRef.setInput('soloLettura', opz.soloLettura ?? false)
    await stabilizza(fixture)
  }

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [RigaFasceSezioneComponent],
      providers: [provideNoopAnimations()],
    })
  })

  it('non compare senza la spunta del prezzo speciale, compare con la spunta', async () => {
    await monta({ speciale: false })
    expect(q('riga-sezione-fasce')).toBeNull()
    stato.form.controls.prezzoSpeciale.setValue(true)
    await stabilizza(fixture)
    expect(q('riga-sezione-fasce')).toBeTruthy()
  })

  it('non compare per le famiglie senza prezzo speciale (fissi)', async () => {
    await monta()
    stato.form.patchValue({ tipo: 'F', cerCode: '' })
    await stabilizza(fixture)
    expect(q('riga-sezione-fasce')).toBeNull()
  })

  it('scrivendo la fascia 1 e «oltre» il controllo ha le fasce nella forma del backend', async () => {
    await monta()
    scrivi('fascia-1-fino', '1000')
    scrivi('fascia-1-prezzo', '0,10')
    scrivi('fascia-oltre-prezzo', '0,05')
    await stabilizza(fixture)
    expect(scaglioni()).toEqual([fascia(1, '1000', '0.10'), fascia(7, null, '0.05')])
  })

  it('sconto e provvigione a cascata con la virgola, tipo di calcolo scelto', async () => {
    await monta()
    scrivi('fascia-1-fino', '1000')
    scrivi('fascia-1-prezzo', '0,10')
    scrivi('fascia-1-sconto', '10+5,5')
    scrivi('fascia-1-provvigione', '3')
    imposta('fascia-1-tipo', 'B')
    await stabilizza(fixture)
    expect(scaglioni()[0]).toEqual(
      fascia(1, '1000', '0.10', 'B', { sconto: '10+5.5', provvigione: '3' })
    )
  })

  it('le righe vuote non partono e le altre si rinumerano di seguito', async () => {
    await monta()
    bottone('fasce-aggiungi')!.click()
    await stabilizza(fixture)
    scrivi('fascia-2-fino', '500')
    scrivi('fascia-2-prezzo', '0,2')
    await stabilizza(fixture)
    expect(scaglioni()).toEqual([fascia(1, '500', '0.2')])
  })

  it('al massimo sette fasce: sei più «oltre», poi il bottone si spegne', async () => {
    await monta()
    for (let i = 0; i < 5; i++) {
      bottone('fasce-aggiungi')!.click()
      await stabilizza(fixture)
    }
    expect(
      fixture.debugElement.queryAll(By.css('[data-testid^="fascia-"][data-testid$="-fino"]')).length
    ).toBe(6)
    expect(bottone('fasce-aggiungi')!.disabled).toBeTrue()
    expect(q('fascia-oltre')).toBeTruthy()
  })

  it('togliere una fascia la rimuove dal valore', async () => {
    await monta()
    stato.form.controls.scaglioni.setValue([
      fascia(1, '1000', '0.1'),
      fascia(2, '5000', '0.08'),
      fascia(7, null, '0.05'),
    ])
    await stabilizza(fixture)
    q<HTMLButtonElement>('fascia-1-togli')!.click()
    await stabilizza(fixture)
    expect(scaglioni()).toEqual([fascia(1, '5000', '0.08'), fascia(7, null, '0.05')])
  })

  it('in modifica mostra i valori con la virgola e senza zeri finali', async () => {
    await monta()
    stato.form.controls.scaglioni.setValue([
      fascia(1, '1000.000', '0.080000', 'A', { sconto: '10+5.5' }),
      fascia(7, null, '0.050000', 'D'),
    ])
    await stabilizza(fixture)
    expect(valore('fascia-1-fino')).toBe('1000')
    expect(valore('fascia-1-prezzo')).toBe('0,08')
    expect(valore('fascia-1-sconto')).toBe('10+5,5')
    expect(valore('fascia-oltre-prezzo')).toBe('0,05')
    expect(valore('fascia-oltre-tipo')).toBe('D')
  })

  describe('descrizioni dei tipi di calcolo (R50)', () => {
    it('A: prezzo per quantità con le soglie', async () => {
      await monta()
      stato.form.controls.scaglioni.setValue([
        fascia(1, '1000', '0.1'),
        fascia(2, '5000', '0.08'),
        fascia(7, null, '0.05'),
      ])
      await stabilizza(fixture)
      expect(testo('fascia-1-descrizione')).toBe('A = Prezzo × quantità fino a KG 1.000.')
      expect(testo('fascia-2-descrizione')).toBe(
        'A = Prezzo × quantità oltre KG 1.000 e fino a 5.000.'
      )
      expect(testo('fascia-oltre-descrizione')).toBe('A = Prezzo × quantità oltre KG 5.000.')
    })

    it('E sull’ultima fascia: tutta la quantità, come D', async () => {
      await monta()
      stato.form.controls.scaglioni.setValue([
        fascia(1, '1000', '0.1'),
        fascia(7, null, '0.05', 'E'),
      ])
      await stabilizza(fixture)
      expect(testo('fascia-oltre-descrizione')).toContain('E = tutta la quantità')
      expect(testo('fascia-oltre-descrizione')).toContain('(come D)')
    })

    it('H: come E, con condizione', async () => {
      await monta()
      stato.form.controls.condizioniRiferite.setValue('12C')
      stato.form.controls.scaglioni.setValue([
        fascia(1, '1000', '0.1'),
        fascia(7, null, '0.05', 'H'),
      ])
      await stabilizza(fixture)
      expect(testo('fascia-oltre-descrizione')).toContain('H = come E, con condizione')
    })

    it('la descrizione segue la modifica del tipo', async () => {
      await monta()
      scrivi('fascia-1-fino', '1000')
      scrivi('fascia-1-prezzo', '0,1')
      imposta('fascia-1-tipo', 'C')
      await stabilizza(fixture)
      expect(testo('fascia-1-descrizione')).toContain('C = Importo fisso di ogni fascia raggiunta')
    })
  })

  describe('tipi di calcolo ammessi', () => {
    const opzioni = (id: string) => Array.from(q<HTMLSelectElement>(id)!.options).map(o => o.value)

    it('senza condizioni: A-D, e E solo sulla fascia «oltre»', async () => {
      await monta()
      expect(opzioni('fascia-1-tipo')).toEqual(['A', 'B', 'C', 'D'])
      expect(opzioni('fascia-oltre-tipo')).toEqual(['A', 'B', 'C', 'D', 'E'])
    })

    it('con le condizioni riferite si aggiungono X Y Z W (e H sull’ultima)', async () => {
      await monta()
      scrivi('riga-condizioni-riferite', '12C')
      await stabilizza(fixture)
      expect(opzioni('fascia-1-tipo')).toEqual(['A', 'B', 'C', 'D', 'X', 'Y', 'Z', 'W'])
      expect(opzioni('fascia-oltre-tipo')).toContain('H')
    })
  })

  describe('riscontro immediato', () => {
    it('Q7: una fascia A dopo una D avvisa subito, ma non blocca nulla', async () => {
      await monta()
      stato.form.controls.scaglioni.setValue([
        fascia(1, '1000', '0.1', 'D'),
        fascia(7, null, '0.05', 'A'),
      ])
      await stabilizza(fixture)
      expect(testo('fasce-avvisi')).toContain('Fascia 7: dopo una fascia «tutta la quantità» (D/W)')
    })

    it('una tabella valida non ha avvisi', async () => {
      await monta()
      stato.form.controls.scaglioni.setValue([fascia(1, '1000', '0.1'), fascia(7, null, '0.05')])
      await stabilizza(fixture)
      expect(q('fasce-avvisi')).toBeNull()
    })

    it('tabella ancora intatta: nessun avviso', async () => {
      await monta()
      expect(q('fasce-avvisi')).toBeNull()
    })
  })

  describe('dati collegati', () => {
    it('«si applica a» ha le cinque voci di E13', async () => {
      await monta()
      expect(Array.from(q<HTMLSelectElement>('riga-applica-a')!.options).map(o => o.value)).toEqual(
        ['', 'DOCUMENTO', 'PERIODO', 'PROGRESSIVO_DA_DATA', 'CONGUAGLIO_365', 'GIORNO']
      )
    })

    it('giorno e mese di riferimento solo per progressivo da data e conguaglio', async () => {
      await monta()
      expect(q('riga-riferimento-giorno')).toBeNull()
      imposta('riga-applica-a', 'CONGUAGLIO_365')
      await stabilizza(fixture)
      expect(q('riga-riferimento-giorno')).toBeTruthy()
      expect(q('riga-riferimento-mese')).toBeTruthy()
      imposta('riga-applica-a', 'PERIODO')
      await stabilizza(fixture)
      expect(q('riga-riferimento-giorno')).toBeNull()
    })
  })

  describe('errori del backend (R36)', () => {
    it('quelli sul campo scaglioni compaiono sull’editor, non in testa', async () => {
      await monta()
      stato.impostaErrori(
        { error: { errori: [{ campo: 'scaglioni', messaggio: 'Indica le fasce.' }] } },
        'ripiego'
      )
      await stabilizza(fixture)
      expect(testo('riga-errore-scaglioni')).toBe('Indica le fasce.')
      expect(stato.generali()).toEqual([])
    })

    it('applicaA, condizioniRiferite e riferimento: sotto il loro campo', async () => {
      await monta()
      imposta('riga-applica-a', 'CONGUAGLIO_365')
      stato.impostaErrori(
        {
          error: {
            errori: [
              { campo: 'applicaA', messaggio: 'Indica a cosa si applica.' },
              { campo: 'condizioniRiferite', messaggio: 'Condizioni non valide.' },
              { campo: 'riferimentoGiorno', messaggio: 'Data non valida.' },
            ],
          },
        },
        'ripiego'
      )
      await stabilizza(fixture)
      expect(testo('riga-errore-applicaA')).toBe('Indica a cosa si applica.')
      expect(testo('riga-errore-condizioniRiferite')).toBe('Condizioni non valide.')
      expect(testo('riga-errore-riferimentoGiorno')).toBe('Data non valida.')
      expect(stato.generali()).toEqual([])
    })
  })

  it('in sola lettura i campi sono spenti e non ci sono bottoni di modifica', async () => {
    await monta({ soloLettura: true })
    stato.form.controls.scaglioni.setValue([fascia(1, '1000', '0.1'), fascia(7, null, '0.05')])
    await stabilizza(fixture)
    expect(q<HTMLInputElement>('fascia-1-fino')!.disabled).toBeTrue()
    expect(q<HTMLSelectElement>('fascia-oltre-tipo')!.disabled).toBeTrue()
    expect(q('fasce-aggiungi')).toBeNull()
    expect(q('fascia-1-togli')).toBeNull()
  })
})
