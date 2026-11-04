import { ComponentFixture, TestBed } from '@angular/core/testing'
import { provideNoopAnimations } from '@angular/platform-browser/animations'
import { of, throwError } from 'rxjs'
import { bottone, q, stabilizza } from '../clienti/tabelle/tabelle-test-utils'
import {
  LegameDialogComponent,
  numeroPerBackend,
  righeModificate,
  RigaForm,
} from './legame-dialog.component'
import { LegamiService } from './legami.service'
import { LegameVista, RigaLegame } from './legami.model'

function rigaLegame(extra: Partial<RigaLegame> = {}): RigaLegame {
  return {
    id: 'r1',
    rigaAddebitoId: 'ra1',
    ordine: 1,
    origine: 'PRINCIPALE',
    tipo: 'RITIRO',
    descrizione: 'Ritiro rifiuto',
    tipoQuantita: 'PESO',
    unitaMisura: 'kg',
    quantita: '10',
    quantitaOrigine: 'DA_MOVIMENTO',
    prezzoSpeciale: false,
    prezzo: '12.5',
    sconto: null,
    prezzoManuale: false,
    aliquotaIva: '22',
    naturaIva: null,
    congelataIl: null,
    importo: '125.00',
    ...extra,
  }
}

function legame(extra: Partial<LegameVista> = {}): LegameVista {
  return {
    id: 'l1',
    movimentoOriginaleId: 'm1',
    movimentoVigenteId: 'm1',
    stato: 'PROPOSTO',
    dataMovimento: '2026-03-12',
    cliente: { id: 'c1', etichetta: 'Rossi Srl', fonte: 'FIR' },
    dettaglioCliente: null,
    contratto: { id: 'k1', etichetta: 'CC-2026-001' },
    elenco: { id: 'e1', etichetta: 'Listino 2026' },
    righe: [rigaLegame()],
    motivi: [],
    avvisi: [],
    motivoEsclusione: null,
    confermatoIl: null,
    fatturatoIl: null,
    riferimentoFattura: null,
    scostamentoDopoFattura: false,
    scostamentoIl: null,
    versione: 3,
    candidati: {
      contratti: [
        { id: 'k1', etichetta: 'CC-2026-001' },
        { id: 'k2', etichetta: 'CC-2026-002' },
      ],
      elenchi: [{ id: 'e1', etichetta: 'Listino 2026' }],
      righe: [],
    },
    ...extra,
  }
}

const scrivi = async (
  fixture: ComponentFixture<unknown>,
  id: string,
  testo: string
): Promise<void> => {
  const host = q(id)!
  const el = host.tagName === 'INPUT' ? (host as HTMLInputElement) : host.querySelector('input')!
  el.value = testo
  el.dispatchEvent(new Event('input', { bubbles: true }))
  el.dispatchEvent(new Event('blur', { bubbles: true }))
  await stabilizza(fixture)
}

describe('numeroPerBackend', () => {
  it('punto decimale, nessun esponente né zero finale', () => {
    expect(numeroPerBackend(12.5, 6)).toBe('12.5')
    expect(numeroPerBackend(1.5, 3)).toBe('1.5')
    expect(numeroPerBackend(10, 3)).toBe('10')
    expect(numeroPerBackend(0.000001, 6)).toBe('0.000001')
    expect(numeroPerBackend(1000, 3)).toBe('1000')
  })
})

describe('righeModificate', () => {
  const form = (extra: Partial<RigaForm> = {}, riga = rigaLegame()): RigaForm => ({
    riga,
    quantita: 10,
    prezzo: 12.5,
    sconto: '',
    ...extra,
  })

  it('nessun ritocco: nessuna riga', () => {
    expect(righeModificate([form()])).toEqual([])
  })

  it('manda solo i campi cambiati, come stringhe col punto', () => {
    expect(righeModificate([form({ quantita: 1.5, prezzo: 13, sconto: '10,5+5' })])).toEqual([
      { rigaAddebitoId: 'ra1', quantita: '1.5', prezzo: '13', sconto: '10.5+5' },
    ])
  })

  it('riga a prezzo speciale: il prezzo non parte mai', () => {
    const r = rigaLegame({ prezzoSpeciale: true, prezzo: '8' })
    expect(righeModificate([form({ prezzo: 9, quantita: 2 }, r)])).toEqual([
      { rigaAddebitoId: 'ra1', quantita: '2' },
    ])
  })

  it('sconto svuotato su una riga con sconto: null', () => {
    const r = rigaLegame({ sconto: '10' })
    expect(righeModificate([form({ sconto: '' }, r)])).toEqual([
      { rigaAddebitoId: 'ra1', sconto: null },
    ])
  })
})

