import {
  DatiPartenzaDaSalvare,
  EsitoAggiuntaTratta,
  NuovaTrattaTrasbordoTotale,
  DatiViaggioFir,
  IDatiViaggioFirRepository,
  QuantitaInviata,
  TrasportoInviato,
  UltimoTrasportoAutomezzo,
} from './dati-viaggio-fir.port'

/** Implementazione in memoria per i test unitari: i FIR si seminano in `righe`. */
export class DatiViaggioFirInMemoria extends IDatiViaggioFirRepository {
  readonly righe = new Map<string, DatiViaggioFir>()
  readonly ultimiPerTarga = new Map<string, UltimoTrasportoAutomezzo>()
  /** Registro delle scritture, nell'ordine (per verificare "solo dopo l'esito positivo"). */
  readonly scritture: string[] = []

  async ultimoTrasportoPerTarga(
    _tenantId: string,
    targa: string
  ): Promise<UltimoTrasportoAutomezzo | null> {
    return this.ultimiPerTarga.get(targa) ?? null
  }

  async leggi(_tenantId: string, firId: string): Promise<DatiViaggioFir | null> {
    return this.righe.get(firId) ?? null
  }

  async salvaDatiPartenza(
    _tenantId: string,
    firId: string,
    dati: DatiPartenzaDaSalvare
  ): Promise<void> {
    this.scritture.push('salvaDatiPartenza')
    const r = this.righe.get(firId)
    if (!r) return
    if (dati.verificatoInPartenza !== undefined) r.verificatoInPartenza = dati.verificatoInPartenza
    if (dati.rinfusa !== undefined) r.rinfusa = dati.rinfusa
    if (dati.conducenteNome !== undefined) r.principale.conducenteNome = dati.conducenteNome
    if (dati.conducenteCognome !== undefined)
      r.principale.conducenteCognome = dati.conducenteCognome
    if (dati.targaRimorchio !== undefined) r.principale.targaRimorchio = dati.targaRimorchio
    if (dati.percorso !== undefined) r.principale.percorso = dati.percorso
  }

  async aggiornaQuantitaDopoEnte(
    _tenantId: string,
    firId: string,
    q: QuantitaInviata
  ): Promise<void> {
    this.scritture.push('aggiornaQuantitaDopoEnte')
    const r = this.righe.get(firId)
    if (!r) return
    r.dichiarato = {
      ...r.dichiarato,
      quantita: {
        valore: q.valore,
        unitaMisura: q.unitaMisura,
        numeroColli: q.rinfusa ? null : q.numeroColli,
      },
    }
    r.rinfusa = q.rinfusa
    r.verificatoInPartenza = q.verificatoInPartenza
  }

  async aggiornaTrasportoDopoEnte(
    _tenantId: string,
    firId: string,
    t: TrasportoInviato
  ): Promise<void> {
    this.scritture.push('aggiornaTrasportoDopoEnte')
    const r = this.righe.get(firId)
    if (!r) return
    r.dichiarato = { ...r.dichiarato, trasporto: { targaAutomezzo: t.targaAutomezzo } }
    r.principale = {
      conducenteNome: t.conducenteNome,
      conducenteCognome: t.conducenteCognome,
      targaRimorchio: t.targaRimorchio,
      percorso: t.percorso,
    }
  }

  async aggiungiTrattaTrasbordoTotale(
    _tenantId: string,
    firId: string,
    t: NuovaTrattaTrasbordoTotale
  ): Promise<EsitoAggiuntaTratta> {
    this.scritture.push('aggiungiTrattaTrasbordoTotale')
    const r = this.righe.get(firId)
    if (!r) throw new Error(`FIR ${firId} non trovato`)
    const stessa = r.tratteAggiuntive.find(
      x =>
        x.codiceFiscale === t.codiceFiscale &&
        x.partitaIva === t.partitaIva &&
        x.dataOraInizioTrasporto?.getTime() === t.dataOraInizioTrasporto.getTime()
    )
    if (stessa) return { creata: false, ordine: stessa.ordine }
    const ordine = Math.max(1, ...r.tratteAggiuntive.map(x => x.ordine)) + 1
    r.tratteAggiuntive.push({
      ordine,
      tipoTratta: 'TERRESTRE',
      denominazione: t.denominazione,
      partitaIva: t.partitaIva,
      codiceFiscale: t.codiceFiscale,
      numeroIscrizioneAlbo: t.numeroIscrizioneAlbo,
      mezzo: t.mezzo,
      conducenteNome: t.conducenteNome,
      conducenteCognome: t.conducenteCognome,
      targaRimorchio: t.targaRimorchio,
      percorso: t.percorso,
      dataOraInizioTrasporto: t.dataOraInizioTrasporto,
    })
    return { creata: true, ordine }
  }
}
