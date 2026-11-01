import { ComponentFixture, TestBed } from '@angular/core/testing'
import { of } from 'rxjs'
import { provideNoopAnimations } from '@angular/platform-browser/animations'
import { RegistryService } from '../registry/registry.service'
import { Ditta } from '../../shared/models/registry.model'
import { DittaRuoloFormComponent } from './ditta-ruolo-form.component'
import { q, scrivi, stabilizza } from './tabelle/tabelle-test-utils'

const PIVA = '12345678903'
const CF_PERSONA = 'RSSMRA80A01H501U'

const DITTA: Ditta = {
  id: 'd1',
  ragioneSociale: 'Rossi S.r.l.',
  partitaIva: PIVA,
  codiceFiscale: null,
  partitaIvaDaVerificare: false,
  privato: false,
  sedi: [
    {
      id: 's1',
      denominazione: null,
      via: 'Via Roma',
      civico: '1',
      cap: '00100',
      citta: 'Roma',
      provincia: 'RM',
      referente: null,
      email: null,
      telefono: null,
      pec: null,
      principale: true,
      attiva: true,
    },
  ],
  ruoli: {},
}

describe('DittaRuoloFormComponent', () => {
  let fixture: ComponentFixture<DittaRuoloFormComponent>
  let registry: jasmine.SpyObj<RegistryService>

  async function crea(tipo: 'agente' | 'cliente') {
    fixture = TestBed.createComponent(DittaRuoloFormComponent)
    fixture.componentRef.setInput('tipo', tipo)
    fixture.componentRef.setInput('pfx', 'x')
    await stabilizza(fixture)
  }

  async function compila() {
    scrivi('x-ragione', 'Bianchi')
    scrivi('x-via', 'Via Torino')
    scrivi('x-civico', '5')
    scrivi('x-cap', '10100')
    scrivi('x-comune', 'Torino')
    scrivi('x-provincia', 'TO')
    await stabilizza(fixture)
  }

  beforeEach(() => {
    registry = jasmine.createSpyObj('RegistryService', ['cercaDitta'])
    registry.cercaDitta.and.returnValue(of({ ditta: null }))
    TestBed.configureTestingModule({
      imports: [DittaRuoloFormComponent],
      providers: [provideNoopAnimations(), { provide: RegistryService, useValue: registry }],
    })
  })
  afterEach(() => fixture?.destroy())

  it('raccogli senza dati: null e messaggi di errore', async () => {
    await crea('agente')
    expect(fixture.componentInstance.raccogli()).toBeNull()
    await stabilizza(fixture)
    expect(document.body.textContent).toContain('Indica la partita IVA o il codice fiscale.')
    expect(document.body.textContent).toContain('La ragione sociale è obbligatoria.')
  })

  it('raccogli con i dati: corpo con il comune dentro indirizzo', async () => {
    await crea('cliente')
    await compila()
    scrivi('x-piva-input', PIVA)
    scrivi('x-email', 'a@b.it')
    await stabilizza(fixture)
    const r = fixture.componentInstance.raccogli()
    expect(r).toEqual({
      dati: {
        ragioneSociale: 'Bianchi',
        partitaIva: PIVA,
        indirizzo: {
          via: 'Via Torino',
          civico: '5',
          cap: '10100',
          comune: 'Torino',
          provincia: 'TO',
        },
        email: 'a@b.it',
      },
      sedeId: undefined,
    })
  })

  it("privato (solo CF): emette privatoChange per il cliente, errore per l'agente", async () => {
    await crea('cliente')
    const stati: boolean[] = []
    fixture.componentInstance.privatoChange.subscribe(v => stati.push(v))
    scrivi('x-cf-input', CF_PERSONA)
    await stabilizza(fixture)
    expect(stati.at(-1)).toBeTrue()
    expect(fixture.componentInstance.privato).toBeTrue()
    scrivi('x-piva-input', PIVA)
    await stabilizza(fixture)
    expect(stati.at(-1)).toBeFalse()
    fixture.destroy()

    await crea('agente')
    await compila()
    scrivi('x-cf-input', CF_PERSONA)
    await stabilizza(fixture)
    expect(fixture.componentInstance.raccogli()).toBeNull()
    await stabilizza(fixture)
    expect(document.body.textContent).toContain(
      'Un privato senza partita IVA può essere solo produttore o cliente.'
    )
  })

  it('ditta trovata: ragione sociale bloccata, sede scelta nel risultato', async () => {
    registry.cercaDitta.and.returnValue(of({ ditta: DITTA }))
    await crea('cliente')
    scrivi('x-piva-input', PIVA)
    q('x-piva-input')!.dispatchEvent(new Event('blur'))
    await stabilizza(fixture)
    expect(q<HTMLInputElement>('x-ragione')!.disabled).toBeTrue()
    expect(q<HTMLInputElement>('x-via')!.value).toBe('Via Roma')
    const r = fixture.componentInstance.raccogli()
    expect(r?.sedeId).toBe('s1')
    expect(r?.dati.ragioneSociale).toBe('Rossi S.r.l.')
  })

  it('azzera svuota campi, errori e ditta trovata', async () => {
    await crea('cliente')
    await compila()
    scrivi('x-piva-input', PIVA)
    fixture.componentInstance.azzera()
    await stabilizza(fixture)
    expect(q<HTMLInputElement>('x-ragione')!.value).toBe('')
    expect(fixture.componentInstance.partitaIVA).toBe('')
  })
})
