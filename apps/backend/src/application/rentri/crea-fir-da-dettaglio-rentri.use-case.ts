import { Injectable } from '@nestjs/common'
import { DomainException } from '../../domain/shared/domain-exception'
import {
  CreateFIRProps,
  FIR,
  ParteFIR,
  TipoOperazioneRifiuto,
  TipoTratta,
  TrattaTrasportoFIR,
} from '../../domain/fir/aggregates/fir.aggregate'
import { UnitaMisura } from '../../domain/fir/value-objects/quantita'
import {
  DatiDestinatarioFormularioResult,
  DatiProduttoreFormularioResult,
  DatiRifiutoResult,
  DatiTrasportatoreFormularioResult,
  FormularioModel,
  IndirizzoRENTRIResult,
} from '../../infrastructure/rentri/rentri-api.client'
import { CreaFIRDaFormularioRENTRIPort } from './crea-fir-da-formulario-rentri.port'

/**
 * Mappa un codice `stato_fisico` RENTRI (`StatiFisici`, formulari.yaml righe
 * 10160-10167: SP/S/FP/L/VS) sul valore italiano del modello locale
 * (`StatoFisicoRifiuto`, `create-fir.dto.ts`: Solido/Liquido/Fangoso/Gassoso/
 * Polvere/Misto). I due insiemi non coincidono (RENTRI non ha "Gassoso"/
 * "Misto", ha "VS" — vischioso sciropposo — senza equivalente locale): per i
 * codici senza corrispondente si conserva il codice RENTRI originale invece
 * di forzare un valore che l'ente non ha dichiarato. `statoFisico` è
 * opzionale nel modello locale (`FIRRifiuto.statoFisico?`), quindi questa
 * scelta non blocca mai l'acquisizione.
 */
const STATO_FISICO_DA_RENTRI: Record<string, string> = {
  SP: 'Polvere',
  S: 'Solido',
  FP: 'Fangoso',
  L: 'Liquido',
}

