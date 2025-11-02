# STRATEGIA DI CONTROLLO PROFILI - WasteFlow Marketing

**Data creazione**: 31 Ottobre 2025
**Obiettivo**: Sistema operativo per tracciare e controllare 107 profili consulenti + attività marketing

---

## 🎯 OVERVIEW

**Problema**: Database completo (107 profili) ma nessun sistema di tracciamento operativo
**Soluzione**: Google Sheets centralizzato + processo settimanale + checklist operative

---

## 📊 SISTEMA DI TRACCIAMENTO GOOGLE SHEETS

### Setup Iniziale (2 ore)

**PASSO 1**: Crea nuovo Google Spreadsheet
- Nome: `WasteFlow - Marketing Tracking Master`
- Link: [INSERIRE LINK DOPO CREAZIONE]

**PASSO 2**: Crea 6 Tab

#### TAB 1: OUTREACH TRACKING 📞

**Colonne**:
| ID | Nome | Tipo | Priorità | Regione | LinkedIn | Email | Sito | Contacted | Data | Canale | Risposta | Data Risp | Demo | Data Demo | Trial | Cliente | MRR | Note |

**Legenda Status**:
- ⏳ In attesa risposta
- ✅ Risposta positiva
- ❌ No/Non interessato
- 🔄 Follow-up needed (7gg+)
- 📅 Demo schedulato
- 🎯 Trial attivo
- 💰 Cliente pagante

**Auto-formulas** (riga sotto header):
```
=COUNTIF(I:I,"✅")  // Risposte positive
=COUNTIF(J:J,"<>") / COUNTIF(I:I,"<>")  // Response rate %
=COUNTIF(N:N,"📅")  // Demo bookati
=SUM(R:R)  // MRR totale
```

**Conditional Formatting**:
- Priorità ⭐⭐⭐ → Background giallo
- Risposta ✅ → Background verde chiaro
- Follow-up 🔄 → Background arancione
- Cliente 💰 → Background verde scuro

---

#### TAB 2: LINKEDIN POST PERFORMANCE 📱

**Colonne**:
| Post # | Data Pubb | Titolo | Formato | Impression | Like | Commenti | Share | Click | Engagement Rate | vs Target | Note |

**Formati**:
- Text-only
- Text + Image
- Carousel (5-8 slide)
- Video (<2 min)
- Poll

**Auto-formulas**:
```
Engagement Rate = (Like + Commenti*2 + Share*3) / Impression
vs Target = Impression / 400 * 100%  // Target baseline 400 impression/post
```

**Benchmark Targets**:
- Impression: 200-500/post (fase iniziale <500 follower)
- Engagement rate: 3-5%
- Click-through: 1-2%
- Follower growth: +10-20/settimana

---

#### TAB 3: LEAD FUNNEL 🎯

**Colonne**:
| Sorgente | Visite Landing | Download Guida | Trial Signup | Demo Call | Paid Cliente | Conversion % | MRR | Note |

**Sorgenti da tracciare**:
- LinkedIn Organic
- SEO Organic (Google)
- Partnership Consulenti
- Direct / Word-of-mouth
- Email Outreach
- (Future: LinkedIn Ads, Google Ads)

**Auto-formulas**:
```
Conversion % = Paid Cliente / Visite Landing * 100%
MRR per Source = COUNT(Paid Cliente) * 49€  // Piano base
```

**Obiettivi M1**:
- 500 visite landing
- 50 download guida (10% conv)
- 15 trial signup (3% conv)
- 5 demo call (1% conv)
- 2 clienti paganti (0.4% conv)

---

#### TAB 4: KPI DASHBOARD 📈

**Struttura**:
| Metrica | Questo Mese | Mese Scorso | Target Mese | % vs Target | Trend | Note |

**Metriche da tracciare**:

**ACQUISITION**:
- Visite sito totali (GA4)
- Visite organiche Google (GSC)
- Download guida RENTRI
- LinkedIn follower totali
- YouTube subscribers (quando attivo)

**ENGAGEMENT**:
- LinkedIn connection acceptance rate
- Email open rate outreach
- Email reply rate
- Demo booking rate (demo / contattati)
- Blog post avg time on page

