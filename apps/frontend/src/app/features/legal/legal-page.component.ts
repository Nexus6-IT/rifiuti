/**
 * LegalPageComponent — visualizzatore pagine legali (ToS, Privacy, DPA).
 *
 * Percorso (pubblico, senza authGuard):
 *  /legal/termini   → Termini di Servizio
 *  /legal/privacy   → Informativa Privacy
 *  /legal/dpa       → Data Processing Agreement
 *
 * Il componente legge il parametro `page` dai dati della rotta (route.data.page)
 * e seleziona il documento corrispondente dal dizionario DOCS.
 *
 * I documenti sono bozze v0.1 — DA VALIDARE CON UN LEGALE.
 * Riferimenti: GDPR (Reg. UE 2016/679) artt. 13, 28, 32; D.Lgs 152/2006 art. 190;
 * DM 59/2023 (RENTRI); D.Lgs 82/2005 (CAD); Linee Guida AgID.
 */

import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule, ActivatedRoute } from '@angular/router';

interface LegalSection {
  heading: string;
  content: string[];
}

interface LegalDoc {
  title: string;
  subtitle: string;
  version: string;
  updatedAt: string;
  sections: LegalSection[];
}

const DOCS: Record<string, LegalDoc> = {
  termini: {
    title: 'Termini di Servizio',
    subtitle: 'Contratto di servizio SaaS B2B — WasteFlow',
    version: 'v0.1 — BOZZA',
    updatedAt: '[DATA VERSIONE]',
    sections: [
      {
        heading: '1. Parti e accettazione',
        content: [
          'Il presente documento ("Termini") disciplina il rapporto contrattuale tra [RAGIONE SOCIALE FORNITORE] (P.IVA [P.IVA FORNITORE], sede [INDIRIZZO SEDE LEGALE]) — di seguito "Fornitore" o "WasteFlow" — e la persona giuridica che si registra al Servizio ("Cliente").',
          'I presenti Termini si applicano esclusivamente a soggetti che agiscono nell\'esercizio della propria attività professionale o imprenditoriale (B2B). Non si applicano a consumatori ai sensi del D.Lgs 206/2005.',
          'Completando la registrazione, il Cliente — tramite il proprio rappresentante legale o soggetto autorizzato — accetta integralmente i presenti Termini. Le clausole limitative di responsabilità e le clausole su foro esclusivo (art. 1341 c.c.) sono espressamente approvate con l\'accettazione.',
        ],
      },
      {
        heading: '2. Oggetto del servizio',
        content: [
          'WasteFlow è una piattaforma SaaS multi-tenant per la gestione digitale dei rifiuti speciali: FIR digitali (xFIR), registro cronologico di carico e scarico (art. 190 D.Lgs 152/2006), anagrafiche, export MUD, dashboard, integrazione RENTRI (DM 59/2023).',
          'Il Servizio è erogato in modalità multi-tenant con isolamento logico dei dati per Cliente (Row-Level Security su PostgreSQL). L\'accesso avviene tramite autenticazione SPID/CIE integrata con Keycloak.',
          'Il Fornitore si riserva di modificare funzionalità non core con ragionevole preavviso, senza che ciò configuri inadempimento contrattuale.',
        ],
      },
      {
        heading: '3. Account e utenti',
        content: [
          'Il Cliente deve fornire dati veritieri e completi in fase di registrazione. Ogni Cliente dispone di un account aziendale (tenant) con un utente amministratore (Admin), che può creare ulteriori utenti nei limiti del piano.',
          'Il Cliente è responsabile della riservatezza delle credenziali e di qualsiasi attività svolta sotto il proprio account.',
        ],
      },
      {
        heading: '4. Piani e pagamenti',
        content: [
          'Il Servizio è disponibile nei piani: TRIAL (gratuito, [PERIODO TRIAL] giorni, limiti ridotti), PROFESSIONAL ([LISTINO PREZZI]/mese, uso professionale PMI), ENTERPRISE (su preventivo, grandi organizzazioni).',
          'Al termine del TRIAL il Servizio è sospeso salvo upgrade. I piani a pagamento si rinnovano automaticamente salvo disdetta con [X] giorni di anticipo. La rinuncia al rimborso per periodi già fatturati è clausola ex art. 1341 c.c.',
          'I pagamenti sono processati da [NOME PROVIDER PAGAMENTI]. Il Fornitore non conserva dati delle carte di credito.',
        ],
      },
      {
        heading: '5. Obblighi del Cliente',
        content: [
          'Il Cliente utilizza il Servizio in conformità alla normativa vigente (D.Lgs 152/2006, DM 59/2023). Il Cliente è titolare del trattamento per i dati di terzi inseriti nel Servizio (art. 28 GDPR) ed è responsabile della correttezza dei dati ambientali.',
          'È vietato: tentare accesso a dati di altri tenant; effettuare reverse engineering; utilizzare il Servizio per attività illegali; rivendere l\'accesso senza autorizzazione scritta.',
          'La conservazione a norma AgID (CAD, D.Lgs 82/2005, Linee Guida AgID) di registri e FIR è responsabilità del Cliente.',
        ],
      },
      {
        heading: '6. Disponibilità (SLA)',
        content: [
          'Il Servizio è erogato "come disponibile" (best-effort). Il Fornitore non garantisce un uptime minimo né tempi di risposta specifici, salvo diverso accordo scritto per i piani ENTERPRISE (clausola ex art. 1341 c.c.).',
          'Il Fornitore non è responsabile di interruzioni causate da forza maggiore, guasti di infrastrutture di terzi o attacchi informatici.',
        ],
      },
      {
        heading: '7. Proprietà intellettuale',
        content: [
          'Il Servizio, il software, il design e i marchi sono di proprietà esclusiva del Fornitore. Al Cliente è concessa una licenza d\'uso non esclusiva, non trasferibile e revocabile per la durata del contratto.',
          'I dati inseriti dal Cliente rimangono di sua proprietà esclusiva. Il Fornitore non li utilizza per finalità proprie, salvo in forma aggregata e anonima per il miglioramento del Servizio.',
        ],
      },
      {
        heading: '8. Limitazione di responsabilità',
        content: [
          'Il Fornitore non è responsabile per danni indiretti, consequenziali, perdita di profitto o perdita di dati (clausola ex art. 1341 c.c.).',
          'La responsabilità complessiva del Fornitore non supera il corrispettivo pagato dal Cliente nei 12 mesi precedenti l\'evento (o EUR 500,00 per piani TRIAL) — clausola ex art. 1341 c.c.',
          'Il Cliente è l\'unico responsabile nei confronti delle autorità ambientali per la correttezza degli adempimenti (registri, FIR, MUD, RENTRI). WasteFlow è uno strumento di gestione digitale e non sostituisce la responsabilità del produttore/detentore di rifiuti.',
        ],
      },
      {
        heading: '9. Sospensione e risoluzione',
        content: [
          'Il Cliente può recedere in qualsiasi momento dalla pagina account. Il Fornitore può sospendere o risolvere il contratto con effetto immediato in caso di violazione materiale dei Termini, mancato pagamento o attività illegali.',
          'Dopo la risoluzione, i dati sono conservati [X] giorni per consentire l\'export, poi eliminati in modo sicuro. La mancata richiesta di export entro tale termine esonera il Fornitore da responsabilità (clausola ex art. 1341 c.c.).',
        ],
      },
      {
        heading: '10. Privacy e protezione dei dati',
        content: [
          'Il trattamento dei dati degli utenti di account è disciplinato dall\'Informativa Privacy (/legal/privacy). Il trattamento dei dati di terzi caricati nel Servizio è disciplinato dal Data Processing Agreement — DPA (/legal/dpa).',
        ],
      },
      {
        heading: '11. Legge applicabile e foro',
        content: [
          'I presenti Termini sono disciplinati dalla legge italiana.',
          'Per qualsiasi controversia è esclusivamente competente il Tribunale di [FORO COMPETENTE] — clausola ex art. 1341 c.c.',
        ],
      },
    ],
  },

  privacy: {
    title: 'Informativa sul Trattamento dei Dati Personali',
    subtitle: 'Ai sensi dell\'art. 13 Reg. UE 2016/679 (GDPR)',
    version: 'v0.1 — BOZZA',
    updatedAt: '[DATA VERSIONE]',
    sections: [
      {
        heading: '1. Titolare del trattamento',
        content: [
          'Titolare: [RAGIONE SOCIALE FORNITORE], sede legale [INDIRIZZO SEDE LEGALE], P.IVA [P.IVA FORNITORE].',
          'Contatto privacy: [EMAIL PRIVACY]. DPO (se nominato): [EVENTUALE DPO].',
          'La presente informativa si applica ai dati degli utenti che si registrano e accedono a WasteFlow (persone fisiche: responsabili, amministratori, operatori).',
          'I dati di terzi che i Clienti caricano nel Servizio (produttori, trasportatori, destinatari) sono trattati ai sensi dell\'art. 28 GDPR e disciplinati dal DPA separato (/legal/dpa).',
        ],
      },
      {
        heading: '2. Dati trattati',
        content: [
          'Dati di registrazione: nome, cognome, email, codice fiscale, ragione sociale e P.IVA dell\'azienda, ruolo.',
          'Dati di autenticazione: dati trasmessi dall\'Identity Provider SPID/CIE (nome, cognome, CF, livello autenticazione); token di sessione JWT temporanei.',
          'Dati di utilizzo: indirizzo IP, browser/SO (user-agent), data e ora degli accessi, log operazioni (audit trail).',
          'Dati di comunicazione: email di supporto, notifiche di sistema.',
        ],
      },
      {
        heading: '3. Finalità e basi giuridiche',
        content: [
          'Erogazione del Servizio e gestione account: art. 6.1.(b) GDPR — esecuzione del contratto.',
          'Fatturazione e adempimenti fiscali: art. 6.1.(c) GDPR — obbligo legale (D.P.R. 633/1972, D.P.R. 600/1973).',
          'Sicurezza informatica e prevenzione abusi: art. 6.1.(f) GDPR — legittimo interesse del Titolare.',
          'Log di audit ambientale (tracciabilità operazioni su FIR e registri): art. 6.1.(c) GDPR — obbligo legale (D.Lgs 152/2006, DM 59/2023).',
          'Comunicazioni commerciali/newsletter: art. 6.1.(a) GDPR — consenso (solo se prestato).',
        ],
      },
      {
        heading: '4. Conservazione',
        content: [
          'Dati di account: per la durata del contratto + periodo obbligatorio per adempimenti fiscali.',
          'Log di audit ambientale: 3 anni dall\'ultima registrazione (art. 190 D.Lgs 152/2006).',
          'Dati di fatturazione: 10 anni (art. 2220 c.c.).',
          'Cookie di sessione: eliminati alla chiusura del browser o scadenza sessione.',
          'Dati marketing: fino alla revoca del consenso.',
        ],
      },
      {
        heading: '5. Destinatari',
        content: [
          'Responsabili del trattamento (art. 28 GDPR): Contabo GmbH (hosting VPS, Germania — UE); provider email transazionale ([NOME PROVIDER]); provider pagamenti ([NOME PROVIDER]).',
          'I dati non sono venduti né ceduti a terzi. Possono essere comunicati ad autorità giudiziarie/fiscali/ambientali su richiesta formale.',
        ],
      },
      {
        heading: '6. Trasferimenti extraUE',
        content: [
          'Il server principale è in Germania (UE). Per provider con sede extraSEE, il trasferimento avviene sulla base delle Clausole Contrattuali Standard (SCC — Decisione UE 2021/914) o garanzie equivalenti.',
        ],
      },
      {
        heading: '7. Diritti dell\'interessato',
        content: [
          'L\'interessato ha diritto di: accesso (art. 15), rettifica (art. 16), cancellazione (art. 17), limitazione (art. 18), portabilità (art. 20), opposizione (art. 21), revoca del consenso (art. 7.3).',
          'Esercizio dei diritti: scrivere a [EMAIL PRIVACY]. Il Titolare risponde entro 30 giorni.',
          'Diritto di reclamo: Autorità Garante per la Protezione dei Dati Personali — www.garanteprivacy.it, garante@gpdp.it, PEC: protocollo@pec.gpdp.it.',
        ],
      },
      {
        heading: '8. Cookie',
        content: [
          'Il Servizio utilizza esclusivamente cookie tecnici e di sessione strettamente necessari al funzionamento (autenticazione, sessione). Non sono utilizzati cookie di profilazione o tracciamento pubblicitario.',
        ],
      },
    ],
  },

  dpa: {
    title: 'Accordo sul Trattamento dei Dati (DPA)',
    subtitle: 'Data Processing Agreement — art. 28 Reg. UE 2016/679 (GDPR)',
    version: 'v0.1 — BOZZA',
    updatedAt: '[DATA VERSIONE]',
    sections: [
      {
        heading: 'Premesse',
        content: [
          '[RAGIONE SOCIALE FORNITORE] ("Responsabile") eroga il Servizio WasteFlow e, nell\'ambito di tale erogazione, tratta dati personali per conto del Cliente ("Titolare del trattamento"), relativi a terzi (produttori, trasportatori, destinatari di rifiuti, dipendenti) i cui dati vengono inseriti nel Servizio dal Titolare.',
          'L\'art. 28 GDPR richiede che il rapporto Titolare–Responsabile sia disciplinato da contratto scritto. Il presente DPA integra i Termini di Servizio WasteFlow di cui costituisce parte integrante.',
        ],
      },
      {
        heading: '1. Oggetto e durata',
        content: [
          'Il DPA regola il trattamento di dati personali effettuato dal Responsabile per conto del Titolare nell\'ambito dell\'erogazione del Servizio WasteFlow.',
          'Durata: per tutta la durata del contratto principale. Alla cessazione si applicano le disposizioni sull\'eliminazione dei dati (art. 9 del presente DPA).',
        ],
      },
      {
        heading: '2. Categorie di dati e interessati',
        content: [
          'Dati trattati: dati anagrafici e identificativi (nome, cognome, CF, P.IVA, ragione sociale); dati di contatto (indirizzo, email, telefono); dati di autorizzazione ambientale (iscrizione Albo Gestori Ambientali); dati relativi ai rifiuti (CER, quantitativi, caratteristiche HP); targhe veicoli di trasporto.',
          'Interessati: rappresentanti di aziende produttrici; conducenti/operatori trasportatori; referenti di impianti di trattamento/smaltimento; dipendenti e collaboratori del Titolare.',
        ],
      },
      {
        heading: '3. Obblighi del Responsabile (art. 28.3 GDPR)',
        content: [
          'a) Trattamento solo su istruzione documentata del Titolare, salvo obbligo di legge.',
          'b) Riservatezza: il personale autorizzato è vincolato da impegno di riservatezza.',
          'c) Sicurezza (art. 32 GDPR): cifratura HTTPS/TLS ≥ 1.2; isolamento dati per tenant (PostgreSQL RLS); backup periodici; accesso con privilegio minimo; log di audit; gestione vulnerabilità.',
          'd) Sub-responsabili: autorizzati quelli elencati nell\'Allegato A; modifiche comunicate con 30 giorni di anticipo.',
          'e) Assistenza per diritti degli interessati (artt. 15–22 GDPR): inoltro al Titolare entro 5 giorni lavorativi.',
          'f) Assistenza per sicurezza, DPIA e notifica data breach (art. 33 GDPR).',
          'g) Cancellazione/restituzione dei dati a fine rapporto su richiesta del Titolare.',
          'h) Audit: messa a disposizione delle informazioni necessarie; preannuncio 30 giorni prima.',
        ],
      },
      {
        heading: '4. Notifica data breach',
        content: [
          'Il Responsabile notifica al Titolare qualsiasi violazione dei dati personali entro 48 ore dal rilevamento, con le informazioni disponibili (natura, categorie, numero di interessati, misure adottate).',
          'Il Responsabile assiste il Titolare nell\'adempimento dell\'obbligo di notifica al Garante (art. 33 GDPR, entro 72 ore) e di comunicazione agli interessati (art. 34 GDPR).',
        ],
      },
      {
        heading: '5. Conservazione a norma (rilevanza ambientale)',
        content: [
          'Registri di carico/scarico e FIR: conservazione minima 3 anni dall\'ultima registrazione (art. 190 D.Lgs 152/2006). Per operazioni di discarica: illimitato.',
          'La conservazione a norma AgID (CAD, D.Lgs 82/2005) presso un conservatore accreditato è responsabilità del Titolare. Il Servizio offre funzionalità di export; la piattaforma RENTRI non fornisce di default il servizio di conservazione sostitutiva legale.',
        ],
      },
      {
        heading: '6. Fine rapporto',
        content: [
          'Alla cessazione del contratto, il Responsabile fornisce export completo dei dati entro [X] giorni lavorativi su richiesta del Titolare, poi elimina in modo sicuro tutti i dati dai sistemi di produzione e dai backup.',
          'Su richiesta del Titolare, il Responsabile attesta per iscritto l\'avvenuta cancellazione.',
        ],
      },
      {
        heading: 'Allegato A — Sub-responsabili autorizzati',
        content: [
          'Contabo GmbH — Hosting VPS — Norimberga, Germania (UE) — nessun trasferimento extraSEE.',
          '[PROVIDER EMAIL TRANSAZIONALE] — Email di sistema — [sede] — [SCC se extraSEE].',
          '[PROVIDER PAGAMENTI] — Elaborazione pagamenti — [sede] — [SCC se extraSEE].',
          '[CONSERVATORE AGID, se attivato] — Conservazione digitale a norma — Italia.',
          'Modifiche all\'elenco saranno comunicate via email con almeno 30 giorni di anticipo.',
        ],
      },
    ],
  },
};