/**
 * Crea FIR da Dettaglio RENTRI — Use Case (R2 Task 5).
 *
 * Implementa {@link CreaFIRDaFormularioRENTRIPort}: trasforma il dettaglio
 * RENTRI di un formulario appena acquisito (`GET /{numero_fir}`,
 * `DettaglioFormulario`) in un FIR locale, per il ramo "nuovo formulario" di
 * `AcquisisciFormularioRENTRIUseCase` (Task 4).
 *
 * ## Decisione 1 — snapshot immutabile, non riferimento vivo
 *
 * Stessa decisione del PO del 2026-06-09 già applicata a `CreateFIRUseCase`
 * per l'anagrafica presa dal registro locale: qui l'anagrafica di produttore/
 * trasportatore/destinatario viene presa dal registro RENTRI (di un'altra
 * controparte, non nostro) e congelata nel FIR al momento dell'aggancio. Un
 * refresh successivo (se l'ente aggiorna l'anagrafica del soggetto) è
 * un'azione esplicita futura, fuori scope di R2: non esiste alcun
 * meccanismo che ri-sincronizzi questi campi da solo.
 *
 * ## Decisione 2 — campo obbligatorio locale assente → rifiuto, non un FIR a metà
 *
 * Il modello RENTRI e quello locale non coincidono: alcuni campi che il
 * nostro modello richiede (`ParteFIR.ragioneSociale`/`partitaIva`,
 * `FIRRifiuto.cerCode`/`quantita`) possono mancare nel dettaglio se il
 * formulario RENTRI non è ancora completo (es. stato `InserimentoQuantita`:
 * l'ente stesso non ha ancora la quantità). La scelta qui è di RIFIUTARE
 * l'acquisizione con un errore di dominio leggibile
 * ("Il formulario RENTRI non contiene `<campo>`, necessario per registrarlo
 * nel gestionale") invece di creare un FIR locale incompleto in silenzio: un
 * FIR con dati mancanti è un documento legale non veritiero, e un'acquisizione
 * silenziosamente parziale nasconderebbe all'operatore che il formulario a
 * monte non è ancora pronto — l'operatore deve poter ritentare l'acquisizione
 * più tardi (quando l'ente avrà completato il formulario), sapendo perché è
 * fallita ora.
 *
 * ## Decisione 3 — nessuna validazione del CER contro il catalogo
 *
 * `CreateFIRUseCase` (creazione di un FIR NUOVO dall'interfaccia) verifica
 * che il codice CER sia ancora `isUtilizzabilePerNuovoFormulario` (R4 Task 4):
 * un codice che RENTRI ha smesso di confermare non è più selezionabile per un
 * formulario che stiamo per generare da zero. Qui è diverso: il formulario
 * ESISTE GIÀ presso l'ente, con qualunque CER avesse alla sua emissione — un
 * CER nel frattempo ritirato dal registro è storico, non un errore
 * dell'operatore. Rifiutare l'acquisizione per questo motivo equivarrebbe a
 * rifiutare di leggere un documento che esiste. Questo use case quindi NON
 * dipende da `ICERRepository` e non chiama né `exists` né
 * `isUtilizzabilePerNuovoFormulario`: normalizza solo il formato del codice
 * (stessa normalizzazione di `CreateFIRUseCase.normalizeCerCode`/
 * `RentriCerSyncService.normalizzaCodice`), senza validarne la validità.
 *
 * ## Decisione 4 — campi RENTRI senza corrispondente locale: lacuna nota, non persi silenziosamente
 *
 * Il dettaglio RENTRI porta strutture senza alcun campo locale
 * corrispondente (stato_formulario, versione, dati_vidimazione,
 * dati_trasporto per-tratta, dati_accettazione, allegati, annullamento,
 * trasbordi, soste tecniche, destinazioni successive). Aggiungere colonne
 * dedicate richiederebbe una migrazione Prisma, non consentita in questo
 * giro (un altro worktree lavora in parallelo sullo schema). La scelta è
 * quindi di mappare fedelmente tutto ciò che HA un corrispondente locale
 * (produttore/destinatario/trasportatori, rifiuto, annotazioni — quest'ultima
 * un 1:1 diretto con `dati_partenza.annotazioni`) e di documentare
 * esplicitamente qui, invece di far finta che non esista, che il resto non è
 * ancora catturato: un futuro task potrà aggiungere una colonna JSON dedicata
 * per il payload grezzo, se servirà.
 *
 * ## Perché `rentriNumeroFir` resta `null` in uscita
 *
 * `AcquisisciFormularioRENTRIUseCase` chiama
 * `nuovoFir.agganciaFormularioAcquisito(numeroFir, ...)` SUBITO DOPO aver
 * ricevuto il FIR da questo use case (v. `acquisisci-formulario-rentri.use-case.ts`).
 * Quel metodo valorizza `rentriNumeroFir` E `rentriOrigineLegame` insieme, e
 * rifiuta (`assertNonGiaLegatoRENTRI`) se il FIR è già legato: se questo use
 * case impostasse già `rentriNumeroFir`, la chiamata del chiamante fallirebbe
 * sempre. Il FIR restituito da qui deve quindi restare NON legato — il
 * legame (e la sua origine `ACQUISITO_DA_TERZI`) è responsabilità esclusiva
 * del chiamante, non di questo use case.
 *
 * Non persiste (nessuna dipendenza da `IFIRRepository`/Prisma): il chiamante
 * salva il FIR restituito DOPO l'aggancio (v. sopra) — riusa così
 * `IFIRRepository.save`/`FIRPrismaRepository` come unico punto di
 * persistenza dei FIR, senza duplicare la logica di scrittura qui.
 */
