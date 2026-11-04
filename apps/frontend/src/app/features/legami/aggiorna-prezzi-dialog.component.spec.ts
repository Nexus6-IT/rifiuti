import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing'
import { provideNoopAnimations } from '@angular/platform-browser/animations'
import { of, throwError } from 'rxjs'
import { ClientiService } from '../clienti/clienti.service'
import { bottone, q, stabilizza } from '../clienti/tabelle/tabelle-test-utils'
import { ListinoService } from '../listino/listino.service'
import {
  AggiornaPrezziDialogComponent,
  descriviAnteprima,
  MSG_ANTEPRIMA_RICARICATA,
} from './aggiorna-prezzi-dialog.component'
import { AnteprimaAggiornamento } from './legami.model'
import { LegamiService } from './legami.service'

function anteprima(extra: Partial<AnteprimaAggiornamento> = {}): AnteprimaAggiornamento {
  return {
    firma: 'firma-1',
    cambiano: 12,
    invariati: 4,
    differenze: [
      {
        legameId: 'l1',
        movimentoId: 'm1',
        prezzoPrima: '10.5',
        prezzoDopo: '12',
        scontoPrima: null,
        scontoDopo: '10+5',
        numeroMovimento: '37/2026',
        dataMovimento: '2026-03-09',
        voce: 'Ritiro CER 20 03 01',
        cliente: 'Verdi Servizi S.r.l.',
      },
    ],
    saltati: [
      { motivo: 'FATTURATO', numero: 2 },
      { motivo: 'PREZZO_SPECIALE', numero: 1 },
      { motivo: 'PREZZO_MANUALE', numero: 2 },
    ],
    daCollegare: 1,
    righeEscluseManuali: 2,
    ...extra,
  }
}

describe('descriviAnteprima', () => {
  it('«12 legami cambiano, 3 saltati (2 fatturati, 1 prezzo speciale), 2 escluse, prezzo modificato a mano, 1 passa a Da collegare»', () => {
    expect(descriviAnteprima(anteprima())).toBe(
      '12 legami cambiano, 3 saltati (2 fatturati, 1 prezzo speciale), 2 escluse, prezzo modificato a mano, 1 passa a Da collegare'
    )
  })

  it('i conteggi hanno il separatore delle migliaia', () => {
    expect(
      descriviAnteprima(
        anteprima({ cambiano: 12345, saltati: [], righeEscluseManuali: 0, daCollegare: 0 })
      )
    ).toBe('12.345 legami cambiano')
  })

  it('omette le parti a zero e usa il plurale', () => {
    expect(
      descriviAnteprima(
        anteprima({ cambiano: 1, saltati: [], righeEscluseManuali: 1, daCollegare: 3 })
      )
    ).toBe('1 legame cambia, 1 esclusa, prezzo modificato a mano, 3 passano a Da collegare')
    expect(
      descriviAnteprima(
        anteprima({ cambiano: 0, saltati: [], righeEscluseManuali: 0, daCollegare: 0 })
      )
    ).toBe('0 legami cambiano')
  })
})

