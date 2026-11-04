import { ComponentFixture, TestBed } from '@angular/core/testing'
import { provideNoopAnimations } from '@angular/platform-browser/animations'
import { of, throwError } from 'rxjs'
import { AuthService } from '../../core/services/auth.service'
import { ToastService } from '../../core/services/toast.service'
import { ClientiService } from '../clienti/clienti.service'
import { bottone, q, stabilizza } from '../clienti/tabelle/tabelle-test-utils'
import { RegistroService } from '../registro/registro.service'
import {
  DaCollegareComponent,
  MSG_FATTURAZIONE_NON_ATTIVA,
  MSG_TETTO,
  TETTO_AZIONE_MASSA,
} from './da-collegare.component'
import { ImpostazioneFatturazioneService } from './impostazioni-fatturazione.service'
import { LegamiService } from './legami.service'
import { LegameVista, RigaLista } from './legami.model'

function riga(n: number, extra: Partial<RigaLista> = {}): RigaLista {
  return {
    legameId: `l${n}`,
    movimentoId: `m${n}`,
    stato: 'PROPOSTO',
    dataMovimento: '2026-03-12',
    cerCode: '080318',
    descrizioneMovimento: null,
    quantita: '10',
    unita: 'kg',
    cliente: { id: 'c1', etichetta: 'Rossi Srl' },
    motivi: [],
    avvisi: [],
    versione: 1,
    confermabile: true,
    fatturato: false,
    ...extra,
  }
}

const legameVuoto = {
  id: 'l1',
  stato: 'PROPOSTO',
  righe: [],
  motivi: [],
  avvisi: [],
} as unknown as LegameVista

