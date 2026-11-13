// Package agente e' il ciclo principale: driver -> firma -> coda -> invio, con battito e stato.
package agente

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"os"
	"path/filepath"
	"sync"
	"sync/atomic"
	"time"

	"wasteflow/agente-pesa/internal/coda"
	"wasteflow/agente-pesa/internal/config"
	"wasteflow/agente-pesa/internal/driver"
	"wasteflow/agente-pesa/internal/driver/trasporto"
	"wasteflow/agente-pesa/internal/firma"
	"wasteflow/agente-pesa/internal/fsatomic"
	"wasteflow/agente-pesa/internal/invio"
	"wasteflow/agente-pesa/internal/istanza"
	"wasteflow/agente-pesa/internal/lettura"
	"wasteflow/agente-pesa/internal/orologio"
)

// File dentro la cartella dati.
const (
	FileCredenziali = "credenziali.bin"
	FileStato       = "stato.json"
	FileLock        = "agente-pesa.lock"
	fileConfServer  = "configurazione-server.json"
)

// Opzioni sono i parametri dell'agente; i campi a zero hanno i valori predefiniti di produzione.
type Opzioni struct {
	Dati              string
	Versione          string
	Orologio          orologio.Orologio
	Log               *slog.Logger
	IntervalloInvio   time.Duration // pausa fra due giri di invio (default 1 s)
	IntervalloBattito time.Duration // 0 = quello dato dal server (60 s)
	BackoffMin        time.Duration
	BackoffMax        time.Duration
}

func (o *Opzioni) predefiniti() {
	if o.Orologio == nil {
		o.Orologio = orologio.Reale
	}
	if o.Log == nil {
		o.Log = slog.New(slog.DiscardHandler)
	}
	if o.IntervalloInvio <= 0 {
		o.IntervalloInvio = time.Second
	}
	if o.Versione == "" {
		o.Versione = "dev"
	}
}

// StatoStrumento e' lo stato di uno strumento, scritto in stato.json.
type StatoStrumento struct {
	StrumentoID  string `json:"strumentoId"`
	Driver       string `json:"driver"`
	Stato        string `json:"stato"` // OK | ERRORE | NON_CONFIGURATO
	UltimoErrore string `json:"ultimoErrore,omitempty"`
}

// Stato e' quello che il comando `stato` mostra: scritto dall'agente a ogni battito.
type Stato struct {
	Aggiornato         time.Time        `json:"aggiornato"`
	Versione           string           `json:"versione"`
	Server             string           `json:"server"`
	AgenteID           string           `json:"agenteId"`
	Revocato           bool             `json:"revocato"`
	SimulazioneAmmessa bool             `json:"simulazioneAmmessa"`
	CodaInAttesa       int              `json:"codaInAttesa"`
	LettureScartate    int              `json:"lettureScartate"`
	UltimaSequenza     int64            `json:"ultimaSequenza"`
	Instabili          int64            `json:"instabili"`
	FuoriPortata       int64            `json:"fuoriPortata"`
	ErroriStrumento    int64            `json:"erroriStrumento"`
	UltimoBattitoOk    *time.Time       `json:"ultimoBattitoOk,omitempty"`
	UltimoErrore       string           `json:"ultimoErrore,omitempty"`
	Strumenti          []StatoStrumento `json:"strumenti"`
}

type agente struct {
	o    Opzioni
	cfg  config.Config
	cred firma.Credenziali
	cl   *invio.Client
	coda *coda.Coda
	mitt *invio.Mittente
	serv invio.Configurazione

	mu        sync.Mutex
	simOk     bool
	strumenti map[string]*StatoStrumento
	annulla   map[string]context.CancelFunc // strumenti simulati, per fermarli se il permesso viene tolto
	revocato  bool
	ultimoOk  *time.Time
	ultimoErr string

	ultimaSeq, instabili, fuoriPortata, errori, scartate atomic.Int64
}

func percorso(o Opzioni, f string) string { return filepath.Join(o.Dati, f) }

