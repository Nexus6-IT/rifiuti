import { RENTRIApiClient } from './rentri-api.client'
import {
  DURATA_AVVIO_SESSIONE_MS,
  DURATA_PRESA_FIRMA_MS,
  ATTESA_CONFERMA_FIRMA_PREDEFINITA_S,
} from '../../application/rentri/completa-operazione-con-firma.use-case'

/**
 * R2/R3 — le scadenze di recupero di IN_FIRMA e IN_AVVIO coprono i timeout massimi delle chiamate
 * all'ente coinvolte, cosi' una scadenza superata significa processo morto e non operazione lenta.
 */
describe('tempi massimi delle chiamate RENTRI e scadenze di recupero delle sessioni', () => {
  it('una chiamata con resilienza: 5 richieste da 30 s + backoff 1+2+4+8 s', () => {
    expect(RENTRIApiClient.DURATA_MASSIMA_CHIAMATA_MS).toBe(5 * 30_000 + 15_000)
  })

  it("un'operazione asincrona: la POST piu 30 giri di polling da 30 s + 2 s", () => {
    expect(RENTRIApiClient.DURATA_MASSIMA_ASINCRONA_MS).toBe(165_000 + 30 * 32_000)
  })

  it('la presa IN_FIRMA copre sign-hash + acquisizione-firma + /stato', () => {
    const peggiore =
      RENTRIApiClient.DURATA_MASSIMA_CHIAMATA_MS * 2 + RENTRIApiClient.DURATA_MASSIMA_ASINCRONA_MS
    expect(DURATA_PRESA_FIRMA_MS).toBeGreaterThanOrEqual(peggiore)
  })

  it('la prenotazione IN_AVVIO copre certificato + /hash + authorize ed e piu lunga dell attesa dell utente', () => {
    const peggiore =
      RENTRIApiClient.DURATA_MASSIMA_CHIAMATA_MS * 2 + RENTRIApiClient.DURATA_MASSIMA_ASINCRONA_MS
    expect(DURATA_AVVIO_SESSIONE_MS).toBeGreaterThanOrEqual(peggiore)
    expect(DURATA_AVVIO_SESSIONE_MS).toBeGreaterThan(ATTESA_CONFERMA_FIRMA_PREDEFINITA_S * 1000)
  })
})
