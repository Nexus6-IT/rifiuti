/**
 * Script di build per il catalogo CER/EER completo (842 voci).
 * Fonte: Decisione 2000/532/CE, modificata dalla Decisione 2014/955/UE,
 * recepita in Italia dall'Allegato D alla Parte IV del D.Lgs. 152/2006.
 *
 * Uso: node prisma/build-complete-cer.js
 * Scopo: aggiunge le voci mancanti all'esistente cer-codes-ispra.csv
 *        e riscrive il file con il catalogo completo, ordinato per codice.
 */

const fs = require('fs')
const path = require('path')

// ============================================================================
// Voci MANCANTI dall'esistente cer-codes-ispra.csv (497 voci)
// Format: [code_con_asterisco_se_pericoloso, description]
// Categorie completamente assenti: 04, 05, 07, 09, 11
// Sottocategorie mancanti: resto del cap.10, codici "99" in molti capitoli
// ============================================================================

const NUOVE_VOCI = [
  // --------------------------------------------------------------------------
  // CAPITOLO 01 — codici 99 mancanti
  // --------------------------------------------------------------------------
  ['01 03 99', 'rifiuti non specificati altrimenti'],
  ['01 04 99', 'rifiuti non specificati altrimenti'],
  ['01 05 99', 'rifiuti non specificati altrimenti'],

  // --------------------------------------------------------------------------
  // CAPITOLO 02 — codici 99 mancanti
  // --------------------------------------------------------------------------
  ['02 01 99', 'rifiuti non specificati altrimenti'],
  ['02 02 99', 'rifiuti non specificati altrimenti'],
  ['02 03 99', 'rifiuti non specificati altrimenti'],
  ['02 04 99', 'rifiuti non specificati altrimenti'],
  ['02 05 99', 'rifiuti non specificati altrimenti'],
  ['02 06 99', 'rifiuti non specificati altrimenti'],
  ['02 07 99', 'rifiuti non specificati altrimenti'],

  // --------------------------------------------------------------------------
  // CAPITOLO 03 — codice 99 mancante
  // --------------------------------------------------------------------------
  ['03 03 99', 'rifiuti non specificati altrimenti'],

  // --------------------------------------------------------------------------
  // CAPITOLO 04 — Rifiuti della lavorazione di pelli e pellicce e dell'industria tessile
  // --------------------------------------------------------------------------
  ['04 01 01', 'carniccio e rifiuti di calce'],
  ['04 01 02', 'rifiuti di calcinazione'],
  ['04 01 03*', 'bagni di sgrassatura esauriti contenenti solventi senza fase liquida'],
  ['04 01 04', 'liquido di concia contenente cromo'],
  ['04 01 05', 'liquido di concia non contenente cromo'],
  ['04 01 06', 'fanghi prodotti dal trattamento in loco degli effluenti contenenti cromo'],
  ['04 01 07', 'fanghi prodotti dal trattamento in loco degli effluenti non contenenti cromo'],
  ['04 01 08', 'cuoio conciato contenenti cromo (scarti di taglio rifili e polveri)'],
  ['04 01 09', 'rifiuti delle operazioni di confezionamento e finitura'],
  ['04 01 99', 'rifiuti non specificati altrimenti'],
  ['04 02 09', 'rifiuti da materiali compositi (fibre impregnate tessili rivestiti plastificati)'],
  ['04 02 10', 'materiale organico proveniente da prodotti naturali (grassi cere)'],
  ['04 02 14*', 'rifiuti provenienti da operazioni di finitura contenenti solventi organici'],
  ['04 02 15', 'rifiuti da operazioni di finitura diversi da quelli di cui alla voce 04 02 14'],
  ['04 02 16*', 'tinture e pigmenti contenenti sostanze pericolose'],
  ['04 02 17', 'tinture e pigmenti diversi da quelli di cui alla voce 04 02 16'],
  ['04 02 19*', 'fanghi prodotti dal trattamento in loco degli effluenti contenenti sostanze pericolose'],
  ['04 02 20', 'fanghi prodotti dal trattamento in loco degli effluenti diversi da quelli di cui alla voce 04 02 19'],
  ['04 02 21', 'rifiuti da fibre tessili grezze'],
  ['04 02 22', 'rifiuti da fibre tessili lavorate'],
  ['04 02 99', 'rifiuti non specificati altrimenti'],

  // --------------------------------------------------------------------------
  // CAPITOLO 05 — Rifiuti della raffinazione del petrolio, purificazione del
  //               gas naturale e trattamento pirolitico del carbone
  // --------------------------------------------------------------------------
  ['05 01 02*', 'fanghi da processi di dissalazione'],
  ['05 01 03*', 'morchie depositate sul fondo dei serbatoi'],
  ['05 01 04*', 'fanghi acidi prodotti da processi di alchilazione'],
  ['05 01 05*', 'perdite di olio'],
  ['05 01 06*', 'fanghi oleosi prodotti dalla manutenzione di impianti e apparecchiature'],
  ['05 01 07*', 'catrami acidi'],
  ['05 01 08*', 'altri catrami'],
  ['05 01 09*', 'fanghi prodotti dal trattamento in loco degli effluenti contenenti sostanze pericolose'],
  ['05 01 10', 'fanghi prodotti dal trattamento in loco degli effluenti diversi da quelli di cui alla voce 05 01 09'],
  ['05 01 11*', 'rifiuti prodotti dalla purificazione di carburanti tramite basi'],
  ['05 01 12*', 'acidi contenenti oli'],
  ['05 01 13', "fanghi residui dell'acqua di alimentazione delle caldaie"],
  ['05 01 14', 'rifiuti prodotti dalle torri di raffreddamento'],
  ['05 01 15*', 'filtri di argilla esauriti'],
  ['05 01 16', 'rifiuti contenenti zolfo prodotti dalla desolforizzazione del petrolio'],
  ['05 01 17', 'bitumi'],
  ['05 01 99', 'rifiuti non specificati altrimenti'],
  ['05 06 01*', 'catrami acidi'],
  ['05 06 03*', 'altri catrami'],
  ['05 06 04', 'rifiuti prodotti dalle torri di raffreddamento'],
  ['05 06 99', 'rifiuti non specificati altrimenti'],
  ['05 07 01*', 'rifiuti contenenti mercurio'],
  ['05 07 02', 'rifiuti contenenti zolfo'],
  ['05 07 99', 'rifiuti non specificati altrimenti'],

  // --------------------------------------------------------------------------
  // CAPITOLO 06 — codici 99 mancanti (06 05 e 06 06 non hanno 99)
  // --------------------------------------------------------------------------
  ['06 01 99', 'rifiuti non specificati altrimenti'],
  ['06 02 99', 'rifiuti non specificati altrimenti'],
  ['06 03 99', 'rifiuti non specificati altrimenti'],
  ['06 04 99', 'rifiuti non specificati altrimenti'],
  ['06 07 99', 'rifiuti non specificati altrimenti'],
  ['06 08 99', 'rifiuti non specificati altrimenti'],
  ['06 09 99', 'rifiuti non specificati altrimenti'],
  ['06 13 99', 'rifiuti non specificati altrimenti'],

  // --------------------------------------------------------------------------
  // CAPITOLO 07 — Rifiuti dei processi chimici organici
  // --------------------------------------------------------------------------
  // 07 01 Rifiuti dalla fabbricazione, formulazione, fornitura ed uso (FFFU) di prodotti chimici organici di base
  ['07 01 01*', 'soluzioni acquose di lavaggio ed acque madri'],
  ['07 01 03*', 'solventi organici alogenati soluzioni di lavaggio ed acque madri'],
  ['07 01 04*', 'altri solventi organici soluzioni di lavaggio ed acque madri'],
  ['07 01 07*', 'fondi e residui di reazione alogenati'],
  ['07 01 08*', 'altri fondi e residui di reazione'],
  ['07 01 09*', 'residui di filtrazione e assorbenti esauriti alogenati'],
  ['07 01 10*', 'altri residui di filtrazione e assorbenti esauriti'],
  ['07 01 11*', 'fanghi prodotti dal trattamento in loco degli effluenti contenenti sostanze pericolose'],
  ['07 01 12', 'fanghi prodotti dal trattamento in loco degli effluenti diversi da quelli di cui alla voce 07 01 11'],
  ['07 01 99', 'rifiuti non specificati altrimenti'],
  // 07 02 FFFU di materie plastiche, gomma sintetica e fibre artificiali
  ['07 02 01*', 'soluzioni acquose di lavaggio ed acque madri'],
  ['07 02 03*', 'solventi organici alogenati soluzioni di lavaggio ed acque madri'],
  ['07 02 04*', 'altri solventi organici soluzioni di lavaggio ed acque madri'],
  ['07 02 07*', 'fondi e residui di reazione alogenati'],
  ['07 02 08*', 'altri fondi e residui di reazione'],
  ['07 02 09*', 'residui di filtrazione e assorbenti esauriti alogenati'],
  ['07 02 10*', 'altri residui di filtrazione e assorbenti esauriti'],
  ['07 02 11*', 'fanghi prodotti dal trattamento in loco degli effluenti contenenti sostanze pericolose'],
  ['07 02 12', 'fanghi prodotti dal trattamento in loco degli effluenti diversi da quelli di cui alla voce 07 02 11'],
  ['07 02 13', 'rifiuti plastici'],
  ['07 02 14*', 'rifiuti prodotti da additivi contenenti sostanze pericolose'],
  ['07 02 15', 'rifiuti prodotti da additivi diversi da quelli di cui alla voce 07 02 14'],
  ['07 02 16*', 'rifiuti contenenti siliconi pericolosi'],
  ['07 02 17', 'rifiuti contenenti siliconi diversi da quelli di cui alla voce 07 02 16'],
  ['07 02 99', 'rifiuti non specificati altrimenti'],
  // 07 03 FFFU di coloranti e pigmenti organici
  ['07 03 01*', 'soluzioni acquose di lavaggio ed acque madri'],
  ['07 03 03*', 'solventi organici alogenati soluzioni di lavaggio ed acque madri'],
  ['07 03 04*', 'altri solventi organici soluzioni di lavaggio ed acque madri'],
  ['07 03 07*', 'fondi e residui di reazione alogenati'],
  ['07 03 08*', 'altri fondi e residui di reazione'],
  ['07 03 09*', 'residui di filtrazione e assorbenti esauriti alogenati'],
  ['07 03 10*', 'altri residui di filtrazione e assorbenti esauriti'],
  ['07 03 11*', 'fanghi prodotti dal trattamento in loco degli effluenti contenenti sostanze pericolose'],
  ['07 03 12', 'fanghi prodotti dal trattamento in loco degli effluenti diversi da quelli di cui alla voce 07 03 11'],
  ['07 03 99', 'rifiuti non specificati altrimenti'],
  // 07 04 FFFU di prodotti fitosanitari organici conservanti del legno e altri biocidi
  ['07 04 01*', 'soluzioni acquose di lavaggio ed acque madri'],
  ['07 04 03*', 'solventi organici alogenati soluzioni di lavaggio ed acque madri'],
  ['07 04 04*', 'altri solventi organici soluzioni di lavaggio ed acque madri'],
  ['07 04 07*', 'fondi e residui di reazione alogenati'],
  ['07 04 08*', 'altri fondi e residui di reazione'],
  ['07 04 09*', 'residui di filtrazione e assorbenti esauriti alogenati'],
  ['07 04 10*', 'altri residui di filtrazione e assorbenti esauriti'],
  ['07 04 11*', 'fanghi prodotti dal trattamento in loco degli effluenti contenenti sostanze pericolose'],
  ['07 04 12', 'fanghi prodotti dal trattamento in loco degli effluenti diversi da quelli di cui alla voce 07 04 11'],
  ['07 04 13*', 'rifiuti solidi contenenti sostanze pericolose'],
  ['07 04 99', 'rifiuti non specificati altrimenti'],
  // 07 05 FFFU di prodotti farmaceutici
  ['07 05 01*', 'soluzioni acquose di lavaggio ed acque madri'],
  ['07 05 03*', 'solventi organici alogenati soluzioni di lavaggio ed acque madri'],
  ['07 05 04*', 'altri solventi organici soluzioni di lavaggio ed acque madri'],
  ['07 05 07*', 'fondi e residui di reazione alogenati'],
  ['07 05 08*', 'altri fondi e residui di reazione'],
  ['07 05 09*', 'residui di filtrazione e assorbenti esauriti alogenati'],
  ['07 05 10*', 'altri residui di filtrazione e assorbenti esauriti'],
  ['07 05 11*', 'fanghi prodotti dal trattamento in loco degli effluenti contenenti sostanze pericolose'],
  ['07 05 12', 'fanghi prodotti dal trattamento in loco degli effluenti diversi da quelli di cui alla voce 07 05 11'],
  ['07 05 13*', 'rifiuti solidi contenenti sostanze pericolose'],
  ['07 05 14', 'rifiuti solidi diversi da quelli di cui alla voce 07 05 13'],
  ['07 05 99', 'rifiuti non specificati altrimenti'],
  // 07 06 FFFU di grassi saponi detergenti disinfettanti e cosmetici
  ['07 06 01*', 'soluzioni acquose di lavaggio ed acque madri'],
  ['07 06 03*', 'solventi organici alogenati soluzioni di lavaggio ed acque madri'],
  ['07 06 04*', 'altri solventi organici soluzioni di lavaggio ed acque madri'],
  ['07 06 07*', 'fondi e residui di reazione alogenati'],
  ['07 06 08*', 'altri fondi e residui di reazione'],
  ['07 06 09*', 'residui di filtrazione e assorbenti esauriti alogenati'],
  ['07 06 10*', 'altri residui di filtrazione e assorbenti esauriti'],
  ['07 06 11*', 'fanghi prodotti dal trattamento in loco degli effluenti contenenti sostanze pericolose'],
  ['07 06 12', 'fanghi prodotti dal trattamento in loco degli effluenti diversi da quelli di cui alla voce 07 06 11'],
  ['07 06 99', 'rifiuti non specificati altrimenti'],
  // 07 07 FFFU di prodotti chimici non specificati altrimenti
  ['07 07 01*', 'soluzioni acquose di lavaggio ed acque madri'],
  ['07 07 03*', 'solventi organici alogenati soluzioni di lavaggio ed acque madri'],
  ['07 07 04*', 'altri solventi organici soluzioni di lavaggio ed acque madri'],
  ['07 07 07*', 'fondi e residui di reazione alogenati'],
  ['07 07 08*', 'altri fondi e residui di reazione'],
  ['07 07 09*', 'residui di filtrazione e assorbenti esauriti alogenati'],
  ['07 07 10*', 'altri residui di filtrazione e assorbenti esauriti'],
  ['07 07 11*', 'fanghi prodotti dal trattamento in loco degli effluenti contenenti sostanze pericolose'],
  ['07 07 12', 'fanghi prodotti dal trattamento in loco degli effluenti diversi da quelli di cui alla voce 07 07 11'],
  ['07 07 99', 'rifiuti non specificati altrimenti'],

  // --------------------------------------------------------------------------
  // CAPITOLO 08 — voci mancanti
  // --------------------------------------------------------------------------
  ['08 02 99', 'rifiuti non specificati altrimenti'],
  ['08 03 99', 'rifiuti non specificati altrimenti'],
  ['08 04 99', 'rifiuti non specificati altrimenti'],
  ['08 05 01*', 'isocianati di scarto'],

  // --------------------------------------------------------------------------
  // CAPITOLO 09 — Rifiuti dell'industria fotografica
  // --------------------------------------------------------------------------
  ['09 01 01*', 'soluzioni di sviluppo e attivanti a base acquosa'],
  ['09 01 02*', 'soluzioni di sviluppo per lastre offset a base acquosa'],
  ['09 01 03*', 'soluzioni di sviluppo a base di solventi'],
  ['09 01 04*', 'soluzioni fissative'],
  ['09 01 05*', 'soluzioni di sbianca e soluzioni di sbianca-fissaggio'],
  ['09 01 06*', 'rifiuti contenenti argento prodotti dal trattamento in loco di rifiuti fotografici'],
  ['09 01 07', 'carta e pellicole per fotografia contenenti argento o composti dell\'argento'],
  ['09 01 08', 'carta e pellicole per fotografia non contenenti argento'],
  ['09 01 10', 'macchine fotografiche monouso senza batterie'],
  ['09 01 11*', 'macchine fotografiche monouso contenenti batterie incluse nella voce 16 06 01 16 06 02 o 16 06 03'],
  ['09 01 12', 'macchine fotografiche monouso contenenti batterie diverse da quelle di cui alla voce 09 01 11'],
  ['09 01 13*', 'rifiuti liquidi acquosi prodotti dal recupero in loco dell\'argento diversi da quelli di cui alla voce 09 01 06'],
  ['09 01 99', 'rifiuti non specificati altrimenti'],

  // --------------------------------------------------------------------------
  // CAPITOLO 10 — codice 99 mancante in 10 01 + interi sotto-capitoli 10 02-10 13
  // --------------------------------------------------------------------------
  ['10 01 99', 'rifiuti non specificati altrimenti'],
  // 10 02 Rifiuti dell'industria del ferro e dell'acciaio
  ['10 02 01', 'rifiuti del trattamento delle scorie'],
  ['10 02 02', 'scorie non trattate'],
  ['10 02 07*', 'rifiuti solidi prodotti dal trattamento dei fumi contenenti sostanze pericolose'],
  ['10 02 08', 'rifiuti solidi prodotti dal trattamento dei fumi diversi da quelli di cui alla voce 10 02 07'],
  ['10 02 10', 'scaglie di laminazione'],
  ['10 02 11*', 'rifiuti prodotti dal trattamento delle acque di raffreddamento contenenti oli'],
  ['10 02 12', 'rifiuti prodotti dal trattamento delle acque di raffreddamento diversi da quelli di cui alla voce 10 02 11'],
  ['10 02 13*', 'fanghi e residui di filtrazione prodotti dal trattamento dei fumi contenenti sostanze pericolose'],
  ['10 02 14', 'fanghi e residui di filtrazione prodotti dal trattamento dei fumi diversi da quelli di cui alla voce 10 02 13'],
  ['10 02 15', 'altri fanghi e residui di filtrazione'],
  ['10 02 99', 'rifiuti non specificati altrimenti'],
  // 10 03 Rifiuti della metallurgia termica dell'alluminio
  ['10 03 02', 'frammenti di anodi'],
  ['10 03 04*', 'scorie della produzione primaria'],
  ['10 03 05', 'rifiuti di allumina'],
  ['10 03 08*', 'scorie saline della produzione secondaria'],
  ['10 03 09*', 'scorie nere della produzione secondaria'],
  ['10 03 15*', 'schiumature infiammabili o che emettono in contatto con l\'acqua gas infiammabili in quantità pericolose'],
  ['10 03 16', 'schiumature diverse da quelle di cui alla voce 10 03 15'],
  ['10 03 17*', 'rifiuti contenenti catrame derivante dalla produzione degli anodi'],
  ['10 03 18', 'rifiuti contenenti carbone derivanti dalla produzione di anodi diversi da quelli di cui alla voce 10 03 17'],
  ['10 03 19*', 'polveri dei gas di combustione contenenti sostanze pericolose'],
  ['10 03 20', 'polveri dei gas di combustione diverse da quelle di cui alla voce 10 03 19'],
  ['10 03 21*', 'altre polveri e particolato (comprese le polveri prodotte da mulini a sfere) contenenti sostanze pericolose'],
  ['10 03 22', 'altre polveri e particolato (comprese le polveri prodotte da mulini a sfere) diverse da quelle di cui alla voce 10 03 21'],
  ['10 03 23*', 'rifiuti solidi prodotti dal trattamento dei fumi contenenti sostanze pericolose'],
  ['10 03 24', 'rifiuti solidi prodotti dal trattamento dei fumi diversi da quelli di cui alla voce 10 03 23'],
  ['10 03 25*', 'fanghi e residui di filtrazione prodotti dal trattamento dei fumi contenenti sostanze pericolose'],
  ['10 03 26', 'fanghi e residui di filtrazione prodotti dal trattamento dei fumi diversi da quelli di cui alla voce 10 03 25'],
  ['10 03 27*', 'rifiuti prodotti dal trattamento delle acque di raffreddamento contenenti oli'],
  ['10 03 28', 'rifiuti prodotti dal trattamento delle acque di raffreddamento diversi da quelli di cui alla voce 10 03 27'],
  ['10 03 29*', 'rifiuti prodotti dal trattamento di scorie saline e scorie nere contenenti sostanze pericolose'],
  ['10 03 30', 'rifiuti prodotti dal trattamento di scorie saline e scorie nere diversi da quelli di cui alla voce 10 03 29'],
  ['10 03 99', 'rifiuti non specificati altrimenti'],
  // 10 04 Rifiuti della metallurgia termica del piombo
  ['10 04 01*', 'scorie della produzione primaria e secondaria'],
  ['10 04 02*', 'scorie e schiumature della produzione primaria e secondaria'],
  ['10 04 03*', 'arsenato di calcio'],
  ['10 04 04*', 'polveri dei gas di combustione'],
  ['10 04 05*', 'altre polveri e particolato'],
  ['10 04 06*', 'rifiuti solidi prodotti dal trattamento dei fumi'],
  ['10 04 07*', 'fanghi e residui di filtrazione prodotti dal trattamento dei fumi'],
  ['10 04 09*', 'rifiuti prodotti dal trattamento delle acque di raffreddamento contenenti oli'],
  ['10 04 10', 'rifiuti prodotti dal trattamento delle acque di raffreddamento diversi da quelli di cui alla voce 10 04 09'],
  ['10 04 99', 'rifiuti non specificati altrimenti'],
  // 10 05 Rifiuti della metallurgia termica dello zinco
  ['10 05 01', 'scorie della produzione primaria e secondaria'],
  ['10 05 03*', 'polveri dei gas di combustione'],
  ['10 05 04', 'altre polveri e particolato'],
  ['10 05 05*', 'rifiuti solidi prodotti dal trattamento dei fumi'],
  ['10 05 06*', 'fanghi e residui di filtrazione prodotti dal trattamento dei fumi'],
  ['10 05 08*', 'rifiuti prodotti dal trattamento delle acque di raffreddamento contenenti oli'],
  ['10 05 09', 'rifiuti prodotti dal trattamento delle acque di raffreddamento diversi da quelli di cui alla voce 10 05 08'],
  ['10 05 10*', 'scorie e schiumature infiammabili o che emettono in contatto con l\'acqua gas infiammabili in quantità pericolose'],
  ['10 05 11', 'scorie e schiumature diverse da quelle di cui alla voce 10 05 10'],
  ['10 05 99', 'rifiuti non specificati altrimenti'],
  // 10 06 Rifiuti della metallurgia termica del rame
  ['10 06 01', 'scorie della produzione primaria e secondaria'],
  ['10 06 02', 'scorie e schiumature della produzione primaria e secondaria'],
  ['10 06 03*', 'polveri dei gas di combustione'],
  ['10 06 04', 'altre polveri e particolato'],
  ['10 06 06*', 'rifiuti solidi prodotti dal trattamento dei fumi'],
  ['10 06 07*', 'fanghi e residui di filtrazione prodotti dal trattamento dei fumi'],
  ['10 06 09*', 'rifiuti prodotti dal trattamento delle acque di raffreddamento contenenti oli'],
  ['10 06 10', 'rifiuti prodotti dal trattamento delle acque di raffreddamento diversi da quelli di cui alla voce 10 06 09'],
  ['10 06 99', 'rifiuti non specificati altrimenti'],
  // 10 07 Rifiuti della metallurgia termica di argento oro e platino
  ['10 07 01', 'scorie della produzione primaria e secondaria'],
  ['10 07 02', 'scorie e schiumature della produzione primaria e secondaria'],
  ['10 07 03', 'rifiuti solidi prodotti dal trattamento dei fumi'],
  ['10 07 04', 'altre polveri e particolato'],
  ['10 07 05', 'fanghi e residui di filtrazione prodotti dal trattamento dei fumi'],
  ['10 07 07*', 'rifiuti prodotti dal trattamento delle acque di raffreddamento contenenti oli'],
  ['10 07 08', 'rifiuti prodotti dal trattamento delle acque di raffreddamento diversi da quelli di cui alla voce 10 07 07'],
  ['10 07 99', 'rifiuti non specificati altrimenti'],
  // 10 08 Rifiuti della metallurgia termica di altri metalli non ferrosi
  ['10 08 04', 'polveri e particolato'],
  ['10 08 08*', 'scorie saline della produzione primaria e secondaria'],
  ['10 08 09', 'altre scorie'],
  ['10 08 10*', 'scorie e schiumature infiammabili o che emettono in contatto con l\'acqua gas infiammabili in quantità pericolose'],
  ['10 08 11', 'scorie e schiumature diverse da quelle di cui alla voce 10 08 10'],
  ['10 08 12*', 'rifiuti contenenti catrame derivante dalla produzione degli anodi'],
  ['10 08 13', 'rifiuti contenenti carbonio derivanti dalla produzione di anodi diversi da quelli di cui alla voce 10 08 12'],
  ['10 08 14', 'frammenti di anodi'],
  ['10 08 15*', 'polveri dei gas di combustione contenenti sostanze pericolose'],
  ['10 08 16', 'polveri dei gas di combustione diverse da quelle di cui alla voce 10 08 15'],
  ['10 08 17*', 'fanghi e residui di filtrazione prodotti dal trattamento dei fumi contenenti sostanze pericolose'],
  ['10 08 18', 'fanghi e residui di filtrazione prodotti dal trattamento dei fumi diversi da quelli di cui alla voce 10 08 17'],
  ['10 08 19*', 'rifiuti prodotti dal trattamento delle acque di raffreddamento contenenti oli'],
  ['10 08 20', 'rifiuti prodotti dal trattamento delle acque di raffreddamento diversi da quelli di cui alla voce 10 08 19'],
  ['10 08 99', 'rifiuti non specificati altrimenti'],
  // 10 09 Rifiuti della fusione di materiali ferrosi
  ['10 09 03', 'scorie di fusione'],
  ['10 09 05*', 'forme e anime da fonderia inutilizzate contenenti sostanze pericolose'],
  ['10 09 06', 'forme e anime da fonderia inutilizzate diverse da quelle di cui alla voce 10 09 05'],
  ['10 09 07*', 'forme e anime da fonderia utilizzate contenenti sostanze pericolose'],
  ['10 09 08', 'forme e anime da fonderia utilizzate diverse da quelle di cui alla voce 10 09 07'],
  ['10 09 09*', 'polveri dei gas di combustione contenenti sostanze pericolose'],
  ['10 09 10', 'polveri dei gas di combustione diverse da quelle di cui alla voce 10 09 09'],
  ['10 09 11*', 'altri particolato contenenti sostanze pericolose'],
  ['10 09 12', 'altri particolato diversi da quelli di cui alla voce 10 09 11'],
  ['10 09 13*', 'scarti di leganti contenenti sostanze pericolose'],
  ['10 09 14', 'scarti di leganti diversi da quelli di cui alla voce 10 09 13'],
  ['10 09 15*', 'scarti di prodotti rilevatori di crepe contenenti sostanze pericolose'],
  ['10 09 16', 'scarti di prodotti rilevatori di crepe diversi da quelli di cui alla voce 10 09 15'],
  ['10 09 99', 'rifiuti non specificati altrimenti'],
  // 10 10 Rifiuti della fusione di materiali non ferrosi
  ['10 10 03', 'scorie di fusione'],
  ['10 10 05*', 'forme e anime da fonderia inutilizzate contenenti sostanze pericolose'],
  ['10 10 06', 'forme e anime da fonderia inutilizzate diverse da quelle di cui alla voce 10 10 05'],
  ['10 10 07*', 'forme e anime da fonderia utilizzate contenenti sostanze pericolose'],
  ['10 10 08', 'forme e anime da fonderia utilizzate diverse da quelle di cui alla voce 10 10 07'],
  ['10 10 09*', 'polveri dei gas di combustione contenenti sostanze pericolose'],
  ['10 10 10', 'polveri dei gas di combustione diverse da quelle di cui alla voce 10 10 09'],
  ['10 10 11*', 'altri particolato contenenti sostanze pericolose'],
  ['10 10 12', 'altri particolato diversi da quelli di cui alla voce 10 10 11'],
  ['10 10 13*', 'scarti di leganti contenenti sostanze pericolose'],
  ['10 10 14', 'scarti di leganti diversi da quelli di cui alla voce 10 10 13'],
  ['10 10 15*', 'scarti di prodotti rilevatori di crepe contenenti sostanze pericolose'],
  ['10 10 16', 'scarti di prodotti rilevatori di crepe diversi da quelli di cui alla voce 10 10 15'],
  ['10 10 99', 'rifiuti non specificati altrimenti'],
  // 10 11 Rifiuti della produzione di vetro e di prodotti di vetro
  ['10 11 03', 'scarti di materiali in fibra a base di vetro'],
  ['10 11 05', 'polveri e particolato'],
  ['10 11 09*', 'residui di miscela di preparazione non sottoposti a trattamento termico contenenti sostanze pericolose'],
  ['10 11 10', 'residui di miscela di preparazione non sottoposti a trattamento termico diversi da quelli di cui alla voce 10 11 09'],
  ['10 11 11*', 'rifiuti di vetro in forma di particolato e polveri di vetro contenenti metalli pesanti (ad esempio prodotti da tubi catodici)'],
  ['10 11 12', 'rifiuti di vetro diversi da quelli di cui alla voce 10 11 11'],
  ['10 11 13*', 'fanghi provenienti dalla lucidatura e dalla macinazione del vetro contenenti sostanze pericolose'],
  ['10 11 14', 'fanghi provenienti dalla lucidatura e dalla macinazione del vetro diversi da quelli di cui alla voce 10 11 13'],
  ['10 11 15*', 'rifiuti solidi prodotti dal trattamento dei fumi contenenti sostanze pericolose'],
  ['10 11 16', 'rifiuti solidi prodotti dal trattamento dei fumi diversi da quelli di cui alla voce 10 11 15'],
  ['10 11 17*', 'fanghi e residui di filtrazione prodotti dal trattamento dei fumi contenenti sostanze pericolose'],
  ['10 11 18', 'fanghi e residui di filtrazione prodotti dal trattamento dei fumi diversi da quelli di cui alla voce 10 11 17'],
  ['10 11 19*', 'rifiuti solidi prodotti dal trattamento in loco degli effluenti contenenti sostanze pericolose'],
  ['10 11 20', 'rifiuti solidi prodotti dal trattamento in loco degli effluenti diversi da quelli di cui alla voce 10 11 19'],
  ['10 11 99', 'rifiuti non specificati altrimenti'],
  // 10 12 Rifiuti della produzione di prodotti ceramici, mattoni, mattonelle e materiali da costruzione
  ['10 12 01', 'residui di miscela di preparazione non sottoposti a trattamento termico'],
  ['10 12 03', 'polveri e particolato'],
  ['10 12 05', 'fanghi e residui di filtrazione prodotti dal trattamento dei fumi'],
  ['10 12 06', 'stampi di scarto'],
  ['10 12 08', 'scarti di ceramica, mattoni, mattonelle e materiali da costruzione (dopo il trattamento termico)'],
  ['10 12 09*', 'rifiuti solidi prodotti dal trattamento dei fumi contenenti sostanze pericolose'],
  ['10 12 10', 'rifiuti solidi prodotti dal trattamento dei fumi diversi da quelli di cui alla voce 10 12 09'],
  ['10 12 11*', 'rifiuti delle operazioni di smaltatura contenenti metalli pesanti'],
  ['10 12 12', 'rifiuti delle operazioni di smaltatura diversi da quelli di cui alla voce 10 12 11'],
  ['10 12 13', 'fanghi prodotti dal trattamento in loco degli effluenti'],
  ['10 12 99', 'rifiuti non specificati altrimenti'],
  // 10 13 Rifiuti della produzione di cemento calce e gesso e manufatti di tali materiali
  ['10 13 01', 'residui di miscela di preparazione non sottoposti a trattamento termico'],
  ['10 13 04', 'rifiuti di calcinazione e di idratazione della calce'],
  ['10 13 06', 'polveri e residui diversi da quelli di cui alle voci 10 13 04 e 10 13 05'],
  ['10 13 07', 'fanghi e residui di filtrazione prodotti dal trattamento dei fumi'],
  ['10 13 09*', 'rifiuti dalla produzione di cemento amianto contenenti amianto'],
  ['10 13 10', 'rifiuti dalla produzione di cemento-amianto diversi da quelli di cui alla voce 10 13 09'],
  ['10 13 11', 'rifiuti da altri materiali compositi a base di cemento diversi da quelli di cui alle voci 10 13 09 e 10 13 10'],
  ['10 13 12*', 'rifiuti solidi prodotti dal trattamento dei fumi contenenti sostanze pericolose'],
  ['10 13 13', 'rifiuti solidi prodotti dal trattamento dei fumi diversi da quelli di cui alla voce 10 13 12'],
  ['10 13 14', 'rifiuti di calcestruzzo e fanghi di calcestruzzo'],
  ['10 13 99', 'rifiuti non specificati altrimenti'],

  // --------------------------------------------------------------------------
  // CAPITOLO 11 — Rifiuti prodotti dal trattamento chimico superficiale e dal
  //               rivestimento di metalli e altri materiali; idrometallurgia non ferrosa
  // --------------------------------------------------------------------------
  // 11 01 Rifiuti prodotti dal trattamento e dalla ricopertura di metalli
  ['11 01 05*', 'acidi di decappaggio'],
  ['11 01 06*', 'acidi non specificati altrimenti'],
  ['11 01 07*', 'basi di decappaggio'],
  ['11 01 08*', 'fanghi di fosfatazione'],
  ['11 01 09*', 'fanghi e residui di filtrazione contenenti sostanze pericolose'],
  ['11 01 10', 'fanghi e residui di filtrazione diversi da quelli di cui alla voce 11 01 09'],
  ['11 01 11*', 'soluzioni acquose di lavaggio contenenti sostanze pericolose'],
  ['11 01 12', 'soluzioni acquose di lavaggio diverse da quelle di cui alla voce 11 01 11'],
  ['11 01 13*', 'rifiuti di sgrassaggio contenenti sostanze pericolose'],
  ['11 01 14', 'rifiuti di sgrassaggio diversi da quelli di cui alla voce 11 01 13'],
  ['11 01 15*', 'eluati e fanghi di sistemi a membrana o a scambio ionico contenenti sostanze pericolose'],
  ['11 01 16*', 'resine a scambio ionico saturate o esaurite'],
  ['11 01 98*', 'altri rifiuti contenenti sostanze pericolose'],
  ['11 01 99', 'rifiuti non specificati altrimenti'],
  // 11 02 Rifiuti prodotti da processi idrometallurgici non ferrosi
  ['11 02 02*', 'fanghi della lavorazione idrometallurgica dello zinco (incluse jarosite e goethite)'],
  ['11 02 03', 'rifiuti della produzione di anodi per processi di elettrolisi acquosa'],
  ['11 02 05*', 'rifiuti della lavorazione idrometallurgica del rame contenenti sostanze pericolose'],
  ['11 02 06', 'rifiuti della lavorazione idrometallurgica del rame diversi da quelli di cui alla voce 11 02 05'],
  ['11 02 07*', 'altri rifiuti contenenti sostanze pericolose'],
  ['11 02 99', 'rifiuti non specificati altrimenti'],
  // 11 03 Fanghi e solidi prodotti da processi di tempera
  ['11 03 01*', 'rifiuti contenenti cianuro'],
  ['11 03 02*', 'altri rifiuti'],
  // 11 05 Rifiuti prodotti dalla zincatura a caldo
  ['11 05 01', 'zinco solido'],
  ['11 05 02', 'ceneri di zinco'],
  ['11 05 03*', 'rifiuti solidi prodotti dal trattamento dei fumi'],
  ['11 05 04*', 'fondente esaurito'],
  ['11 05 99', 'rifiuti non specificati altrimenti'],

  // --------------------------------------------------------------------------
  // CAPITOLO 12 — voci mancanti
  // --------------------------------------------------------------------------
  ['12 03 01*', 'soluzioni acquose di lavaggio'],
  ['12 03 02*', 'rifiuti prodotti dai processi di sgrassaggio a vapore'],
]

