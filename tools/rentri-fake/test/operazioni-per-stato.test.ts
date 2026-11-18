import { operazioniPerStato } from '../src/dominio/operazione'

/**
 * Macchina degli stati della fake estesa al ciclo del FIR in viaggio
 * (`docs/superpowers/plans/2026-11-18-rentri-fir-viaggio.md`, §4.1).
 *
 * Il contratto da' i NOMI degli stati, non le transizioni: la macchina qui e'
 * plausibile e dichiarata tale, da verificare sulla demo (checklist del piano,
 * rischio 1). Questi test fissano la forma che i pezzi successivi usano.
 */
describe('operazioniPerStato — fase iniziale (Inserimento / Firma)', () => {
  it('Inserimento: si inseriscono quantita e trasporto, non si firma ancora', () => {
    const iniziale = operazioniPerStato('InserimentoQuantitaTrasportoIniziale')
    expect(iniziale).toEqual(expect.arrayContaining(['DatiQuantita', 'Trasporto']))
    expect(iniziale.some(o => o.startsWith('AcquisizioneFirma'))).toBe(false)
    expect(iniziale).not.toContain('Hash')
  })

  it('InserimentoTrasportoIniziale propone il trasporto, InserimentoQuantita la quantita', () => {
    expect(operazioniPerStato('InserimentoTrasportoIniziale')).toContain('Trasporto')
    expect(operazioniPerStato('InserimentoTrasportoIniziale')).not.toContain('DatiQuantita')
    expect(operazioniPerStato('InserimentoQuantita')).toContain('DatiQuantita')
    expect(operazioniPerStato('InserimentoQuantita')).not.toContain('Trasporto')
  })

  it('Firma iniziale: propone la firma del ruolo giusto e l`hash', () => {
    const coppia = operazioniPerStato('FirmaProduttoreTrasportatoreIniziale')
    expect(coppia).toEqual(
      expect.arrayContaining(['AcquisizioneFirmaProduttoreTrasportatore', 'Hash'])
    )
    expect(operazioniPerStato('FirmaProduttore')).toContain('AcquisizioneFirmaProduttore')
    expect(operazioniPerStato('FirmaTrasportatoreIniziale')).toContain(
      'AcquisizioneFirmaTrasportatore'
    )
    expect(coppia).not.toContain('DatiQuantita')
  })

  it('NuovoDestinatario non e` piu` fra le operazioni della fase iniziale', () => {
    for (const stato of [
      'InserimentoQuantitaTrasportoIniziale',
      'InserimentoTrasportoIniziale',
      'InserimentoQuantita',
      'FirmaProduttoreTrasportatoreIniziale',
      'FirmaTrasportatoreIniziale',
      'FirmaProduttore',
    ]) {
      expect(operazioniPerStato(stato)).not.toContain('NuovoDestinatario')
    }
  })
})

describe('operazioniPerStato — RollbackFirma', () => {
  it('non dipende dallo stato: compare solo se la fake ha una firma reversibile', () => {
    expect(operazioniPerStato('Accettato')).not.toContain('RollbackFirma')
    expect(operazioniPerStato('Accettato', { ultimaFirmaPresente: true })).toContain(
      'RollbackFirma'
    )
    expect(operazioniPerStato('InserimentoAccettazione')).not.toContain('RollbackFirma')
  })

  it('mai per la firma di annullamento', () => {
    expect(operazioniPerStato('FirmaAnnullamento', { ultimaFirmaPresente: true })).not.toContain(
      'RollbackFirma'
    )
  })
})

describe('operazioniPerStato — viaggio e destinatario successivo', () => {
  it('prima dell`accettazione si possono dichiarare annotazione, sosta e trasbordi', () => {
    expect(operazioniPerStato('InserimentoAccettazione')).toEqual(
      expect.arrayContaining([
        'Accettazione',
        'Annotazione',
        'SostaTecnica',
        'TrasbordoTotale',
        'TrasbordoParziale',
      ])
    )
  })

  it('gli stati di firma del viaggio propongono la firma corrispondente', () => {
    expect(operazioniPerStato('FirmaAnnotazione')).toContain('AcquisizioneFirmaAnnotazione')
    expect(operazioniPerStato('FirmaSostaTecnica')).toContain('AcquisizioneFirmaSostaTecnica')
    expect(operazioniPerStato('FirmaTrasbordoTotale')).toContain('AcquisizioneFirmaTrasbordoTotale')
    expect(operazioniPerStato('FirmaTrasbordoParziale')).toContain(
      'AcquisizioneFirmaTrasbordoParziale'
    )
  })

  it('RespintoAccettatoParzialmente NON e` terminale: ammette NuovoDestinatario', () => {
    expect(operazioniPerStato('RespintoAccettatoParzialmente')).toEqual(
      expect.arrayContaining(['NuovoDestinatario'])
    )
  })

  it('Accettato ammette solo l`annotazione (contratto, riga 1037): nessuna firma, nessun destinatario', () => {
    expect(operazioniPerStato('Accettato')).toEqual(['Annotazione'])
  })

  it('Reset e` proposto solo negli stati che il contratto elenca (riga 1888)', () => {
    expect(operazioniPerStato('FirmaAnnotazione')).toContain('Reset')
    expect(operazioniPerStato('FirmaAccettazione')).toContain('Reset')
    expect(operazioniPerStato('FirmaProduttore')).not.toContain('Reset')
    expect(operazioniPerStato('FirmaProduttoreTrasportatoreIniziale')).not.toContain('Reset')
    expect(operazioniPerStato('InserimentoAccettazione')).not.toContain('Reset')
  })

  it('l`accettazione e` possibile solo in InserimentoAccettazione (contratto, riga 431)', () => {
    expect(operazioniPerStato('InserimentoAccettazione')).toContain('Accettazione')
    expect(operazioniPerStato('FirmaAccettazione')).not.toContain('Accettazione')
  })

  it('Indeterminato non propone scritture', () => {
    expect(operazioniPerStato('Indeterminato')).toEqual([])
  })

  it('uno stato sconosciuto non cade piu` nella lista "iniziale": nessuna operazione', () => {
    expect(operazioniPerStato('StatoInventato')).toEqual([])
  })
})
