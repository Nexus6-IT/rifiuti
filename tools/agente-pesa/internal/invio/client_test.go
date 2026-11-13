package invio

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"wasteflow/agente-pesa/internal/coda"
	"wasteflow/agente-pesa/internal/orologio"
)

const token = "wfpa_SEGRETISSIMO_token_di_prova"

func chiave(n int) string { return fmt.Sprintf("00000000-0000-4000-8000-%012d", n) }

func riempi(t *testing.T, n int) *coda.Coda {
	t.Helper()
	c, err := coda.Apri(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	for i := 1; i <= n; i++ {
		if err := c.Accoda(coda.Elemento{PayloadB64: "cA==", FirmaB64: "cw==", ChiaveIdempotenza: chiave(i), Sequenza: int64(i)}); err != nil {
			t.Fatal(err)
		}
	}
	return c
}

type fixture struct {
	srv      *httptest.Server
	m        *Mittente
	clock    *orologio.Finto
	log      *bytes.Buffer
	chiamate atomic.Int32
}

func nuovo(t *testing.T, n int, h func(w http.ResponseWriter, r *http.Request, f *fixture)) *fixture {
	t.Helper()
	f := &fixture{clock: orologio.NuovoFinto(time.Date(2026, 11, 13, 10, 0, 0, 0, time.UTC)), log: &bytes.Buffer{}}
	f.srv = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		f.chiamate.Add(1)
		if r.Header.Get("Authorization") != "Bearer "+token {
			t.Errorf("header Authorization inatteso: %q", r.Header.Get("Authorization"))
		}
		if !strings.HasPrefix(r.UserAgent(), "agente-pesa/") {
			t.Errorf("user agent %q", r.UserAgent())
		}
		h(w, r, f)
	}))
	t.Cleanup(f.srv.Close)
	log := slog.New(slog.NewTextHandler(f.log, &slog.HandlerOptions{Level: slog.LevelDebug}))
	cl, err := NuovoClient(f.srv.URL, token, "test", log)
	if err != nil {
		t.Fatal(err)
	}
	f.m = &Mittente{Client: cl, Coda: riempi(t, n), Orologio: f.clock, Log: log, BackoffMin: time.Second, BackoffMax: 5 * time.Minute}
	return f
}

func rispondi(w http.ResponseWriter, stato int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(stato)
	json.NewEncoder(w).Encode(v)
}

func TestAbbinamentoRestituisceTokenEStrumenti(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var in map[string]string
		json.NewDecoder(r.Body).Decode(&in)
		if r.URL.Path != "/agenti-pesa/abbinamento" || r.Header.Get("Authorization") != "" || in["codice"] != "ABCD-EFGH-JKMN" {
			t.Errorf("richiesta inattesa: %s %v", r.URL.Path, in)
		}
		rispondi(w, 201, map[string]any{"agenteId": "a1", "token": "wfpa_nuovo", "azienda": map[string]string{"ragioneSociale": "Rossi Srl"},
			"strumenti": []map[string]string{{"id": "s1", "descrizione": "Ponte 1", "matricola": "M1"}}, "simulazioneAmmessa": true})
	}))
	defer srv.Close()
	cl, _ := NuovoClient(srv.URL, "", "test", nil)
	r, err := cl.Abbina(context.Background(), "ABCD-EFGH-JKMN", "Y2hpYXZl", "PC-PESA", "test")
	if err != nil || r.Token != "wfpa_nuovo" || r.Azienda.RagioneSociale != "Rossi Srl" || len(r.Strumenti) != 1 || !r.SimulazioneAmmessa {
		t.Fatalf("risposta %+v err %v", r, err)
	}
}

func TestAbbinamentoCodiceNonValido(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		rispondi(w, 401, map[string]string{"error": "CODICE_NON_VALIDO", "message": "Codice di abbinamento non valido o scaduto."})
	}))
	defer srv.Close()
	cl, _ := NuovoClient(srv.URL, "", "test", nil)
	_, err := cl.Abbina(context.Background(), "x", "y", "h", "v")
	h, ok := err.(*ErrHTTP)
	if !ok || h.Stato != 401 || h.Codice != "CODICE_NON_VALIDO" || !strings.Contains(h.Messaggio, "scaduto") {
		t.Fatalf("errore %v", err)
	}
}

func TestLottoConEsitiMisti(t *testing.T) {
	f := nuovo(t, 3, func(w http.ResponseWriter, r *http.Request, f *fixture) {
		rispondi(w, 200, map[string]any{"esiti": []map[string]any{
			{"chiaveIdempotenza": chiave(1), "esito": "ACCETTATA", "letturaId": "L1"},
			{"chiaveIdempotenza": chiave(2), "esito": "RIFIUTATA", "codice": "FUORI_PORTATA", "messaggio": "troppo"},
			{"chiaveIdempotenza": chiave(3), "esito": "GIA_RICEVUTA"},
		}})
	})
	r := f.m.Ciclo(context.Background())
	if r.Inviate != 3 || r.Rifiutate != 1 || r.Errore != nil || r.Attesa != 0 {
		t.Fatalf("risultato %+v", r)
	}
	if k := f.m.Coda.Conta(); k.InAttesa != 0 || k.Inviate != 2 || k.Scartate != 1 {
		t.Fatalf("coda %+v", k)
	}
}

