/**
 * Stato in memoria per le rotte "Copia FIR cartaceo"/"Copia FIR digitale"
 * (formulari.yaml, gruppi `/copia-cartacea/...` e `/copia-digitale/...`):
 * restituzione della copia del formulario, obbligatoria in entrambe le forme
 * (cartacea o digitale) fino al 15/09/2026 come alternativa ammessa, poi
 * SOLO digitale.
 *
 * File separato da `stato/archivio.ts` (su cui lavora in parallelo un altro
 * task): nessuna delle due rotte tocca `Formulario`/`Transazione` in
 * scrittura, quindi non serve condividerne la classe. Dove serve leggere un
 * `Formulario` esistente (v. `CopiaDigitale.produttoreCodiceFiscale` sotto),
 * `routes/copie.ts` usa `Archivio.leggiFormulario`, un metodo pubblico di
 * sola lettura — non una modifica di `archivio.ts`.
 *
 * Volutamente non persistente, come `Archivio`: ogni test/avvio riparte
 * pulito.
 */

/** Conferma di presa visione/ricezione da parte di un soggetto. */
export interface ConfermaCopia {
  ruolo?: string
  numIscrSito?: string | null
  dataConferma: string
}

/**
 * `CopiaDigitaleModel` (formulari.yaml righe 6672-6690) non porta alcuna
 * informazione sui soggetti a cui la copia va resa disponibile (solo
 * `num_iscr_sito` del destinatario che carica, `note`, `xfir`) — a differenza
 * di `CopiaCartaceaModel`, che li dichiara esplicitamente nel corpo.
 *
 * **Divergenza dichiarata**: la fake risolve un SOLO soggetto disponibile,
 * `produttoreCodiceFiscale`, leggendolo dal `Formulario` sottostante
 * (`Archivio.leggiFormulario(numeroFir).produttore`), se il FIR è stato
 * seminato in archivio. Il contratto reale li ricaverebbe dall'intero grafo
 * dei soggetti del FIR digitale (produttore, trasportatori, intermediari,
 * destinatari successivi) contenuto nel file xFIR — un parser xFIR completo
 * è fuori dall'ambito di questo modulo (la validazione del formato xFIR
 * appartiene a `xfir.ts`/`validatore-xades.ts`, fuori dai file che questo
 * task può toccare). Senza FIR seminato, `produttoreCodiceFiscale` resta
 * `null` e la copia non compare in alcun elenco per soggetto.
 */
export interface CopiaDigitale {
  identificativo: string
  numeroFir: string
  /** Unità locale del destinatario che ha caricato la copia (path del POST). */
  numIscrSitoCaricamento: string
  xfir: string
  note: string | null
  dataCaricamento: string
  codiceFiscaleCaricamento: string | null
  produttoreCodiceFiscale: string | null
  /**
   * Conferme di presa visione, chiave = `num_iscr_sito` del soggetto che
   * conferma (così come lo riceve
   * `PUT /copia-digitale/conferma/{num_iscr_sito}/{identificativo}`).
   *
   * **Divergenza dichiarata**: la fake non risolve `num_iscr_sito ->
   * codice_fiscale`, quindi `GET /copia-digitale/conferma/{identificativo_soggetto}`
   * (che elenca per codice fiscale) considera una copia "confermata" se
   * esiste ALMENO una conferma registrata, indipendentemente da quale
   * `num_iscr_sito` l'abbia posta — non incrocia l'identità di chi conferma
   * con `identificativo_soggetto` del path.
   */
  conferme: Map<string, ConfermaCopia>
}

/**
 * `CopiaCartaceaModel` (formulari.yaml righe 6381-6439) porta invece
 * esplicitamente `produttore`/`trasportatori`/`intermediari`
 * (`CopiaCartaceaSoggettoInfo`: `codice_fiscale`, `denominazione`,
 * `num_iscr_sito` opzionale) — la fake li conserva così come ricevuti e
 * risolve la visibilità/conferma per soggetto (`identificativo_soggetto` =
 * `codice_fiscale`) senza bisogno di attingere a un `Formulario`.
 */
