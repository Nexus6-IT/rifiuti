package agente

import (
	"crypto/ed25519"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"sync"
	"sync/atomic"
	"testing"

	"wasteflow/agente-pesa/internal/firma"
	"wasteflow/agente-pesa/internal/lettura"
)

const (
	idAgente    = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
	idStrumento = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
	tokenProva  = "wfpa_token_di_prova_0123456789"
)

// serverFinto implementa le quattro rotte del backend (D8) e verifica davvero le firme con la
// chiave pubblica ricevuta all'abbinamento.
type serverFinto struct {
	*httptest.Server
	mu          sync.Mutex
	pub         ed25519.PublicKey
	simAmmessa  atomic.Bool
	giu         atomic.Bool // letture e battito rispondono 503
	accettate   []lettura.Payload
	viste       map[string]bool
	firmeErrate int
	duplicati   int
	battiti     []map[string]any
	letture     atomic.Int32
}

func nuovoServerFinto(t *testing.T) *serverFinto {
	s := &serverFinto{viste: map[string]bool{}}
	s.simAmmessa.Store(true)
	s.Server = httptest.NewServer(http.HandlerFunc(s.gestisci))
	t.Cleanup(s.Close)
	return s
}

func json200(w http.ResponseWriter, stato int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(stato)
	json.NewEncoder(w).Encode(v)
}

func (s *serverFinto) strumenti() []map[string]string {
	return []map[string]string{{"id": idStrumento, "descrizione": "Ponte 1", "matricola": "M1"}}
}

func (s *serverFinto) gestisci(w http.ResponseWriter, r *http.Request) {
	if r.URL.Path != "/agenti-pesa/abbinamento" && r.Header.Get("Authorization") != "Bearer "+tokenProva {
		json200(w, 401, map[string]string{"error": "TOKEN_NON_VALIDO"})
		return
	}
	switch r.URL.Path {
	case "/agenti-pesa/abbinamento":
		var in map[string]string
		json.NewDecoder(r.Body).Decode(&in)
		pub, err := base64.StdEncoding.DecodeString(in["chiavePubblica"])
		if in["codice"] != "ABCD-EFGH-JKMN" || err != nil || len(pub) != 32 {
			json200(w, 401, map[string]string{"error": "CODICE_NON_VALIDO", "message": "Codice di abbinamento non valido o scaduto."})
			return
		}
		s.mu.Lock()
		s.pub = pub
		s.mu.Unlock()
		json200(w, 201, map[string]any{"agenteId": idAgente, "token": tokenProva, "azienda": map[string]string{"ragioneSociale": "Prova Srl"},
			"strumenti": s.strumenti(), "simulazioneAmmessa": s.simAmmessa.Load()})
	case "/agenti-pesa/configurazione":
		json200(w, 200, map[string]any{"agenteId": idAgente, "azienda": map[string]string{"ragioneSociale": "Prova Srl"}, "strumenti": s.strumenti(),
			"simulazioneAmmessa": s.simAmmessa.Load(), "intervalloBattitoS": 60, "lottoMassimo": 50, "oraServer": "2026-11-13T10:00:00.000Z"})
	case "/agenti-pesa/battito":
		if s.giu.Load() {
			json200(w, 503, map[string]string{"error": "NON_DISPONIBILE"})
			return
		}
		var in map[string]any
		json.NewDecoder(r.Body).Decode(&in)
		s.mu.Lock()
		s.battiti = append(s.battiti, in)
		s.mu.Unlock()
		json200(w, 200, map[string]any{"oraServer": "2026-11-13T10:00:00.000Z", "simulazioneAmmessa": s.simAmmessa.Load(), "revocato": false})
	case "/agenti-pesa/letture":
		s.letture.Add(1)
		if s.giu.Load() {
			json200(w, 503, map[string]string{"error": "NON_DISPONIBILE"})
			return
		}
		var in struct {
			Letture []struct{ Payload, Firma string } `json:"letture"`
		}
		json.NewDecoder(r.Body).Decode(&in)
		s.mu.Lock()
		defer s.mu.Unlock()
		var esiti []map[string]any
		for _, e := range in.Letture {
			pay, _ := base64.StdEncoding.DecodeString(e.Payload)
			sig, _ := base64.StdEncoding.DecodeString(e.Firma)
			var p lettura.Payload
			if !firma.Verifica(s.pub, pay, sig) || json.Unmarshal(pay, &p) != nil {
				s.firmeErrate++
				esiti = append(esiti, map[string]any{"chiaveIdempotenza": nil, "esito": "RIFIUTATA", "codice": "FIRMA_NON_VALIDA", "messaggio": "firma"})
				continue
			}
			if s.viste[p.ChiaveIdempotenza] {
				s.duplicati++
				esiti = append(esiti, map[string]any{"chiaveIdempotenza": p.ChiaveIdempotenza, "esito": "GIA_RICEVUTA"})
				continue
			}
			s.viste[p.ChiaveIdempotenza] = true
			s.accettate = append(s.accettate, p)
			esiti = append(esiti, map[string]any{"chiaveIdempotenza": p.ChiaveIdempotenza, "esito": "ACCETTATA", "letturaId": "L"})
		}
		json200(w, 200, map[string]any{"esiti": esiti})
	default:
		http.NotFound(w, r)
	}
}

func (s *serverFinto) numAccettate() int {
	s.mu.Lock()
	defer s.mu.Unlock()
	return len(s.accettate)
}
