// Package invio e' il client HTTPS verso il backend: abbinamento, configurazione, lotti di letture,
// battito; piu' il Mittente che ritrasmette la coda con backoff (D8 e D17 del piano 4.8b).
package invio

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"wasteflow/agente-pesa/internal/config"
)

// Strumento e' uno strumento assegnato all'agente.
type Strumento struct {
	ID          string `json:"id"`
	Descrizione string `json:"descrizione"`
	Matricola   string `json:"matricola"`
}

// Azienda e' il cliente a cui l'agente appartiene.
type Azienda struct {
	RagioneSociale string `json:"ragioneSociale"`
}

// RispostaAbbinamento e' la risposta 201 di POST /agenti-pesa/abbinamento.
type RispostaAbbinamento struct {
	AgenteID           string      `json:"agenteId"`
	Token              string      `json:"token"`
	Azienda            Azienda     `json:"azienda"`
	Strumenti          []Strumento `json:"strumenti"`
	SimulazioneAmmessa bool        `json:"simulazioneAmmessa"`
}

// Configurazione e' la risposta di GET /agenti-pesa/configurazione.
type Configurazione struct {
	AgenteID           string      `json:"agenteId"`
	Azienda            Azienda     `json:"azienda"`
	Strumenti          []Strumento `json:"strumenti"`
	SimulazioneAmmessa bool        `json:"simulazioneAmmessa"`
	IntervalloBattitoS int         `json:"intervalloBattitoS"`
	LottoMassimo       int         `json:"lottoMassimo"`
	OraServer          string      `json:"oraServer"`
}

// ElementoLotto e' una lettura inviata: i byte esatti firmati e la firma, in base64.
type ElementoLotto struct {
	Payload string `json:"payload"`
	Firma   string `json:"firma"`
}

// EsitoLettura e' l'esito del server per un elemento del lotto (stesso ordine dell'invio).
type EsitoLettura struct {
	ChiaveIdempotenza *string  `json:"chiaveIdempotenza"`
	Esito             string   `json:"esito"` // ACCETTATA | GIA_RICEVUTA | RIFIUTATA
	LetturaID         string   `json:"letturaId,omitempty"`
	Codice            string   `json:"codice,omitempty"`
	Messaggio         string   `json:"messaggio,omitempty"`
	Avvisi            []string `json:"avvisi,omitempty"`
}

// StatoStrumento e' lo stato di uno strumento nel battito.
type StatoStrumento struct {
	StrumentoID  string `json:"strumentoId"`
	Stato        string `json:"stato"` // OK | ERRORE | NON_CONFIGURATO
	UltimoErrore string `json:"ultimoErrore,omitempty"`
}

// Battito e' il corpo di POST /agenti-pesa/battito.
type Battito struct {
	Versione        string           `json:"versione"`
	OraAgente       string           `json:"oraAgente"`
	CodaInAttesa    int              `json:"codaInAttesa"`
	LettureScartate int              `json:"lettureScartate"`
	UltimaSequenza  int64            `json:"ultimaSequenza"`
	Strumenti       []StatoStrumento `json:"strumenti"`
}

// RispostaBattito e' la risposta del battito.
type RispostaBattito struct {
	OraServer          string `json:"oraServer"`
	SimulazioneAmmessa bool   `json:"simulazioneAmmessa"`
	Revocato           bool   `json:"revocato"`
}

// ErrHTTP e' una risposta di errore del server.
type ErrHTTP struct {
	Stato      int
	Codice     string // campo "error" del corpo, es. AGENTE_REVOCATO
	Messaggio  string
	RetryAfter time.Duration
}

func (e *ErrHTTP) Error() string {
	return fmt.Sprintf("il server ha risposto %d %s: %s", e.Stato, e.Codice, e.Messaggio)
}

// Client parla con il backend. Il token e' usato solo nell'header Authorization, mai scritto nel log.
type Client struct {
	base     *url.URL
	token    string
	http     *http.Client
	versione string
	log      *slog.Logger
}

// NuovoClient valida l'indirizzo (https, o http verso localhost) e prepara il client con timeout di 30 s.
// Certificati verificati con l'archivio di sistema (nessuna opzione per disattivare il controllo).
func NuovoClient(server, token, versione string, log *slog.Logger) (*Client, error) {
	if err := config.ValidaServer(server); err != nil {
		return nil, err
	}
	u, _ := url.Parse(server)
	if log == nil {
		log = slog.New(slog.DiscardHandler)
	}
	return &Client{base: u, token: token, http: &http.Client{
		Timeout: 30 * time.Second,
		// Nessun redirect: l'API non ne fa, e seguirne uno (anche https->http) rimanderebbe
		// l'header Authorization altrove.
		CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse },
	}, versione: versione, log: log}, nil
}