**CONVERSION**:
- Trial signup (totali)
- Trial → Paid conversion %
- MRR
- Churn rate
- CAC per canale (se budget speso)

**CONTENT**:
- Post LinkedIn pubblicati/mese
- Avg engagement rate post
- Blog post pubblicati
- Keywords Google top 20
- Video pubblicati

**Color coding** (Conditional Formatting):
- ✅ Verde: >100% target
- 🟡 Giallo: 50-99% target
- 🔴 Rosso: <50% target

---

#### TAB 5: CALENDARIO EDITORIALE 📅

**Colonne**:
| Data | Giorno | Canale | Tipo | Titolo/Topic | Status | Owner | Link Published | Impression | Engagement | Note |

**Status**:
- 💡 Idea
- 📝 Draft
- ✏️ Review
- 📅 Scheduled
- ✅ Published
- ⚠️ Late (se data < oggi e status ≠ published)

**Canali**:
- LinkedIn (Personal Founder)
- LinkedIn (Company Page)
- Blog WasteFlow
- YouTube
- Email Newsletter

**Planning Window**: Minimo 2 settimane in anticipo

**Cadenza Target**:
- LinkedIn: 3 post/settimana (Lun/Mer/Ven)
- Blog: 1 articolo/settimana
- YouTube: 1 video/2 settimane
- Email: 1 newsletter/mese

---

#### TAB 6: WEEKLY REVIEW 📋

**Template** (copiare ogni Venerdi):

```
=============================================================
SETTIMANA: [Data inizio] - [Data fine]
=============================================================

🎯 OBIETTIVI SETTIMANA (set Lunedi):
- [ ] Obiettivo 1
- [ ] Obiettivo 2
- [ ] Obiettivo 3
- [ ] Obiettivo 4
- [ ] Obiettivo 5

📊 NUMERI CHIAVE:
Visite sito: [N] (+/- [N] vs settimana scorsa)
Download guida: [N] (+/- [N])
LinkedIn connections nuovi: +[N]
LinkedIn posts pubblicati: [N]/3
Demo call: [N] bookati, [N] completati
Trial signup: [N] nuovi
Clienti paganti: +[N]
MRR: [€] (+/- [€])

✅ WINS DELLA SETTIMANA:
1. [Win 1 - specifica]
2. [Win 2]
3. [Win 3]

⚠️ CHALLENGES & BLOCKERS:
1. [Challenge 1 - specifica + root cause]
2. [Challenge 2]
   → Action: [Cosa fai per risolvere]

🔄 PRIORITÀ PROSSIMA SETTIMANA:
1. [Priorità 1 - SMART goal]
2. [Priorità 2]
3. [Priorità 3]
4. [Priorità 4]
5. [Priorità 5]

💡 INSIGHTS / LESSONS LEARNED:
- [Insight 1 - cosa hai imparato, cosa replichi, cosa eviti]
- [Insight 2]

📞 FOLLOW-UP NEEDED:
- [Nome consulente] - [Azione specifica] - [Deadline]
- [Nome consulente] - [Azione specifica] - [Deadline]

=============================================================
Compilato da: [Nome]
Next review: [Data prossimo Venerdi]
=============================================================
```

---

## 🔄 PROCESSO SETTIMANALE

### LUNEDÌ (2h) - Planning & Outreach Start

**09:00-10:00 - Review & Planning**:
- [ ] Leggi Weekly Review settimana scorsa (5 min)
- [ ] Check KPI Dashboard: numeri vs target (10 min)
- [ ] Definisci 5 obiettivi settimana (15 min)
- [ ] Update Calendario Editoriale: post settimana (20 min)
- [ ] Identifica top 10 consulenti da contattare (10 min)

**10:00-11:00 - LinkedIn Outreach**:
- [ ] Invia 10 connection request personalizzati (40 min)
- [ ] Update Tab 1 Outreach Tracking (10 min)
- [ ] Rispondi a tutti messaggi/commenti LinkedIn (10 min)

**11:00-12:00 - Content Publishing**:
- [ ] Pubblica Post LinkedIn #1 settimana (20 min)
- [ ] Engagement boost: rispondi commenti, chiedi a team di like (40 min)

---

### MARTEDÌ (2h) - Content Creation

