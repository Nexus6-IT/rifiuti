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
	Rifiutate int           // fra questi, quelli RIFIUTATA e scartati per sempre
	Sospese   int           // RIFIUTATA con un codice transitorio: restano in coda e si riprovano
	Attesa    time.Duration // se > 0: non riprovare prima di questo tempo
	Revocato  bool
	Errore    error // errore di rete o del server, gia' tradotto in Attesa
}

// LottoMassimo e' il tetto di letture per richiesta (D8).
const LottoMassimo = 50

// MaxRetryAfter e' il tetto dell'attesa chiesta dal server con Retry-After.
const MaxRetryAfter = 10 * time.Minute

// CodiciTransitori sono i codici di rifiuto del backend (D7) che il tempo puo' risolvere, perche'
// dipendono da qualcosa che cambia fuori dalla lettura: la lettura, firmata e immutabile, e'
// valida appena la condizione cade. Tutto il resto (firma, agente, peso, simulazione, chiave o
// alibi riusati) e i codici sconosciuti sono definitivi.
//
//   - OROLOGIO_AVANTI: oraAgente (nel payload firmato) e' oltre ricezione+5 min; diventa valida
//     quando l'ora del server la raggiunge, o dopo che il tecnico corregge l'orologio del PC.
//   - STRUMENTO_NON_ASSEGNATO, STRUMENTO_NON_ATTIVO: l'amministratore assegna o riattiva lo
//     strumento dopo la pesata.
//   - FUORI_PORTATA: la portata dello strumento viene corretta in anagrafica.
//
// PAYLOAD_NON_VALIDO e' definitivo: i byte firmati non cambiano mai, quindi se il server li giudica
// malformati lo restano (un agente piu' nuovo del backend si evita con il file di contratto,
// verificato in CI da entrambi i lati). La lettura resta in scartate/ con il motivo.
var CodiciTransitori = map[string]bool{
	"OROLOGIO_AVANTI":         true,
	"STRUMENTO_NON_ASSEGNATO": true,
	"STRUMENTO_NON_ATTIVO":    true,
	"FUORI_PORTATA":           true,
}