// ConToken restituisce una copia del client con il token indicato (dopo l'abbinamento).
func (c *Client) ConToken(token string) *Client {
	n := *c
	n.token = token
	return &n
}

func (c *Client) fai(ctx context.Context, metodo, percorso string, corpo, out any) error {
	var r io.Reader
	if corpo != nil {
		b, err := json.Marshal(corpo)
		if err != nil {
			return err
		}
		r = bytes.NewReader(b)
	}
	req, err := http.NewRequestWithContext(ctx, metodo, c.base.JoinPath(percorso).String(), r)
	if err != nil {
		return err
	}
	req.Header.Set("User-Agent", "agente-pesa/"+c.versione)
	req.Header.Set("Accept", "application/json")
	if corpo != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	if c.token != "" {
		req.Header.Set("Authorization", "Bearer "+c.token)
	}
	resp, err := c.http.Do(req)
	if err != nil {
		// url.Error contiene l'URL ma mai gli header: niente token.
		return fmt.Errorf("%s %s: %w", metodo, percorso, err)
	}
	defer resp.Body.Close()
	b, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if err != nil {
		return fmt.Errorf("%s %s: lettura della risposta: %w", metodo, percorso, err)
	}
	if resp.StatusCode/100 != 2 {
		e := &ErrHTTP{Stato: resp.StatusCode, RetryAfter: retryAfter(resp.Header.Get("Retry-After"))}
		var corpoErr struct {
			Error   string `json:"error"`
			Message any    `json:"message"`
		}
		if json.Unmarshal(b, &corpoErr) == nil {
			e.Codice = corpoErr.Error
			if s, ok := corpoErr.Message.(string); ok {
				e.Messaggio = s
			}
		}
		c.log.Warn("risposta di errore dal server", "percorso", percorso, "stato", resp.StatusCode, "codice", e.Codice)
		return e
	}
	if out == nil {
		return nil
	}
	if err := json.Unmarshal(b, out); err != nil {
		return fmt.Errorf("%s %s: risposta non valida: %w", metodo, percorso, err)
	}
	return nil
}

func retryAfter(h string) time.Duration {
	h = strings.TrimSpace(h)
	if n, err := strconv.Atoi(h); err == nil && n >= 0 {
		return time.Duration(n) * time.Second
	}
	if t, err := http.ParseTime(h); err == nil {
		if d := time.Until(t); d > 0 {
			return d
		}
	}
	return 0
}

// Abbina scambia il codice con il token.
func (c *Client) Abbina(ctx context.Context, codice, chiavePubB64, nomeHost, versione string) (RispostaAbbinamento, error) {
	var r RispostaAbbinamento
	err := c.fai(ctx, http.MethodPost, "/agenti-pesa/abbinamento", map[string]string{
		"codice": codice, "chiavePubblica": chiavePubB64, "nomeHost": nomeHost, "versione": versione,
	}, &r)
	return r, err
}

// Configurazione legge la configurazione dal server.
func (c *Client) Configurazione(ctx context.Context) (Configurazione, error) {
	var r Configurazione
	err := c.fai(ctx, http.MethodGet, "/agenti-pesa/configurazione", nil, &r)
	return r, err
}

// InviaLotto invia da 1 a 50 letture; gli esiti sono nello stesso ordine.
func (c *Client) InviaLotto(ctx context.Context, el []ElementoLotto) ([]EsitoLettura, error) {
	var r struct {
		Esiti []EsitoLettura `json:"esiti"`
	}
	err := c.fai(ctx, http.MethodPost, "/agenti-pesa/letture", map[string]any{"letture": el}, &r)
	return r.Esiti, err
}

// Battito invia lo stato dell'agente.
func (c *Client) Battito(ctx context.Context, b Battito) (RispostaBattito, error) {
	var r RispostaBattito
	err := c.fai(ctx, http.MethodPost, "/agenti-pesa/battito", b, &r)
	return r, err
}

// ErroreRevoca dice se l'errore e' una revoca o un token non piu' valido: l'invio si ferma.
func ErroreRevoca(err error) bool {
	var h *ErrHTTP
	if !errors.As(err, &h) {
		return false
	}
	return h.Stato == http.StatusUnauthorized || (h.Stato == http.StatusForbidden && h.Codice == "AGENTE_REVOCATO")
}
