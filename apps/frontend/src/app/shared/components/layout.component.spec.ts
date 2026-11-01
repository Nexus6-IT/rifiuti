import { HttpClientTestingModule } from '@angular/common/http/testing'
import { MessageService } from 'primeng/api'
import { TestBed } from '@angular/core/testing'
import { provideRouter } from '@angular/router'
import { LayoutComponent, ordinaAziendePerGruppo } from './layout.component'

describe('ordinaAziendePerGruppo', () => {
  it('mette ogni figlia sotto la propria madre e la marca come annidata', () => {
    const risultato = ordinaAziendePerGruppo([
      { id: 'beta', name: 'Beta Srl', parentTenantId: 'madre' },
      { id: 'madre', name: 'Gruppo Madre Srl', parentTenantId: null },
      { id: 'alfa', name: 'Alfa Srl', parentTenantId: 'madre' },
    ])

    expect(risultato.map(a => a.id)).toEqual(['madre', 'alfa', 'beta'])
    expect(risultato.map(a => a.annidata)).toEqual([false, true, true])
  })

  it('lascia in elenco piatto le aziende senza gruppo', () => {
    const risultato = ordinaAziendePerGruppo([
      { id: 'due', name: 'Due Srl', parentTenantId: null },
      { id: 'uno', name: 'Uno Srl', parentTenantId: null },
    ])

    expect(risultato.map(a => a.id)).toEqual(['due', 'uno'])
    expect(risultato.every(a => !a.annidata)).toBe(true)
  })

  it("non perde le figlie la cui madre non e' accessibile all'utente", () => {
    const risultato = ordinaAziendePerGruppo([
      { id: 'orfana', name: 'Orfana Srl', parentTenantId: 'madre-non-visibile' },
      { id: 'uno', name: 'Uno Srl', parentTenantId: null },
    ])

    expect(risultato.map(a => a.id).sort()).toEqual(['orfana', 'uno'])
    expect(risultato.find(a => a.id === 'orfana')?.annidata).toBe(false)
  })
})

describe('LayoutComponent: voce di menu Pese', () => {
  it('la voce Pese punta a /pese ed è gated dalla feature pese', () => {
    TestBed.configureTestingModule({
      imports: [LayoutComponent, HttpClientTestingModule],
      providers: [provideRouter([]), MessageService],
    })
    const layout = TestBed.createComponent(LayoutComponent).componentInstance
    const voce = layout.navMain.find(v => v.route === '/pese')
    expect(voce).toEqual(jasmine.objectContaining({ label: 'Pese', feature: 'pese' }))
  })
})

describe('LayoutComponent: voce di menu Clienti', () => {
  it('la voce Clienti sostituisce quella temporanea delle tabelle di fatturazione', () => {
    TestBed.configureTestingModule({
      imports: [LayoutComponent, HttpClientTestingModule],
      providers: [provideRouter([]), MessageService],
    })
    const layout = TestBed.createComponent(LayoutComponent).componentInstance
    const voce = layout.navMain.find(v => v.route === '/clienti')
    expect(voce).toEqual(
      jasmine.objectContaining({ label: 'Clienti', icon: 'pi pi-users', feature: 'contratti' })
    )
    expect(layout.navMain.find(v => v.label === 'Tabelle di fatturazione')).toBeUndefined()
  })
})
