import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { PORTA_PUSH, type PermessoNotifiche, type PortaPush } from './porta-push';
import { PushService } from './push.service';

const API = '/api/v1/push';

class PortaFinta implements PortaPush {
  sup = true;
  installazione = false;
  perm: PermessoNotifiche = 'default';
  rispostaPermesso: PermessoNotifiche = 'granted';
  endpoint: string | null = null;
  chiamate: string[] = [];
  falliscePermesso = false;
  supportato = () => this.sup;
  richiedeInstallazione = () => this.installazione;
  permesso = () => this.perm;
  async chiediPermesso() {
    this.chiamate.push('chiediPermesso');
    this.perm = this.rispostaPermesso;
    return this.rispostaPermesso;
  }
  async endpointAttuale() {
    return this.endpoint;
  }
  async sottoscrivi(chiave: string) {
    this.chiamate.push(`sottoscrivi:${chiave}`);
    if (this.falliscePermesso) throw new Error('push service non raggiungibile');
    this.endpoint = 'https://fcm.googleapis.com/fcm/send/abc';
    return this.endpoint;
  }
  async annullaLocale() {
    this.chiamate.push('annullaLocale');
    this.endpoint = null;
  }
}

const flush = () => new Promise<void>((r) => setTimeout(r));

describe('PushService', () => {
  let porta: PortaFinta;
  let http: HttpTestingController;
  let servizio: PushService;

  function crea() {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: PORTA_PUSH, useValue: porta },
      ],
    });
    servizio = TestBed.inject(PushService);
    http = TestBed.inject(HttpTestingController);
  }
  beforeEach(() => {
    porta = new PortaFinta();
  });
  afterEach(() => http.verify());

  async function inizializza(
    config = { disponibile: true, chiavePubblica: 'CHIAVE' },
    preferenze = { giroModificato: true },
  ) {
    const p = servizio.inizializza();
    await flush();
    http.expectOne(`${API}/configurazione`).flush(config);
    if (config.disponibile && porta.sup && porta.perm !== 'denied') {
      await flush();
      http.expectOne(`${API}/preferenze`).flush(preferenze);
    }
    await p;
  }

  it('browser senza push: stato non-supportato e nessuna chiamata al server', async () => {
    porta.sup = false;
    crea();
    await servizio.inizializza();
    expect(servizio.stato()).toBe('non-supportato');
  });

  it('iPhone non installato: serve l installazione sulla Home, nessuna chiamata', async () => {
    porta.installazione = true;
    crea();
    await servizio.inizializza();
    expect(servizio.stato()).toBe('da-installare');
  });

  it('server senza chiavi VAPID: non-disponibile', async () => {
    crea();
    await inizializza({ disponibile: false, chiavePubblica: null as unknown as string });
    expect(servizio.stato()).toBe('non-disponibile');
  });

  it('errore di rete sulla configurazione: non-disponibile, mai un errore non gestito', async () => {
    crea();
    const p = servizio.inizializza();
    await flush();
    http.expectOne(`${API}/configurazione`).error(new ProgressEvent('error'));
    await p;
    expect(servizio.stato()).toBe('non-disponibile');
  });

  it('permesso negato dal browser: stato negato, senza chiedere altro', async () => {
    porta.perm = 'denied';
    crea();
    await inizializza();
    expect(servizio.stato()).toBe('negato');
  });

  it('pronto ad attivare: da-attivare, poi attiva() chiede il permesso, sottoscrive e registra l endpoint', async () => {
    crea();
    await inizializza();
    expect(servizio.stato()).toBe('da-attivare');
    const p = servizio.attiva();
    await flush();
    const put = http.expectOne(`${API}/sottoscrizione`);
    expect(put.request.method).toBe('PUT');
    expect(put.request.body).toEqual({ endpoint: 'https://fcm.googleapis.com/fcm/send/abc' });
    put.flush(null, { status: 204, statusText: 'No Content' });
    await p;
    expect(servizio.stato()).toBe('attivo');
    expect(porta.chiamate).toEqual(['chiediPermesso', 'sottoscrivi:CHIAVE']);
  });

  it('attiva(): se l utente nega il permesso il server non viene toccato', async () => {
    porta.rispostaPermesso = 'denied';
    crea();
    await inizializza();
    await servizio.attiva();
    expect(servizio.stato()).toBe('negato');
    http.expectNone(`${API}/sottoscrizione`);
  });

  it('attiva(): se il browser non riesce a sottoscrivere resta da-attivare con un messaggio', async () => {
    porta.falliscePermesso = true;
    crea();
    await inizializza();
    await servizio.attiva();
    expect(servizio.stato()).toBe('da-attivare');
    expect(servizio.errore()).toMatch(/notifiche/i);
  });

  it('attiva(): se il server rifiuta la registrazione toglie la sottoscrizione dal browser', async () => {
    crea();
    await inizializza();
    const p = servizio.attiva();
    await flush();
    http.expectOne(`${API}/sottoscrizione`).flush({}, { status: 503, statusText: 'x' });
    await p;
    expect(porta.chiamate).toContain('annullaLocale');
    expect(servizio.stato()).toBe('da-attivare');
    expect(servizio.errore()).toBeTruthy();
  });

  it('gia sottoscritto sul dispositivo: stato attivo e risincronizza l endpoint (anche dopo un cambio utente)', async () => {
    porta.perm = 'granted';
    porta.endpoint = 'https://fcm.googleapis.com/fcm/send/abc';
    crea();
    const p = servizio.inizializza();
    await flush();
    http.expectOne(`${API}/configurazione`).flush({ disponibile: true, chiavePubblica: 'CHIAVE' });
    await flush();
    http.expectOne(`${API}/preferenze`).flush({ giroModificato: false });
    await flush();
    http.expectOne(`${API}/sottoscrizione`).flush(null, { status: 204, statusText: 'No Content' });
    await p;
    expect(servizio.stato()).toBe('attivo');
    expect(servizio.preferenze()).toEqual({ giroModificato: false });
  });

  it('disattiva(): toglie l endpoint dal server e dal browser', async () => {
    porta.perm = 'granted';
    porta.endpoint = 'https://fcm.googleapis.com/fcm/send/abc';
    crea();
    const ini = servizio.inizializza();
    await flush();
    http.expectOne(`${API}/configurazione`).flush({ disponibile: true, chiavePubblica: 'CHIAVE' });
    await flush();
    http.expectOne(`${API}/preferenze`).flush({ giroModificato: true });
    await flush();
    http.expectOne(`${API}/sottoscrizione`).flush(null, { status: 204, statusText: 'x' });
    await ini;
    const p = servizio.disattiva();
    await flush();
    const r = http.expectOne(`${API}/sottoscrizione/annulla`);
    expect(r.request.body).toEqual({ endpoint: 'https://fcm.googleapis.com/fcm/send/abc' });
    r.flush(null, { status: 204, statusText: 'x' });
    await p;
    expect(porta.chiamate).toContain('annullaLocale');
    expect(servizio.stato()).toBe('da-attivare');
  });

  it('impostaGiroModificato(): salva sul server e aggiorna il segnale; su errore ripristina', async () => {
    crea();
    await inizializza();
    const p = servizio.impostaGiroModificato(false);
    const r = http.expectOne(`${API}/preferenze`);
    expect(r.request.method).toBe('PUT');
    expect(r.request.body).toEqual({ giroModificato: false });
    r.flush({ giroModificato: false });
    await p;
    expect(servizio.preferenze().giroModificato).toBe(false);

    const q = servizio.impostaGiroModificato(true);
    http.expectOne(`${API}/preferenze`).error(new ProgressEvent('error'));
    await q;
    expect(servizio.preferenze().giroModificato).toBe(false);
    expect(servizio.errore()).toBeTruthy();
  });

  describe('logout', () => {
    async function conSottoscrizione() {
      porta.perm = 'granted';
      porta.endpoint = 'https://fcm.googleapis.com/fcm/send/abc';
      crea();
      const ini = servizio.inizializza();
      await flush();
      http
        .expectOne(`${API}/configurazione`)
        .flush({ disponibile: true, chiavePubblica: 'CHIAVE' });
      await flush();
      http.expectOne(`${API}/preferenze`).flush({ giroModificato: true });
      await flush();
      http.expectOne(`${API}/sottoscrizione`).flush(null, { status: 204, statusText: 'x' });
      await ini;
    }

    it('rimuoviDalServer(): chiede l annullamento con l endpoint e toglie la sottoscrizione dal browser', async () => {
      await conSottoscrizione();
      const p = servizio.rimuoviAlLogout();
      await flush();
      const r = http.expectOne(`${API}/sottoscrizione/annulla`);
      expect(r.request.body).toEqual({ endpoint: 'https://fcm.googleapis.com/fcm/send/abc' });
      r.flush(null, { status: 204, statusText: 'x' });
      await p;
      expect(porta.chiamate).toContain('annullaLocale');
    });

    it('server irraggiungibile: il browser la toglie lo stesso (il server la scopre con il 410) e il logout non si blocca', async () => {
      await conSottoscrizione();
      const p = servizio.rimuoviAlLogout();
      await flush();
      http.expectOne(`${API}/sottoscrizione/annulla`).error(new ProgressEvent('error'));
      await p;
      expect(porta.chiamate).toContain('annullaLocale');
    });

    it('senza sottoscrizione sul dispositivo non chiama il server', async () => {
      crea();
      await servizio.rimuoviAlLogout();
      http.expectNone(`${API}/sottoscrizione/annulla`);
    });

    it('browser senza push: nessun errore', async () => {
      porta.sup = false;
      crea();
      await expect(servizio.rimuoviAlLogout()).resolves.toBeUndefined();
    });

    it('annullaLocale (sessione finita o cambio utente): toglie solo dal browser, non chiama il server', async () => {
      await conSottoscrizione();
      servizio.sessioneChiusa();
      await flush();
      expect(porta.chiamate).toContain('annullaLocale');
      http.expectNone(`${API}/sottoscrizione/annulla`);
      expect(servizio.stato()).toBe('da-attivare');
    });

    it('nuovo accesso dello STESSO utente: la sottoscrizione resta e lo stato resta attivo', async () => {
      await conSottoscrizione();
      servizio.sessioneChiusa(true);
      await flush();
      expect(porta.chiamate).not.toContain('annullaLocale');
      expect(servizio.stato()).toBe('attivo');
    });

    it('cambio utente: inizializza aspetta la disiscrizione lenta e non ri-registra l endpoint vecchio', async () => {
      await conSottoscrizione();
      let sblocca!: () => void;
      porta.annullaLocale = async () => {
        await new Promise<void>((r) => (sblocca = r));
        porta.endpoint = null;
      };
      servizio.sessioneChiusa(false);
      const p = servizio.inizializza();
      await flush();
      http.expectNone(`${API}/configurazione`);
      sblocca();
      await flush();
      http.expectOne(`${API}/configurazione`).flush({ disponibile: true, chiavePubblica: 'C' });
      await flush();
      http.expectOne(`${API}/preferenze`).flush({ giroModificato: true });
      await p;
      http.expectNone(`${API}/sottoscrizione`);
      expect(servizio.stato()).toBe('da-attivare');
    });

    it('logout con porta lenta: finisce entro il tetto complessivo (~4 s)', async () => {
      await conSottoscrizione();
      vi.useFakeTimers();
      try {
        porta.endpointAttuale = () => new Promise<string | null>(() => undefined);
        let finito = false;
        void servizio.rimuoviAlLogout().then(() => (finito = true));
        await vi.advanceTimersByTimeAsync(4_100);
        expect(finito).toBe(true);
      } finally {
        vi.useRealTimers();
      }
    });
  });
});
