import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing'
import { provideNoopAnimations } from '@angular/platform-browser/animations'
import { bottone, q, scrivi, stabilizza } from '../clienti/tabelle/tabelle-test-utils'
import { importoItaliano, totaleFissiAnnuo } from './listino-calcoli'
import { Scadenza } from './listino.model'
import { RigaScadenzeSezioneComponent } from './riga-scadenze-sezione.component'
import { RigaForm } from './riga-modulo'

const sc = (
  ordine: number,
  giorno: number,
  mese: number,
  anno: number | null = null
): Scadenza => ({
  ordine,
  giorno,
  mese,
  anno,
})

describe('RigaScadenzeSezioneComponent', () => {
  let fixture: ComponentFixture<RigaScadenzeSezioneComponent>
  let stato: RigaForm

  const testo = (id: string) => q(id)?.textContent?.replace(/\s+/g, ' ').trim() ?? ''
  const valore = (id: string) => (q<HTMLInputElement>(id) as HTMLInputElement).value
  const scadenze = () => stato.form.controls.scadenze.value

  function imposta(id: string, v: string): void {
    const el = q<HTMLSelectElement>(id)!
    el.value = v
    el.dispatchEvent(new Event('change', { bubbles: true }))
  }

  async function monta(opz: { tipo?: string; soloLettura?: boolean } = {}): Promise<void> {
    stato = new RigaForm()
    stato.form.patchValue({ tipo: opz.tipo ?? 'F', unitaMisura: 'NR' })
    fixture = TestBed.createComponent(RigaScadenzeSezioneComponent)
    fixture.componentRef.setInput('stato', stato)
    fixture.componentRef.setInput('soloLettura', opz.soloLettura ?? false)
    await stabilizza(fixture)
  }

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [RigaScadenzeSezioneComponent],
      providers: [provideNoopAnimations()],
    })
  })

  it('compare solo per i fissi', async () => {
    await monta({ tipo: 'CER' })
    expect(q('riga-sezione-scadenze')).toBeNull()
    stato.form.controls.tipo.setValue('F')
    await stabilizza(fixture)
    expect(q('riga-sezione-scadenze')).toBeTruthy()
  })

  it('scrivendo giorno e mese il controllo ha la scadenza, anno vuoto = ogni anno', async () => {
    await monta()
    scrivi('scadenza-1-giorno', '15')
    scrivi('scadenza-1-mese', '3')
    await stabilizza(fixture)
    expect(scadenze()).toEqual([sc(1, 15, 3, null)])
    scrivi('scadenza-1-anno', '2027')
    await stabilizza(fixture)
    expect(scadenze()).toEqual([sc(1, 15, 3, 2027)])
  })

  it('le righe vuote in coda non partono, quelle in mezzo partono col loro numero', async () => {
    await monta()
    bottone('scadenze-aggiungi')!.click()
    await stabilizza(fixture)
    scrivi('scadenza-2-giorno', '1')
    scrivi('scadenza-2-mese', '6')
    await stabilizza(fixture)
    expect(scadenze()).toEqual([sc(1, 0, 0, null), sc(2, 1, 6, null)])
  })

  it('al massimo dodici scadenze', async () => {
    await monta()
    for (let i = 0; i < 15; i++) {
      bottone('scadenze-aggiungi')!.click()
      await stabilizza(fixture)
    }
    expect(
      fixture.nativeElement.ownerDocument.querySelectorAll(
        '[data-testid^="scadenza-"][data-testid$="-giorno"]'
      ).length
    ).toBe(12)
    expect(bottone('scadenze-aggiungi')!.disabled).toBeTrue()
  })

  it('togliere una scadenza la rimuove', async () => {
    await monta()
    stato.form.controls.scadenze.setValue([sc(1, 15, 1), sc(2, 15, 4)])
    await stabilizza(fixture)
    q<HTMLButtonElement>('scadenza-1-togli')!.click()
    await stabilizza(fixture)
    expect(scadenze()).toEqual([sc(1, 15, 4)])
  })

  it('in modifica mostra le scadenze del controllo', async () => {
    await monta()
    stato.form.controls.scadenze.setValue([sc(1, 31, 1), sc(2, 30, 6, 2027)])
    await stabilizza(fixture)
    expect(valore('scadenza-1-giorno')).toBe('31')
    expect(valore('scadenza-1-anno')).toBe('')
    expect(valore('scadenza-2-anno')).toBe('2027')
  })

  describe('Calendario automatico', () => {
    it('dalla prima data genera le altre secondo la frequenza', async () => {
      await monta()
      scrivi('scadenza-1-giorno', '15')
      scrivi('scadenza-1-mese', '1')
      imposta('scadenze-frequenza', 'TRIMESTRALE')
      await stabilizza(fixture)
      bottone('scadenze-calendario')!.click()
      await stabilizza(fixture)
      expect(scadenze()).toEqual([sc(1, 15, 1), sc(2, 15, 4), sc(3, 15, 7), sc(4, 15, 10)])
      expect(valore('scadenza-4-mese')).toBe('10')
    })

    it('mensile: dodici date, fine mese dove il giorno manca', async () => {
      await monta()
      scrivi('scadenza-1-giorno', '31')
      scrivi('scadenza-1-mese', '1')
      await stabilizza(fixture)
      bottone('scadenze-calendario')!.click()
      await stabilizza(fixture)
      expect(scadenze().length).toBe(12)
      expect(scadenze()[1]).toEqual(sc(2, 28, 2))
    })

    it('anno esplicito: 29/02 negli anni bisestili, oltre dicembre l’anno dopo', async () => {
      await monta()
      scrivi('scadenza-1-giorno', '31')
      scrivi('scadenza-1-mese', '1')
      scrivi('scadenza-1-anno', '2028')
      await stabilizza(fixture)
      bottone('scadenze-calendario')!.click()
      await stabilizza(fixture)
      expect(scadenze()[1]).toEqual(sc(2, 29, 2, 2028))
    })

    it('prima data fuori dal primo periodo: messaggio del Task 18, nulla cambia', async () => {
      await monta()
      scrivi('scadenza-1-giorno', '1')
      scrivi('scadenza-1-mese', '4')
      imposta('scadenze-frequenza', 'TRIMESTRALE')
      await stabilizza(fixture)
      bottone('scadenze-calendario')!.click()
      await stabilizza(fixture)
      expect(testo('scadenze-errore-calendario')).toBe(
        'Con scadenze trimestrali e anno vuoto la prima data va tra il 1° gennaio e il 31 marzo.'
      )
      expect(scadenze()).toEqual([sc(1, 1, 4)])
    })

    it('trimestrale da marzo è ammesso', async () => {
      await monta()
      scrivi('scadenza-1-giorno', '15')
      scrivi('scadenza-1-mese', '3')
      imposta('scadenze-frequenza', 'TRIMESTRALE')
      await stabilizza(fixture)
      bottone('scadenze-calendario')!.click()
      await stabilizza(fixture)
      expect(q('scadenze-errore-calendario')).toBeNull()
      expect(scadenze().map(s => s.mese)).toEqual([3, 6, 9, 12])
    })

    it('senza la prima data chiede di indicarla', async () => {
      await monta()
      bottone('scadenze-calendario')!.click()
      await stabilizza(fixture)
      expect(testo('scadenze-errore-calendario')).toBe('Indica la prima scadenza.')
    })

    it('non c’è in sola lettura', async () => {
      await monta({ soloLettura: true })
      expect(q('scadenze-calendario')).toBeNull()
    })
  })

  describe('periodo e periodo extra', () => {
    it('il periodo di competenza compare accanto alla scadenza', async () => {
      await monta()
      stato.form.controls.scadenze.setValue([sc(1, 1, 4, 2026), sc(2, 30, 6, 2026)])
      imposta('riga-periodo-scadenze', 'TA')
      await stabilizza(fixture)
      expect(testo('scadenza-1-periodo')).toBe('Competenza 2026: dal 01/04/2026 al 30/06/2026')
      imposta('riga-periodo-scadenze', 'TP')
      await stabilizza(fixture)
      expect(testo('scadenza-2-periodo')).toBe('Competenza 2026: dal 01/04/2026 al 30/06/2026')
    })

    it('senza periodo scelto nessuna competenza', async () => {
      await monta()
      stato.form.controls.scadenze.setValue([sc(1, 1, 4, 2026)])
      await stabilizza(fixture)
      expect(testo('scadenza-1-periodo')).toBe('')
    })

    it('XA, XD e YC chiedono il periodo extra dal … al …; gli altri no', async () => {
      await monta()
      expect(q('riga-periodo-extra-dal')).toBeNull()
      for (const p of ['XA', 'XD', 'YC']) {
        imposta('riga-periodo-scadenze', p)
        await stabilizza(fixture)
        expect(q('riga-periodo-extra-dal')).withContext(p).toBeTruthy()
        expect(q('riga-periodo-extra-al')).withContext(p).toBeTruthy()
      }
      imposta('riga-periodo-scadenze', 'MP')
      await stabilizza(fixture)
      expect(q('riga-periodo-extra-dal')).toBeNull()
    })

    it('tornando a un periodo ordinario le date extra si svuotano', async () => {
      await monta()
      imposta('riga-periodo-scadenze', 'XA')
      await stabilizza(fixture)
      scrivi('riga-periodo-extra-dal', '2026-01-01')
      scrivi('riga-periodo-extra-al', '2026-03-31')
      await stabilizza(fixture)
      expect(stato.form.controls.periodoExtraDal.value).toBe('2026-01-01')
      imposta('riga-periodo-scadenze', 'MP')
      await stabilizza(fixture)
      expect(stato.form.controls.periodoExtraDal.value).toBe('')
      expect(stato.form.controls.periodoExtraAl.value).toBe('')
      expect(stato.dati().periodoExtraDal).toBeNull()
    })

    it('periodo extra: le date vanno nel corpo', async () => {
      await monta()
      imposta('riga-periodo-scadenze', 'XD')
      await stabilizza(fixture)
      scrivi('riga-periodo-extra-dal', '2026-01-01')
      scrivi('riga-periodo-extra-al', '2026-03-31')
      const d = stato.dati()
      expect(d.periodoScadenze).toBe('XD')
      expect(d.periodoExtraDal).toBe('2026-01-01')
      expect(d.periodoExtraAl).toBe('2026-03-31')
    })

    it('avvisa subito se il periodo extra è incompleto', async () => {
      await monta()
      scrivi('scadenza-1-giorno', '1')
      scrivi('scadenza-1-mese', '1')
      imposta('riga-periodo-scadenze', 'XA')
      await stabilizza(fixture)
      expect(testo('scadenze-avvisi')).toContain(
        'Per una scadenza extra indica il periodo dal … al ….'
      )
    })
  })

  describe('totale annuo dei fissi', () => {
    it('coincide con totaleFissiAnnuo: quantità x prezzo x scadenze di ogni anno', async () => {
      await monta()
      stato.form.patchValue({ quantitaFissa: '2', prezzo: '10,50' })
      stato.form.controls.scadenze.setValue([sc(1, 1, 1), sc(2, 1, 4), sc(3, 1, 7), sc(4, 1, 10)])
      await stabilizza(fixture)
      expect(testo('scadenze-totale-importo')).toBe('84,00 €')
    })

    it('somma esatta e un solo arrotondamento (non uno per scadenza)', async () => {
      await monta()
      stato.form.patchValue({ quantitaFissa: '1', prezzo: '0,333' })
      stato.form.controls.scadenze.setValue([sc(1, 1, 1), sc(2, 1, 2), sc(3, 1, 3)])
      await stabilizza(fixture)
      const atteso = importoItaliano(
        totaleFissiAnnuo([
          {
            tipo: 'F',
            quantitaFissa: '1',
            prezzo: '0.333',
            scadenze: [sc(1, 1, 1), sc(2, 1, 2), sc(3, 1, 3)],
          },
        ])
      )
      expect(atteso).toBe('1,00')
      expect(testo('scadenze-totale-importo')).toBe(`${atteso} €`)
    })

    it('le scadenze con anno esplicito non entrano; quantità vuota vale 1', async () => {
      await monta()
      stato.form.patchValue({ quantitaFissa: '', prezzo: '5' })
      stato.form.controls.scadenze.setValue([sc(1, 1, 1), sc(2, 1, 2, 2027)])
      await stabilizza(fixture)
      expect(testo('scadenze-totale-importo')).toBe('5,00 €')
    })

    it('prezzo di 1000 e 1234,5: il totale mostra le migliaia, il campo no', async () => {
      await monta()
      stato.form.patchValue({ quantitaFissa: '', prezzo: '1000' })
      stato.form.controls.scadenze.setValue([sc(1, 1, 1)])
      await stabilizza(fixture)
      expect(testo('scadenze-totale-importo')).toBe('1.000,00 €')
      stato.form.patchValue({ prezzo: '1234,5' })
      await stabilizza(fixture)
      expect(testo('scadenze-totale-importo')).toBe('1.234,50 €')
    })

    it('senza prezzo vale zero', async () => {
      await monta()
      stato.form.controls.scadenze.setValue([sc(1, 1, 1)])
      await stabilizza(fixture)
      expect(testo('scadenze-totale-importo')).toBe('0,00 €')
    })
  })

  describe('errori del backend (R36)', () => {
    it('scadenze, periodo e periodo extra: sotto il loro campo', async () => {
      await monta()
      imposta('riga-periodo-scadenze', 'XA')
      stato.impostaErrori(
        {
          error: {
            errori: [
              { campo: 'scadenze', messaggio: 'Scadenza 1: data non valida.' },
              { campo: 'periodoScadenze', messaggio: 'Periodo non valido.' },
              { campo: 'periodoExtraDal', messaggio: 'Indica il periodo.' },
            ],
          },
        },
        'ripiego'
      )
      await stabilizza(fixture)
      expect(testo('riga-errore-scadenze')).toBe('Scadenza 1: data non valida.')
      expect(testo('riga-errore-periodoScadenze')).toBe('Periodo non valido.')
      expect(testo('riga-errore-periodoExtraDal')).toBe('Indica il periodo.')
      expect(stato.generali()).toEqual([])
    })
  })

  it('in sola lettura i campi sono spenti', async () => {
    await monta({ soloLettura: true })
    stato.form.controls.scadenze.setValue([sc(1, 15, 1)])
    await stabilizza(fixture)
    expect(q<HTMLInputElement>('scadenza-1-giorno')!.disabled).toBeTrue()
    expect(q('scadenze-aggiungi')).toBeNull()
    expect(q('scadenza-1-togli')).toBeNull()
  })

  describe('numeri scritti male', () => {
    it('«1a» e i punti impediscono il salvataggio (niente parseInt permissivo)', async () => {
      await monta()
      scrivi('scadenza-1-giorno', '1a')
      scrivi('scadenza-1-mese', '3')
      scrivi('scadenza-1-anno', '2026x')
      await stabilizza(fixture)
      expect(testo('scadenze-errori-numeri')).toContain('Scadenza 1, giorno: Numero non valido')
      expect(testo('scadenze-errori-numeri')).toContain('Scadenza 1, anno: Numero non valido')
      expect(stato.haErroriLocali()).toBeTrue()
      scrivi('scadenza-1-giorno', '15')
      scrivi('scadenza-1-anno', '')
      await stabilizza(fixture)
      expect(stato.haErroriLocali()).toBeFalse()
    })

    it('il totale di un prezzo scritto con il punto non conta (e il campo è in errore)', async () => {
      await monta()
      stato.form.patchValue({ prezzo: '1.000' })
      stato.form.controls.scadenze.setValue([sc(1, 1, 1)])
      await stabilizza(fixture)
      expect(stato.erroriDi('prezzo')).toEqual(['Usa la virgola per i decimali'])
      expect(testo('scadenze-totale-importo')).toBe('0,00 €')
    })
  })

  it('aggiungendo una scadenza il focus va sul suo giorno', async () => {
    await monta()
    bottone('scadenze-aggiungi')!.click()
    await stabilizza(fixture)
    await new Promise(r => setTimeout(r))
    expect(document.activeElement).toBe(q('scadenza-2-giorno'))
  })

  describe('seguiti del giro 4.2b (voci 18-21)', () => {
    it('una riga vuota in mezzo è «vuota», non «data non valida» (voce 18)', async () => {
      await monta()
      bottone('scadenze-aggiungi')!.click()
      await stabilizza(fixture)
      scrivi('scadenza-2-giorno', '1')
      scrivi('scadenza-2-mese', '6')
      await stabilizza(fixture)
      const t = testo('scadenze-avvisi')
      expect(t).toContain('Scadenza 1: è vuota, compilala o toglila.')
      expect(t).not.toContain('Scadenza 1: data non valida')
    })

    it('un numero errato non nasconde la competenza delle altre righe (voce 19)', async () => {
      await monta()
      stato.form.controls.scadenze.setValue([sc(1, 1, 4, 2026), sc(2, 30, 6, 2026)])
      imposta('riga-periodo-scadenze', 'TA')
      await stabilizza(fixture)
      scrivi('scadenza-2-giorno', '3x')
      await stabilizza(fixture)
      expect(testo('scadenza-1-periodo')).toContain('Competenza 2026')
      expect(testo('scadenza-2-periodo')).toBe('')
    })

    it('la zona degli errori di numero esiste sempre con aria-live e i campi la citano (voce 20)', async () => {
      await monta()
      const zona = q('scadenza-1-giorno')!.ownerDocument.getElementById('scadenze-errori-numeri')
      expect(zona?.getAttribute('aria-live')).toBe('polite')
      expect(q('scadenza-1-giorno')!.getAttribute('aria-describedby')).toBeNull()
      scrivi('scadenza-1-giorno', '1a')
      await stabilizza(fixture)
      expect(q('scadenza-1-giorno')!.getAttribute('aria-describedby')).toBe(
        'scadenze-errori-numeri'
      )
      expect(zona!.textContent).toContain('Numero non valido')
    })

    it('l’annuncio per i lettori di schermo manca prima degli 800 ms e arriva dopo (voce 21)', fakeAsync(() => {
      stato = new RigaForm()
      stato.form.patchValue({ tipo: 'F', unitaMisura: 'NR' })
      fixture = TestBed.createComponent(RigaScadenzeSezioneComponent)
      fixture.componentRef.setInput('stato', stato)
      fixture.componentRef.setInput('soloLettura', false)
      fixture.detectChanges()
      stato.form.controls.periodoScadenze.setValue('XA')
      stato.form.controls.scadenze.setValue([sc(1, 1, 6)])
      fixture.detectChanges()
      tick(700)
      fixture.detectChanges()
      expect(testo('scadenze-annuncio')).toBe('')
      tick(100)
      fixture.detectChanges()
      expect(testo('scadenze-annuncio')).toContain('scadenza extra')
    }))

    it('togliendo una scadenza il focus va su una riga ancora presente (voce 21)', async () => {
      await monta()
      stato.form.controls.scadenze.setValue([sc(1, 15, 1), sc(2, 15, 4)])
      await stabilizza(fixture)
      q<HTMLButtonElement>('scadenza-2-togli')!.click()
      await stabilizza(fixture)
      await new Promise(r => setTimeout(r))
      expect(document.activeElement).toBe(q('scadenza-1-giorno'))
    })
  })
})