**09:00-11:00 - Scrittura Content**:
- [ ] Scrivi draft Post LinkedIn #2 (1h)
- [ ] Scrivi draft blog post o Cap. guida RENTRI (1h)

**11:00-12:00 - Email Outreach**:
- [ ] Invia 5 email studi consulenza (40 min)
- [ ] Update Tab 1 Outreach Tracking (10 min)
- [ ] Rispondi a reply email precedenti (10 min)

---

### MERCOLEDÌ (2-3h) - Visual Creation & Demo

**09:00-11:00 - Visual Content**:
- [ ] Crea visual Canva per Post #2 (carousel/image) (1.5h)
- [ ] Prepara visual Post #3 (30 min)

**11:00-12:00 - Publishing**:
- [ ] Pubblica Post LinkedIn #2 (20 min)
- [ ] Engagement boost (40 min)

**14:00-15:00 - Demo Call** (se scheduled):
- [ ] Demo call con prospect (1h)
- [ ] Follow-up email post-demo (15 min)

---

### GIOVEDÌ (2h) - Blog & SEO

**09:00-11:00 - Blog Finalization**:
- [ ] Finalizza blog post (1h)
- [ ] SEO optimization: keywords, meta, internal links (30 min)
- [ ] Pubblica blog (30 min)

**11:00-12:00 - LinkedIn Follow-up**:
- [ ] Check connection accepted: invia First Message con guida (30 min)
- [ ] Follow-up 7gg no-response (template soft reminder) (20 min)
- [ ] Commenta 5 post LinkedIn di consulenti target (10 min)

---

### VENERDÌ (2h) - Publishing & Review

**09:00-10:00 - Content Publishing**:
- [ ] Pubblica Post LinkedIn #3 (20 min)
- [ ] Engagement boost (40 min)

**10:00-11:30 - Weekly Review**:
- [ ] Update Tab 2 LinkedIn Post Performance (15 min)
- [ ] Update Tab 3 Lead Funnel (10 min)
- [ ] Update Tab 4 KPI Dashboard (20 min)
- [ ] Compila Tab 6 Weekly Review template (30 min)
- [ ] Identifica quick wins prossima settimana (15 min)

**11:30-12:00 - Calendario Planning**:
- [ ] Schedule post settimana prossima su Buffer (15 min)
- [ ] Plan topic settimana prossima (15 min)

---

### SABATO-DOMENICA (Optional 2-4h) - Research & Prep

**Sabato (2h)**:
- [ ] LinkedIn research: identifica 20 nuovi consulenti target (1h)
- [ ] Aggiungi profili a Tab 1 database (30 min)
- [ ] Leggi industry news / competitor analysis (30 min)

**Domenica (2h)**:
- [ ] Brainstorm content ideas mese prossimo (1h)
- [ ] Prepara bozze post settimana prossima (1h)

---

**TOTALE TEMPO SETTIMANALE**: 12-16 ore/settimana

---

## 🚨 ALERT SYSTEM

### Alert Automatici (Check ogni Venerdi)

#### 🔴 ALERT ROSSO - Azione Immediata Richiesta

**Trigger 1: MRR < 50% Target Mid-Month**
- Se a giorno 15 del mese MRR < 50% target mensile
- **Azione**: Analizza funnel. Problema top (lead gen) o bottom (conversion)?
- **Owner**: Founder
- **Deadline**: 48h analisi + piano correzione

**Trigger 2: Trial → Paid Conversion < 15%**
- Media ultimi 30gg conversione trial
- **Azione**: Intervista trial che hanno churnato. Identifica blocchi onboarding.
- **Owner**: Product/Founder
- **Deadline**: 5 giorni (1 intervista/giorno)

**Trigger 3: Outreach Reply Rate < 5%**
- Ultimi 50 contatti
- **Azione**: Messaging non funziona. A/B test 2 varianti subject/copy.
- **Owner**: Marketing
- **Deadline**: 3 giorni setup test

**Trigger 4: Churn Rate > 10%**
- Clienti paganti che hanno cancellato / totale
- **Azione**: Exit interview obbligatoria. Identifica pattern. Problema prodotto?
- **Owner**: Product + CS
- **Deadline**: Immediate (entro 24h da churn)