// ============================================================================
// LETTURA CSV ESISTENTE
// ============================================================================
const csvPath = path.join(__dirname, 'cer-codes-ispra.csv')
const existing = fs.readFileSync(csvPath, 'utf8')
  .split('\n')
  .filter(l => l.trim())

const header = existing[0]
const existingRows = existing.slice(1).map(l => {
  const parts = l.split(',')
  return {
    code: parts[0].trim(),
    normalizedCode: parts[0].trim().replace(/\*/g, '').replace(/\s/g, ''),
    raw: l,
  }
})

// Set dei codici già presenti (normalizzato: senza spazi né asterischi)
const existingNormalized = new Set(existingRows.map(r => r.normalizedCode))

// ============================================================================
// COSTRUZIONE NUOVE RIGHE
// ============================================================================
function buildRow(code, description) {
  const isPericoloso = code.endsWith('*')
  const codeClean = code.replace(/\*/g, '').replace(/\s/g, '')
  // category = prime 2 cifre, subcategory = cifre 3-4
  const category = codeClean.substring(0, 2)
  const subcategory = codeClean.substring(2, 4)
  const isPerStr = isPericoloso ? 'true' : 'false'
  // Escape description if contains comma
  const safeDesc = description.includes(',') ? `"${description}"` : description
  return `${code},${safeDesc},${isPerStr},${category},${subcategory}`
}