describe('LegameDialogComponent', () => {
  let fixture: ComponentFixture<LegameDialogComponent>
  let servizio: jasmine.SpyObj<LegamiService>

  async function apri(l: LegameVista, puoScrivere = true): Promise<void> {
    servizio = jasmine.createSpyObj('LegamiService', ['modifica', 'conferma', 'dettaglio'])
    await TestBed.configureTestingModule({
      imports: [LegameDialogComponent],
      providers: [provideNoopAnimations(), { provide: LegamiService, useValue: servizio }],
    }).compileComponents()
    fixture = TestBed.createComponent(LegameDialogComponent)
    fixture.componentRef.setInput('legame', l)
    fixture.componentRef.setInput('puoScrivere', puoScrivere)
    await stabilizza(fixture)
  }

  afterEach(() => fixture?.destroy())

  it('mostra stato, cliente «da FIR», contratto e righe con l’importo del server', async () => {
    await apri(legame())
    expect(q('legame-stato')?.textContent).toContain('Proposto')
    expect(q('legame-cliente')?.textContent).toContain('Rossi Srl')
    expect(q('legame-cliente')?.textContent).toContain('da FIR')
    expect(q('legame-riga-0')?.textContent).toContain('125.00')
  })

  it('quantità "1,5" digitata: la conferma parte con "1.5" nelle modifiche', async () => {
    await apri(legame())
    servizio.conferma.and.returnValue(of(legame({ stato: 'CONFERMATO' })))
    await scrivi(fixture, 'legame-qta-0', '1,5')
    bottone('legame-conferma')!.click()
    await stabilizza(fixture)
    expect(servizio.conferma).toHaveBeenCalledOnceWith('l1', {
      versione: 3,
      modifiche: { righe: [{ rigaAddebitoId: 'ra1', quantita: '1.5' }] },
    })
  })

  it('prezzo "12,75" modificato: «Salva» invia "12.75", badge «prezzo manuale»', async () => {
    await apri(legame())
    servizio.modifica.and.returnValue(of(legame()))
    await scrivi(fixture, 'legame-prezzo-0', '12,75')
    expect(q('legame-badge-manuale-0')?.textContent).toContain('prezzo manuale')
    bottone('legame-salva')!.click()
    await stabilizza(fixture)
    expect(servizio.modifica).toHaveBeenCalledOnceWith('l1', {
      versione: 3,
      righe: [{ rigaAddebitoId: 'ra1', prezzo: '12.75' }],
    })
  })

  it('nessun separatore delle migliaia nel campo modificabile', async () => {
    await apri(legame({ righe: [rigaLegame({ quantita: '1000', prezzo: '2500.5' })] }))
    const qta = q('legame-qta-0')!.querySelector('input')!
    const prezzo = q('legame-prezzo-0')!.querySelector('input')!
    expect(qta.value).toBe('1000')
    expect(prezzo.value).toBe('2500,5')
  })

  it('«Conferma» senza ritocchi: nessun blocco modifiche', async () => {
    await apri(legame())
    servizio.conferma.and.returnValue(of(legame({ stato: 'CONFERMATO' })))
    bottone('legame-conferma')!.click()
    await stabilizza(fixture)
    expect(servizio.conferma).toHaveBeenCalledOnceWith('l1', { versione: 3 })
  })

  it('riga a prezzo speciale: il prezzo non è modificabile', async () => {
    await apri(legame({ righe: [rigaLegame({ prezzoSpeciale: true, prezzo: '8' })] }))
    expect(q('legame-prezzo-0')).toBeNull()
    expect(q('legame-prezzo-testo-0')?.textContent).toContain('8')
  })

  it('sconto con il punto: «Usa la virgola per i decimali» e pulsanti bloccati', async () => {
    await apri(legame())
    await scrivi(fixture, 'legame-sconto-0', '10.5')
    expect(q('legame-sconto-errore-0')?.textContent).toContain('Usa la virgola per i decimali')
    expect(bottone('legame-conferma')!.disabled).toBeTrue()
    expect(bottone('legame-salva')!.disabled).toBeTrue()
  })

  it('sconto con la virgola accettato e inviato col punto', async () => {
    await apri(legame())
    servizio.modifica.and.returnValue(of(legame()))
    await scrivi(fixture, 'legame-sconto-0', '10,5')
    bottone('legame-salva')!.click()
    await stabilizza(fixture)
    expect(servizio.modifica.calls.mostRecent().args[1]).toEqual({
      versione: 3,
      righe: [{ rigaAddebitoId: 'ra1', sconto: '10.5' }],
    })
  })

  it('cambio di contratto con un prezzo manuale: avviso che andrà perso e contrattoId inviato', async () => {
    await apri(legame({ righe: [rigaLegame({ prezzoManuale: true })] }))
    expect(q('legame-avviso-perdita')).toBeNull()
    fixture.componentInstance.contrattoId = 'k2'
    await stabilizza(fixture)
    expect(q('legame-avviso-perdita')?.textContent).toContain('andranno persi')
    expect(fixture.componentInstance.modifiche()).toEqual({ contrattoId: 'k2' })
  })

  it('409 LEGAME_INCOMPLETO: elenca i motivi tradotti', async () => {
    await apri(legame())
    servizio.conferma.and.returnValue(
      throwError(() => ({
        status: 409,
        error: {
          error: 'LEGAME_INCOMPLETO',
          message: 'x',
          details: { motivi: ['SENZA_PREZZO'] },
        },
      }))
    )
    bottone('legame-conferma')!.click()
    await stabilizza(fixture)
    expect(q('legame-errore')?.textContent).toContain('Manca il prezzo')
  })

  it('VERSIONE_SUPERATA: messaggio e «Ricarica» che rilegge il legame', async () => {
    await apri(legame())
    servizio.modifica.and.returnValue(
      throwError(() => ({
        status: 409,
        error: { error: 'VERSIONE_SUPERATA', message: 'Ricarica' },
      }))
    )
    bottone('legame-salva')!.click()
    await stabilizza(fixture)
    servizio.dettaglio.and.returnValue(of(legame({ versione: 4 })))
    bottone('legame-ricarica')!.click()
    await stabilizza(fixture)
    expect(servizio.dettaglio).toHaveBeenCalledWith('l1')
    expect(q('legame-errore')).toBeNull()
  })

  it('sola lettura (VIEWER o stato FATTURATO): nessun campo né pulsante di scrittura', async () => {
    await apri(legame(), false)
    expect(q('legame-conferma')).toBeNull()
    expect(q('legame-qta-0')).toBeNull()
    expect(q('legame-sola-lettura')).not.toBeNull()
    fixture.destroy()
    TestBed.resetTestingModule()
    await apri(legame({ stato: 'FATTURATO' }), true)
    expect(q('legame-conferma')).toBeNull()
  })
})