export interface SoggettoCopiaCartacea {
  codiceFiscale: string
  denominazione: string
  numIscrSito?: string | null
}

export interface CopiaCartacea {
  identificativo: string
  numeroFir: string
  /** Unità locale del trasportatore che ha caricato la copia (path del POST). */
  numIscrSitoCaricamento: string
  fileContent: string
  nomeFile: string
  mime: string
  dataEmissione: string
  produttore: SoggettoCopiaCartacea
  trasportatori: SoggettoCopiaCartacea[]
  intermediari: SoggettoCopiaCartacea[]
  note: string | null
  dataCaricamento: string
  codiceFiscaleCaricamento: string | null
  /** Chiave = `codice_fiscale` del soggetto (`identificativo_soggetto`). */
  conferme: Map<string, ConfermaCopia>
}

/** Tutti i soggetti (produttore + trasportatori + intermediari) di una copia cartacea. */
export function soggettiCopiaCartacea(copia: CopiaCartacea): SoggettoCopiaCartacea[] {
  return [copia.produttore, ...copia.trasportatori, ...copia.intermediari]
}

export class ArchivioCopie {
  private digitali = new Map<string, CopiaDigitale>()
  private cartacee = new Map<string, CopiaCartacea>()

  azzera(): void {
    this.digitali.clear()
    this.cartacee.clear()
  }

  // ---- Copia digitale ----------------------------------------------------

  /**
   * `identificativo`, a differenza di `Formulario`/`Transazione` (che generano
   * il proprio id), e' fornito dal chiamante: `routes/copie.ts` lo fa
   * coincidere con l'id della `Transazione` NONBLOCK_PULL creata per lo
   * stesso caricamento, cosi' un test puo' risalire alla copia appena creata
   * dalla SOLA risposta 202 (`{transazione_id}`), senza bisogno di
   * un'elencazione — v. commento di testata di `registraRotteCopie`.
   */
  creaCopiaDigitale(dati: Omit<CopiaDigitale, 'dataCaricamento' | 'conferme'>): CopiaDigitale {
    const copia: CopiaDigitale = {
      ...dati,
      dataCaricamento: new Date().toISOString(),
      conferme: new Map(),
    }
    this.digitali.set(copia.identificativo, copia)
    return copia
  }

  leggiCopiaDigitale(identificativo: string): CopiaDigitale | undefined {
    return this.digitali.get(identificativo)
  }

  elencaCopieDigitaliCaricate(
    numIscrSito: string,
    filtro?: { numeroFir?: string }
  ): CopiaDigitale[] {
    return [...this.digitali.values()].filter(copia => {
      if (copia.numIscrSitoCaricamento !== numIscrSito) return false
      if (filtro?.numeroFir && copia.numeroFir !== filtro.numeroFir) return false
      return true
    })
  }

  /** Copie disponibili per la conferma (o già confermate) per il soggetto indicato. */
  elencaCopieDigitaliPerSoggetto(
    identificativoSoggetto: string,
    filtro?: { numeroFir?: string; confermate?: boolean }
  ): CopiaDigitale[] {
    return [...this.digitali.values()].filter(copia => {
      if (copia.produttoreCodiceFiscale !== identificativoSoggetto) return false
      if (filtro?.numeroFir && copia.numeroFir !== filtro.numeroFir) return false
      if (filtro?.confermate !== undefined) {
        const confermata = copia.conferme.size > 0
        if (confermata !== filtro.confermate) return false
      }
      return true
    })
  }

  eliminaCopiaDigitale(
    numIscrSito: string,
    identificativo: string
  ): 'non-trovata' | 'ha-conferme' | 'ok' {
    const copia = this.digitali.get(identificativo)
    if (!copia || copia.numIscrSitoCaricamento !== numIscrSito) return 'non-trovata'
    if (copia.conferme.size > 0) return 'ha-conferme'
    this.digitali.delete(identificativo)
    return 'ok'
  }