// LottoEffettivo e' il lotto realmente usato: da 1 a LottoMassimo (0 o fuori scala = LottoMassimo).
func (m *Mittente) LottoEffettivo() int {
	if m.Lotto <= 0 || m.Lotto > LottoMassimo {
		return LottoMassimo
	}
	return m.Lotto
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
// Il mutex non e' tenuto durante la chiamata HTTP (fino a 30 s), cosi' il battito puo' segnare la
// revoca; Ciclo non va chiamato da piu' goroutine insieme.
func (m *Mittente) Ciclo(ctx context.Context) Risultato {
	m.mu.Lock()
	ora := m.Orologio.Adesso()
	if ora.Before(m.nonPrima) {
		r := Risultato{Attesa: m.nonPrima.Sub(ora), Revocato: m.revocato}
		m.mu.Unlock()
		return r
	}
	revocato := m.revocato
	m.mu.Unlock()

	el, err := m.Coda.Prossimi(m.LottoEffettivo())
	if len(el) == 0 {
		m.mu.Lock()
		defer m.mu.Unlock()
		if err != nil {
			return Risultato{Errore: fmt.Errorf("lettura della coda: %w", err), Attesa: m.differisci(ora, m.aumentaBackoff())}
		}
		return Risultato{Revocato: revocato}
	}
	if err != nil {
		m.log().Warn("alcune letture della coda non si leggono, si riprovera'", "errore", err)
	}
	lista := make([]ElementoLotto, len(el))
	for i, e := range el {
		lista[i] = ElementoLotto{Payload: e.PayloadB64, Firma: e.FirmaB64}
	}
	esiti, err := m.Client.InviaLotto(ctx, lista)

	if err != nil && len(el) > 1 && erroreDiFormato(err) {
		// Un solo elemento fuori formato fa rifiutare l'intero lotto: reinvio uno a uno, cosi' solo
		// quello avvelenato e' scartato e la coda non resta bloccata per sempre.
		return m.reinvioSingolo(ctx, el, ora)
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	if err != nil {
		if len(el) == 1 && erroreDiFormato(err) {
			return m.scartaPerErroreHTTP(el[0], err, ora)
		}
		return m.errore(ora, err)
	}
	if len(esiti) != len(el) {
		return Risultato{Errore: fmt.Errorf("il server ha risposto con %d esiti per %d letture", len(esiti), len(el)), Attesa: m.differisci(ora, m.aumentaBackoff())}
	}
	m.backoff, m.revocato = 0, false
	r := Risultato{}
	m.applica(el, esiti, &r)
	return r
}

// erroreDiFormato: il server ha rifiutato la richiesta per il suo contenuto (non per lo stato del
// server o dell'agente): 400, 413 o 422.
func erroreDiFormato(err error) bool {
	var h *ErrHTTP
	if !errors.As(err, &h) {
		return false
	}
	return h.Stato == http.StatusBadRequest || h.Stato == http.StatusRequestEntityTooLarge || h.Stato == http.StatusUnprocessableEntity
}

func (m *Mittente) scartaPerErroreHTTP(e coda.Elemento, err error, ora time.Time) Risultato {
	var h *ErrHTTP
	errors.As(err, &h)
	motivo := fmt.Sprintf("HTTP_%d: %s %s", h.Stato, h.Codice, h.Messaggio)
	m.log().Warn("lettura rifiutata dal server (formato), scartata", "sequenza", e.Sequenza, "stato", h.Stato)
	r := Risultato{Inviate: 1, Rifiutate: 1}
	if serr := m.Coda.Segna(e.ChiaveIdempotenza, coda.Rifiutata, motivo); serr != nil {
		r.Inviate, r.Rifiutate, r.Errore = 0, 0, serr
	}
	m.backoff = 0
	return r
}

func (m *Mittente) reinvioSingolo(ctx context.Context, el []coda.Elemento, ora time.Time) Risultato {
	var r Risultato
	for _, e := range el {
		esiti, err := m.Client.InviaLotto(ctx, []ElementoLotto{{Payload: e.PayloadB64, Firma: e.FirmaB64}})
		m.mu.Lock()
		switch {
		case err == nil && len(esiti) == 1:
			m.backoff, m.revocato = 0, false
			m.applica([]coda.Elemento{e}, esiti, &r)
		case err != nil && erroreDiFormato(err):
			x := m.scartaPerErroreHTTP(e, err, ora)
			r.Inviate += x.Inviate
			r.Rifiutate += x.Rifiutate
			if x.Errore != nil {
				r.Errore = x.Errore
			}
		default:
			if err == nil {
				err = fmt.Errorf("il server ha risposto con %d esiti per 1 lettura", len(esiti))
			}
			x := m.errore(ora, err)
			r.Errore, r.Attesa, r.Revocato = x.Errore, x.Attesa, x.Revocato
			m.mu.Unlock()
			return r
		}
		m.mu.Unlock()
	}
	return r
}

// applica registra nella coda gli esiti del server (stesso ordine degli elementi).
func (m *Mittente) applica(el []coda.Elemento, esiti []EsitoLettura, r *Risultato) {
	for i, e := range el {
		x := esiti[i]
		if x.ChiaveIdempotenza != nil && *x.ChiaveIdempotenza != e.ChiaveIdempotenza {
			// gli esiti si associano per posizione: se la chiave non coincide qualcosa non torna
			r.Errore = fmt.Errorf("esito %d per la chiave %s, attesa %s: nessun esito registrato", i+1, *x.ChiaveIdempotenza, e.ChiaveIdempotenza)
			continue
		}
		var s coda.Esito
		var motivo string
		switch x.Esito {
		case "ACCETTATA":
			s = coda.Accettata
		case "GIA_RICEVUTA":
			s = coda.GiaRicevuta
		case "RIFIUTATA":
			motivo = x.Codice + ": " + x.Messaggio
			if CodiciTransitori[x.Codice] {
				m.log().Warn("lettura rifiutata dal server per un motivo transitorio, resta in coda", "sequenza", e.Sequenza, "codice", x.Codice)
				scartata, err := m.Coda.Sospendi(e.ChiaveIdempotenza, motivo)
				switch {
				case err != nil:
					r.Errore = err
				case scartata:
					r.Inviate++
					r.Rifiutate++
					m.log().Warn("lettura sospesa da oltre 7 giorni, scartata", "sequenza", e.Sequenza, "codice", x.Codice)
				default:
					r.Sospese++
				}
				continue
			}
			s = coda.Rifiutata
			r.Rifiutate++
			m.log().Warn("lettura rifiutata dal server", "sequenza", e.Sequenza, "codice", x.Codice)
		default:
			r.Errore = fmt.Errorf("esito sconosciuto %q", x.Esito)
			continue // resta in coda
		}
		if err := m.Coda.Segna(e.ChiaveIdempotenza, s, motivo); err != nil {
			r.Errore = err
			if s == coda.Rifiutata {
				r.Rifiutate--
			}
			continue
		}
		r.Inviate++
	}
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
		} else if d > MaxRetryAfter {
			d = MaxRetryAfter
		}
		return Risultato{Errore: err, Attesa: m.differisci(ora, d)}
	default: // 5xx, 4xx imprevisti, rete chiusa, timeout: la coda resta, si ritenta
		m.log().Warn("invio fallito, si ritenta", "errore", err)
		return Risultato{Errore: err, Attesa: m.differisci(ora, m.aumentaBackoff())}
	}
}
