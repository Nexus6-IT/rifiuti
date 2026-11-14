package agente

import (
	"context"
	"encoding/base64"
	"errors"
	"fmt"
	"os"
	"path/filepath"

	"wasteflow/agente-pesa/internal/config"
	"wasteflow/agente-pesa/internal/firma"
	"wasteflow/agente-pesa/internal/invio"
	"wasteflow/agente-pesa/internal/permessi"
)

// Abbina scambia il codice di abbinamento con il token: genera la coppia Ed25519 (la privata non
// lascia mai il PC), salva credenziali (DPAPI su Windows) e configurazione. Se la configurazione
// esiste gia', ne conserva driver e parametri e aggiunge solo gli strumenti nuovi.
func Abbina(ctx context.Context, o Opzioni, server, codice string) (invio.RispostaAbbinamento, error) {
	o.predefiniti()
	var r invio.RispostaAbbinamento
	if err := config.ValidaServer(server); err != nil {
		return r, err
	}
	// Prima di ogni segreto: la cartella dati e' riservata agli amministratori fin dall'inizio, non
	// solo dopo `servizio installa` (fra i due passi la chiave privata sarebbe leggibile da tutti).
	if err := permessi.Cartella(o.Dati); err != nil {
		return r, fmt.Errorf("cartella dati non protetta, abbinamento annullato: %w", err)
	}
	cust := firma.Custode{Percorso: filepath.Join(o.Dati, FileCredenziali)}
	if _, err := os.Stat(cust.Percorso); err == nil {
		return r, errors.New("questo PC e' gia' abbinato: per un nuovo abbinamento revocare l'agente nell'interfaccia e cancellare la cartella dati")
	}
	pub, priv, err := firma.NuovaCoppia()
	if err != nil {
		return r, err
	}
	cl, err := invio.NuovoClient(server, "", o.Versione, o.Log)
	if err != nil {
		return r, err
	}
	host, _ := os.Hostname()
	if len(host) > 100 {
		host = host[:100]
	}
	r, err = cl.Abbina(ctx, codice, base64.StdEncoding.EncodeToString(pub), host, o.Versione)
	if err != nil {
		return r, err
	}
	if err := cust.Salva(firma.Credenziali{AgenteID: r.AgenteID, Token: r.Token, Privata: priv}); err != nil {
		return r, fmt.Errorf("credenziali non salvate: %w; il server ha gia' consumato il codice e l'agente risulta ATTIVO senza credenziali: revocarlo in WasteFlow e crearne uno nuovo", err)
	}
	pc := filepath.Join(o.Dati, config.NomeFile)
	c, err := config.Carica(pc)
	if err != nil && !errors.Is(err, os.ErrNotExist) {
		return r, err
	}
	c.Server = server
	for _, s := range r.Strumenti {
		trovato := false
		for _, e := range c.Strumenti {
			trovato = trovato || e.StrumentoID == s.ID
		}
		if !trovato {
			c.Strumenti = append(c.Strumenti, config.Strumento{StrumentoID: s.ID})
		}
	}
	return r, config.Salva(pc, c)
}
