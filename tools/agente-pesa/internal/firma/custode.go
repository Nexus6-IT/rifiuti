package firma

import (
	"crypto/ed25519"
	"crypto/rand"
	"encoding/json"
	"errors"
	"fmt"

	"wasteflow/agente-pesa/internal/fsatomic"
)

// Credenziali sono i segreti dell'agente dopo l'abbinamento. Mai nel file di configurazione, mai nel log.
type Credenziali struct {
	AgenteID string `json:"agenteId"`
	Token    string `json:"token"`
	Privata  []byte `json:"privata"` // Ed25519, 64 byte
}

// Chiave restituisce la chiave privata.
func (c Credenziali) Chiave() ed25519.PrivateKey { return ed25519.PrivateKey(c.Privata) }

// NuovaCoppia genera la coppia Ed25519 dell'agente (alla prima abbinamento).
func NuovaCoppia() (ed25519.PublicKey, ed25519.PrivateKey, error) {
	return ed25519.GenerateKey(rand.Reader)
}

// Custode conserva le credenziali in un file: su Windows cifrate con DPAPI (macchina), altrove 0600.
type Custode struct{ Percorso string }

// Salva scrive le credenziali in modo atomico.
func (c Custode) Salva(cr Credenziali) error {
	if len(cr.Privata) != ed25519.PrivateKeySize || cr.Token == "" || cr.AgenteID == "" {
		return errors.New("credenziali incomplete")
	}
	raw, err := json.Marshal(cr)
	if err != nil {
		return err
	}
	blob, err := proteggi(raw)
	if err != nil {
		return fmt.Errorf("protezione delle credenziali: %w", err)
	}
	return fsatomic.Scrivi(c.Percorso, blob, 0o600)
}

// Carica legge le credenziali; errore se il file manca, e' alterato o e' di un'altra macchina.
func (c Custode) Carica() (Credenziali, error) {
	var cr Credenziali
	blob, err := leggi(c.Percorso)
	if err != nil {
		return cr, err
	}
	raw, err := sproteggi(blob)
	if err != nil {
		return cr, fmt.Errorf("lettura delle credenziali: %w", err)
	}
	if err := json.Unmarshal(raw, &cr); err != nil {
		return cr, fmt.Errorf("credenziali illeggibili: %w", err)
	}
	if len(cr.Privata) != ed25519.PrivateKeySize || cr.Token == "" || cr.AgenteID == "" {
		return Credenziali{}, errors.New("credenziali incomplete")
	}
	return cr, nil
}