const nuoveRighe = []
let duplicatiSaltati = 0

for (const [code, description] of NUOVE_VOCI) {
  const normalizedCode = code.replace(/\*/g, '').replace(/\s/g, '')
  if (existingNormalized.has(normalizedCode)) {
    duplicatiSaltati++
    continue
  }
  nuoveRighe.push(buildRow(code, description))
  existingNormalized.add(normalizedCode) // evita duplicati interni all'array NUOVE_VOCI
}

// ============================================================================
// MERGE + SORT + SCRITTURA
// ============================================================================
const allRows = [...existingRows.map(r => r.raw), ...nuoveRighe]

// Sort per codice (normalizzato numerico)
allRows.sort((a, b) => {
  const codeA = a.split(',')[0].trim().replace(/\*/g, '').replace(/\s/g, '')
  const codeB = b.split(',')[0].trim().replace(/\*/g, '').replace(/\s/g, '')
  return codeA.localeCompare(codeB)
})

const output = [header, ...allRows].join('\n') + '\n'
fs.writeFileSync(csvPath, output, 'utf8')

console.log(`CSV aggiornato: ${allRows.length} voci totali`)
console.log(`  Esistenti conservate: ${existingRows.length}`)
console.log(`  Nuove aggiunte: ${nuoveRighe.length}`)
console.log(`  Duplicati saltati: ${duplicatiSaltati}`)
console.log(`  Target: 842`)