// Esegui avvia l'agente e ritorna a ctx chiuso, dopo aver fermato tutto. Errore solo per problemi
// di configurazione o di avvio (il gestore dei servizi lo riavvia).
func Esegui(ctx context.Context, o Opzioni) error {
	o.predefiniti()
	if err := os.MkdirAll(o.Dati, 0o700); err != nil {
		return fmt.Errorf("cartella dati: %w", err)
	}
	rilascia, err := istanza.Blocca(percorso(o, FileLock))
	if err != nil {
		return err
	}
	defer rilascia()
	cfg, err := config.Carica(percorso(o, config.NomeFile))
	if err != nil {
		return fmt.Errorf("configurazione: %w (eseguire prima `agente-pesa abbina`)", err)
	}
	cred, err := firma.Custode{Percorso: percorso(o, FileCredenziali)}.Carica()
	if err != nil {
		return fmt.Errorf("credenziali: %w (eseguire prima `agente-pesa abbina`)", err)
	}
	cl, err := invio.NuovoClient(cfg.Server, cred.Token, o.Versione, o.Log)
	if err != nil {
		return err
	}
	q, err := coda.Apri(o.Dati)
	if err != nil {
		return fmt.Errorf("coda: %w", err)
	}
	q.Adesso = o.Orologio.Adesso
	a := &agente{o: o, cfg: cfg, cred: cred, cl: cl, coda: q, strumenti: map[string]*StatoStrumento{}, annulla: map[string]context.CancelFunc{}}
	a.mitt = &invio.Mittente{Client: cl, Coda: q, Orologio: o.Orologio, Log: o.Log, BackoffMin: o.BackoffMin, BackoffMax: o.BackoffMax}
	if o.BackoffMin == 0 && o.BackoffMax == 0 {
		a.mitt.Jitter = invio.Jitter20
	}
	if err := a.configurazioneServer(ctx); err != nil {
		if ctx.Err() != nil {
			return nil
		}
		return err
	}
	if err := cfg.Valida(config.Vincoli{CartellaDati: o.Dati, StrumentiServer: ids(a.serv.Strumenti)}); err != nil {
		return fmt.Errorf("configurazione non valida:\n%w", err)
	}
	a.mitt.Lotto = a.serv.LottoMassimo // il Mittente lo porta comunque a 1..50
	a.simOk = a.serv.SimulazioneAmmessa
	if err := q.Pulisci(30 * 24 * time.Hour); err != nil {
		o.Log.Warn("pulizia delle letture inviate non riuscita", "errore", err)
	}

	var wg sync.WaitGroup
	for _, sc := range cfg.Strumenti {
		a.strumenti[sc.StrumentoID] = &StatoStrumento{StrumentoID: sc.StrumentoID, Driver: sc.Driver, Stato: "NON_CONFIGURATO"}
	}
	for _, sc := range cfg.Strumenti {
		sc := sc
		wg.Add(1)
		go func() { defer wg.Done(); a.strumento(ctx, sc) }()
	}
	wg.Add(2)
	go func() { defer wg.Done(); a.cicloInvio(ctx) }()
	go func() { defer wg.Done(); a.cicloBattito(ctx) }()
	<-ctx.Done()
	wg.Wait()
	a.scriviStato()
	return nil
}

func ids(s []invio.Strumento) []string {
	r := make([]string, 0, len(s))
	for _, x := range s {
		r = append(r, x.ID)
	}
	return r
}

// configurazioneServer legge la configurazione dal server; se non risponde usa l'ultima copia
// salvata (l'agente deve ripartire anche senza rete), e se non c'e' riprova con backoff.
func (a *agente) configurazioneServer(ctx context.Context) error {
	b := time.Second
	if a.o.BackoffMin > 0 {
		b = a.o.BackoffMin
	}
	for {
		c, err := a.cl.Configurazione(ctx)
		if err == nil {
			a.serv = c
			if raw, e := json.Marshal(c); e == nil {
				_ = fsatomic.Scrivi(percorso(a.o, fileConfServer), raw, 0o644)
			}
			return nil
		}
		if invio.ErroreRevoca(err) {
			a.mitt.SegnaRevocato()
			a.revocato = true
		}
		if raw, e := os.ReadFile(percorso(a.o, fileConfServer)); e == nil && json.Unmarshal(raw, &a.serv) == nil {
			a.o.Log.Warn("configurazione del server non raggiungibile: uso l'ultima salvata", "errore", err)
			return nil
		}
		a.o.Log.Warn("configurazione del server non raggiungibile, riprovo", "errore", err)
		if a.o.Orologio.Dormi(ctx, b) != nil {
			return ctx.Err()
		}
		if b *= 2; b > 5*time.Minute {
			b = 5 * time.Minute
		}
	}
}

