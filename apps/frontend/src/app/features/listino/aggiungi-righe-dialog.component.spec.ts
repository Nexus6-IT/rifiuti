import { Component, EventEmitter, Input, Output } from '@angular/core'
import { ComponentFixture, TestBed } from '@angular/core/testing'
import { provideNoopAnimations } from '@angular/platform-browser/animations'
import { Subject, of, throwError } from 'rxjs'
import { bottone, q, stabilizza } from '../clienti/tabelle/tabelle-test-utils'
import { AggiungiRigheDialogComponent } from './aggiungi-righe-dialog.component'
import { ElencoAddebiti, EsitoCopia, RigaAddebito } from './listino.model'
import { ListinoService } from './listino.service'
import { SceltaElencoOrigineComponent } from './scelta-elenco-origine.component'

@Component({ selector: 'app-scelta-elenco-origine', standalone: true, template: '' })
class SceltaFinta {
  @Input() prefisso = ''
  @Input() escludiElencoId: string | null = null
  @Input() azzera = 0
  @Output() scelto = new EventEmitter<ElencoAddebiti | null>()
}

const arrivo = { id: 'e1', codice: '001', righe: 3, versione: 7 } as ElencoAddebiti
const origine = { id: 'e9', codice: '009' } as ElencoAddebiti
const riga = (id: string, cer: string): RigaAddebito =>
  ({ id, tipo: 'CER', cerCode: cer, addebito: null, descrizione: `Rifiuto ${cer}` }) as RigaAddebito
const ESITO: EsitoCopia = {
  copiate: 2,
  escluse: { minimi: 0, acconti: 0, conguagli: 0, duplicate: 1, condizioni: 0 },
}

