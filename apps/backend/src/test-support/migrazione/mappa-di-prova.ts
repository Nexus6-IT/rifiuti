import { FORMATO_MAPPA } from '../../application/migrazione/pacchetto/mappa-import'

export const U1 = '11111111-1111-4111-8111-111111111111'
export const U2 = '22222222-2222-4222-8222-222222222222'

/** Mappa valida e sintetica per i test (nessun dato reale). */
export function mappaValida(): Record<string, unknown> {
  return {
    formato: FORMATO_MAPPA,
    ditta: '0001',
    anno: 2026,
    dataTaglio: '2026-06-30',
    registri: [{ legacy: 'REG1', registroId: U1 }],
    unitaLocali: [{ legacy: 'X1.1', sedeId: U2, unitaLocaleId: null }],
    causali: [{ oper: '10', causale: 'INGRESSO_ESTERNO', verso: 'CARICO', confermata: true }],
    agganci: [{ partitaIva: '00000000000', dittaId: U2 }],
  }
}
