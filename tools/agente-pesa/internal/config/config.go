// Package config legge, valida e scrive il file agente-pesa.json (D17 del piano 4.8b).
package config

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"runtime"
	"strings"

	"wasteflow/agente-pesa/internal/driver"
	"wasteflow/agente-pesa/internal/fsatomic"
)

// NomeFile e' il nome del file di configurazione dentro la cartella dati.
const NomeFile = "agente-pesa.json"

// Trasporto dice come raggiungere lo strumento (TCP pronto; seriale solo come interfaccia).
type Trasporto struct {
	Tipo      string `json:"tipo"` // "tcp" | "seriale"
	Indirizzo string `json:"indirizzo,omitempty"`
	Porta     string `json:"porta,omitempty"`
	Baud      int    `json:"baud,omitempty"`
}

// Strumento associa uno strumento del server a un driver locale.
type Strumento struct {
	StrumentoID string          `json:"strumentoId"`
	Driver      string          `json:"driver"`
	Parametri   json.RawMessage `json:"parametri,omitempty"`
	Trasporto   *Trasporto      `json:"trasporto,omitempty"`
}

// Log configura il file di log.
type Log struct {
	Livello string `json:"livello"`
	MaxMB   int    `json:"maxMB"`
	File    int    `json:"file"`
}

// Config e' il contenuto di agente-pesa.json.
type Config struct {
	Server      string      `json:"server"`
	Simulazione bool        `json:"simulazione"`
	Strumenti   []Strumento `json:"strumenti"`
	Log         Log         `json:"log"`
}

// CartellaPredefinita e' la cartella dati del servizio.
func CartellaPredefinita() string {
	if runtime.GOOS == "windows" {
		return `C:\ProgramData\WasteFlow\AgentePesa`
	}
	return "/var/lib/wasteflow-agente-pesa"
}

func (c *Config) predefiniti() {
	if c.Log.Livello == "" {
		c.Log.Livello = "info"
	}
	if c.Log.MaxMB == 0 {
		c.Log.MaxMB = 10
	}
	if c.Log.File == 0 {
		c.Log.File = 5
	}
}

// Carica legge il file; chiavi sconosciute sono un errore (un refuso non passa in silenzio).
func Carica(path string) (Config, error) {
	var c Config
	b, err := os.ReadFile(path)
	if err != nil {
		return c, err
	}
	dec := json.NewDecoder(bytes.NewReader(b))
	dec.DisallowUnknownFields()
	if err := dec.Decode(&c); err != nil {
		return c, fmt.Errorf("%s: %w", path, err)
	}
	c.predefiniti()
	return c, nil
}

// Salva scrive il file in modo atomico.
func Salva(path string, c Config) error {
	c.predefiniti()
	b, err := json.MarshalIndent(c, "", "  ")
	if err != nil {
		return err
	}
	return fsatomic.Scrivi(path, append(b, '\n'), 0o644)
}

// ValidaServer: solo https://, con l'unica eccezione di http verso localhost/127.0.0.1/[::1].
func ValidaServer(s string) error {
	u, err := url.Parse(s)
	if err != nil || u.Host == "" {
		return fmt.Errorf("indirizzo del server non valido: %q", s)
	}
	switch u.Scheme {
	case "https":
		return nil
	case "http":
		switch u.Hostname() {
		case "localhost", "127.0.0.1", "::1":
			return nil
		}
		return fmt.Errorf("server %q: http e' ammesso solo verso localhost; usare https", s)
	}
	return fmt.Errorf("server %q: schema non ammesso", s)
}

// Vincoli sono i controlli che dipendono dal contesto.
type Vincoli struct {
	CartellaDati    string   // deve essere assoluta
	StrumentiServer []string // id assegnati dal server; nil = non verificare
}

var reUUID = regexp.MustCompile(`^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`)

// Valida elenca tutti i problemi trovati (errors.Join).
func (c Config) Valida(v Vincoli) error {
	var e []error
	if v.CartellaDati != "" && !isAbs(v.CartellaDati) {
		e = append(e, fmt.Errorf("cartella dati %q: serve un percorso assoluto", v.CartellaDati))
	}
	if err := ValidaServer(c.Server); err != nil {
		e = append(e, err)
	}
	switch strings.ToLower(c.Log.Livello) {
	case "debug", "info", "warn", "error":
	default:
		e = append(e, fmt.Errorf("log.livello %q: usare debug, info, warn o error", c.Log.Livello))
	}
	if c.Log.MaxMB < 1 || c.Log.File < 1 {
		e = append(e, errors.New("log.maxMB e log.file devono essere almeno 1"))
	}
	noti := map[string]bool{}
	for _, id := range v.StrumentiServer {
		noti[id] = true
	}
	visti := map[string]bool{}
	for i, s := range c.Strumenti {
		pre := fmt.Sprintf("strumento %d (%s)", i+1, s.StrumentoID)
		if !reUUID.MatchString(s.StrumentoID) {
			e = append(e, fmt.Errorf("%s: strumentoId non e' un uuid", pre))
		}
		if visti[s.StrumentoID] {
			e = append(e, fmt.Errorf("%s: strumento ripetuto", pre))
		}
		visti[s.StrumentoID] = true
		if v.StrumentiServer != nil && !noti[s.StrumentoID] {
			e = append(e, fmt.Errorf("%s: non e' fra gli strumenti assegnati a questo agente dal server", pre))
		}
		switch {
		case s.Driver == "":
			e = append(e, fmt.Errorf("%s: driver non indicato (disponibili: %s)", pre, strings.Join(driver.Nomi(), ", ")))
		case !driver.Esiste(s.Driver):
			e = append(e, fmt.Errorf("%s: driver %q sconosciuto (disponibili: %s)", pre, s.Driver, strings.Join(driver.Nomi(), ", ")))
		case s.Driver == "SIMULATA" && !c.Simulazione:
			e = append(e, fmt.Errorf("%s: il driver SIMULATA richiede \"simulazione\": true", pre))
		}
		if t := s.Trasporto; t != nil {
			switch {
			case t.Tipo == "tcp" && t.Indirizzo == "":
				e = append(e, fmt.Errorf("%s: trasporto tcp senza indirizzo", pre))
			case t.Tipo == "seriale" && t.Porta == "":
				e = append(e, fmt.Errorf("%s: trasporto seriale senza porta", pre))
			case t.Tipo != "tcp" && t.Tipo != "seriale":
				e = append(e, fmt.Errorf("%s: trasporto %q sconosciuto (tcp o seriale)", pre, t.Tipo))
			}
		}
	}
	return errors.Join(e...)
}

// isAbs accetta sia i percorsi della piattaforma sia quelli Windows (C:\...), cosi' la stessa
// regola vale nei test su Linux.
func isAbs(p string) bool {
	if filepath.IsAbs(p) {
		return true
	}
	return len(p) >= 3 && p[1] == ':' && (p[2] == '\\' || p[2] == '/')
}
