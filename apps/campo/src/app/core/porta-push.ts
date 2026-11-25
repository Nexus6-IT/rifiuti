import { InjectionToken } from '@angular/core';

export type PermessoNotifiche = 'default' | 'granted' | 'denied';

/**
 * Cio' che serve dal browser per le notifiche, dietro un'interfaccia: i test non toccano il
 * service worker vero e un giorno Capacitor la sostituisce con le notifiche native.
 */
export interface PortaPush {
  /** Service worker, Push API e Notification disponibili (su iPhone solo con l'app installata). */
  supportato(): boolean;
  /** iPhone/iPad con l'app aperta nel browser: le notifiche richiedono l'installazione sulla Home. */
  richiedeInstallazione(): boolean;
  permesso(): PermessoNotifiche;
  /** Deve partire da un tocco dell'utente. */
  chiediPermesso(): Promise<PermessoNotifiche>;
  /** Indirizzo della sottoscrizione attuale del dispositivo, se c'e'. */
  endpointAttuale(): Promise<string | null>;
  /** Crea (o riusa) la sottoscrizione con la chiave pubblica del server; restituisce l'indirizzo. */
  sottoscrivi(chiavePubblica: string): Promise<string>;
  /** Toglie la sottoscrizione dal browser (il server la scopre al prossimo invio: 410). */
  annullaLocale(): Promise<void>;
}

export const PORTA_PUSH = new InjectionToken<PortaPush>('PORTA_PUSH');

function daBase64Url(valore: string): Uint8Array<ArrayBuffer> {
  const b64 =
    valore.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (valore.length % 4)) % 4);
  const bin = atob(b64);
  const out = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Implementazione per il browser (Push API sul service worker registrato dall'app). */
export const portaPushBrowser: PortaPush = {
  supportato() {
    return (
      typeof window !== 'undefined' &&
      'serviceWorker' in navigator &&
      'PushManager' in window &&
      'Notification' in window
    );
  },
  richiedeInstallazione() {
    const ios = /iPad|iPhone|iPod/.test(navigator.userAgent);
    const installata =
      (navigator as unknown as { standalone?: boolean }).standalone === true ||
      window.matchMedia?.('(display-mode: standalone)').matches === true;
    return ios && !installata;
  },
  permesso() {
    return 'Notification' in window ? Notification.permission : 'denied';
  },
  async chiediPermesso() {
    return Notification.requestPermission();
  },
  async endpointAttuale() {
    const reg = await navigator.serviceWorker.ready;
    return (await reg.pushManager.getSubscription())?.endpoint ?? null;
  },
  async sottoscrivi(chiavePubblica) {
    const reg = await navigator.serviceWorker.ready;
    const esistente = await reg.pushManager.getSubscription();
    if (esistente) return esistente.endpoint;
    const nuova = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: daBase64Url(chiavePubblica),
    });
    return nuova.endpoint;
  },
  async annullaLocale() {
    const reg = await navigator.serviceWorker.ready;
    await (await reg.pushManager.getSubscription())?.unsubscribe();
  },
};