describe('DaCollegareComponent (DOM)', () => {
  let fixture: ComponentFixture<DaCollegareComponent>
  let servizio: jasmine.SpyObj<LegamiService>
  let fatturazione: jasmine.SpyObj<ImpostazioneFatturazioneService>

  async function crea(ruolo: string, righe: RigaLista[], totale = righe.length): Promise<void> {
    servizio = jasmine.createSpyObj('LegamiService', [
      'lista',
      'azioni',
      'daMovimento',
      'dettaglio',
      'riammetti',
    ])
    servizio.lista.and.returnValue(of({ elementi: righe, totale }))
    fatturazione = jasmine.createSpyObj('ImpostazioneFatturazioneService', ['leggi'])
    fatturazione.leggi.and.returnValue(
      of({ fatturazioneDa: '2026-01-01', versione: 1, modificatoIl: null })
    )
    await TestBed.configureTestingModule({
      imports: [DaCollegareComponent],
      providers: [
        provideNoopAnimations(),
        { provide: LegamiService, useValue: servizio },
        { provide: ImpostazioneFatturazioneService, useValue: fatturazione },
        {
          provide: ClientiService,
          useValue: { clienti: { list: () => of({ elementi: [], totale: 0 }) } },
        },
        { provide: RegistroService, useValue: { listRegistri: () => of([]) } },
        { provide: AuthService, useValue: { currentUser: () => ({ role: ruolo }) } },
        { provide: ToastService, useValue: jasmine.createSpyObj('ToastService', ['success']) },
      ],
    }).compileComponents()
    fixture = TestBed.createComponent(DaCollegareComponent)
    await stabilizza(fixture)
  }

  afterEach(() => fixture?.destroy())

  const spunta = async (id: string, si = true): Promise<void> => {
    const c = q<HTMLInputElement>(id)!
    c.checked = si
    c.dispatchEvent(new Event('change', { bubbles: true }))
    await stabilizza(fixture)
  }

  it('usa la classe pagina-lavoro e lascia il posto delle azioni di pagina', async () => {
    await crea('ADMIN', [riga(1)])
    expect(fixture.nativeElement.querySelector('.pagina-lavoro')).not.toBeNull()
    expect(q('legami-azioni-pagina')).not.toBeNull()
  })

  it('lista vuota con fatturazione spenta: messaggio «Fatturazione non attiva»', async () => {
    await crea('ADMIN', [])
    fatturazione.leggi.and.returnValue(
      of({ fatturazioneDa: null, versione: 0, modificatoIl: null })
    )
    fixture.componentInstance.carica()
    await stabilizza(fixture)
    expect(q('legami-vuota')?.textContent).toContain(MSG_FATTURAZIONE_NON_ATTIVA)
  })

  it('lista vuota con fatturazione attiva: «Nessun movimento da collegare»', async () => {
    await crea('ADMIN', [])
    expect(q('legami-vuota')?.textContent).toContain('Nessun movimento da collegare')
  })

  it('badge e motivi per riga', async () => {
    await crea('ADMIN', [
      riga(1, { stato: 'MANCANTE', legameId: null, versione: null, motivi: ['SENZA_CONTRATTO'] }),
      riga(2, { stato: 'DA_RIALLINEARE', avvisi: ['CAMBIO_CER_DA_CONFERMARE'] }),
    ])
    expect(q('stato-m1')?.textContent).toContain('Senza legame')
    expect(q('stato-m2')?.textContent).toContain('Da riallineare')
    expect(q('motivi-m1')?.textContent).toContain('Il cliente non ha un contratto')
    expect(q('motivi-m2')?.textContent).toContain('Il codice CER è cambiato')
  })

  it('selezione di 501 righe: azione di massa disabilitata con il messaggio del tetto', async () => {
    await crea('OPERATOR', [riga(1)])
    for (let i = 0; i <= TETTO_AZIONE_MASSA; i++) fixture.componentInstance.seleziona(riga(i), true)
    await stabilizza(fixture)
    expect(bottone('massa-conferma')!.disabled).toBeTrue()
    expect(bottone('massa-escludi')!.disabled).toBeTrue()
    expect(q('massa-tetto')?.textContent).toContain(MSG_TETTO)
    expect(q('massa-tetto')?.textContent).toContain('501')
  })

  it('con 500 righe selezionate le azioni sono attive', async () => {
    await crea('OPERATOR', [riga(1)])
    for (let i = 0; i < TETTO_AZIONE_MASSA; i++) fixture.componentInstance.seleziona(riga(i), true)
    await stabilizza(fixture)
    expect(bottone('massa-conferma')!.disabled).toBeFalse()
    expect(q('massa-tetto')).toBeNull()
  })

  it('escludi senza motivo: pulsante disabilitato; con il motivo parte con ESCLUDI', async () => {
    await crea('OPERATOR', [riga(1)])
    await spunta('sel-m1')
    bottone('massa-escludi')!.click()
    await stabilizza(fixture)
    expect(bottone('massa-escludi-conferma')!.disabled).toBeTrue()
    const t = q<HTMLTextAreaElement>('massa-motivo')!
    t.value = '   '
    t.dispatchEvent(new Event('input', { bubbles: true }))
    await stabilizza(fixture)
    expect(bottone('massa-escludi-conferma')!.disabled).toBeTrue()
    t.value = 'Rifiuto di prova'
    t.dispatchEvent(new Event('input', { bubbles: true }))
    await stabilizza(fixture)
    expect(bottone('massa-escludi-conferma')!.disabled).toBeFalse()
    servizio.azioni.and.returnValue(of({ riusciti: 1, falliti: [] }))
    bottone('massa-escludi-conferma')!.click()
    await stabilizza(fixture)
    expect(servizio.azioni).toHaveBeenCalledOnceWith({
      azione: 'ESCLUDI',
      elementi: [{ legameId: 'l1', versione: 1 }],
      motivo: 'Rifiuto di prova',
    })
  })

  it('conferma di massa: i MANCANTI vanno per movimento, gli altri con la versione vista', async () => {
    await crea('OPERATOR', [
      riga(1),
      riga(2, { stato: 'MANCANTE', legameId: null, versione: null }),
    ])
    await spunta('seleziona-pagina')
    servizio.azioni.and.returnValue(of({ riusciti: 2, falliti: [] }))
    bottone('massa-conferma')!.click()
    await stabilizza(fixture)
    expect(servizio.azioni).toHaveBeenCalledOnceWith({
      azione: 'CONFERMA',
      elementi: [{ legameId: 'l1', versione: 1 }],
      movimentoIds: ['m2'],
    })
  })

  it('esito di massa: «3 confermati, 1 saltato» con i motivi', async () => {
    await crea('OPERATOR', [riga(1), riga(2)])
    await spunta('seleziona-pagina')
    servizio.azioni.and.returnValue(
      of({
        riusciti: 3,
        falliti: [{ legameId: 'l2', codice: 'LEGAME_INCOMPLETO', messaggio: 'Manca il prezzo' }],
      })
    )
    bottone('massa-conferma')!.click()
    await stabilizza(fixture)
    expect(q('esito-riepilogo')?.textContent).toContain('3 confermati, 1 saltato')
    expect(q('esito-saltati')?.textContent).toContain('Manca il prezzo')
    expect(q('esito-saltati')?.textContent).toContain('12/03/2026')
  })

  it('409 OPERAZIONE_CONCORRENTE: messaggio «riprova» e selezione conservata', async () => {
    await crea('OPERATOR', [riga(1)])
    await spunta('sel-m1')
    servizio.azioni.and.returnValue(
      throwError(() => ({ status: 409, error: { error: 'OPERAZIONE_CONCORRENTE', message: 'x' } }))
    )
    bottone('massa-conferma')!.click()
    await stabilizza(fixture)
    expect(q('legami-errore')?.textContent).toContain('riprova')
    expect(fixture.componentInstance.selezionate()).toBe(1)
  })

  it('VIEWER: nessuna azione, nessuna casella, solo il dettaglio', async () => {
    await crea('VIEWER', [riga(1)])
    expect(q('sel-m1')).toBeNull()
    expect(q('seleziona-pagina')).toBeNull()
    expect(q('barra-massa')).toBeNull()
    expect(q('apri-m1')?.textContent).toContain('Dettaglio')
  })

  it('riammetti dal filtro Esclusi', async () => {
    await crea('OPERATOR', [])
    servizio.lista.and.returnValue(
      of({ elementi: [riga(7, { stato: 'ESCLUSO', versione: 4 })], totale: 1 })
    )
    const c = q<HTMLInputElement>('filtro-esclusi')!
    c.checked = true
    c.dispatchEvent(new Event('change', { bubbles: true }))
    await stabilizza(fixture)
    const ultima = servizio.lista.calls.mostRecent().args[0]!
    expect(ultima.esclusi).toBeTrue()
    expect(ultima.stati).toEqual(['ESCLUSO'])
    servizio.riammetti.and.returnValue(of(legameVuoto))
    bottone('riammetti-m7')!.click()
    await stabilizza(fixture)
    expect(servizio.riammetti).toHaveBeenCalledOnceWith('l7', 4)
  })

  it('esclusi spento: la query porta esclusi=false', async () => {
    await crea('OPERATOR', [riga(1)])
    expect(servizio.lista.calls.first().args[0]!.esclusi).toBeFalse()
  })

  it('MANCANTE: apre il legame dopo daMovimento; PROPOSTO: dopo dettaglio', async () => {
    await crea('OPERATOR', [
      riga(1),
      riga(2, { stato: 'MANCANTE', legameId: null, versione: null }),
      riga(3, { stato: 'DA_RIALLINEARE' }),
    ])
    servizio.daMovimento.and.returnValue(of(legameVuoto))
    servizio.dettaglio.and.returnValue(of(legameVuoto))
    bottone('apri-m2')!.click()
    await stabilizza(fixture)
    expect(servizio.daMovimento).toHaveBeenCalledWith('m2')
    expect(fixture.componentInstance.aperto()).toBe(legameVuoto)
    bottone('apri-m3')!.click()
    await stabilizza(fixture)
    expect(servizio.daMovimento).toHaveBeenCalledWith('m3')
    bottone('apri-m1')!.click()
    await stabilizza(fixture)
    expect(servizio.dettaglio).toHaveBeenCalledWith('l1')
    expect(servizio.daMovimento).toHaveBeenCalledTimes(2)
  })
})