---

#### 🟡 ALERT GIALLO - Attenzione & Monitoring

**Trigger 1: LinkedIn Engagement Rate < 2%**
- Media ultimi 5 post
- **Azione**: Content quality issue. Testa format diversi (carousel vs video).
- **Owner**: Marketing
- **Deadline**: 7 giorni

**Trigger 2: Demo Booking Rate < 5%**
- Demo bookati / contatti totali
- **Azione**: Top funnel issue (lead quality bassa) o CTA debole.
- **Owner**: Sales
- **Deadline**: 7 giorni

**Trigger 3: Download Guida < 50% Target Mid-Month**
- A giorno 15, download < 25 (target 50/mese)
- **Azione**: Traffic basso o conversion landing page bassa.
- **Owner**: Marketing
- **Deadline**: 5 giorni

**Trigger 4: Blog Production Behind Schedule**
- Post in ritardo >7 giorni vs calendario
- **Azione**: Riallocate risorse o abbassa target (2 post/mese invece 4).
- **Owner**: Content lead
- **Deadline**: 48h

---

#### ✅ GREEN FLAG - Celebra & Scale

**Trigger 1: MRR Growth > 50% MoM**
- Month-over-month growth
- **Azione**: Identifica cosa ha funzionato. RADDOPPIA.
- **Owner**: Founder
- **Celebration**: Team shoutout + retrospective "What worked"

**Trigger 2: Viral Post (>1.000 Impression)**
- Post singolo supera 1.000 impression
- **Azione**: Analizza: format? topic? timing? Replica schema.
- **Owner**: Marketing
- **Celebration**: Screenshot + share con team

**Trigger 3: Inbound Partnership Request**
- Consulente/studio contatta spontaneamente
- **Azione**: Fast-track. Risposta entro 4h. Demo entro 48h.
- **Owner**: Sales/Founder
- **Celebration**: Case study post-closing

**Trigger 4: Testimonial/Review 5 Stelle**
- Cliente lascia review positiva spontanea
- **Azione**: Chiedi permesso uso marketing. Create social proof asset.
- **Owner**: Marketing + CS
- **Celebration**: Thank you gift cliente (Amazon voucher 50€?)

---

## 📊 IMPORT DATABASE CONSULENTI

### Setup Iniziale Tab 1

**Step 1**: Copia header row:
```
ID | Nome | Tipo | Priorità | Regione | LinkedIn | Email | Sito | Contacted | Data | Canale | Risposta | Data Risp | Demo | Data Demo | Trial | Cliente | MRR | Note
```

**Step 2**: Import top 20 profili Alta Priorità (⭐⭐⭐)

**Da file**: `marketing/05-partnership/database-consulenti-ESTESO-100plus.md`

**Profili Priority 1 (primi 10)**:
1. Ing. Diego Moretti - RT Albo Gestori
2. Prof. Stefano Maglia - TuttoAmbiente
3. Valli Gestioni Ambientali - Bergamo
4. ESAL S.r.l. - Brescia
5. Proteko - Multi-sede
6. TEA Consulting - Milano
7. SEN Sistemi - Verona
8. Studio Ambientale Monza
9. EcoGestioni - Torino
10. Ambiente Plus - Padova

**Step 3**: Per ogni profilo, compila:
- ID: 001, 002, 003...
- Nome: [Nome da database]
- Tipo: Individuale / Studio Piccolo / Studio Medio / Studio Grande
- Priorità: ⭐⭐⭐ / ⭐⭐ / ⭐
- Regione: [Da database]
- LinkedIn: [URL se trovato, altrimenti "DA CERCARE"]
- Email: [Da database o "info@[sitoweb].it"]
- Sito: [URL]
- Contacted: [Vuoto inizialmente]
- Resto: [Vuoto, compilerai man mano]

**Step 4**: Import graduale
- Settimana 1: Top 20 (⭐⭐⭐)
- Settimana 2-4: Altri 30 (⭐⭐⭐ + ⭐⭐)
- Mese 2: Completare 107 profili

---

## 🎯 STRATEGIA CONTROLLO PROFILI

### Definizione "Controllo Profilo"

