import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// Il worker gira in un contesto senza Angular: qui lo si esegue con un `self` finto.
const SORGENTE = readFileSync(join(process.cwd(), 'public/sw-campo.js'), 'utf8');

type Listener = (event: unknown) => void;

function carica() {
  const listener: Record<string, Listener> = {};
  const notifiche: Array<{ titolo: string; opzioni: Record<string, unknown> }> = [];
  const chiuse: number[] = [];
  const aperte: string[] = [];
  const focus: string[] = [];
  let finestre: Array<{ url: string; focus: () => Promise<void> }> = [];
  const importati: string[] = [];
  const self = {
    location: { origin: 'https://app.example.test' },
    registration: {
      showNotification: (titolo: string, opzioni: Record<string, unknown>) => {
        notifiche.push({ titolo, opzioni });
        return Promise.resolve();
      },
    },
    clients: {
      matchAll: () => Promise.resolve(finestre),
      openWindow: (url: string) => {
        aperte.push(url);
        return Promise.resolve();
      },
    },
    addEventListener: (nome: string, fn: Listener) => (listener[nome] = fn),
  };
  new Function('self', 'importScripts', SORGENTE)(self, (u: string) => importati.push(u));
  return {
    listener,
    notifiche,
    chiuse,
    aperte,
    focus,
    importati,
    impostaFinestre: (f: typeof finestre) => (finestre = f),
  };
}

const evento = (extra: Record<string, unknown> = {}) => {
  const attese: Promise<unknown>[] = [];
  return {
    ev: { waitUntil: (p: Promise<unknown>) => attese.push(p), ...extra },
    fine: () => Promise.all(attese),
  };
};

describe('sw-campo.js (push senza dati)', () => {
  it('carica prima il worker di Angular', () => {
    expect(carica().importati).toEqual(['./ngsw-worker.js']);
  });

  it('un push mostra una notifica generica, senza dati: con o senza payload', async () => {
    const w = carica();
    for (const data of [undefined, { json: () => ({ cliente: 'Rossi SRL', ritiro: 'abc' }) }]) {
      const { ev, fine } = evento({ data });
      w.listener['push'](ev);
      await fine();
    }
    expect(w.notifiche).toHaveLength(2);
    for (const n of w.notifiche) {
      expect(n.titolo).toBe('WasteFlow campo');
      expect(JSON.stringify(n)).not.toMatch(/Rossi|abc/);
      expect(n.opzioni['tag']).toBe('giro');
    }
  });

  it('il tocco sulla notifica la chiude e apre l app, o riporta in primo piano quella aperta', async () => {
    const w = carica();
    const chiusa = { close: () => w.chiuse.push(1) };
    let e = evento({ notification: chiusa });
    w.listener['notificationclick'](e.ev);
    await e.fine();
    expect(w.chiuse).toHaveLength(1);
    expect(w.aperte).toEqual(['https://app.example.test/campo/']);

    const messaAFuoco: string[] = [];
    w.impostaFinestre([
      { url: 'https://app.example.test/altro', focus: async () => undefined },
      {
        url: 'https://app.example.test/campo/ritiro/1',
        focus: async () => void messaAFuoco.push('ok'),
      },
    ]);
    e = evento({ notification: chiusa });
    w.listener['notificationclick'](e.ev);
    await e.fine();
    expect(messaAFuoco).toEqual(['ok']);
    expect(w.aperte).toHaveLength(1);
  });
});