@Injectable()
export class CreaFIRDaDettaglioRENTRIUseCase implements CreaFIRDaFormularioRENTRIPort {
  async creaDaDettaglio(
    tenantId: string,
    userId: string,
    dettaglio: FormularioModel,
    _numeroFir: string
  ): Promise<FIR> {
    const partenza = dettaglio.dati_partenza
    if (!partenza) {
      throw this.campoMancante('dati_partenza')
    }

    const produttoreRentri = this.richiedi(partenza.produttore, 'dati_partenza.produttore')
    const destinatarioRentri = this.richiedi(partenza.destinatario, 'dati_partenza.destinatario')
    const [trasportatorePrincipale, ...trasportatoriSuccessivi] = partenza.trasportatori ?? []
    if (!trasportatorePrincipale) {
      throw this.campoMancante('dati_partenza.trasportatori')
    }
    const rifiutoRentri = this.richiedi(partenza.rifiuto, 'dati_partenza.rifiuto')

    const produttore = this.mappaParte(produttoreRentri, 'dati_partenza.produttore')
    const destinatario = this.mappaParte(destinatarioRentri, 'dati_partenza.destinatario')
    const trasportatore = this.mappaParte(trasportatorePrincipale, 'dati_partenza.trasportatori[0]')
    const rifiuto = this.mappaRifiuto(rifiutoRentri, destinatarioRentri)

    // Le tratte successive alla prima (già mappata come trasportatore
    // principale, sopra) diventano trasportatoriAggiuntivi: ordine 2, 3, ...
    // (il principale occupa implicitamente l'ordine 1, non essendo parte
    // dell'array trasportatoriAggiuntivi — stesso schema di CreateFIRUseCase).
    const trasportatoriAggiuntivi: TrattaTrasportoFIR[] = trasportatoriSuccessivi.map((t, i) =>
      this.mappaTrattaAggiuntiva(t, i + 2)
    )

    const props: CreateFIRProps = {
      tenantId,
      creatoDaUserId: userId,
      produttoreId: produttoreRentri.codice_fiscale,
      trasportatoreId: trasportatorePrincipale.codice_fiscale,
      destinatarioId: destinatarioRentri.codice_fiscale,
      produttore,
      trasportatore,
      destinatario,
      trasportatoriAggiuntivi,
      rifiuto,
      annotazioni: partenza.annotazioni ?? undefined,
    }

    return FIR.create(props)
  }

  /** Legge un sotto-oggetto obbligatorio del dettaglio, o rifiuta con un errore leggibile se assente. */
  private richiedi<T>(value: T | null | undefined, nomeCampo: string): T {
    if (value === null || value === undefined) {
      throw this.campoMancante(nomeCampo)
    }
    return value
  }

  private campoMancante(nomeCampo: string): DomainException {
    return DomainException.validationFailed(
      'CAMPO_RENTRI_MANCANTE',
      `Il formulario RENTRI non contiene \`${nomeCampo}\`, necessario per registrarlo nel gestionale`,
      { campo: nomeCampo }
    )
  }

  /**
   * Mappa un soggetto RENTRI (produttore/destinatario/trasportatore
   * principale) su {@link ParteFIR}. `ParteFIR` ha un solo campo
   * identificativo (`partitaIva`), mentre RENTRI usa "codice_fiscale" per
   * tutti i soggetti (può essere una vera Partita IVA a 11 cifre o un codice
   * fiscale personale a 16 caratteri, v. formulari.yaml). Nessun campo
   * dedicato `codiceFiscale` su `ParteFIR` in questo giro (aggiungerne uno
   * persistito richiederebbe una migrazione Prisma, non consentita): si
   * conserva qui il valore RENTRI così com'è, nel campo disponibile — lacuna
   * nota, non un dato perso (v. commento di classe, Decisione 4).
   */
  private mappaParte(
    dati:
      | DatiProduttoreFormularioResult
      | DatiDestinatarioFormularioResult
      | DatiTrasportatoreFormularioResult,
    nomeCampo: string
  ): ParteFIR {
    if (!dati.denominazione?.trim()) {
      throw this.campoMancante(`${nomeCampo}.denominazione`)
    }
    if (!dati.codice_fiscale?.trim()) {
      throw this.campoMancante(`${nomeCampo}.codice_fiscale`)
    }

    return {
      ragioneSociale: dati.denominazione,
      partitaIva: dati.codice_fiscale,
      indirizzo: 'indirizzo' in dati ? this.mappaIndirizzo(dati.indirizzo) : undefined,
    }
  }

