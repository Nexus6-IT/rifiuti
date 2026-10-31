import {
  STATI_RENTRI,
  StatoRentri,
  descrizioneAvvio,
  descrizioneEsitoVerifica,
  etichettaStatoRentri,
  eConfermata,
  eSelezionabile,
  severitaStatoRentri,
  tooltipStatoRentri,
} from './stato-rentri'

describe('stato-rentri', () => {
  it('etichette italiane di tutti gli stati, vuoto = Non trasmessa', () => {
    expect(etichettaStatoRentri(null)).toBe('Non trasmessa')
    expect(etichettaStatoRentri(undefined)).toBe('Non trasmessa')
    expect(etichettaStatoRentri('DA_TRASMETTERE')).toBe('Da trasmettere')
    expect(etichettaStatoRentri('IN_INVIO')).toBe('In invio')
    expect(etichettaStatoRentri('ATTESA_ESITO')).toBe("In attesa dell'esito")
    expect(etichettaStatoRentri('TRASMESSA')).toBe('Trasmessa')
    expect(etichettaStatoRentri('RIFIUTATA')).toBe('Rifiutata')
    expect(etichettaStatoRentri('NON_TRASMISSIBILE')).toBe('Non trasmissibile')
    expect(etichettaStatoRentri('INCERTA')).toBe('Esito incerto')
    expect(etichettaStatoRentri('GIA_SU_RENTRI')).toBe('Già su RENTRI')
    expect(STATI_RENTRI.length).toBe(8)
  })

  it('solo TRASMESSA e GIA_SU_RENTRI sono confermate: mai le altre', () => {
    const confermate = STATI_RENTRI.filter(s => eConfermata(s))
    expect(confermate).toEqual(['TRASMESSA', 'GIA_SU_RENTRI'] as StatoRentri[])
    expect(eConfermata(null)).toBeFalse()
  })

  it('selezionabili per Trasmetti: mai trasmesse, rifiutate e non trasmissibili', () => {
    expect(eSelezionabile(null)).toBeTrue()
    expect(eSelezionabile('RIFIUTATA')).toBeTrue()
    expect(eSelezionabile('NON_TRASMISSIBILE')).toBeTrue()
    for (const s of [
      'DA_TRASMETTERE',
      'IN_INVIO',
      'ATTESA_ESITO',
      'INCERTA',
      'TRASMESSA',
      'GIA_SU_RENTRI',
    ] as StatoRentri[]) {
      expect(eSelezionabile(s)).withContext(s).toBeFalse()
    }
  })

  it('severità: successo solo se confermata, avviso se incerta', () => {
    expect(severitaStatoRentri('TRASMESSA')).toBe('success')
    expect(severitaStatoRentri('GIA_SU_RENTRI')).toBe('success')
    expect(severitaStatoRentri('ATTESA_ESITO')).not.toBe('success')
    expect(severitaStatoRentri('INCERTA')).toBe('warning')
    expect(severitaStatoRentri('RIFIUTATA')).toBe('danger')
  })

  it("il tooltip riporta il motivo, e dice di verificare se l'esito è incerto", () => {
    expect(tooltipStatoRentri('RIFIUTATA', 'Codice CER non ammesso')).toContain(
      'Codice CER non ammesso'
    )
    expect(tooltipStatoRentri('INCERTA', null)).toContain('verificare')
    expect(tooltipStatoRentri('ATTESA_ESITO', null)).toContain('non ancora confermata')
    expect(tooltipStatoRentri(null, null)).toContain('Non ancora trasmessa')
  })

  it('il 202 di Trasmetti dice solo che è partito, mai "trasmesso"', () => {
    const avvii = ['AVVIATO', 'SENZA_CERTIFICATO', 'NIENTE_DA_INVIARE', 'NON_AVVIATO'] as const
    for (const a of avvii) {
      expect(descrizioneAvvio(a, 3).toLowerCase()).withContext(a).not.toContain('trasmesse ')
    }
    expect(descrizioneAvvio('AVVIATO', 3)).toContain('3 annotazioni')
    expect(descrizioneAvvio('AVVIATO', 1)).toContain('1 annotazione')
    expect(descrizioneAvvio('SENZA_CERTIFICATO', 2)).toContain('certificato')
    expect(descrizioneAvvio('NIENTE_DA_INVIARE', 0)).toBe('Nessuna nuova annotazione da inviare.')
    expect(descrizioneAvvio('AVVIATO', 0)).toContain('già in coda')
    expect(descrizioneAvvio('SOSPESO', 2)).toBe(
      "2 annotazioni in coda. Invii verso RENTRI sospesi dall'amministratore del sistema: partiranno quando saranno riattivati."
    )
    expect(descrizioneAvvio('SOSPESO', 1)).toContain('1 annotazione in coda')
  })

  it('esito della verifica: usa il messaggio del backend', () => {
    expect(
      descrizioneEsitoVerifica({
        esito: 'TRASMESSA',
        stato: 'TRASMESSA',
        messaggio: 'Confermata da RENTRI.',
      })
    ).toBe('Confermata da RENTRI.')
  })
})
