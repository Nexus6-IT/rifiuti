import { ComponentFixture, TestBed } from '@angular/core/testing'
import { provideNoopAnimations } from '@angular/platform-browser/animations'
import { of, throwError } from 'rxjs'
import { MessageService } from 'primeng/api'
import { AuthService } from '../../core/services/auth.service'
import { bottone, q, stabilizza } from '../clienti/tabelle/tabelle-test-utils'
import { ConfigurazioneSdiComponent } from './configurazione-sdi.component'
import { ConfigurazioneSdiService } from './configurazione-sdi.service'
import { ConfigurazioneSdi } from './sdi.model'

const vuota: ConfigurazioneSdi = {
  configurata: false,
  provider: null,
  ambiente: null,
  haCredenziali: false,
  idConfigurazioneProvider: null,
  haSegretoWebhook: false,
  firmaDalProvider: false,
  invioAttivo: false,
  onboarding: {},
  passiOnboarding: ['CONTRATTO_PROVIDER', 'PROVA_SANDBOX_SUPERATA'],
  verificataIl: null,
  ultimoEsitoVerifica: null,
  versione: 0,
  modificatoIl: null,
}
const configurata: ConfigurazioneSdi = {
  ...vuota,
  configurata: true,
  provider: 'fake',
  ambiente: 'SANDBOX',
  versione: 1,
}

