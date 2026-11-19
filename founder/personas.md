# WasteFlow · Personas per il panel da 50 compratori

Data: 18/11/2026. Bozza per il prossimo `/founder-consumer`. Il panel NON è stato lanciato.

## 0. Cosa è dato reale e cosa è ipotesi

**Dati reali (verificati o con fonte):**
- Nessun cliente, nessun contratto, nessun pilota, nessuna intervista. Al 09/09 risultano 8 tenant e 10 utenti di prova (board.md).
- Il software NON è accreditato RENTRI: oggi non trasmette registri e FIR. La firma non ha valore legale (nessun QTSP). Conservazione a norma assente (board.md).
- Il prodotto ha già: selettore clienti e dashboard "Tutti i clienti" per consulenti, ruoli e permessi per operatore, scadenze e alert su autorizzazioni dei trasportatori (docs/FEATURES.md §4.1, §4.6).
- 25 concorrenti, prezzi pubblici 69-430 €/anno per azienda, mediana 125 €. Per consulenti: RENTRI Suite 50-69 €/azienda/anno a scaglioni (listino di parte), Console QuiRifiutiPro 1.150 € per 50 licenze (competitors.md §5, §7).
- Portale RENTRI gratuito; FIR digitale obbligatorio dal 16/09/2026 (competitors.md §1-2).
- RENTRI al 31/10/2025: 164.711 operatori, 268.504 unità locali, 380.749 incaricati, **275 delegati**, 90.348 produttori non iscritti. Produttori per dimensione: 122.952 sotto 10 dipendenti, 74.880 fra 11 e 50, 48.111 oltre 50 ([Albo gestori, Ecomondo 2025, slide Gizzi](https://www.albonazionalegestoriambientali.it/Download/it/Eventi/Ecomondo%202025/PPT%20ECOMONDO%202025/2.Gizzi.pdf)).
- Panel precedente (simulato): 0 acquisti su 20. Motivi: fiducia 7, abitudine 7, prezzo 4, bisogno 2 (panel/results.md).

**Ipotesi (non verificate):**
- Che il consulente sia il canale verso le PMI (opinione del board, nessun consulente sentito).
- Che i 275 "delegati" RENTRI siano in gran parte associazioni di categoria e loro società di servizi. Il DM 59/2023 prevede la delega a questi soggetti, ma la slide non dettaglia chi sono.
- Tutte le dimensioni marcate "stima".

## 1. Chi compra, chi usa, chi decide, chi influenza

| Tipo | Chi compra (paga) | Chi usa | Chi decide | Chi influenza |
|---|---|---|---|---|
| Consulente ambientale / studio | il titolare dello studio | lui e i suoi tecnici; l'azienda cliente in sola lettura | il titolare, da solo | colleghi, corsi e convegni, associazioni dei consulenti, il fornitore attuale |
| Gruppo madre-figlie | la capogruppo (amministrazione) | responsabile ambiente/HSE, addetti di sede | direttore amministrativo o generale | il consulente ambientale del gruppo, l'IT (se c'è un ERP), chi fa il bilancio di sostenibilità |
| Associazione di categoria | la sede territoriale o la sua società di servizi | gli operatori dell'ufficio ambiente | direttore della sede, spesso la struttura nazionale o la giunta | la confederazione nazionale, le convenzioni già firmate, gli associati |
| Intermediario (scartato) | il titolare | lui e un'impiegata | il titolare | i trasportatori e gli impianti con cui lavora |
| Trasportatore (scartato) | il titolare | autisti e ufficio traffico | il titolare | il fornitore dell'ERP flotta, il consulente ADR |
| Impianto (scartato) | la direzione | pesa, accettazione, amministrazione | direzione e IT | fornitore dell'ERP (WinWaste, Waste 360) |
| Consorzio (scartato) | il consorzio | ufficio tecnico | consiglio di amministrazione | i consorziati |

## 2. Tipi non coperti dal panel precedente

- **Associazioni di categoria e loro società di servizi.** Il panel precedente non le aveva. Contano perché comprano per decine o centinaia di imprese con un solo contratto, e perché le piccole imprese (122.952 produttori sotto 10 dipendenti) delegano a loro. Rifiutoo, Prometeo, RifiutiGuru, QuiRifiutiPro Console e GoRENTRI Partner già le citano come target (competitors.md §3): è il canale che gli incumbent presidiano.
- **Consulenti come tipo a sé.** Prima erano il 25% di un panel su gruppi, con un pitch scritto per la capogruppo. Il board indica il consulente multi-azienda come "versione più forte" (board.md §5), ma non è mai stato testato con un pitch suo.

## 3. Schede per tipo

### 3.1 Consulente ambientale / studio (sotto-panel 25)
- **Mercato:** stima 3.000-8.000 studi e professionisti che tengono registri per terzi. Nessuna fonte trovata (il "5.000-8.000" dei documenti interni non ha fonte). Gli incaricati RENTRI sono 380.749, ma includono i dipendenti delle aziende.
- **Budget:** stima 200-15.000 €/anno per strumenti, secondo la dimensione.
- **Come compra:** demo o prova, decisione del titolare in 2-6 settimane. Cambia fornitore a inizio anno, non a metà, perché migrare i clienti è rischioso.
- **Dolore:** entrare nel portale per ogni cliente, una azienda alla volta; scadenze sparse fra Excel e agenda.
- **Obiezioni:** senza trasmissione a RENTRI deve ribattere tutto sul portale; RENTRI Suite a 50-69 €/azienda; incumbent con piani consulenti; rischio sanzioni per il cliente.
- **Alternativa oggi:** portale come incaricato, Rifiutoo consulenti, Console QuiRifiutiPro, RENTRI Suite, Excel.

### 3.2 Gruppo madre-figlie (sotto-panel 15)
- **Mercato:** ISTAT conta circa 99.000 gruppi d'impresa con circa 220.000 imprese ([Istat](https://www.istat.it/it/archivio/234313); anno del dato da verificare sul comunicato). Quelli con almeno due società obbligate a RENTRI: stima 8.000-20.000.
- **Budget:** 300-30.000 €/anno per software ambientali (stima, come panel precedente).
- **Come compra:** proposta del responsabile ambiente, approvazione dell'amministrazione; 1-3 mesi; spesso passa dal consulente.
- **Dolore:** raccogliere i registri delle sedi via email; nessuna vista d'insieme; riepilogo per la sostenibilità fatto a mano.
- **Obiezioni:** doppio inserimento con ERP o portale; 1.200 € contro 69-430 € per azienda; controllo della capogruppo solo "vista"; nessuna referenza.
- **Alternativa oggi:** portale per ogni società, un gestionale per società, modulo ERP, consulente.

### 3.3 Associazione di categoria / società di servizi (sotto-panel 10)
- **Mercato:** 275 delegati RENTRI al 31/10/2025 (fonte Albo sopra). Le sedi territoriali di associazioni artigiane, del commercio, dell'industria e dell'agricoltura sono stima 500-1.500 in Italia; solo una parte offre il servizio rifiuti.
- **Budget:** stima 1.000-30.000 €/anno per il software del servizio; pressione a stare sotto 20-40 € per impresa, perché il servizio si rivende agli associati.
- **Come compra:** spesso decide la struttura nazionale con una convenzione; a livello di sede servono preventivo, confronto e giunta. Tempi 3-9 mesi.
- **Dolore:** lavoro a mano per decine di micro imprese, picchi di scadenze, blocchi del portale (febbraio 2026).
- **Obiezioni:** convenzione nazionale già firmata; dati di centinaia di associati su un fornitore nuovo; decisione non locale; assistenza nei picchi.
- **Alternativa oggi:** portale come delegato, convenzione con Rifiutoo, Namirial Partner, Buffetti/Dylog.

## 4. Proposta di suddivisione dei 50

| Sotto-panel | Compratori | Perché |
|---|---:|---|
| `panel50/consulenti` | 25 | È il beachhead indicato dal board e il tipo meno testato. Con 25 le letture per segmento (3) e per comportamento (6) non sono tutte "thin". |
| `panel50/gruppi` | 15 | Ritest dell'idea madre-figlie con un pitch onesto sull'accreditamento. Bastano 15: il panel precedente ha già dato 0/20, serve solo vedere se cambia qualcosa. |
| `panel50/associazioni` | 10 | Tipo nuovo, canale con un solo contratto per molte imprese. 10 bastano a far emergere le obiezioni; un esito positivo va verificato con 2-3 sedi vere. |

## 5. Tipi scartati e perché

- **Intermediari (categoria 8 Albo).** Mercato piccolo (numero ufficiale non trovato; stima 2.000-5.000). Gestiscono FIR per conto terzi ma senza detenzione: serve un flusso diverso, non presente nel prodotto.
- **Trasportatori (categorie 4 e 5).** Numero non trovato (stima decine di migliaia). Servono app per autisti e geolocalizzazione dei mezzi (rinviata al 13/09/2027): l'app mobile non esiste ed è congelata.
- **Impianti di trattamento e recupero.** 10.763 impianti operativi ([ISPRA, Rapporto rifiuti speciali 2023](https://www.isprambiente.gov.it/files2023/pubblicazioni/rapporti/rapportorifiutispeciali_ed-2023_n-389_versioneintegrale.pdf), dati 2021). Usano ERP verticali (WinWaste, Waste 360) con pesa, contabilità e magazzino; la pesa di WasteFlow è congelata.
- **Consorzi** (di filiera come CONAI e i consorzi di materiale, o di raccolta). Non tengono i registri delle imprese aderenti e hanno sistemi propri. I consorzi di servizi legati alle associazioni sono già inclusi nel sotto-panel associazioni.

## 6. Prezzi usati nei pitch

- **Gruppi:** 1.200 €/anno fino a 5 società, 150 € per ogni società in più, primo mese gratuito. Già nel pitch precedente (pitch.md), riusato senza modifiche.
- **Consulenti: DA DECIDERE.** I documenti dicono "0 € fino a 5 clienti, poi 19 € per cliente" senza il periodo (STRATEGIA_MARKETING_EXECUTIVE.md). Se fosse mensile, sarebbe 228 €/anno per azienda, 3-4 volte RENTRI Suite. Proposta nel pitch: **prime 5 aziende gratuite, poi 59 €/anno per azienda**, allineato allo scaglione centrale di RENTRI Suite.
- **Associazioni: DA DECIDERE.** Nessun prezzo nei documenti. Proposta nel pitch: stesso listino dei consulenti (5 gratuite, poi 59 €/anno per impresa). Rischio: le associazioni chiedono 20-40 € per impresa.
- **Offerta di apertura, uguale per tutti:** primo mese gratuito e import dei dati a cura di WasteFlow. Riusata dal pitch precedente.

## 7. Cosa cambia rispetto al pitch precedente

Il pitch precedente diceva "Registri e FIR trasmessi a RENTRI dal software". Oggi non è vero: il software non è accreditato. Tutti i nuovi pitch dicono che WasteFlow prepara e controlla registri e FIR, e che la trasmissione resta sul portale fino all'accreditamento. Il panel misurerà quindi il prodotto di oggi, non quello promesso.
