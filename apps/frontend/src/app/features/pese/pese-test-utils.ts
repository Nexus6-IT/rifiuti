// Aiuti per le spec DOM delle pese: eventi reali sul DOM, mai chiamate dirette ai metodi.
import { AccessoVista, PesataVista } from './pese.service'

export const q = <T extends HTMLElement = HTMLElement>(id: string): T | null =>
  document.body.querySelector<T>(`[data-testid="${id}"]`)

export const qb = (id: string): HTMLButtonElement | null => {
  const e = q(id)
  return e instanceof HTMLButtonElement ? e : (e?.querySelector('button') ?? null)
}

export const scrivi = (el: HTMLInputElement | HTMLTextAreaElement, t: string): void => {
  el.value = t
  el.dispatchEvent(new Event('input', { bubbles: true }))
}

export const scegli = (el: HTMLSelectElement, valore: string): void => {
  el.value = valore
  el.dispatchEvent(new Event('change', { bubbles: true }))
}

export const incolla = (i: HTMLInputElement, t: string): void => {
  const dt = new DataTransfer()
  dt.setData('text', t)
  i.dispatchEvent(
    new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true })
  )
}

export const tasto = (i: HTMLElement, key: string, code = key): KeyboardEvent => {
  const e = new KeyboardEvent('keydown', { key, code, bubbles: true, cancelable: true })
  i.dispatchEvent(e)
  return e
}

export function pesata(p: Partial<PesataVista> = {}): PesataVista {
  return {
    id: 'p1',
    ordine: 1,
    fonte: 'STRUMENTO',
    pesoOriginaleKg: 24000,
    pesoEffettivoKg: 24000,
    rettifiche: [],
    strumento: { id: 's1', descrizione: 'Pesa a ponte', matricola: 'M-77' },
    strumentoEsterno: null,
    alibiId: null,
    oraStrumento: null,
    oraRicezione: '2026-10-30T08:00:00.000Z',
    operatore: 'Mario Rossi',
    motivo: null,
    allegato: null,
    integra: true,
    avvisi: [],
    ...p,
  }
}

export function accesso(a: Partial<AccessoVista> = {}): AccessoVista {
  return {
    id: 'a1',
    numero: 'ACC-2026-0001',
    registro: { id: 'r1', descrizione: 'Sede di Milano' },
    verso: 'CARICO',
    modo: 'DOPPIA',
    stato: 'CHIUSO',
    automezzo: null,
    targa: 'AB123CD',
    targaRimorchio: null,
    cerCode: '17 05 04',
    descrizione: null,
    note: null,
    apertoIl: '2026-10-30T08:00:00.000Z',
    chiusoIl: '2026-10-30T09:00:00.000Z',
    annullatoIl: null,
    motivoAnnullamento: null,
    pesate: [
      pesata(),
      pesata({ id: 'p2', ordine: 2, pesoOriginaleKg: 8000, pesoEffettivoKg: 8000 }),
    ],
    netto: {
      stato: 'CALCOLATO',
      lordoKg: 24000,
      taraKg: 8000,
      nettoKg: 16000,
      qualita: 'DUE_PESATE',
      manuale: false,
      rettificato: false,
      errore: null,
      avvisi: [],
    },
    collegamenti: [],
    avvisi: [],
    puoOperare: true,
    puoRettificare: true,
    ...a,
  }
}