@Component({
  selector: 'app-legal-page',
  standalone: true,
  imports: [CommonModule, RouterModule],
  template: `
    <!-- Barra disclaimer -->
    <div class="legal-banner" role="note" aria-label="Avviso documento in bozza">
      <i class="pi pi-exclamation-triangle legal-banner__icon" aria-hidden="true"></i>
      <span>
        <strong>BOZZA — DA VALIDARE CON UN LEGALE</strong>
        &nbsp;·&nbsp; Questo documento non costituisce consulenza legale.
      </span>
    </div>

    <div class="legal-page" *ngIf="doc; else notFound">

      <!-- Intestazione documento -->
      <header class="legal-header">
        <a routerLink="/signup" class="legal-back">
          <i class="pi pi-arrow-left" aria-hidden="true"></i> Torna alla registrazione
        </a>
        <p class="legal-version">{{ doc.version }} &nbsp;·&nbsp; Aggiornato al {{ doc.updatedAt }}</p>
        <h1 class="legal-title">{{ doc.title }}</h1>
        <p class="legal-subtitle">{{ doc.subtitle }}</p>
        <hr class="legal-divider" />
      </header>

      <!-- Sezioni del documento -->
      <article class="legal-article">
        <section
          *ngFor="let section of doc.sections; let i = index"
          class="legal-section"
        >
          <h2 class="legal-section__heading">{{ section.heading }}</h2>
          <p
            *ngFor="let para of section.content"
            class="legal-section__para"
          >{{ para }}</p>
        </section>
      </article>

      <footer class="legal-footer">
        <p>
          {{ doc.version }} &nbsp;·&nbsp; Documento soggetto a revisione da parte di un legale
          qualificato prima della pubblicazione.
        </p>
        <p>
          Per informazioni: <a href="mailto:[EMAIL FORNITORE]" class="legal-link">[EMAIL FORNITORE]</a>
        </p>
      </footer>
    </div>

    <ng-template #notFound>
      <div class="legal-not-found">
        <p>Documento non trovato. <a routerLink="/" class="legal-link">Torna alla home</a></p>
      </div>
    </ng-template>
  `,
  styles: [`
    /* ── Banner disclaimer ─────────────────────────────────────── */
    .legal-banner {
      position: sticky;
      top: 0;
      z-index: 100;
      display: flex;
      align-items: center;
      gap: 0.75rem;
      padding: 0.75rem 1.5rem;
      background: #fef3c7;
      border-bottom: 1px solid #fbbf24;
      font-size: 0.875rem;
      color: #92400e;
    }
    .legal-banner__icon { color: #d97706; font-size: 1.1rem; flex-shrink: 0; }

    /* ── Pagina ────────────────────────────────────────────────── */
    .legal-page {
      max-width: 800px;
      margin: 0 auto;
      padding: 2rem 1.5rem 4rem;
    }

    /* ── Intestazione ──────────────────────────────────────────── */
    .legal-back {
      display: inline-flex;
      align-items: center;
      gap: 0.4rem;
      font-size: 0.875rem;
      font-weight: 600;
      color: #0d9488;
      text-decoration: none;
      margin-bottom: 1.5rem;
    }
    .legal-back:hover { color: #0f766e; text-decoration: underline; }

    .legal-version {
      font-size: 0.75rem;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      color: #ef4444;
      margin: 0 0 0.5rem;
    }
    .legal-title {
      font-size: clamp(1.5rem, 4vw, 2.25rem);
      font-weight: 700;
      letter-spacing: -0.02em;
      margin: 0 0 0.5rem;
      color: #0f172a;
      line-height: 1.2;
    }
    .legal-subtitle {
      font-size: 1rem;
      color: #475569;
      margin: 0 0 1.5rem;
    }
    .legal-divider {
      border: none;
      border-top: 1px solid #e2e8f0;
      margin: 0 0 2rem;
    }

    /* ── Sezioni ───────────────────────────────────────────────── */
    .legal-article { display: flex; flex-direction: column; gap: 2rem; }

    .legal-section__heading {
      font-size: 1rem;
      font-weight: 700;
      color: #0f172a;
      margin: 0 0 0.75rem;
      padding-bottom: 0.4rem;
      border-bottom: 2px solid #0d9488;
    }
    .legal-section__para {
      font-size: 0.9375rem;
      line-height: 1.7;
      color: #334155;
      margin: 0 0 0.6rem;
    }
    .legal-section__para:last-child { margin-bottom: 0; }

    /* ── Footer ────────────────────────────────────────────────── */
    .legal-footer {
      margin-top: 3rem;
      padding-top: 1.5rem;
      border-top: 1px solid #e2e8f0;
      font-size: 0.8125rem;
      color: #64748b;
    }
    .legal-footer p { margin: 0.25rem 0; }
    .legal-link { color: #0d9488; font-weight: 600; }
    .legal-link:hover { color: #0f766e; }

    /* ── Not found ─────────────────────────────────────────────── */
    .legal-not-found {
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 40vh;
      font-size: 1rem;
      color: #475569;
    }

    /* ── Responsive ────────────────────────────────────────────── */
    @media (max-width: 640px) {
      .legal-page { padding: 1rem 1rem 3rem; }
      .legal-banner { font-size: 0.8125rem; padding: 0.6rem 1rem; }
    }
  `],
})
export class LegalPageComponent implements OnInit {
  doc: LegalDoc | null = null;

  private readonly route = inject(ActivatedRoute);

  ngOnInit(): void {
    const page = this.route.snapshot.data['page'] as string;
    this.doc = DOCS[page] ?? null;
  }
}