func (a *agente) imposta(id, stato, errore string) {
	a.mu.Lock()
	if s := a.strumenti[id]; s != nil {
		s.Stato, s.UltimoErrore = stato, errore
	}
	a.mu.Unlock()
}

func apriTrasporto(t *config.Trasporto) trasporto.Apri {
	switch {
	case t == nil:
		return nil
	case t.Tipo == "tcp":
		return trasporto.TCP(t.Indirizzo, 10*time.Second)
	default:
		return trasporto.Seriale(t.Porta, t.Baud)
	}
}

func (a *agente) strumento(ctx context.Context, sc config.Strumento) {
	if sc.Driver == "SIMULATA" {
		a.mu.Lock()
		ok := a.simOk
		a.mu.Unlock()
		if !ok {
			msg := "simulazione non ammessa dal server per questa azienda: driver non avviato"
			a.o.Log.Error(msg, "strumento", sc.StrumentoID)
			a.imposta(sc.StrumentoID, "NON_CONFIGURATO", msg)
			return
		}
		var c context.CancelFunc
		ctx, c = context.WithCancel(ctx)
		a.mu.Lock()
		a.annulla[sc.StrumentoID] = c
		a.mu.Unlock()
		defer c()
	}
	b := time.Second
	if a.o.BackoffMin > 0 {
		b = a.o.BackoffMin
	}
	for ctx.Err() == nil {
		drv, err := driver.Crea(sc.Driver, driver.Parametri{Dati: sc.Parametri, CartellaDati: a.o.Dati, Orologio: a.o.Orologio}, apriTrasporto(sc.Trasporto))
		if err != nil {
			a.o.Log.Error("driver non avviabile", "strumento", sc.StrumentoID, "errore", err)
			a.imposta(sc.StrumentoID, "ERRORE", err.Error())
			return
		}
		a.imposta(sc.StrumentoID, "OK", "")
		out := make(chan driver.Campione, 16)
		var cons sync.WaitGroup
		cons.Add(1)
		go func() { defer cons.Done(); a.consuma(sc, drv, out) }()
		err = drv.Esegui(ctx, out)
		close(out)
		cons.Wait()
		if ctx.Err() != nil {
			return
		}
		msg := "il driver si e' fermato"
		if err != nil {
			msg = err.Error()
		}
		a.o.Log.Error("driver fermo, riavvio", "strumento", sc.StrumentoID, "errore", msg)
		a.imposta(sc.StrumentoID, "ERRORE", msg)
		if errors.Is(err, trasporto.ErrNonDisponibile) {
			return
		}
		if a.o.Orologio.Dormi(ctx, b) != nil {
			return
		}
		if b *= 2; b > time.Minute {
			b = time.Minute
		}
	}
}