describe('AggiornaPrezziDialogComponent', () => {
  let fixture: ComponentFixture<AggiornaPrezziDialogComponent>
  let servizio: jasmine.SpyObj<LegamiService>
  let contratti: jasmine.Spy
  let elenchi: jasmine.Spy

  async function apri(): Promise<void> {
    servizio = jasmine.createSpyObj('LegamiService', [
      'anteprimaAggiornamento',
      'applicaAggiornamento',
    ])
    servizio.anteprimaAggiornamento.and.returnValue(of(anteprima()))
    servizio.applicaAggiornamento.and.returnValue(
      of({ aggiornati: 12, saltati: 3, daCollegare: 1 })
    )
    contratti = jasmine.createSpy('list').and.returnValue(
      of({
        elementi: [{ id: 'k1', numero: 'CC-1', cliente: { ragioneSociale: 'Rossi Srl' } }],
        totale: 1,
      })
    )
    elenchi = jasmine
      .createSpy('delContratto')
      .and.returnValue(
        of({ contesto: {}, elenchi: [{ id: 'e1', codice: 'A', descrizione: 'Listino' }] })
      )
    await TestBed.configureTestingModule({
      imports: [AggiornaPrezziDialogComponent],
      providers: [
        provideNoopAnimations(),
        { provide: LegamiService, useValue: servizio },
        { provide: ClientiService, useValue: { contratti: { list: contratti } } },
        { provide: ListinoService, useValue: { elenchi: { delContratto: elenchi } } },
      ],
    }).compileComponents()
    fixture = TestBed.createComponent(AggiornaPrezziDialogComponent)
    fixture.componentRef.setInput('visible', true)
    await stabilizza(fixture)
  }

  afterEach(() => fixture?.destroy())

  const scegliContratto = async (): Promise<void> => {
    fixture.componentInstance.scegliContratto('k1')
    await stabilizza(fixture)
  }
  const faiAnteprima = async (): Promise<void> => {
    await scegliContratto()
    bottone('ap-anteprima')!.click()
    await stabilizza(fixture)
  }
  const spunta = async (si = true): Promise<void> => {
    const c = q<HTMLInputElement>('ap-conferma')!
    c.checked = si
    c.dispatchEvent(new Event('change', { bubbles: true }))
    await stabilizza(fixture)
  }

  it('perimetro obbligatorio: senza contratto né elenco «Anteprima» è disattivata e non chiama il server', async () => {
    await apri()
    expect(bottone('ap-anteprima')!.disabled).toBeTrue()
    fixture.componentInstance.anteprima()
    expect(servizio.anteprimaAggiornamento).not.toHaveBeenCalled()
  })

  it('i contratti si cercano sul server con al massimo 25 righe (il backend accetta 100)', fakeAsync(() => {
    TestBed.resetTestingModule()
    // Il setup asincrono sta in apri(): qui basta il debounce, quindi si crea in modo sincrono.
    servizio = jasmine.createSpyObj('LegamiService', [
      'anteprimaAggiornamento',
      'applicaAggiornamento',
    ])
    contratti = jasmine.createSpy('list').and.returnValue(of({ elementi: [], totale: 0 }))
    TestBed.configureTestingModule({
      imports: [AggiornaPrezziDialogComponent],
      providers: [
        provideNoopAnimations(),
        { provide: LegamiService, useValue: servizio },
        { provide: ClientiService, useValue: { contratti: { list: contratti } } },
        { provide: ListinoService, useValue: { elenchi: { delContratto: () => of() } } },
      ],
    })
    const f = TestBed.createComponent(AggiornaPrezziDialogComponent)
    f.componentRef.setInput('visible', true)
    f.detectChanges()
    tick(0)
    contratti.calls.reset()
    f.componentInstance.cercaContratti('rossi')
    tick(300)
    expect(contratti).toHaveBeenCalledTimes(1)
    const filtro = contratti.calls.mostRecent().args[0]
    expect(filtro.testo).toBe('rossi')
    expect(filtro.dimensione).toBeLessThanOrEqual(100)
    f.destroy()
  }))

  it('scelto il contratto si caricano i suoi elenchi e «Anteprima» manda il perimetro', async () => {
    await apri()
    await scegliContratto()
    expect(elenchi).toHaveBeenCalledWith('k1')
    fixture.componentInstance.elencoId = 'e1'
    fixture.componentInstance.dal = '2026-01-01'
    fixture.componentInstance.al = '2026-03-31'
    bottone('ap-anteprima')!.click()
    await stabilizza(fixture)
    expect(servizio.anteprimaAggiornamento).toHaveBeenCalledOnceWith({
      contrattoId: 'k1',
      elencoId: 'e1',
      dal: '2026-01-01',
      al: '2026-03-31',
    })
  })

  it('date incoerenti: «Anteprima» disattivata con il messaggio', async () => {
    await apri()
    await scegliContratto()
    fixture.componentInstance.dal = '2026-04-01'
    fixture.componentInstance.al = '2026-03-31'
    await stabilizza(fixture)
    expect(bottone('ap-anteprima')!.disabled).toBeTrue()
    expect(q('ap-errore-date')?.textContent).toContain('dopo')
  })

  it('anteprima: testo di riepilogo e tabella di esempi', async () => {
    await apri()
    await faiAnteprima()
    expect(q('ap-riepilogo')!.textContent).toContain(
      '12 legami cambiano, 3 saltati (2 fatturati, 1 prezzo speciale), 2 escluse, prezzo modificato a mano, 1 passa a Da collegare'
    )
    const righe = document.body.querySelectorAll('[data-testid="ap-esempi"] tbody tr')
    expect(righe.length).toBe(1)
    const t = righe[0].textContent!
    expect(t).toContain('10,50')
    expect(t).toContain('12,00')
    expect(t).toContain('10+5')
    // movimento, cliente e voce leggibili al posto della numerazione
    expect(q('ap-esempio-movimento')!.textContent).toContain('37/2026')
    expect(q('ap-esempio-movimento')!.textContent).toContain('09/03/2026')
    expect(q('ap-esempio-cliente')!.textContent).toContain('Verdi Servizi S.r.l.')
    expect(q('ap-esempio-voce')!.textContent).toContain('Ritiro CER 20 03 01')
    const intest = Array.from(document.body.querySelectorAll('[data-testid="ap-esempi"] th')).map(
      h => h.textContent!.trim()
    )
    expect(intest.slice(0, 3)).toEqual(['Movimento', 'Cliente', 'Voce'])
    expect(intest).not.toContain('#')
    // niente identificativi interni
    expect(q('ap-esempi')!.textContent).not.toContain('m1')
    expect(q('ap-esempi')!.textContent).not.toContain('l1')
  })

  it('didascalia: meno righe dei legami che cambiano, niente «le prime»', async () => {
    await apri()
    servizio.anteprimaAggiornamento.and.returnValue(of(anteprima({ cambiano: 150 })))
    await faiAnteprima()
    const c = document.body.querySelector('[data-testid="ap-esempi"] caption')!.textContent!
    expect(c).toContain('Righe con prezzo o sconto diverso')
    expect(c).not.toContain('le prime')
  })

  it('didascalia: con 200 righe (tetto del backend) dice «le prime 200»', async () => {
    await apri()
    const d = Array.from({ length: 200 }, (_, i) => ({
      legameId: `l${i}`,
      movimentoId: `m${i}`,
      prezzoPrima: '1',
      prezzoDopo: '2',
      scontoPrima: null,
      scontoDopo: null,
      numeroMovimento: `${i}/2026`,
      dataMovimento: '2026-03-09',
      voce: 'CER 20 03 01',
      cliente: 'Verdi',
    }))
    servizio.anteprimaAggiornamento.and.returnValue(of(anteprima({ cambiano: 150, differenze: d })))
    await faiAnteprima()
    expect(document.body.querySelector('[data-testid="ap-esempi"] caption')!.textContent).toContain(
      'le prime 200'
    )
  })

  it('cambiano ma nessuna riga di prezzo: nota «IVA o stato» e tabella assente', async () => {
    await apri()
    servizio.anteprimaAggiornamento.and.returnValue(of(anteprima({ differenze: [] })))
    await faiAnteprima()
    expect(q('ap-esempi')).toBeNull()
    expect(q('ap-solo-altro')!.textContent).toContain('IVA')
  })

  it('i contratti annullati non si offrono', async () => {
    await apri()
    contratti.and.returnValue(
      of({
        elementi: [
          { id: 'k1', numero: 'CC-1', stato: 'ATTIVO', cliente: { ragioneSociale: 'A' } },
          { id: 'k2', numero: 'CC-2', stato: 'ANNULLATO', cliente: { ragioneSociale: 'B' } },
        ],
        totale: 2,
      })
    )
    fixture.componentInstance.cercaContratti('c')
    await new Promise(r => setTimeout(r, 350))
    expect(fixture.componentInstance.opzioniContratti().map(o => o.value)).toEqual(['k1'])
  })

  it('senza la casella di conferma «Applica» è disattivato e non chiama il server', async () => {
    await apri()
    await faiAnteprima()
    expect(bottone('ap-applica')!.disabled).toBeTrue()
    fixture.componentInstance.applica()
    expect(servizio.applicaAggiornamento).not.toHaveBeenCalled()
    await spunta()
    expect(bottone('ap-applica')!.disabled).toBeFalse()
  })

  it('niente da aggiornare: niente casella e «Applica» disattivato', async () => {
    await apri()
    servizio.anteprimaAggiornamento.and.returnValue(of(anteprima({ cambiano: 0, differenze: [] })))
    await faiAnteprima()
    expect(q('ap-conferma')).toBeNull()
    fixture.componentInstance.confermato = true
    await stabilizza(fixture)
    expect(bottone('ap-applica')!.disabled).toBeTrue()
    expect(q('ap-niente')).not.toBeNull()
  })

  it('applica invia la firma dell’anteprima e il perimetro, poi emette l’esito', async () => {
    await apri()
    const esiti: unknown[] = []
    fixture.componentInstance.applicato.subscribe(e => esiti.push(e))
    await faiAnteprima()
    await spunta()
    bottone('ap-applica')!.click()
    await stabilizza(fixture)
    expect(servizio.applicaAggiornamento).toHaveBeenCalledOnceWith({ contrattoId: 'k1' }, 'firma-1')
    expect(esiti).toEqual([{ aggiornati: 12, saltati: 3, daCollegare: 1 }])
  })

  it('409 ANTEPRIMA_SUPERATA: ricarica l’anteprima con il messaggio e chiede una nuova conferma', async () => {
    await apri()
    await faiAnteprima()
    await spunta()
    servizio.applicaAggiornamento.and.returnValue(
      throwError(() => ({ status: 409, error: { error: 'ANTEPRIMA_SUPERATA', message: 'x' } }))
    )
    servizio.anteprimaAggiornamento.and.returnValue(
      of(anteprima({ firma: 'firma-2', cambiano: 13 }))
    )
    bottone('ap-applica')!.click()
    await stabilizza(fixture)
    expect(servizio.anteprimaAggiornamento).toHaveBeenCalledTimes(2)
    expect(q('ap-messaggio')!.textContent).toContain(MSG_ANTEPRIMA_RICARICATA)
    expect(q('ap-riepilogo')!.textContent).toContain('13 legami cambiano')
    expect(bottone('ap-applica')!.disabled).toBeTrue()
    // con la nuova conferma si applica la NUOVA firma
    await spunta()
    servizio.applicaAggiornamento.and.returnValue(
      of({ aggiornati: 13, saltati: 3, daCollegare: 0 })
    )
    bottone('ap-applica')!.click()
    await stabilizza(fixture)
    expect(servizio.applicaAggiornamento.calls.mostRecent().args).toEqual([
      { contrattoId: 'k1' },
      'firma-2',
    ])
  })

  it('altro errore dell’applicazione: messaggio del backend, anteprima invariata', async () => {
    await apri()
    await faiAnteprima()
    await spunta()
    servizio.applicaAggiornamento.and.returnValue(
      throwError(() => ({
        status: 409,
        error: { error: 'OPERAZIONE_CONCORRENTE', message: 'altro' },
      }))
    )
    bottone('ap-applica')!.click()
    await stabilizza(fixture)
    expect(q('ap-errore')!.textContent).toContain('riprova')
    expect(servizio.anteprimaAggiornamento).toHaveBeenCalledTimes(1)
  })

  it('errore dell’anteprima: messaggio visibile', async () => {
    await apri()
    servizio.anteprimaAggiornamento.and.returnValue(
      throwError(() => ({
        status: 400,
        error: { error: 'PERIMETRO_NON_VALIDO', message: 'Indica un contratto o un elenco.' },
      }))
    )
    await faiAnteprima()
    expect(q('ap-errore')!.textContent).toContain('Indica un contratto o un elenco.')
  })

  it('cambiare il perimetro dopo l’anteprima la scarta e toglie la conferma', async () => {
    await apri()
    await faiAnteprima()
    await spunta()
    fixture.componentInstance.cambiaPerimetro()
    await stabilizza(fixture)
    expect(q('ap-riepilogo')).toBeNull()
    expect(fixture.componentInstance.confermato).toBeFalse()
  })

  describe('accessibilità', () => {
    it('i campi hanno le etichette e il focus va sul primo campo all’apertura', async () => {
      await apri()
      await new Promise(r => setTimeout(r, 50))
      for (const id of ['ap-contratto', 'ap-elenco', 'ap-dal', 'ap-al']) {
        const lab = document.body.querySelector(`label[for="${id}"]`)
        expect(lab).withContext(id).not.toBeNull()
        expect(document.getElementById(id)).withContext(id).not.toBeNull()
      }
      expect(document.getElementById('ap-contratto')).not.toBeNull()
      const attivo = document.activeElement as HTMLElement | null
      expect(
        document.body.querySelector('[data-testid="aggiorna-prezzi-dialog"]')?.contains(attivo)
      ).toBeTrue()
    })

    it('Esc chiude la finestra', async () => {
      await apri()
      const chiusure: boolean[] = []
      fixture.componentInstance.chiuso.subscribe(() => chiusure.push(true))
      const dlg = document.body.querySelector('.p-dialog')!
      dlg.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
      await stabilizza(fixture)
      expect(chiusure.length).toBe(1)
    })

    it('Esc durante l’applicazione non chiude (keydown reale)', async () => {
      await apri()
      fixture.componentInstance.inCorso.set(true)
      await stabilizza(fixture)
      const chiusure: boolean[] = []
      fixture.componentInstance.chiuso.subscribe(() => chiusure.push(true))
      document.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', which: 27, keyCode: 27, bubbles: true })
      )
      document.body
        .querySelector('.p-dialog')!
        .dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', keyCode: 27, bubbles: true }))
      await stabilizza(fixture)
      expect(chiusure.length).toBe(0)
    })

    it('durante l’applicazione la finestra non si chiude', async () => {
      await apri()
      fixture.componentInstance.inCorso.set(true)
      const chiusure: boolean[] = []
      fixture.componentInstance.chiuso.subscribe(() => chiusure.push(true))
      fixture.componentInstance.chiudi()
      expect(chiusure.length).toBe(0)
    })
  })
})