describe('ConfigurazioneSdiComponent', () => {
  let fixture: ComponentFixture<ConfigurazioneSdiComponent>
  let servizio: jasmine.SpyObj<ConfigurazioneSdiService>

  async function crea(ruolo: string, iniziale: ConfigurazioneSdi = vuota): Promise<void> {
    servizio = jasmine.createSpyObj('ConfigurazioneSdiService', [
      'leggi',
      'salva',
      'verifica',
      'rigeneraToken',
      'impostaInvioAttivo',
      'impostaPasso',
    ])
    servizio.leggi.and.returnValue(of(iniziale))
    await TestBed.configureTestingModule({
      imports: [ConfigurazioneSdiComponent],
      providers: [
        provideNoopAnimations(),
        MessageService,
        { provide: ConfigurazioneSdiService, useValue: servizio },
        { provide: AuthService, useValue: { currentUser: () => ({ role: ruolo }) } },
      ],
    }).compileComponents()
    fixture = TestBed.createComponent(ConfigurazioneSdiComponent)
    await stabilizza(fixture)
  }

  const scrivi = async (id: string, valore: string) => {
    const el = q<HTMLInputElement>(id)!
    el.value = valore
    el.dispatchEvent(new Event('input', { bubbles: true }))
    await stabilizza(fixture)
  }
  const scegli = async (id: string, valore: string) => {
    const el = q<HTMLSelectElement>(id)!
    el.value = valore
    el.dispatchEvent(new Event('change', { bubbles: true }))
    await stabilizza(fixture)
  }

  afterEach(() => fixture?.destroy())

  it('senza configurazione: avviso, invio non attivabile e nessuna sezione di verifica', async () => {
    await crea('ADMIN')
    expect(q('sdi-non-configurata')).not.toBeNull()
    expect(q('sdi-verifica')).toBeNull()
    expect(q('sdi-invio')).toBeNull()
  })

  it('salva senza provider: errore e nessuna chiamata', async () => {
    await crea('ADMIN')
    bottone('sdi-salva')!.click()
    await stabilizza(fixture)
    expect(q('sdi-errore')?.textContent).toContain('Scegli il provider')
    expect(servizio.salva).not.toHaveBeenCalled()
  })

  it('salva: invia provider, ambiente, versione e la chiave solo se scritta; mostra il token una volta', async () => {
    await crea('ADMIN')
    servizio.salva.and.returnValue(
      of({ ...configurata, haCredenziali: true, webhookToken: 'TOKEN-ABC' })
    )
    await scegli('sdi-provider', 'fake')
    await scrivi('sdi-apikey', 'chiave-1')
    bottone('sdi-salva')!.click()
    await stabilizza(fixture)
    expect(servizio.salva).toHaveBeenCalledWith(
      jasmine.objectContaining({
        provider: 'fake',
        ambiente: 'SANDBOX',
        versione: 0,
        credenziali: { apiKey: 'chiave-1' },
      })
    )
    expect(q('sdi-token')?.textContent).toContain('TOKEN-ABC')
    // I campi dei segreti si svuotano e il server non li restituisce.
    expect(q<HTMLInputElement>('sdi-apikey')!.value).toBe('')
  })

  it('senza chiave scritta, le credenziali non partono (restano invariate)', async () => {
    await crea('ADMIN', configurata)
    servizio.salva.and.returnValue(of(configurata))
    bottone('sdi-salva')!.click()
    await stabilizza(fixture)
    const dati = servizio.salva.calls.mostRecent().args[0]
    expect('credenziali' in dati).toBeFalse()
    expect('segretoWebhook' in dati).toBeFalse()
  })

  it('l interruttore «Invio attivo» e disabilitato finche non c e una verifica riuscita', async () => {
    await crea('ADMIN', configurata)
    expect(q('sdi-invio')?.querySelector('input')?.disabled).toBeTrue()
    fixture.destroy()
    TestBed.resetTestingModule()
    await crea('ADMIN', { ...configurata, verificataIl: '2026-11-19T10:00:00.000Z' })
    expect(q('sdi-invio')?.querySelector('input')?.disabled).toBeFalse()
  })

  it('verifica: mostra l esito riuscito', async () => {
    await crea('ADMIN', configurata)
    servizio.verifica.and.returnValue(
      of({
        esito: { ok: true, dettaglio: 'ok' },
        configurazione: { ...configurata, verificataIl: '2026-11-19T10:00:00.000Z', versione: 2 },
      })
    )
    bottone('sdi-verifica')!.click()
    await stabilizza(fixture)
    expect(q('sdi-verificata')).not.toBeNull()
  })

  it('verifica fallita: mostra il motivo', async () => {
    await crea('ADMIN', configurata)
    servizio.verifica.and.returnValue(
      of({
        esito: { ok: false, dettaglio: 'Credenziali rifiutate' },
        configurazione: {
          ...configurata,
          ultimoEsitoVerifica: 'Credenziali rifiutate',
          versione: 2,
        },
      })
    )
    bottone('sdi-verifica')!.click()
    await stabilizza(fixture)
    expect(q('sdi-esito-ko')?.textContent).toContain('Credenziali rifiutate')
  })

  it('versione superata (409): rilegge e avvisa', async () => {
    await crea('ADMIN', configurata)
    servizio.salva.and.returnValue(
      throwError(() => ({ status: 409, error: { error: 'VERSIONE_SUPERATA', message: 'x' } }))
    )
    await scegli('sdi-provider', 'fake')
    bottone('sdi-salva')!.click()
    await stabilizza(fixture)
    expect(servizio.leggi).toHaveBeenCalledTimes(2)
    expect(q('sdi-errore')?.textContent).toContain('modificata da un altro utente')
  })

  it('VIEWER e OPERATOR: tutti i campi e i bottoni sono disabilitati', async () => {
    for (const ruolo of ['VIEWER', 'OPERATOR']) {
      TestBed.resetTestingModule()
      await crea(ruolo, { ...configurata, verificataIl: '2026-11-19T10:00:00.000Z' })
      expect(q<HTMLSelectElement>('sdi-provider')!.disabled).toBeTrue()
      expect(bottone('sdi-salva')!.disabled).toBeTrue()
      expect(bottone('sdi-verifica')!.disabled).toBeTrue()
      expect(q('sdi-invio')?.querySelector('input')?.disabled).toBeTrue()
      expect(q<HTMLInputElement>('sdi-passo-CONTRATTO_PROVIDER')!.disabled).toBeTrue()
      fixture.destroy()
    }
  })

  it('onboarding: spuntare un passo chiama il servizio con la versione', async () => {
    await crea('ADMIN', configurata)
    servizio.impostaPasso.and.returnValue(
      of({
        ...configurata,
        versione: 2,
        onboarding: { CONTRATTO_PROVIDER: { il: '2026-11-19T10:00:00.000Z', da: 'u1' } },
      })
    )
    q<HTMLInputElement>('sdi-passo-CONTRATTO_PROVIDER')!.click()
    await stabilizza(fixture)
    expect(servizio.impostaPasso).toHaveBeenCalledWith('CONTRATTO_PROVIDER', true, 1)
  })
})
