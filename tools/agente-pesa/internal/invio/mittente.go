package invio

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"math/rand/v2"
	"net/http"
	"sync"
	"time"

	"wasteflow/agente-pesa/internal/coda"
	"wasteflow/agente-pesa/internal/orologio"
)

// PausaRevoca e' l'attesa prima di riprovare dopo una revoca (controllo ogni 10 minuti).
const PausaRevoca = 10 * time.Minute

// Mittente ritrasmette la coda: consegna almeno una volta, in ordine di sequenza.
type Mittente struct {
	Client     *Client
	Coda       *coda.Coda
	Orologio   orologio.Orologio
	Log        *slog.Logger
	Lotto      int           // default 50
	BackoffMin time.Duration // default 1 s
	BackoffMax time.Duration // default 5 min
	// Jitter altera la durata del backoff; nil = nessun jitter (default: +-20% casuale nel costruttore dell'agente).
	Jitter func(time.Duration) time.Duration

	mu       sync.Mutex
	nonPrima time.Time
	backoff  time.Duration
	revocato bool
}

// Risultato descrive un giro di invio.
type Risultato struct {
	Inviate   int           // elementi con un esito dal server
	Rifiutate int           // fra questi, quelli RIFIUTATA
	Attesa    time.Duration // se > 0: non riprovare prima di questo tempo
	Revocato  bool
	Errore    error // errore di rete o del server, gia' tradotto in Attesa
}

// Jitter20 e' un jitter casuale di +-20%.
func Jitter20(d time.Duration) time.Duration {
	return time.Duration(float64(d) * (0.8 + 0.4*rand.Float64()))
}

// Revocato dice se il server ha revocato l'agente.
func (m *Mittente) Revocato() bool {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.revocato
}

// SegnaRevocato ferma l'invio per PausaRevoca (usato anche dal battito).
func (m *Mittente) SegnaRevocato() {
	m.mu.Lock()
	m.revocato = true
	m.nonPrima = m.Orologio.Adesso().Add(PausaRevoca)
	m.mu.Unlock()
}

func (m *Mittente) aumentaBackoff() time.Duration {
	min, max := m.BackoffMin, m.BackoffMax
	if min <= 0 {
		min = time.Second
	}
	if max <= 0 {
		max = 5 * time.Minute
	}
	if m.backoff == 0 {
		m.backoff = min
	} else if m.backoff *= 2; m.backoff > max {
		m.backoff = max
	}
	if m.Jitter != nil {
		return m.Jitter(m.backoff)
	}
	return m.backoff
}

func (m *Mittente) log() *slog.Logger {
	if m.Log == nil {
		return slog.New(slog.DiscardHandler)
	}
	return m.Log
}

// Ciclo invia un lotto (se e' il momento). Non dorme: dice in Risultato.Attesa quanto aspettare.
func (m *Mittente) Ciclo(ctx context.Context) Risultato {
	m.mu.Lock()
	defer m.mu.Unlock()
	ora := m.Orologio.Adesso()
	if ora.Before(m.nonPrima) {
		return Risultato{Attesa: m.nonPrima.Sub(ora), Revocato: m.revocato}
	}
	lotto := m.Lotto
	if lotto <= 0 {
		lotto = 50
	}
	el, err := m.Coda.Prossimi(lotto)
	if err != nil {
		return Risultato{Errore: fmt.Errorf("lettura della coda: %w", err), Attesa: m.differisci(ora, m.aumentaBackoff())}
	}
	if len(el) == 0 {
		return Risultato{Revocato: m.revocato}
	}
	lista := make([]ElementoLotto, len(el))
	for i, e := range el {
		lista[i] = ElementoLotto{Payload: e.PayloadB64, Firma: e.FirmaB64}
	}
	esiti, err := m.Client.InviaLotto(ctx, lista)
	if err != nil {
		return m.errore(ora, err)
	}
	if len(esiti) != len(el) {
		return Risultato{Errore: fmt.Errorf("il server ha risposto con %d esiti per %d letture", len(esiti), len(el)), Attesa: m.differisci(ora, m.aumentaBackoff())}
	}
	m.backoff, m.revocato = 0, false
	r := Risultato{}
	for i, e := range el {
		var s coda.Esito
		var motivo string
		switch esiti[i].Esito {
		case "ACCETTATA":
			s = coda.Accettata
		case "GIA_RICEVUTA":
			s = coda.GiaRicevuta
		case "RIFIUTATA":
			s, motivo = coda.Rifiutata, esiti[i].Codice+": "+esiti[i].Messaggio
			r.Rifiutate++
			m.log().Warn("lettura rifiutata dal server", "sequenza", e.Sequenza, "codice", esiti[i].Codice)
		default:
			r.Errore = fmt.Errorf("esito sconosciuto %q", esiti[i].Esito)
			continue // resta in coda
		}
		if err := m.Coda.Segna(e.ChiaveIdempotenza, s, motivo); err != nil {
			r.Errore = err
			continue
		}
		r.Inviate++
	}
	return r
}

func (m *Mittente) differisci(ora time.Time, d time.Duration) time.Duration {
	m.nonPrima = ora.Add(d)
	return d
}

func (m *Mittente) errore(ora time.Time, err error) Risultato {
	var h *ErrHTTP
	switch {
	case ErroreRevoca(err):
		m.revocato = true
		m.log().Warn("invio fermo: agente revocato o token non valido; la coda e' conservata")
		return Risultato{Errore: err, Revocato: true, Attesa: m.differisci(ora, PausaRevoca)}
	case errors.As(err, &h) && h.Stato == http.StatusTooManyRequests:
		d := h.RetryAfter
		if d <= 0 {
			d = m.aumentaBackoff()
		}
		return Risultato{Errore: err, Attesa: m.differisci(ora, d)}
	default: // 5xx, 4xx imprevisti, rete chiusa, timeout: la coda resta, si ritenta
		m.log().Warn("invio fallito, si ritenta", "errore", err)
		return Risultato{Errore: err, Attesa: m.differisci(ora, m.aumentaBackoff())}
	}
}
