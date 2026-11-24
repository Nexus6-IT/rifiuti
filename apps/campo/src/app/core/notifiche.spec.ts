import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Notifiche } from './notifiche';
import { PORTA_PUSH, type PermessoNotifiche, type PortaPush } from './porta-push';

const flush = () => new Promise<void>((r) => setTimeout(r));

function porta(over: Partial<PortaPush> & { perm?: PermessoNotifiche } = {}): PortaPush {
  return {
    supportato: () => true,
    richiedeInstallazione: () => false,
    permesso: () => over.perm ?? 'default',
    chiediPermesso: async () => 'granted',
    endpointAttuale: async () => null,
    sottoscrivi: async () => 'https://fcm.googleapis.com/fcm/send/x',
    annullaLocale: async () => undefined,
    ...over,
  };
}

describe('Notifiche (scheda nel giro)', () => {
  let http: HttpTestingController;
  function monta(p: PortaPush) {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: PORTA_PUSH, useValue: p },
      ],
    });
    http = TestBed.inject(HttpTestingController);
    const f = TestBed.createComponent(Notifiche);
    return f;
  }
  const el = (f: { nativeElement: unknown }) => f.nativeElement as HTMLElement;

  it('browser senza push o server senza chiavi: la scheda non compare', async () => {
    const f = monta(porta({ supportato: () => false }));
    await flush();
    f.detectChanges();
    expect(el(f).querySelector('section')).toBeNull();

    TestBed.resetTestingModule();
    const g = monta(porta());
    await flush();
    http
      .expectOne('/api/v1/push/configurazione')
      .flush({ disponibile: false, chiavePubblica: null });
    await flush();
    g.detectChanges();
    expect(el(g).querySelector('section')).toBeNull();
  });

  it('da attivare: il pulsante c è, il testo dice che l avviso non contiene dati', async () => {
    const f = monta(porta());
    await flush();
    http.expectOne('/api/v1/push/configurazione').flush({ disponibile: true, chiavePubblica: 'K' });
    await flush();
    http.expectOne('/api/v1/push/preferenze').flush({ giroModificato: true });
    await flush();
    f.detectChanges();
    expect(el(f).querySelector('[data-testid="attiva-notifiche"]')).not.toBeNull();
    expect(el(f).textContent).toContain('non contiene dati');
  });

  it('endpoint di un altro autista (409): messaggio chiaro, nessun pulsante, nessun ritentativo', async () => {
    const f = monta(porta({ perm: 'granted', endpointAttuale: async () => 'https://fcm.googleapis.com/fcm/send/x' }));
    await flush();
    http.expectOne('/api/v1/push/configurazione').flush({ disponibile: true, chiavePubblica: 'K' });
    await flush();
    http.expectOne('/api/v1/push/preferenze').flush({ giroModificato: true });
    await flush();
    http
      .expectOne('/api/v1/push/sottoscrizione')
      .flush({ error: 'ENDPOINT_PUSH_DI_ALTRO_UTENTE' }, { status: 409, statusText: 'Conflict' });
    await flush();
    f.detectChanges();
    const sez = el(f).querySelector('[data-testid="notifiche-altro-autista"]');
    expect(sez?.textContent).toContain('già attive per un altro autista');
    expect(el(f).querySelector('[data-testid="attiva-notifiche"]')).toBeNull();
    http.expectNone('/api/v1/push/sottoscrizione');
  });

  it('attivo: mostra la preferenza e il tocco la salva sul server', async () => {
    const f = monta(
      porta({
        perm: 'granted',
        endpointAttuale: async () => 'https://fcm.googleapis.com/fcm/send/x',
      }),
    );
    await flush();
    http.expectOne('/api/v1/push/configurazione').flush({ disponibile: true, chiavePubblica: 'K' });
    await flush();
    http.expectOne('/api/v1/push/preferenze').flush({ giroModificato: true });
    await flush();
    http.expectOne('/api/v1/push/sottoscrizione').flush(null, { status: 204, statusText: 'x' });
    await flush();
    f.detectChanges();
    const pref = el(f).querySelector('[data-testid="pref-giro"]') as HTMLInputElement;
    expect(pref.checked).toBe(true);
    pref.checked = false;
    pref.dispatchEvent(new Event('change'));
    const r = http.expectOne('/api/v1/push/preferenze');
    expect(r.request.body).toEqual({ giroModificato: false });
    r.flush({ giroModificato: false });
    await flush();
    f.detectChanges();
    expect((el(f).querySelector('[data-testid="pref-giro"]') as HTMLInputElement).checked).toBe(
      false,
    );
  });

  it('iPhone non installato: spiega come installare, senza pulsante di attivazione', async () => {
    const f = monta(porta({ richiedeInstallazione: () => true }));
    await flush();
    f.detectChanges();
    expect(el(f).querySelector('[data-testid="notifiche-installa"]')).not.toBeNull();
    expect(el(f).querySelector('[data-testid="attiva-notifiche"]')).toBeNull();
  });

  it('permesso negato: dice come sbloccare', async () => {
    const f = monta(porta({ perm: 'denied' }));
    await flush();
    http.expectOne('/api/v1/push/configurazione').flush({ disponibile: true, chiavePubblica: 'K' });
    await flush();
    f.detectChanges();
    expect(el(f).querySelector('[data-testid="notifiche-negate"]')).not.toBeNull();
  });
});