Per ogni profilo nel database, "controllato" significa:

**FASE 1: RESEARCH COMPLETATA** ✅
- [ ] LinkedIn profile trovato e analizzato
- [ ] Sito web visitato e servizi mappati
- [ ] Email/telefono verificati
- [ ] Google News search completato (content creator?)
- [ ] Competitor check (usa già software?)
- [ ] Note dettagliate in colonna "Note" spreadsheet

**FASE 2: PRIMO CONTATTO INVIATO** 📤
- [ ] Connection request LinkedIn inviato (con copy personalizzato)
- [ ] O email inviata (se no LinkedIn)
- [ ] Data contatto tracked
- [ ] Canale tracked (LinkedIn/Email)
- [ ] Status: ⏳ In attesa

**FASE 3: FOLLOW-UP GESTITO** 🔄
- [ ] Se no risposta dopo 7gg: Follow-up inviato
- [ ] Se risposta ✅: First message value inviato (guida RENTRI)
- [ ] Se risposta ❌: Marked e archiviate note (reattempt in 6 mesi?)
- [ ] Se demo bookato 📅: Prep demo personalizzata

**FASE 4: CONVERSIONE TRACCIATA** 💰
- [ ] Demo completato: Note pain points, objections
- [ ] Trial attivato: Onboarding call scheduled
- [ ] Cliente pagante: Success metrics defined
- [ ] MRR tracked
- [ ] Case study potential identified

---

### KPI "Profili Controllati"

**Target Settimanale**: 10 profili/settimana research + 10 contatti/settimana

**Tracking**:
```
Profili Controllati (%) = (Profili con "Research completata" + Contacted) / 107 * 100%
```

**Milestone**:
- Settimana 1: 10% (11 profili)
- Settimana 2: 20% (21 profili)
- Settimana 4: 40% (43 profili)
- Mese 2: 70% (75 profili)
- Mese 3: 100% (107 profili)

**Visual Progress** (in Tab 4 KPI Dashboard):
- Progress bar con conditional formatting
- Colore verde se on-track
- Colore giallo se <5% behind
- Colore rosso se >10% behind vs timeline

---

## 🛠️ TOOLS RACCOMANDATI

### Core Stack (Free)

| Funzione | Tool | Note |
|----------|------|------|
| **Tracking Master** | Google Sheets | Dashboard centrale |
| **Task Management** | Todoist/Trello Free | Checklist giornaliere |
| **Social Scheduling** | Buffer Free | 3 post, 3 account |
| **Analytics Web** | Google Analytics 4 | Visite, funnel |
| **SEO Tracking** | Google Search Console | Keywords, impression |
| **CRM** | HubSpot Free | Contact management |
| **Email Tracking** | Mailtrack Gmail | Open tracking |
| **Demo Booking** | Calendly Free | 1 evento type |
| **Form Lead** | Tally.so Free | Unlimited forms |

### Automazioni (Optional)

**Zapier/Make.com (Free tier)**:
- GA4 → Google Sheets (auto-update visite settimanali)
- LinkedIn Lead Gen Form → Google Sheets
- Calendly booking → Slack notification
- HubSpot deal won → Google Sheets MRR update

**Time saved**: 2-3h/settimana manual data entry

---

## 📋 CHECKLIST SETUP COMPLETO

### Fase 1: Setup Spreadsheet (2h)
- [ ] Crea Google Sheet "WasteFlow Marketing Tracking Master"
- [ ] Crea 6 tab (Outreach, LinkedIn, Funnel, KPI, Calendario, Weekly Review)
- [ ] Setup formulas Tab 4 KPI Dashboard
- [ ] Setup conditional formatting (colori status)
- [ ] Import top 20 profili consulenti in Tab 1
- [ ] Condividi spreadsheet con team (Editor access)

### Fase 2: Setup Tools (1h)
- [ ] Attiva Google Analytics 4 su sito (se non già fatto)
- [ ] Attiva Google Search Console
- [ ] Setup Buffer account (schedule post)
- [ ] Setup HubSpot CRM Free (import 20 consulenti)
- [ ] Setup Mailtrack Gmail (email tracking)
- [ ] Setup Calendly (demo booking link)