// consuma e' il nucleo: solo Definitivo && Stabile diventa una lettura firmata e accodata.
func (a *agente) consuma(sc config.Strumento, drv driver.Driver, out <-chan driver.Campione) {
	for c := range out {
		if !driver.DaRegistrare(c) {
			switch c.Stato {
			case driver.Instabile:
				a.instabili.Add(1)
			case driver.Sottocarico, driver.Sovraccarico:
				a.fuoriPortata.Add(1)
				a.o.Log.Warn("peso fuori portata scartato", "strumento", sc.StrumentoID)
			case driver.Errore:
				a.errori.Add(1)
				a.o.Log.Warn("campione in errore", "strumento", sc.StrumentoID)
			}
			continue
		}
		seq, err := a.coda.ProssimaSequenza()
		if err != nil {
			a.o.Log.Error("sequenza non disponibile", "errore", err)
			a.scartate.Add(1)
			continue
		}
		p, err := lettura.Nuova(a.cred.AgenteID, sc.StrumentoID, seq, c, a.o.Orologio.Adesso(), drv.Nome(), drv.Simulato())
		if err != nil {
			a.o.Log.Error("lettura scartata", "strumento", sc.StrumentoID, "errore", err)
			a.scartate.Add(1)
			continue
		}
		byt := p.Bytes()
		sig := firma.Firma(a.cred.Chiave(), byt)
		err = a.coda.Accoda(coda.Elemento{
			PayloadB64: base64.StdEncoding.EncodeToString(byt), FirmaB64: base64.StdEncoding.EncodeToString(sig),
			ChiaveIdempotenza: p.ChiaveIdempotenza, Sequenza: seq, CreataIl: a.o.Orologio.Adesso().UTC(),
		})
		if err != nil {
			if errors.Is(err, coda.ErrCodaPiena) {
				a.o.Log.Error("coda piena: lettura persa", "sequenza", seq)
			} else {
				a.o.Log.Error("lettura non accodata", "errore", err)
			}
			a.scartate.Add(1)
			continue
		}
		a.ultimaSeq.Store(seq)
	}
}

func (a *agente) cicloInvio(ctx context.Context) {
	for ctx.Err() == nil {
		r := a.mitt.Ciclo(ctx)
		a.mu.Lock()
		a.revocato = r.Revocato || a.mitt.Revocato()
		if r.Errore != nil {
			a.ultimoErr = r.Errore.Error()
		}
		a.mu.Unlock()
		if r.Inviate >= a.mitt.LottoEffettivo() && r.Attesa == 0 && r.Errore == nil {
			continue // lotto pieno: c'e' ancora coda da svuotare
		}
		pausa := a.o.IntervalloInvio
		if r.Attesa > 0 {
			pausa = r.Attesa
		}
		if a.o.Orologio.Dormi(ctx, pausa) != nil {
			return
		}
	}
}

func (a *agente) cicloBattito(ctx context.Context) {
	ultimaPulizia := a.o.Orologio.Adesso()
	for ctx.Err() == nil {
		a.battito(ctx)
		a.scriviStato()
		if a.o.Orologio.Adesso().Sub(ultimaPulizia) > 24*time.Hour {
			_ = a.coda.Pulisci(30 * 24 * time.Hour)
			ultimaPulizia = a.o.Orologio.Adesso()
		}
		d := a.o.IntervalloBattito
		if d <= 0 {
			d = time.Duration(a.serv.IntervalloBattitoS) * time.Second
		}
		if d <= 0 {
			d = 60 * time.Second
		}
		if a.o.Orologio.Dormi(ctx, d) != nil {
			return
		}
	}
}

func (a *agente) battito(ctx context.Context) {
	k := a.coda.Conta()
	a.mu.Lock()
	sts := make([]invio.StatoStrumento, 0, len(a.strumenti))
	for _, s := range a.strumenti {
		sts = append(sts, invio.StatoStrumento{StrumentoID: s.StrumentoID, Stato: s.Stato, UltimoErrore: troncato(s.UltimoErrore, 200)})
	}
	a.mu.Unlock()
	r, err := a.cl.Battito(ctx, invio.Battito{
		Versione: a.o.Versione, OraAgente: a.o.Orologio.Adesso().Format("2006-01-02T15:04:05.000Z07:00"),
		CodaInAttesa: k.InAttesa, LettureScartate: k.Scartate + int(a.scartate.Load()),
		UltimaSequenza: a.ultimaSeq.Load(), Strumenti: sts,
	})
	a.mu.Lock()
	defer a.mu.Unlock()
	if err != nil {
		a.ultimoErr = err.Error()
		if invio.ErroreRevoca(err) {
			a.revocato = true
			a.mitt.SegnaRevocato()
		}
		return
	}
	now := a.o.Orologio.Adesso()
	a.ultimoOk, a.ultimoErr = &now, ""
	if r.Revocato {
		a.revocato = true
		a.mitt.SegnaRevocato()
	}
	if a.simOk && !r.SimulazioneAmmessa { // permesso tolto mentre l'agente gira
		a.simOk = false
		for id, c := range a.annulla {
			c()
			if s := a.strumenti[id]; s != nil {
				s.Stato, s.UltimoErrore = "NON_CONFIGURATO", "simulazione non piu' ammessa dal server"
			}
		}
	}
	a.simOk = r.SimulazioneAmmessa
}