func TestRetryAfterRispettato(t *testing.T) {
	var vera atomic.Bool
	f := nuovo(t, 1, func(w http.ResponseWriter, r *http.Request, f *fixture) {
		if !vera.Load() {
			w.Header().Set("Retry-After", "7")
			rispondi(w, 429, map[string]string{"error": "TROPPE_RICHIESTE"})
			return
		}
		rispondi(w, 200, map[string]any{"esiti": []map[string]any{{"esito": "ACCETTATA"}}})
	})
	r := f.m.Ciclo(context.Background())
	if r.Attesa != 7*time.Second {
		t.Fatalf("attesa %v", r.Attesa)
	}
	vera.Store(true)
	f.clock.Avanza(3 * time.Second)
	n := f.chiamate.Load()
	if r := f.m.Ciclo(context.Background()); r.Attesa != 4*time.Second || f.chiamate.Load() != n {
		t.Fatalf("durante l'attesa non si deve chiamare il server: %+v", r)
	}
	f.clock.Avanza(4 * time.Second)
	if r := f.m.Ciclo(context.Background()); r.Inviate != 1 {
		t.Fatalf("risultato %+v", r)
	}
}

func TestBackoffCrescenteConTetto(t *testing.T) {
	f := nuovo(t, 1, func(w http.ResponseWriter, r *http.Request, f *fixture) {
		rispondi(w, 503, map[string]string{"error": "NON_DISPONIBILE"})
	})
	var viste []time.Duration
	for i := 0; i < 11; i++ {
		r := f.m.Ciclo(context.Background())
		viste = append(viste, r.Attesa)
		f.clock.Avanza(r.Attesa)
	}
	atteso := []time.Duration{1, 2, 4, 8, 16, 32, 64, 128, 256, 300, 300}
	for i, a := range atteso {
		if viste[i] != a*time.Second {
			t.Fatalf("backoff %v, atteso %v...", viste, atteso)
		}
	}
	if f.m.Coda.Conta().InAttesa != 1 {
		t.Fatal("la lettura deve restare in coda")
	}
}

func TestReteChiusaNessunaPerdita(t *testing.T) {
	f := nuovo(t, 2, func(w http.ResponseWriter, r *http.Request, f *fixture) {})
	f.srv.Close()
	r := f.m.Ciclo(context.Background())
	if r.Errore == nil || r.Attesa != time.Second || f.m.Coda.Conta().InAttesa != 2 {
		t.Fatalf("risultato %+v", r)
	}
}

func TestRevocaFermaInvioPerDieciMinuti(t *testing.T) {
	var vera atomic.Bool
	f := nuovo(t, 1, func(w http.ResponseWriter, r *http.Request, f *fixture) {
		if !vera.Load() {
			rispondi(w, 403, map[string]string{"error": "AGENTE_REVOCATO", "message": "revocato"})
			return
		}
		rispondi(w, 200, map[string]any{"esiti": []map[string]any{{"esito": "ACCETTATA"}}})
	})
	r := f.m.Ciclo(context.Background())
	if !r.Revocato || r.Attesa != 10*time.Minute || !f.m.Revocato() {
		t.Fatalf("risultato %+v", r)
	}
	n := f.chiamate.Load()
	f.clock.Avanza(9 * time.Minute)
	f.m.Ciclo(context.Background())
	if f.chiamate.Load() != n {
		t.Fatal("nessun invio durante la pausa di revoca")
	}
	vera.Store(true) // per esempio il servizio e' stato ripristinato
	f.clock.Avanza(2 * time.Minute)
	if r := f.m.Ciclo(context.Background()); r.Inviate != 1 || f.m.Revocato() {
		t.Fatalf("risultato %+v", r)
	}
}

func TestHttpVersoHostNonLocaleRifiutato(t *testing.T) {
	if _, err := NuovoClient("http://wasteflow.example", "t", "v", nil); err == nil {
		t.Fatal("http verso un host non locale deve essere un errore di configurazione")
	}
	if _, err := NuovoClient("https://wasteflow.example", "t", "v", nil); err != nil {
		t.Fatal(err)
	}
}

func TestTokenMaiNelLog(t *testing.T) {
	f := nuovo(t, 1, func(w http.ResponseWriter, r *http.Request, f *fixture) {
		rispondi(w, 500, map[string]string{"error": "ERRORE", "message": "boom"})
	})
	f.m.Ciclo(context.Background())
	f.srv.Close()
	f.clock.Avanza(time.Hour)
	f.m.Ciclo(context.Background())
	if f.log.Len() == 0 {
		t.Fatal("il test deve produrre log")
	}
	if strings.Contains(f.log.String(), "SEGRETISSIMO") || strings.Contains(f.log.String(), "wfpa_") {
		t.Fatalf("token nel log: %s", f.log.String())
	}
}

func TestNumeroEsitiDiversoNonSegnaNulla(t *testing.T) {
	f := nuovo(t, 2, func(w http.ResponseWriter, r *http.Request, f *fixture) {
		rispondi(w, 200, map[string]any{"esiti": []map[string]any{{"esito": "ACCETTATA"}}})
	})
	r := f.m.Ciclo(context.Background())
	if r.Errore == nil || f.m.Coda.Conta().InAttesa != 2 {
		t.Fatalf("risultato %+v", r)
	}
}