### Fase 3: Primo Ciclo Test (1 settimana)
- [ ] Compila primo Weekly Review (anche se settimana parziale)
- [ ] Track primo 10 outreach
- [ ] Track primo 3 post LinkedIn
- [ ] Update KPI Dashboard
- [ ] Identifica pain points processo
- [ ] Aggiusta template/processo se necessario

### Fase 4: Routine Consolidata (Settimana 2-4)
- [ ] Segui processo settimanale (Lun-Ven schedule)
- [ ] Compila Weekly Review ogni Venerdi
- [ ] Monthly review fine mese (2h)
- [ ] Iterate su cosa funziona / cosa no

---

## 🎓 TRAINING & ONBOARDING

### Per Founder/Marketing Lead (Primary User)

**Sessione 1 (1h) - Introduzione Spreadsheet**:
- Walkthrough 6 tab: scopo, come compilare
- Demo: Tracciare un profilo da zero a cliente
- Pratica: Inserisci 5 profili e traccia 3 outreach

**Sessione 2 (30 min) - Processo Settimanale**:
- Walkthrough calendario Lun-Ven
- Compila primo Weekly Review insieme
- Setup reminder calendario (Google Calendar eventi ricorrenti)

**Sessione 3 (30 min) - Alert & Optimization**:
- Come leggere KPI Dashboard
- Quando scattano alert (rosso/giallo/verde)
- Come iterare su cosa funziona

**Totale training**: 2 ore

### Per Team Member (Secondary User)

**Quick Start (15 min)**:
- Tab 1: Come aggiungere profili
- Tab 5: Come schedulare content
- Tab 6: Come leggere Weekly Review

---

## 📈 SUCCESS METRICS

### Settimana 1 (Post-Setup)
- ✅ Spreadsheet operativo e popolato (20 profili)
- ✅ Primo 10 outreach tracked
- ✅ Primo Weekly Review compilato
- ✅ Team trained (se applicabile)

### Mese 1
- ✅ 40 profili controllati (37%)
- ✅ 30 outreach inviati
- ✅ 12 post LinkedIn tracked
- ✅ 4 Weekly Review compilati
- ✅ First iteration processo (cosa aggiustare)

### Mese 3
- ✅ 107 profili controllati (100%)
- ✅ 80+ outreach inviati
- ✅ 36 post LinkedIn tracked
- ✅ 12 Weekly Review compilati
- ✅ Processo ottimizzato e scalabile

---

## 🚀 PROSSIMI STEP IMMEDIATI

### OGGI (2h)
1. [ ] Crea Google Sheet "WasteFlow Marketing Tracking Master"
2. [ ] Setup Tab 1 Outreach Tracking (header + conditional formatting)
3. [ ] Import 10 profili consulenti ⭐⭐⭐
4. [ ] Invia 3 connection request LinkedIn (test processo)
5. [ ] Track in spreadsheet

### DOMANI (2h)
6. [ ] Completa setup Tab 2-6 spreadsheet
7. [ ] Import altri 10 profili
8. [ ] Invia altri 5 outreach
9. [ ] Setup Buffer/Calendly

### SETTIMANA 1 (12h)
10. [ ] Compila primo Weekly Review (Venerdi)
11. [ ] Completa 40 profili in spreadsheet
12. [ ] Invia 20 outreach totali
13. [ ] Track 3 post LinkedIn
14. [ ] Team training (se applicabile)

---

**DONE = Hai sistema operativo per gestire 107 profili + marketing scaling** 🎯

---

## 📞 SUPPORTO

**Domande?**
1. Rileggi sezione rilevante questo doc
2. Check esempio in Weekly Review template
3. Chiedi in team (se applicabile)

**File correlati**:
- `marketing/00-piano-azioni/azioni-costo-zero.md` - Strategia generale
- `marketing/05-partnership/database-consulenti-ESTESO-100plus.md` - 107 profili
- `marketing/01-content/social-media/linkedin-posts-organici.md` - Content plan

---

**Documento creato da**: Claude (Social Media Sales Expert)
**Ultima modifica**: 31 Ottobre 2025
**Versione**: 1.0
**Status**: ✅ PRONTO PER IMPLEMENTAZIONE

**GOOD LUCK! 🚀**