  /**
   * `IndirizzoModel.citta` è un `oneOf` fra comune italiano (solo codice
   * ISTAT, RENTRI non restituisce qui il nome leggibile: servirebbe una
   * chiamata separata a `GET /codifiche/v1.0/comuni`, fuori scope) e città
   * estera (nome in chiaro + nazione). `indirizzo` è opzionale sul modello
   * locale (`ParteFIR.indirizzo?`): un indirizzo parziale o assente non
   * blocca mai l'acquisizione.
   */
  private mappaIndirizzo(ind?: IndirizzoRENTRIResult | null): string | undefined {
    if (!ind?.indirizzo) return undefined

    const civico = ind.civico ? `, ${ind.civico}` : ''
    const cap = ind.cap ? ` - ${ind.cap}` : ''
    const cittaLabel = this.mappaCitta(ind.citta)
    const citta = cittaLabel ? ` ${cittaLabel}` : ''

    return `${ind.indirizzo}${civico}${cap}${citta}`.trim()
  }

  private mappaCitta(citta: IndirizzoRENTRIResult['citta']): string | undefined {
    if (!citta) return undefined
    if ('comune_id' in citta && citta.comune_id) {
      return `(ISTAT ${citta.comune_id})`
    }
    if ('nome_citta' in citta && citta.nome_citta) {
      return citta.nazione_id ? `${citta.nome_citta} (${citta.nazione_id})` : citta.nome_citta
    }
    return undefined
  }

  /**
   * Mappa `dati_partenza.rifiuto` su `CreateFIRProps['rifiuto']`. `codice_eer`
   * e `quantita` sono gli unici due campi che il modello locale richiede
   * sempre (`FIRRifiuto.cerCode: string`, `FIRRifiuto.quantita: Quantita` con
   * `Quantita.create` che rifiuta un valore non positivo): mancanti →
   * `campoMancante` (v. Decisione 2 di classe). Il CER NON viene validato
   * contro il catalogo (v. Decisione 3): solo normalizzato nel formato
   * canonico "NN NN NN"(*).
   */
  private mappaRifiuto(
    r: DatiRifiutoResult,
    destinatario: DatiDestinatarioFormularioResult
  ): CreateFIRProps['rifiuto'] {
    if (!r.codice_eer?.trim()) {
      throw this.campoMancante('dati_partenza.rifiuto.codice_eer')
    }
    const quantitaValore = r.quantita?.valore
    if (!quantitaValore || quantitaValore <= 0) {
      throw this.campoMancante('dati_partenza.rifiuto.quantita')
    }

    const { tipoOperazione, codiceOperazione } = this.mappaOperazione(destinatario.attivita)
    const numeroColli = r.numero_colli ? Number.parseInt(r.numero_colli, 10) : NaN

    return {
      cerCode: this.normalizzaCodiceEER(r.codice_eer),
      quantita: quantitaValore,
      unitaMisura: r.quantita?.unita_misura === 'l' ? UnitaMisura.LITRI : UnitaMisura.KG,
      statoFisico: r.stato_fisico
        ? (STATO_FISICO_DA_RENTRI[r.stato_fisico] ?? r.stato_fisico)
        : undefined,
      caratteristichePericolo:
        r.caratteristiche_pericolo && r.caratteristiche_pericolo.length > 0
          ? r.caratteristiche_pericolo.join(',')
          : undefined,
      numeroColli: Number.isFinite(numeroColli) ? numeroColli : undefined,
      descrizione: r.descrizione ?? undefined,
      tipoOperazione,
      codiceOperazione,
    }
  }

