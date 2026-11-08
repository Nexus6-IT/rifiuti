import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing'
import { ComponentFixture, TestBed } from '@angular/core/testing'
import { provideNoopAnimations } from '@angular/platform-browser/animations'
import { environment } from '../../../../environments/environment'
import { NotificationsPageComponent } from './notifications-page.component'

/** Task 15: la pagina Notifiche — un solo h1, nessun arancio fuori dal primario, stati veri. */
describe('NotificationsPageComponent (stile)', () => {
  let fixture: ComponentFixture<NotificationsPageComponent>
  let http: HttpTestingController
  // Gli endpoint veri del backend (notifications.controller.ts): GET /notifications, POST :id/mark-read.
  const url = `${environment.apiUrl}/notifications`

  const fa = (minuti: number) => new Date(Date.now() - minuti * 60000).toISOString()
  const notifica = (id: string, read: boolean, minuti: number) => ({
    id,
    type: 'FIR_COMPLETED',
    title: `Titolo ${id}`,
    message: `Messaggio ${id}`,
    read,
    createdAt: fa(minuti),
  })

  const ciclo = async () => {
    fixture.detectChanges()
    await fixture.whenStable()
    fixture.detectChanges()
  }

  const monta = async (risposta: unknown[] | 'errore') => {
    TestBed.configureTestingModule({
      imports: [NotificationsPageComponent, HttpClientTestingModule],
      providers: [provideNoopAnimations()],
    })
    fixture = TestBed.createComponent(NotificationsPageComponent)
    http = TestBed.inject(HttpTestingController)
    fixture.detectChanges()
    const req = http.expectOne(url)
    if (risposta === 'errore') {
      req.flush('x', { status: 500, statusText: 'Errore' })
    } else {
      req.flush(risposta)
    }
    await ciclo()
    return fixture.nativeElement as HTMLElement
  }

  afterEach(() => http.verify())

  it('ha un solo h1 («Notifiche»)', async () => {
    const el = await monta([notifica('a', false, 5)])
    expect(el.querySelectorAll('h1').length).toBe(1)
    expect(el.querySelector('h1')?.textContent?.trim()).toBe('Notifiche')
  })

  it('nessun bottone primario arancio: «Segna tutte come lette» e a contorno', async () => {
    const el = await monta([notifica('a', false, 5)])
    expect(el.querySelectorAll('.wf-primario').length).toBe(0)
    const bottone = el.querySelector('[data-testid="segna-tutte-lette"] button') as HTMLElement
    expect(bottone.classList.contains('p-button-outlined')).toBeTrue()
  })

  it("«Segna come letta» ha il testo visibile, non solo l'icona", async () => {
    const el = await monta([notifica('a', false, 5)])
    const bottone = el.querySelector<HTMLElement>('[data-testid="segna-letta"] button')!
    expect(bottone.textContent?.trim()).toBe('Segna come letta')
  })

  it('la notifica non letta non ha il filetto arancio a sinistra', async () => {
    const el = await monta([notifica('a', false, 5), notifica('b', true, 5)])
    const nonLetta = el.querySelectorAll<HTMLElement>('[data-testid="notifica"]')[0]
    expect(getComputedStyle(nonLetta).borderLeftWidth).toBe(
      getComputedStyle(nonLetta).borderRightWidth
    )
  })

  it('il tempo trascorso e al singolare quando serve', async () => {
    const el = await monta([
      notifica('a', true, 1),
      notifica('b', true, 60),
      notifica('c', true, 60 * 24),
    ])
    const testo = el.textContent ?? ''
    expect(testo).toContain('1 minuto fa')
    expect(testo).toContain('1 ora fa')
    expect(testo).toContain('1 giorno fa')
    expect(testo).not.toMatch(/\b1 (minuti|ore|giorni)\b/)
  })

  it('se il caricamento fallisce lo dice, con Riprova, senza dire «Nessuna notifica»', async () => {
    const el = await monta('errore')
    expect(el.querySelector('[data-testid="notifiche-errore"]')).not.toBeNull()
    expect(el.textContent).not.toContain('Nessuna notifica')
  })

  it('«Segna come letta» usa POST :id/mark-read e aggiorna la riga', async () => {
    const el = await monta([notifica('a', false, 5)])
    const bottone = el.querySelector<HTMLElement>('[data-testid="segna-letta"] button')!
    bottone.click()
    const req = http.expectOne(`${url}/a/mark-read`)
    expect(req.request.method).toBe('POST')
    req.flush({ success: true })
    await ciclo()
    expect(el.querySelector('.notification-item--unread')).toBeNull()
  })

  it('durante il caricamento non mostra «Nessuna notifica»', async () => {
    TestBed.configureTestingModule({
      imports: [NotificationsPageComponent, HttpClientTestingModule],
      providers: [provideNoopAnimations()],
    })
    fixture = TestBed.createComponent(NotificationsPageComponent)
    http = TestBed.inject(HttpTestingController)
    fixture.detectChanges()
    expect(fixture.nativeElement.textContent).not.toContain('Nessuna notifica')
    http.expectOne(url).flush([])
    await ciclo()
    expect(fixture.nativeElement.textContent).toContain('Nessuna notifica')
  })
})
