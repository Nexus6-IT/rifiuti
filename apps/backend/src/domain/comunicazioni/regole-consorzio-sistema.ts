import type { RegolaConsorzioDef } from './classifica-consorzio'

/**
 * Regole di sistema proposte (P9 §4.1, da confermare con un cliente): valgono per un consorzio solo
 * finche' l'azienda non ne definisce di proprie. CONOU = oli minerali usati (CER capitolo 13);
 * COBAT = batterie e accumulatori al piombo (16 06 01*) e batterie portatili (20 01 33*).
 */
const base = {
  verso: null,
  causaleCodice: null,
  registroId: null,
  attiva: true,
  validaDal: '1970-01-01',
} as const

export const REGOLE_CONSORZIO_DI_SISTEMA: readonly RegolaConsorzioDef[] = Object.freeze([
  Object.freeze({ ...base, consorzio: 'CONOU', cerPrefisso: '13', cerEsatto: null }),
  Object.freeze({ ...base, consorzio: 'COBAT', cerPrefisso: null, cerEsatto: '160601' }),
  Object.freeze({ ...base, consorzio: 'COBAT', cerPrefisso: null, cerEsatto: '200133' }),
])