describe('AggiungiRigheDialogComponent', () => {
  let fixture: ComponentFixture<AggiungiRigheDialogComponent>
  let aggiungiRighe: jasmine.Spy
  let list: jasmine.Spy
  let eventi: string[]

  async function apri() {
    fixture = TestBed.createComponent(AggiungiRigheDialogComponent)
    eventi = []
    fixture.componentInstance.aggiunte.subscribe(() => eventi.push('aggiunte'))
    fixture.componentInstance.ricarica.subscribe(() => eventi.push('ricarica'))
    fixture.componentInstance.visibleChange.subscribe(v => eventi.push(`visibile:${v}`))
    fixture.componentRef.setInput('elenco', arrivo)
    fixture.componentRef.setInput('visible', true)
    await stabilizza(fixture)
  }
  const scegliOrigine = async () => {
    fixture.debugElement
      .query(x => x.componentInstance instanceof SceltaFinta)
      .componentInstance.scelto.emit(origine)
    await stabilizza(fixture)
  }
  const spunta = async (id: string) => {
    q<HTMLInputElement>(`aggiungi-riga-${id}`)!.click()
    await stabilizza(fixture)
  }

  beforeEach(() => {
    aggiungiRighe = jasmine.createSpy('aggiungiRighe').and.returnValue(of(ESITO))
    list = jasmine
      .createSpy('list')
      .and.returnValue(of([riga('r1', '20 03 01'), riga('r2', '15 01 01')]))
    TestBed.configureTestingModule({
      imports: [AggiungiRigheDialogComponent],
      providers: [
        provideNoopAnimations(),
        { provide: ListinoService, useValue: { azioni: { aggiungiRighe }, righe: { list } } },
      ],
    })
    TestBed.overrideComponent(AggiungiRigheDialogComponent, {
      remove: { imports: [SceltaElencoOrigineComponent] },
      add: { imports: [SceltaFinta] },
    })
  })
  afterEach(() => fixture?.destroy())

  it('scelto l’elenco di origine si leggono le righe; senza spunte non si può aggiungere', async () => {
    await apri()
    expect(q('aggiungi-righe')).toBeNull()
    await scegliOrigine()
    expect(list).toHaveBeenCalledOnceWith('e9')
    expect(q('aggiungi-righe')!.textContent).toContain('20 03 01')
    expect(bottone('aggiungi-conferma')!.disabled).toBeTrue()
  })

  it('manda solo le righe spuntate e la versione dell’elenco di arrivo', async () => {
    await apri()
    await scegliOrigine()
    await spunta('r2')
    expect(bottone('aggiungi-conferma')!.textContent).toContain('Aggiungi 1 riga')
    bottone('aggiungi-conferma')!.click()
    await stabilizza(fixture)
    expect(aggiungiRighe).toHaveBeenCalledOnceWith('e1', ['r2'], 7)
    expect(q('aggiungi-esito')!.textContent).toContain('Righe aggiunte: 2')
    expect(q('aggiungi-escluse')!.textContent).toContain('1 già presenti')
    expect(eventi).toContain('aggiunte')
  })

  it('"Seleziona tutte" spunta e toglie tutte', async () => {
    await apri()
    await scegliOrigine()
    q<HTMLInputElement>('aggiungi-tutte')!.click()
    await stabilizza(fixture)
    expect(fixture.componentInstance.scelte().size).toBe(2)
    q<HTMLInputElement>('aggiungi-tutte')!.click()
    await stabilizza(fixture)
    expect(fixture.componentInstance.scelte().size).toBe(0)
  })

  it('cambiando origine le spunte ripartono da zero', async () => {
    await apri()
    await scegliOrigine()
    await spunta('r1')
    await scegliOrigine()
    expect(fixture.componentInstance.scelte().size).toBe(0)
  })

  it('elenco senza righe e errore di lettura delle righe', async () => {
    list.and.returnValue(of([]))
    await apri()
    await scegliOrigine()
    expect(q('aggiungi-nessuna-riga')).not.toBeNull()
    list.and.returnValue(throwError(() => ({ error: { message: 'Righe KO.' } })))
    await scegliOrigine()
    expect(q('aggiungi-errore-righe')!.textContent).toContain('Righe KO.')
  })

  it('409: messaggio con "Ricarica"', async () => {
    aggiungiRighe.and.returnValue(
      throwError(() => ({ status: 409, error: { message: 'Elenco modificato.' } }))
    )
    await apri()
    await scegliOrigine()
    await spunta('r1')
    bottone('aggiungi-conferma')!.click()
    await stabilizza(fixture)
    expect(q('aggiungi-errore')!.textContent).toContain('Elenco modificato.')
    bottone('aggiungi-ricarica')!.click()
    expect(eventi).toContain('ricarica')
  })

  it('400 con errori strutturati; durante l’invio Esc non chiude', async () => {
    const lenta = new Subject<EsitoCopia>()
    aggiungiRighe.and.returnValue(lenta)
    await apri()
    await scegliOrigine()
    await spunta('r1')
    bottone('aggiungi-conferma')!.click()
    await stabilizza(fixture)
    fixture.componentInstance.chiudi()
    expect(eventi.filter(e => e.startsWith('visibile'))).toEqual([])
    lenta.error({ status: 400, error: { errori: [{ campo: null, messaggio: 'Troppe righe.' }] } })
    await stabilizza(fixture)
    expect(q('aggiungi-errore')!.textContent).toContain('Troppe righe.')
    expect(q('aggiungi-ricarica')).toBeNull()
  })

  it('minimi (M…) e detrazioni/anticipi ($…) non si possono spuntare, con il perché (M6)', async () => {
    list.and.returnValue(
      of([
        riga('r1', '20 03 01'),
        { ...riga('r2', ''), tipo: 'MW' },
        { ...riga('r3', ''), tipo: '$D' },
      ])
    )
    await apri()
    await scegliOrigine()
    expect(q<HTMLInputElement>('aggiungi-riga-r1')!.disabled).toBeFalse()
    expect(q<HTMLInputElement>('aggiungi-riga-r2')!.disabled).toBeTrue()
    expect(q<HTMLInputElement>('aggiungi-riga-r3')!.disabled).toBeTrue()
    expect(q('aggiungi-riga-r2')!.closest('label')!.getAttribute('title')).toContain('Non si copia')
    q<HTMLInputElement>('aggiungi-tutte')!.click()
    await stabilizza(fixture)
    expect([...fixture.componentInstance.scelte()]).toEqual(['r1'])
    expect(q<HTMLInputElement>('aggiungi-tutte')!.checked).toBeTrue()
  })
})
