import { ComponentFixture, TestBed } from '@angular/core/testing'
import { provideNoopAnimations } from '@angular/platform-browser/animations'
import { Subject, of, throwError } from 'rxjs'
import { Cliente, ContrattoCliente } from '../clienti/clienti.model'
import { ClientiService } from '../clienti/clienti.service'
import { q, stabilizza } from '../clienti/tabelle/tabelle-test-utils'
import { ElencoAddebiti } from './listino.model'
import { ListinoService } from './listino.service'
import { SceltaElencoOrigineComponent } from './scelta-elenco-origine.component'

const elenco = (id: string): ElencoAddebiti =>
  ({ id, codice: id.toUpperCase(), descrizione: `Elenco ${id}`, righe: 4 }) as ElencoAddebiti
const cliente = { id: 'cl9' } as Cliente
const contratto = (id: string) => ({ id, numero: `CC-${id}`, descrizione: 'x' }) as ContrattoCliente

describe('SceltaElencoOrigineComponent', () => {
  let fixture: ComponentFixture<SceltaElencoOrigineComponent>
  let contrattiList: jasmine.Spy
  let delContratto: jasmine.Spy
  let scelti: (ElencoAddebiti | null)[]

  const sel = (id: string, v: string) => {
    const s = q<HTMLSelectElement>(id)!
    s.value = v
    s.dispatchEvent(new Event('change'))
  }

  beforeEach(async () => {
    contrattiList = jasmine
      .createSpy('list')
      .and.returnValue(of({ elementi: [contratto('c1'), contratto('c2')], totale: 2 }))
    delContratto = jasmine
      .createSpy('delContratto')
      .and.returnValue(of({ contesto: {}, elenchi: [elenco('e1'), elenco('e2')] }))
    TestBed.configureTestingModule({
      imports: [SceltaElencoOrigineComponent],
      providers: [
        provideNoopAnimations(),
        {
          provide: ClientiService,
          useValue: {
            contratti: { list: contrattiList },
            clienti: { list: () => of({ elementi: [], totale: 0 }) },
          },
        },
        { provide: ListinoService, useValue: { elenchi: { delContratto } } },
      ],
    })
    fixture = TestBed.createComponent(SceltaElencoOrigineComponent)
    scelti = []
    fixture.componentInstance.scelto.subscribe(e => scelti.push(e))
    fixture.componentRef.setInput('escludiElencoId', 'e2')
    await stabilizza(fixture)
  })
  afterEach(() => fixture.destroy())

  it('cliente → contratti del cliente → elenchi del contratto, senza l’elenco di arrivo', async () => {
    fixture.componentInstance.sceltoCliente(cliente)
    await stabilizza(fixture)
    expect(contrattiList).toHaveBeenCalledOnceWith({ clienteId: 'cl9', pagina: 1, dimensione: 100 })
    expect(q('origine-contratto')!.textContent).toContain('CC-c1')
    sel('origine-contratto', 'c1')
    await stabilizza(fixture)
    expect(delContratto).toHaveBeenCalledOnceWith('c1')
    const testo = q('origine-elenco')!.textContent!
    expect(testo).toContain('E1 - Elenco e1 (4 righe)')
    expect(testo).not.toContain('E2')
    sel('origine-elenco', 'e1')
    expect(scelti[scelti.length - 1]?.id).toBe('e1')
  })

  it('cambiando contratto la scelta dell’elenco torna nulla', async () => {
    fixture.componentInstance.sceltoCliente(cliente)
    await stabilizza(fixture)
    sel('origine-contratto', 'c1')
    await stabilizza(fixture)
    sel('origine-elenco', 'e1')
    sel('origine-contratto', 'c2')
    await stabilizza(fixture)
    expect(scelti[scelti.length - 1]).toBeNull()
  })

  it('il cliente tolto svuota la catena', async () => {
    fixture.componentInstance.sceltoCliente(cliente)
    await stabilizza(fixture)
    fixture.componentInstance.sceltoCliente(null)
    await stabilizza(fixture)
    expect(q('origine-contratto')).toBeNull()
    expect(scelti[scelti.length - 1]).toBeNull()
  })

  it('cliente senza contratti: messaggio', async () => {
    contrattiList.and.returnValue(of({ elementi: [], totale: 0 }))
    fixture.componentInstance.sceltoCliente(cliente)
    await stabilizza(fixture)
    expect(q('origine-nessun-contratto')).not.toBeNull()
  })

  it('cliente con più contratti di quelli letti: avviso con il totale (voce 13)', async () => {
    contrattiList.and.returnValue(of({ elementi: [contratto('c1')], totale: 150 }))
    fixture.componentInstance.sceltoCliente(cliente)
    await stabilizza(fixture)
    expect(q('origine-errore-contratti')!.textContent).toContain('150 contratti')
    expect(q('origine-contratto')).not.toBeNull()
  })

  it('errori di contratti ed elenchi in zone separate', async () => {
    contrattiList.and.returnValue(throwError(() => ({ error: { message: 'Contratti KO.' } })))
    fixture.componentInstance.sceltoCliente(cliente)
    await stabilizza(fixture)
    expect(q('origine-errore-contratti')!.textContent).toContain('Contratti KO.')
    contrattiList.and.returnValue(of({ elementi: [contratto('c1')], totale: 1 }))
    fixture.componentInstance.sceltoCliente(cliente)
    await stabilizza(fixture)
    expect(q('origine-errore-contratti')).toBeNull()
    delContratto.and.returnValue(throwError(() => ({ error: { message: 'Elenchi KO.' } })))
    sel('origine-contratto', 'c1')
    await stabilizza(fixture)
    expect(q('origine-errore-elenchi')!.textContent).toContain('Elenchi KO.')
  })

  it('una risposta tardiva di un contratto abbandonato non conta', async () => {
    const tardiva = new Subject<{ elenchi: ElencoAddebiti[] }>()
    delContratto.and.returnValues(tardiva, of({ elenchi: [elenco('e1')] }))
    fixture.componentInstance.sceltoCliente(cliente)
    await stabilizza(fixture)
    sel('origine-contratto', 'c1')
    sel('origine-contratto', 'c2')
    await stabilizza(fixture)
    tardiva.next({ elenchi: [elenco('e9')] })
    await stabilizza(fixture)
    expect(q('origine-elenco')!.textContent).not.toContain('E9')
  })

  it('azzera ricrea anche il campo del cliente e svuota la catena (M5)', async () => {
    fixture.componentInstance.sceltoCliente(cliente)
    await stabilizza(fixture)
    const prima = fixture.nativeElement.querySelector('app-scelta-cliente')
    fixture.componentRef.setInput('azzera', 1)
    await stabilizza(fixture)
    await Promise.resolve()
    await stabilizza(fixture)
    const dopo = fixture.nativeElement.querySelector('app-scelta-cliente')
    expect(dopo).not.toBeNull()
    expect(dopo).not.toBe(prima)
    expect(q('origine-contratto')).toBeNull()
  })
})