  /**
   * `dati_partenza.destinatario.attivita` (`OperazioniRecuperoSmaltimento`,
   * es. "R13"/"D15") corrisponde 1:1 al Campo 3 FIR locale
   * (`FIRRifiuto.codiceOperazione`); il prefisso R/D deriva anche
   * `tipoOperazione` (RECOVERY/DISPOSAL), usato per l'aggregazione MUD.
   * Campo opzionale su RENTRI: se assente, entrambi restano `undefined`.
   */
  private mappaOperazione(attivita?: string | null): {
    tipoOperazione?: TipoOperazioneRifiuto
    codiceOperazione?: string
  } {
    if (!attivita) return {}
    const codice = attivita.trim().toUpperCase()
    if (codice.startsWith('R')) return { tipoOperazione: 'RECOVERY', codiceOperazione: codice }
    if (codice.startsWith('D')) return { tipoOperazione: 'DISPOSAL', codiceOperazione: codice }
    return { codiceOperazione: codice }
  }

  /**
   * Normalizza il codice EER RENTRI (senza spazi, es. "130208*") nel formato
   * canonico del catalogo locale "NN NN NN"(*) — stessa normalizzazione di
   * `CreateFIRUseCase.normalizeCerCode`/`RentriCerSyncService.normalizzaCodice`.
   * Nessuna validazione di esistenza/utilizzabilità qui (v. Decisione 3 di
   * classe): un formato non a 6 cifre viene lasciato invariato (difensivo,
   * non dovrebbe accadere su un formulario reale già vidimato dall'ente).
   */
  private normalizzaCodiceEER(raw: string): string {
    const trimmed = raw.trim().toUpperCase()
    const hazardous = trimmed.endsWith('*')
    const digits = trimmed.replace(/[^0-9]/g, '')
    if (digits.length !== 6) return trimmed
    const spaced = `${digits.slice(0, 2)} ${digits.slice(2, 4)} ${digits.slice(4, 6)}`
    return hazardous ? `${spaced}*` : spaced
  }

  /**
   * Mappa una tratta di trasporto successiva alla principale su
   * `TrattaTrasportoFIR`. A differenza di `ParteFIR`, questo tipo ha sia
   * `partitaIva` che `codiceFiscale` distinti: si sceglie in base al formato
   * (11 cifre → Partita IVA, altrimenti codice fiscale personale/estero) —
   * un'euristica, non una validazione formale del contratto, ma più precisa
   * del singolo campo di `ParteFIR`. Mezzo e data presa in carico restano
   * vuoti (si valorizzano a runtime, come in `CreateFIRUseCase.snapshotTratta`).
   */
  private mappaTrattaAggiuntiva(
    t: DatiTrasportatoreFormularioResult,
    ordine: number
  ): TrattaTrasportoFIR {
    if (!t.denominazione?.trim()) {
      throw this.campoMancante(`dati_partenza.trasportatori[${ordine - 1}].denominazione`)
    }
    if (!t.codice_fiscale?.trim()) {
      throw this.campoMancante(`dati_partenza.trasportatori[${ordine - 1}].codice_fiscale`)
    }

    const isPartitaIva = /^\d{11}$/.test(t.codice_fiscale)

    return {
      ordine,
      tipoTratta: this.mappaTipoTratta(t.tipo_trasporto),
      denominazione: t.denominazione,
      partitaIva: isPartitaIva ? t.codice_fiscale : undefined,
      codiceFiscale: isPartitaIva ? undefined : t.codice_fiscale,
      numeroIscrizioneAlbo: t.numero_iscrizione_albo ?? undefined,
    }
  }

  private mappaTipoTratta(tipoTrasporto?: string | null): TipoTratta {
    switch (tipoTrasporto) {
      case 'Ferroviario':
        return TipoTratta.FERROVIARIA
      case 'Marittimo':
        return TipoTratta.MARITTIMA
      default:
        // "Terrestre" o valore assente/non riconosciuto: il caso più comune,
        // scelto come fallback difensivo (v. commento di classe, Decisione 4).
        return TipoTratta.TERRESTRE
    }
  }
}
