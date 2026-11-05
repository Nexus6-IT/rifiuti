import { ComponentFixture, TestBed } from '@angular/core/testing'
import { provideNoopAnimations } from '@angular/platform-browser/animations'
import { of, throwError } from 'rxjs'
import { MessageService } from 'primeng/api'
import { AuthService } from '../../../core/services/auth.service'
import { RegistroIva } from '../../clienti/clienti.model'
import { TabelleFatturazioneService } from '../../clienti/tabelle-fatturazione.service'
import { bottone, q, scrivi, stabilizza } from '../../clienti/tabelle/tabelle-test-utils'
import { By } from '@angular/platform-browser'
import { Dropdown } from 'primeng/dropdown'
import { CedenteSchedaComponent } from './cedente-scheda.component'
import { ImpostazioniFatturazione44Service } from './impostazioni-fatturazione-4-4.service'
import { CedenteVista } from './impostazioni.model'

const completo: CedenteVista = {
  regimeFiscale: 'RF01',
  reaUfficio: 'MI',
  capitaleSociale: '1000.50',
  socioUnico: 'SU',
  statoLiquidazione: 'LN',
  registroIvaPredefinitoId: null,
  idTrasmittenteCodice: null,
  versione: 3,
  daTenant: {
    ragioneSociale: 'Ecologia Rossi SRL',
    partitaIva: '01234567890',
    codiceFiscale: '01234567890',
    indirizzo: 'Via Roma 1',
    cap: '20100',
    comune: 'Milano',
    provincia: 'MI',
    numeroRea: '123456',
  },
  completo: true,
  mancanti: [],
}

const incompleto: CedenteVista = {
  ...completo,
  regimeFiscale: null,
  reaUfficio: null,
  capitaleSociale: null,
  socioUnico: null,
  versione: 0,
  completo: false,
  mancanti: ['Regime fiscale', 'Indirizzo della sede'],
}

