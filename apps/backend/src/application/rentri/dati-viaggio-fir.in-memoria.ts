import {
  DatiPartenzaDaSalvare,
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
}