func troncato(s string, n int) string {
	if len(s) > n {
		return s[:n]
	}
	return s
}

func (a *agente) scriviStato() {
	k := a.coda.Conta()
	a.mu.Lock()
	st := Stato{
		Aggiornato: a.o.Orologio.Adesso(), Versione: a.o.Versione, Server: a.cfg.Server, AgenteID: a.cred.AgenteID,
		Revocato: a.revocato, SimulazioneAmmessa: a.simOk, CodaInAttesa: k.InAttesa,
		LettureScartate: k.Scartate + int(a.scartate.Load()), UltimaSequenza: a.ultimaSeq.Load(),
		Instabili: a.instabili.Load(), FuoriPortata: a.fuoriPortata.Load(), ErroriStrumento: a.errori.Load(),
		UltimoBattitoOk: a.ultimoOk, UltimoErrore: a.ultimoErr,
	}
	for _, sc := range a.cfg.Strumenti {
		if s := a.strumenti[sc.StrumentoID]; s != nil {
			st.Strumenti = append(st.Strumenti, *s)
		}
	}
	a.mu.Unlock()
	if b, err := json.MarshalIndent(st, "", "  "); err == nil {
		if err := fsatomic.Scrivi(percorso(a.o, FileStato), b, 0o644); err != nil {
			a.o.Log.Warn("stato non scritto", "errore", err)
		}
	}
}

// LeggiStato legge stato.json (assente = agente mai avviato) e conta la coda dalle cartelle senza
// aprirla, cosi' e' sicuro anche con l'agente acceso.
func LeggiStato(dati string) (Stato, coda.Conteggi, error) {
	var st Stato
	k := coda.ContaCartella(dati)
	b, err := os.ReadFile(filepath.Join(dati, FileStato))
	if err != nil {
		return st, k, err
	}
	return st, k, json.Unmarshal(b, &st)
}

// Scrivi stampa lo stato in forma leggibile.
func (s Stato) Scrivi(w io.Writer, k coda.Conteggi) {
	fmt.Fprintf(w, "agente %s (versione %s) verso %s\n", s.AgenteID, s.Versione, s.Server)
	fmt.Fprintf(w, "aggiornato: %s\n", s.Aggiornato.Format(time.RFC3339))
	if s.Revocato {
		fmt.Fprintln(w, "ATTENZIONE: agente revocato dal server; l'invio e' fermo e la coda e' conservata")
	}
	if s.UltimoBattitoOk != nil {
		fmt.Fprintf(w, "ultimo battito riuscito: %s\n", s.UltimoBattitoOk.Format(time.RFC3339))
	} else {
		fmt.Fprintln(w, "nessun battito riuscito")
	}
	if s.UltimoErrore != "" {
		fmt.Fprintf(w, "ultimo errore: %s\n", s.UltimoErrore)
	}
	fmt.Fprintf(w, "coda: %d in attesa, %d inviate, %d scartate (ultima sequenza %d)\n", k.InAttesa, k.Inviate, k.Scartate, s.UltimaSequenza)
	fmt.Fprintf(w, "scartati dal nucleo: %d instabili, %d fuori portata, %d in errore\n", s.Instabili, s.FuoriPortata, s.ErroriStrumento)
	fmt.Fprintf(w, "simulazione ammessa dal server: %v\n", s.SimulazioneAmmessa)
	for _, x := range s.Strumenti {
		fmt.Fprintf(w, "strumento %s [%s]: %s", x.StrumentoID, x.Driver, x.Stato)
		if x.UltimoErrore != "" {
			fmt.Fprintf(w, " - %s", x.UltimoErrore)
		}
		fmt.Fprintln(w)
	}
}