describe('CedenteSchedaComponent', () => {
  let fixture: ComponentFixture<CedenteSchedaComponent>
  let servizio: jasmine.SpyObj<ImpostazioniFatturazione44Service>

  async function crea(ruolo: string, iniziale: CedenteVista = completo): Promise<void> {
    servizio = jasmine.createSpyObj('ImpostazioniFatturazione44Service', [
      'leggiCedente',
      'salvaCedente',
    ])
    servizio.leggiCedente.and.returnValue(of(iniziale))
    const registri = [
      { id: 'r1', codice: 'A', descrizione: 'Registro A', attivo: true },
      { id: 'r2', codice: 'B', descrizione: 'Registro B', attivo: false },
    ] as unknown as RegistroIva[]
    await TestBed.configureTestingModule({
      imports: [CedenteSchedaComponent],
      providers: [
        provideNoopAnimations(),
        MessageService,
        { provide: ImpostazioniFatturazione44Service, useValue: servizio },
        {
          provide: TabelleFatturazioneService,
          useValue: { registri: { list: () => of(registri) } },
        },
        { provide: AuthService, useValue: { currentUser: () => ({ role: ruolo }) } },
      ],
    }).compileComponents()
    fixture = TestBed.createComponent(CedenteSchedaComponent)
    await stabilizza(fixture)
  }

  afterEach(() => fixture?.destroy())

  it('mostra i dati del tenant in sola lettura', async () => {
    await crea('ADMIN')
    const testo = q('cedente-tenant')!.textContent ?? ''
    expect(testo).toContain('Ecologia Rossi SRL')
    expect(testo).toContain('01234567890')
    expect(testo).toContain('Via Roma 1, 20100 Milano (MI)')
    expect(q('cedente-tenant')!.querySelector('input')).toBeNull()
  })

  it('il menu del regime fiscale ha le 19 voci ufficiali, senza RF03 e senza doppioni', async () => {
    await crea('ADMIN')
    // Elenco scritto a mano: non si confronta con la costante del codice.
    const attesi = [
      'RF01',
      'RF02',
      'RF04',
      'RF05',
      'RF06',
      'RF07',
      'RF08',
      'RF09',
      'RF10',
      'RF11',
      'RF12',
      'RF13',
      'RF14',
      'RF15',
      'RF16',
      'RF17',
      'RF18',
      'RF19',
      'RF20',
    ]
    const voci = fixture.componentInstance.opzioniRegime
    expect(voci.map(o => o.value)).toEqual(attesi)
    expect(new Set(voci.map(o => o.value)).size).toBe(19)
    expect(voci.some(o => o.value === 'RF03')).toBeFalse()
    expect(voci.find(o => o.value === 'RF01')!.label).toBe('RF01 - Ordinario')
    expect(voci.find(o => o.value === 'RF17')!.label).toBe(
      'RF17 - IVA per cassa (art. 32-bis, D.L. 83/2012)'
    )
    expect(voci.find(o => o.value === 'RF19')!.label).toBe('RF19 - Forfettario')
    expect(voci.find(o => o.value === 'RF20')!.label).toBe(
      'RF20 - Regime transfrontaliero di Franchigia IVA (Direttiva UE 2020/285)'
    )
    for (const o of voci) expect(o.label).toMatch(/^RF\d\d - \S/)
  })

  it('capitale sociale: "1000,50" parte come "1000.50"', async () => {
    await crea('ADMIN', incompleto)
    const c = fixture.componentInstance
    servizio.salvaCedente.and.returnValue(of(completo))
    c.form.patchValue({ regimeFiscale: 'RF01' })
    scrivi('cedente-capitale', '1000,50')
    await stabilizza(fixture)
    bottone('cedente-salva')!.click()
    await stabilizza(fixture)
    expect(servizio.salvaCedente).toHaveBeenCalledTimes(1)
    const corpo = servizio.salvaCedente.calls.mostRecent().args[0]
    expect(corpo.capitaleSociale).toBe('1000.50')
    expect(corpo.regimeFiscale).toBe('RF01')
    expect(corpo.versione).toBe(0)
  })

  it('capitale sociale con il punto: «Usa la virgola per i decimali», nessun invio', async () => {
    await crea('ADMIN', incompleto)
    fixture.componentInstance.form.patchValue({ regimeFiscale: 'RF01' })
    scrivi('cedente-capitale', '1000.50')
    await stabilizza(fixture)
    expect(q('cedente-capitale-errore')?.textContent).toContain('Usa la virgola per i decimali')
    bottone('cedente-salva')!.click()
    await stabilizza(fixture)
    expect(servizio.salvaCedente).not.toHaveBeenCalled()
  })

  it('il capitale sociale caricato si legge con la virgola', async () => {
    await crea('ADMIN')
    expect(q<HTMLInputElement>('cedente-capitale')!.value).toBe('1000,50')
  })

  it('cedente incompleto: riquadro con i campi mancanti', async () => {
    await crea('ADMIN', incompleto)
    const riquadro = q('cedente-incompleto')!
    expect(riquadro.textContent).toContain('Regime fiscale')
    expect(riquadro.textContent).toContain('Indirizzo della sede')
  })

  it('cedente completo: nessun riquadro', async () => {
    await crea('ADMIN')
    expect(q('cedente-incompleto')).toBeNull()
  })

  it('senza regime fiscale non si invia', async () => {
    await crea('ADMIN', incompleto)
    bottone('cedente-salva')!.click()
    await stabilizza(fixture)
    expect(servizio.salvaCedente).not.toHaveBeenCalled()
  })

  for (const ruolo of ['VIEWER', 'OPERATOR']) {
    it(`${ruolo}: campi e pulsante disabilitati`, async () => {
      await crea(ruolo)
      expect(q<HTMLInputElement>('cedente-capitale')!.disabled).toBeTrue()
      expect(q<HTMLInputElement>('cedente-rea')!.disabled).toBeTrue()
      expect(fixture.componentInstance.form.disabled).toBeTrue()
      const menu = fixture.debugElement.queryAll(By.directive(Dropdown))
      expect(menu.length).toBe(4)
      for (const d of menu) expect((d.componentInstance as Dropdown).disabled).toBeTrue()
      expect(bottone('cedente-salva')!.disabled).toBeTrue()
      expect(q('cedente-sola-lettura')).not.toBeNull()
    })
  }

  it('nel menu del registro predefinito ci sono i soli attivi', async () => {
    await crea('ADMIN')
    expect(fixture.componentInstance.opzioniRegistro().map(r => r.id)).toEqual(['r1'])
  })

  it('un registro predefinito disattivato resta nel menu finché è quello scelto', async () => {
    await crea('ADMIN', { ...completo, registroIvaPredefinitoId: 'r2' })
    expect(fixture.componentInstance.opzioniRegistro().map(r => r.id)).toEqual(['r1', 'r2'])
  })

  it('i facoltativi svuotati partono come null e il corpo ha statoLiquidazione', async () => {
    await crea('ADMIN')
    servizio.salvaCedente.and.returnValue(of(completo))
    fixture.componentInstance.form.patchValue({
      reaUfficio: '',
      capitaleSociale: '',
      socioUnico: null,
      registroIvaPredefinitoId: null,
      idTrasmittenteCodice: '  ',
    })
    bottone('cedente-salva')!.click()
    await stabilizza(fixture)
    expect(servizio.salvaCedente).toHaveBeenCalledOnceWith({
      regimeFiscale: 'RF01',
      reaUfficio: null,
      capitaleSociale: null,
      socioUnico: null,
      statoLiquidazione: 'LN',
      registroIvaPredefinitoId: null,
      idTrasmittenteCodice: null,
      versione: 3,
    })
  })

  for (const testo of ['-5', '1000,505', '5,']) {
    it(`capitale sociale «${testo}»: errore e nessun invio`, async () => {
      await crea('ADMIN')
      scrivi('cedente-capitale', testo)
      await stabilizza(fixture)
      expect(q('cedente-capitale-errore')?.textContent).toContain('positivo')
      expect(q('cedente-capitale')!.getAttribute('aria-invalid')).toBe('true')
      bottone('cedente-salva')!.click()
      await stabilizza(fixture)
      expect(servizio.salvaCedente).not.toHaveBeenCalled()
    })
  }

  it('ufficio REA: una lettera sola è un errore, due lettere partono in maiuscolo', async () => {
    await crea('ADMIN')
    scrivi('cedente-rea', 'm')
    await stabilizza(fixture)
    expect(q('cedente-rea-errore')?.textContent).toContain('due lettere')
    bottone('cedente-salva')!.click()
    await stabilizza(fixture)
    expect(servizio.salvaCedente).not.toHaveBeenCalled()

    servizio.salvaCedente.and.returnValue(of(completo))
    scrivi('cedente-rea', 'mi')
    await stabilizza(fixture)
    bottone('cedente-salva')!.click()
    await stabilizza(fixture)
    expect(servizio.salvaCedente.calls.mostRecent().args[0].reaUfficio).toBe('MI')
  })

  it('409 non di rilettura: errore mostrato, nessuna ricarica, dati in pagina', async () => {
    await crea('ADMIN')
    servizio.salvaCedente.and.returnValue(
      throwError(() => ({
        status: 409,
        error: { error: 'ALTRO', message: 'Registro non valido.' },
      }))
    )
    bottone('cedente-salva')!.click()
    await stabilizza(fixture)
    expect(servizio.leggiCedente).toHaveBeenCalledTimes(1)
    expect(q('cedente-errore')?.textContent).toContain('Registro non valido.')
    expect(q('cedente-tenant')).not.toBeNull()
  })

  it('rilettura fallita dopo un 409: «Riprova» c’è anche con i dati già in pagina', async () => {
    await crea('ADMIN')
    servizio.salvaCedente.and.returnValue(
      throwError(() => ({ status: 409, error: { error: 'VERSIONE_SUPERATA' } }))
    )
    servizio.leggiCedente.and.returnValues(
      throwError(() => ({ status: 500, error: {} })),
      of(completo)
    )
    bottone('cedente-salva')!.click()
    await stabilizza(fixture)
    expect(q('cedente-errore')).not.toBeNull()
    bottone('cedente-riprova')!.click()
    await stabilizza(fixture)
    expect(q('cedente-errore')).toBeNull()
    expect(q('cedente-riprova')).toBeNull()
  })

  it('409 VERSIONE_SUPERATA: messaggio e ricarica', async () => {
    await crea('ADMIN')
    servizio.salvaCedente.and.returnValue(
      throwError(() => ({ status: 409, error: { error: 'VERSIONE_SUPERATA' } }))
    )
    servizio.leggiCedente.and.returnValue(of({ ...completo, reaUfficio: 'RM', versione: 4 }))
    bottone('cedente-salva')!.click()
    await stabilizza(fixture)
    expect(servizio.leggiCedente).toHaveBeenCalledTimes(2)
    expect(q('cedente-errore')?.textContent).toContain('modificati da un altro utente')
    expect(q<HTMLInputElement>('cedente-rea')!.value).toBe('RM')
  })

  it('GET fallito: errore con Riprova', async () => {
    servizio = jasmine.createSpyObj('ImpostazioniFatturazione44Service', ['leggiCedente'])
    servizio.leggiCedente.and.returnValues(
      throwError(() => ({ status: 500, error: {} })),
      of(completo)
    )
    await TestBed.configureTestingModule({
      imports: [CedenteSchedaComponent],
      providers: [
        provideNoopAnimations(),
        MessageService,
        { provide: ImpostazioniFatturazione44Service, useValue: servizio },
        { provide: TabelleFatturazioneService, useValue: { registri: { list: () => of([]) } } },
        { provide: AuthService, useValue: { currentUser: () => ({ role: 'ADMIN' }) } },
      ],
    }).compileComponents()
    fixture = TestBed.createComponent(CedenteSchedaComponent)
    await stabilizza(fixture)
    expect(q('cedente-errore')).not.toBeNull()
    bottone('cedente-riprova')!.click()
    await stabilizza(fixture)
    expect(q('cedente-tenant')).not.toBeNull()
  })
})