  confermaCopiaDigitale(
    identificativo: string,
    numIscrSito: string,
    dati: { ruolo?: string; respingi?: boolean }
  ): 'non-trovata' | 'ok' {
    const copia = this.digitali.get(identificativo)
    if (!copia) return 'non-trovata'

    if (dati.respingi) {
      copia.conferme.delete(numIscrSito)
      return 'ok'
    }
    copia.conferme.set(numIscrSito, {
      ruolo: dati.ruolo,
      numIscrSito,
      dataConferma: new Date().toISOString(),
    })
    return 'ok'
  }

  // ---- Copia cartacea -----------------------------------------------------

  /** V. commento di {@link creaCopiaDigitale}: `identificativo` e' fornito dal chiamante. */
  creaCopiaCartacea(dati: Omit<CopiaCartacea, 'dataCaricamento' | 'conferme'>): CopiaCartacea {
    const copia: CopiaCartacea = {
      ...dati,
      dataCaricamento: new Date().toISOString(),
      conferme: new Map(),
    }
    this.cartacee.set(copia.identificativo, copia)
    return copia
  }

  leggiCopiaCartacea(identificativo: string): CopiaCartacea | undefined {
    return this.cartacee.get(identificativo)
  }

  elencaCopieCartaceeCaricate(
    numIscrSito: string,
    filtro?: { numeroFir?: string; confermate?: boolean }
  ): CopiaCartacea[] {
    return [...this.cartacee.values()].filter(copia => {
      if (copia.numIscrSitoCaricamento !== numIscrSito) return false
      if (filtro?.numeroFir && copia.numeroFir !== filtro.numeroFir) return false
      if (filtro?.confermate !== undefined) {
        const confermata = copia.conferme.size > 0
        if (confermata !== filtro.confermate) return false
      }
      return true
    })
  }

  elencaCopieCartaceePerSoggetto(
    identificativoSoggetto: string,
    filtro?: { numeroFir?: string; confermate?: boolean }
  ): CopiaCartacea[] {
    return [...this.cartacee.values()].filter(copia => {
      const appartiene = soggettiCopiaCartacea(copia).some(
        s => s.codiceFiscale === identificativoSoggetto
      )
      if (!appartiene) return false
      if (filtro?.numeroFir && copia.numeroFir !== filtro.numeroFir) return false
      if (filtro?.confermate !== undefined) {
        const confermata = copia.conferme.has(identificativoSoggetto)
        if (confermata !== filtro.confermate) return false
      }
      return true
    })
  }

  eliminaCopiaCartacea(
    numIscrSito: string,
    identificativo: string
  ): 'non-trovata' | 'ha-conferme' | 'ok' {
    const copia = this.cartacee.get(identificativo)
    if (!copia || copia.numIscrSitoCaricamento !== numIscrSito) return 'non-trovata'
    if (copia.conferme.size > 0) return 'ha-conferme'
    this.cartacee.delete(identificativo)
    return 'ok'
  }

  confermaCopiaCartacea(
    identificativo: string,
    identificativoSoggetto: string,
    dati: { ruolo?: string; numIscrSito?: string | null; respingi?: boolean }
  ): 'non-trovata' | 'soggetto-non-pertinente' | 'ok' {
    const copia = this.cartacee.get(identificativo)
    if (!copia) return 'non-trovata'
    const appartiene = soggettiCopiaCartacea(copia).some(
      s => s.codiceFiscale === identificativoSoggetto
    )
    if (!appartiene) return 'soggetto-non-pertinente'

    if (dati.respingi) {
      copia.conferme.delete(identificativoSoggetto)
      return 'ok'
    }
    copia.conferme.set(identificativoSoggetto, {
      ruolo: dati.ruolo,
      numIscrSito: dati.numIscrSito ?? null,
      dataConferma: new Date().toISOString(),
    })
    return 'ok'
  }
}
