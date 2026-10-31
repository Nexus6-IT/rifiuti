import { RegistroVista } from '../registro/registro.service'
import {
  AmbitoVista,
  CaricoVista,
  PropostaScarico,
  ScaricoVista,
  VistaAbbinamenti,
} from './abbinamenti.service'

export function sede(id: string, denominazione: string, principale = false): RegistroVista {
  return {
    id,
    unitaLocaleId: `u-${id}`,
    numIscrSito: null,
    denominazione,
    codice: id,
    attivo: true,
    principale,
  }
}

export function carico(p: Partial<CaricoVista> = {}): CaricoVista {
  return {
    tipo: 'MOVIMENTO',
    id: 'c1',
    numero: '1/2026',
    giorno: '2026-03-01',
    classe: 'R13',
    quantita: 1000,
    abbinato: 400,
    residuo: 600,
    etaGiorni: 92,
    stato: 'APERTO',
    ...p,
  }
}

export function scarico(p: Partial<ScaricoVista> = {}): ScaricoVista {
  return {
    id: 's1',
    numero: '3/2026',
    giorno: '2026-03-20',
    quantita: 400,
    classeAttesa: 'R13',
    abbinato: 400,
    stato: 'ABBINATO',
    righe: [
      {
        carico: { tipo: 'MOVIMENTO', id: 'c1', numero: '1/2026', giorno: '2026-03-01' },
        quantita: 400,
        origine: 'AUTOMATICO',
      },
    ],
    ...p,
  }
}

export function ambito(p: Partial<AmbitoVista> = {}): AmbitoVista {
  return {
    cerCode: '15 01 01',
    famiglia: 'KG',
    unita: 'kg',
    classi: ['R13'],
    carichi: [carico()],
    scarichi: [scarico()],
    differenzeFifo: 0,
    incoerenze: [],
    ...p,
  }
}

export function vista(p: Partial<VistaAbbinamenti> = {}): VistaAbbinamenti {
  return {
    registroId: 'r1',
    oggi: '2026-06-01',
    ambiti: [ambito()],
    puoModificare: true,
    puoRicalcolare: true,
    ...p,
  }
}

export function proposta(p: Partial<PropostaScarico> = {}): PropostaScarico {
  return {
    scarico: scarico({ stato: 'NON_ABBINATO', abbinato: 0, righe: [] }),
    candidati: [
      carico({ id: 'c1', numero: '1/2026', residuo: 1000, abbinato: 0 }),
      carico({ id: 'c2', numero: '2/2026', giorno: '2026-03-10', residuo: 250, quantita: 250 }),
    ],
    proposta: [
      {
        carico: { tipo: 'MOVIMENTO', id: 'c1', numero: '1/2026', giorno: '2026-03-01' },
        quantita: 400,
      },
    ],
    scoperto: 0,
    ...p,
  }
}
