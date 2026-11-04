import { ComponentFixture, TestBed } from '@angular/core/testing'
import { provideNoopAnimations } from '@angular/platform-browser/animations'
import { of, throwError } from 'rxjs'
import { bottone, q, stabilizza } from '../clienti/tabelle/tabelle-test-utils'
import {
  LegameDialogComponent,
  erroreSconto,
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

describe('erroreSconto', () => {
  it('rifiuta negativi, punto, più di tre termini e termini oltre 99,99', () => {
    expect(erroreSconto('-5')).not.toBeNull()
    expect(erroreSconto('10.5')).toContain('virgola')
    expect(erroreSconto('1+2+3+4')).toContain('al massimo tre')
    expect(erroreSconto('100')).toContain('99,99')
    expect(erroreSconto('10,555')).not.toBeNull()
  })

  it('accetta vuoto, 10, 10,5 e 10+5,5+2', () => {
    for (const ok of ['', '10', '10,5', '10+5,5+2']) expect(erroreSconto(ok)).toBeNull()
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

  it('riga a prezzo speciale: lo sconto non parte mai', () => {
    const r = rigaLegame({ prezzoSpeciale: true, prezzo: '8', sconto: '10' })
    expect(righeModificate([form({ prezzo: 8, sconto: '20' }, r)])).toEqual([])
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
    expect(q('legame-riga-0')?.textContent).toContain('125,00 €')
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
    expect(q('legame-avviso-rigenera')).toBeNull()
    fixture.componentInstance.contrattoId = 'k2'
    await stabilizza(fixture)
    expect(q('legame-avviso-rigenera')?.textContent).toContain('andranno persi')
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

  it('VERSIONE_SUPERATA: «Ricarica» rilegge tutto e la richiesta successiva porta la versione nuova', async () => {
    await apri(legame())
    servizio.modifica.and.returnValue(
      throwError(() => ({
        status: 409,
        error: { error: 'VERSIONE_SUPERATA', message: 'Ricarica' },
      }))
    )
    bottone('legame-salva')!.click()
    await stabilizza(fixture)
    servizio.dettaglio.and.returnValue(of(legame({ versione: 4, stato: 'PROPOSTO' })))
    bottone('legame-ricarica')!.click()
    await stabilizza(fixture)
    expect(servizio.dettaglio).toHaveBeenCalledWith('l1')
    expect(q('legame-errore')).toBeNull()
    servizio.modifica.and.returnValue(of(legame()))
    bottone('legame-salva')!.click()
    await stabilizza(fixture)
    expect(servizio.modifica.calls.mostRecent().args[1]).toEqual({ versione: 4 })
  })

  it('cambio di elenco più quantità toccata: modifiche senza righe e tabella in sola lettura', async () => {
    await apri(
      legame({
        candidati: {
          contratti: [{ id: 'k1', etichetta: 'CC-2026-001' }],
          elenchi: [
            { id: 'e1', etichetta: 'Listino 2026' },
            { id: 'e2', etichetta: 'Listino speciale' },
          ],
          righe: [],
        },
      })
    )
    await scrivi(fixture, 'legame-qta-0', '3')
    fixture.componentInstance.elencoId = 'e2'
    await stabilizza(fixture)
    expect(fixture.componentInstance.modifiche()).toEqual({ elencoId: 'e2' })
    expect(q('legame-qta-0')).toBeNull()
    expect(q('legame-avviso-rigenera')).not.toBeNull()
  })

  it('cambio di contratto: l’elenco si azzera e il suo menu si disattiva', async () => {
    await apri(
      legame({
        candidati: {
          contratti: [
            { id: 'k1', etichetta: 'A' },
            { id: 'k2', etichetta: 'B' },
          ],
          elenchi: [
            { id: 'e1', etichetta: 'Listino 2026' },
            { id: 'e2', etichetta: 'Altro' },
          ],
          righe: [],
        },
      })
    )
    const c = fixture.componentInstance
    c.contrattoId = 'k2'
    c.alCambioContratto()
    expect(c.elencoId).toBeNull()
    expect(c.modifiche()).toEqual({ contrattoId: 'k2' })
    c.contrattoId = 'k1'
    c.alCambioContratto()
    expect(c.elencoId).toBe('e1')
  })

  it('senza cliente (SENZA_CLIENTE): si sceglie il cliente e parte solo clienteId', async () => {
    TestBed.resetTestingModule()
    servizio = jasmine.createSpyObj('LegamiService', ['modifica', 'conferma', 'dettaglio'])
    await TestBed.configureTestingModule({
      imports: [LegameDialogComponent],
      providers: [provideNoopAnimations(), { provide: LegamiService, useValue: servizio }],
    }).compileComponents()
    fixture = TestBed.createComponent(LegameDialogComponent)
    fixture.componentRef.setInput(
      'legame',
      legame({ cliente: null, contratto: null, elenco: null, righe: [], motivi: ['SENZA_CLIENTE'] })
    )
    fixture.componentRef.setInput('puoScrivere', true)
    fixture.componentRef.setInput('clienti', [{ label: 'Bianchi Srl', value: 'c9' }])
    await stabilizza(fixture)
    expect(q('legame-cliente-scelta')).not.toBeNull()
    fixture.componentInstance.clienteId = 'c9'
    expect(bottone('legame-conferma')!.disabled).toBeTrue()
    expect(q('legame-conferma-bloccata')).not.toBeNull()
    fixture.componentInstance.alCambioCliente()
    await stabilizza(fixture)
    expect(bottone('legame-conferma')!.disabled).toBeFalse()
    servizio.conferma.and.returnValue(of(legame({ stato: 'CONFERMATO' })))
    bottone('legame-conferma')!.click()
    await stabilizza(fixture)
    expect(servizio.conferma).toHaveBeenCalledOnceWith('l1', {
      versione: 3,
      modifiche: { clienteId: 'c9' },
    })
  })

  it('numeri in sola lettura con la virgola, importi con euro', async () => {
    await apri(
      legame({
        stato: 'ANNULLATO',
        righe: [rigaLegame({ quantita: '12.5', prezzo: '1.5', importo: '123.45' })],
      })
    )
    const t = q('legame-riga-0')?.textContent ?? ''
    expect(t).toContain('12,5')
    expect(t).toContain('1,5')
    expect(t).toContain('123,45 €')
    expect(t).not.toContain('12.5')
    expect(t).not.toContain('123.45')
  })

  it('RIGA_AMBIGUA: si sceglie una riga fra i candidati e parte come aggiunta', async () => {
    await apri(
      legame({
        righe: [],
        motivi: ['RIGA_AMBIGUA'],
        candidati: {
          contratti: [],
          elenchi: [],
          righe: [
            { id: 'ra7', etichetta: 'Ritiro 080318', origine: 'PROPOSTA' },
            { id: 'ra8', etichetta: 'Ritiro 080318 urgente', origine: 'PROPOSTA' },
          ],
        },
      })
    )
    const c = fixture.componentInstance
    c.rigaDaAggiungere = 'ra8'
    c.aggiungiRiga()
    await stabilizza(fixture)
    expect(q('legame-aggiunta')?.textContent).toContain('urgente')
    expect(c.righeDisponibili().map(r => r.id)).toEqual(['ra7'])
    servizio.conferma.and.returnValue(of(legame({ stato: 'CONFERMATO' })))
    bottone('legame-conferma')!.click()
    await stabilizza(fixture)
    expect(servizio.conferma).toHaveBeenCalledOnceWith('l1', {
      versione: 3,
      modifiche: { righe: [{ rigaAddebitoId: 'ra8' }] },
    })
  })

  it('quantità 0: errore esplicito (nessuna correzione silenziosa) e pulsanti bloccati', async () => {
    await apri(legame())
    await scrivi(fixture, 'legame-qta-0', '0')
    expect(q('legame-qta-errore-0')?.textContent).toContain('maggiore di zero')
    expect(bottone('legame-conferma')!.disabled).toBeTrue()
  })

  it('prezzo svuotato su una riga che lo aveva: errore e pulsanti bloccati', async () => {
    await apri(legame())
    await scrivi(fixture, 'legame-prezzo-0', '')
    expect(q('legame-prezzo-errore-0')?.textContent).toContain('obbligatorio')
    expect(bottone('legame-salva')!.disabled).toBeTrue()
  })

  it('riga a prezzo speciale: anche lo sconto è di sola lettura', async () => {
    await apri(legame({ righe: [rigaLegame({ prezzoSpeciale: true, prezzo: '8', sconto: '10' })] }))
    expect(q('legame-sconto-0')).toBeNull()
    expect(q('legame-sconto-testo-0')?.textContent).toContain('10')
  })

  it('«Rimuovi riga»: parte rimuovi:true per quella riga, le altre non toccate non partono', async () => {
    await apri(legame({ righe: [rigaLegame(), rigaLegame({ id: 'r2', rigaAddebitoId: 'ra2' })] }))
    bottone('legame-rimuovi-1')!.click()
    await stabilizza(fixture)
    expect(q('legame-rimossa-1')).not.toBeNull()
    servizio.conferma.and.returnValue(of(legame({ stato: 'CONFERMATO' })))
    bottone('legame-conferma')!.click()
    await stabilizza(fixture)
    expect(servizio.conferma).toHaveBeenCalledOnceWith('l1', {
      versione: 3,
      modifiche: { righe: [{ rigaAddebitoId: 'ra2', rimuovi: true }] },
    })
  })

  it('«Ripristina» annulla la rimozione; rimuovere tutte le righe blocca i pulsanti', async () => {
    await apri(legame())
    bottone('legame-rimuovi-0')!.click()
    await stabilizza(fixture)
    expect(q('legame-senza-righe')).not.toBeNull()
    expect(bottone('legame-conferma')!.disabled).toBeTrue()
    bottone('legame-rimuovi-0')!.click()
    await stabilizza(fixture)
    expect(q('legame-senza-righe')).toBeNull()
    expect(fixture.componentInstance.modifiche()).toBeUndefined()
  })

  it('una riga rimossa non porta i suoi ritocchi; a scelte cambiate non si può rimuovere', async () => {
    await apri(legame({ righe: [rigaLegame(), rigaLegame({ id: 'r2', rigaAddebitoId: 'ra2' })] }))
    await scrivi(fixture, 'legame-qta-1', '4')
    bottone('legame-rimuovi-1')!.click()
    await stabilizza(fixture)
    expect(fixture.componentInstance.modifiche()).toEqual({
      righe: [{ rigaAddebitoId: 'ra2', rimuovi: true }],
    })
    fixture.componentInstance.contrattoId = 'k2'
    await stabilizza(fixture)
    expect(q('legame-rimuovi-0')).toBeNull()
  })

  it('la ricerca nel menu cliente è inoltrata alla pagina (cercaCliente)', async () => {
    await apri(legame({ cliente: null, righe: [] }))
    const testi: string[] = []
    fixture.componentInstance.cercaCliente.subscribe(t => testi.push(t))
    fixture.componentInstance.cercaCliente.emit('bia')
    expect(testi).toEqual(['bia'])
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
