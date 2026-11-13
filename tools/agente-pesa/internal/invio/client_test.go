package invio

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
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
		if err := c.Accoda(coda.Elemento{PayloadB64: base64.StdEncoding.EncodeToString([]byte(fmt.Sprintf("p%d", i))), FirmaB64: "cw==", ChiaveIdempotenza: chiave(i), Sequenza: int64(i)}); err != nil {
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
	f.m.Coda.Adesso = f.clock.Adesso
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
			{"chiaveIdempotenza": chiave(2), "esito": "RIFIUTATA", "codice": "PESO_NON_VALIDO", "messaggio": "troppo"},
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

// esitiPer risponde con un esito per elemento, scelto da f(indice).
func esitiPer(w http.ResponseWriter, n int, f func(i int) map[string]any) {
	var es []map[string]any
	for i := 1; i <= n; i++ {
		es = append(es, f(i))
	}
	rispondi(w, 200, map[string]any{"esiti": es})
}

func TestRifiutoTransitorioRestaInCodaEPoiArriva(t *testing.T) {
	for _, codice := range []string{"OROLOGIO_AVANTI", "STRUMENTO_NON_ASSEGNATO", "STRUMENTO_NON_ATTIVO", "FUORI_PORTATA"} {
		t.Run(codice, func(t *testing.T) {
			var rifiuti atomic.Int32
			f := nuovo(t, 2, func(w http.ResponseWriter, r *http.Request, f *fixture) {
				var in struct {
					Letture []struct{ Payload string } `json:"letture"`
				}
				json.NewDecoder(r.Body).Decode(&in)
				esitiPer(w, len(in.Letture), func(i int) map[string]any {
					if rifiuti.Load() < 3 {
						rifiuti.Add(1)
						return map[string]any{"esito": "RIFIUTATA", "codice": codice, "messaggio": "per ora no"}
					}
					return map[string]any{"esito": "ACCETTATA", "letturaId": "L"}
				})
			})
			r := f.m.Ciclo(context.Background())
			if r.Rifiutate != 0 || r.Sospese != 2 || r.Inviate != 0 {
				t.Fatalf("risultato %+v", r)
			}
			if k := f.m.Coda.Conta(); k.InAttesa != 2 || k.Scartate != 0 {
				t.Fatalf("la lettura deve restare in coda: %+v", k)
			}
			// finche' non scade la riprova non si richiama il server
			n := f.chiamate.Load()
			f.m.Ciclo(context.Background())
			if f.chiamate.Load() != n {
				t.Fatal("nessuna chiamata prima della riprova")
			}
			// riprove con backoff crescente fino al successo
			for giri := 0; f.m.Coda.Conta().InAttesa > 0 && giri < 20; giri++ {
				f.clock.Avanza(time.Hour)
				f.m.Ciclo(context.Background())
			}
			if k := f.m.Coda.Conta(); k.InAttesa != 0 || k.Inviate != 2 || k.Scartate != 0 {
				t.Fatalf("alla fine devono essere arrivate: %+v", k)
			}
		})
	}
}

func TestRifiutoDefinitivoOSconosciutoVaInScartate(t *testing.T) {
	for _, codice := range []string{"FIRMA_NON_VALIDA", "AGENTE_DIVERSO", "PESO_INSTABILE", "PESO_NON_VALIDO", "SIMULAZIONE_NON_AMMESSA",
		"CHIAVE_RIUSATA", "ALIBI_GIA_USATO", "PAYLOAD_NON_VALIDO", "CODICE_DEL_FUTURO", ""} {
		t.Run(codice, func(t *testing.T) {
			f := nuovo(t, 1, func(w http.ResponseWriter, r *http.Request, f *fixture) {
				esitiPer(w, 1, func(int) map[string]any {
					return map[string]any{"esito": "RIFIUTATA", "codice": codice, "messaggio": "no"}
				})
			})
			r := f.m.Ciclo(context.Background())
			if r.Rifiutate != 1 || r.Sospese != 0 {
				t.Fatalf("risultato %+v", r)
			}
			if k := f.m.Coda.Conta(); k.InAttesa != 0 || k.Scartate != 1 {
				t.Fatalf("coda %+v", k)
			}
		})
	}
}

func TestSospesaScartataDopoSetteGiorni(t *testing.T) {
	f := nuovo(t, 1, func(w http.ResponseWriter, r *http.Request, f *fixture) {
		esitiPer(w, 1, func(int) map[string]any {
			return map[string]any{"esito": "RIFIUTATA", "codice": "OROLOGIO_AVANTI", "messaggio": "avanti"}
		})
	})
	for giorni := 0; giorni < 9; giorni++ {
		f.m.Ciclo(context.Background())
		f.clock.Avanza(24 * time.Hour)
	}
	if k := f.m.Coda.Conta(); k.InAttesa != 0 || k.Scartate != 1 {
		t.Fatalf("coda %+v", k)
	}
}

// avvelenato risponde 400 a qualunque lotto con piu' di un elemento che contiene la lettura 2.
func avvelenato(w http.ResponseWriter, r *http.Request, f *fixture) {
	var in struct {
		Letture []struct{ Payload string } `json:"letture"`
	}
	json.NewDecoder(r.Body).Decode(&in)
	ha2 := false
	for _, l := range in.Letture {
		b, _ := base64.StdEncoding.DecodeString(l.Payload)
		ha2 = ha2 || string(b) == "p2"
	}
	if ha2 {
		rispondi(w, 400, map[string]any{"error": "Bad Request", "message": "letture.1.payload non valido"})
		return
	}
	esitiPer(w, len(in.Letture), func(int) map[string]any { return map[string]any{"esito": "ACCETTATA", "letturaId": "L"} })
}

func TestLottoAvvelenatoNonBloccaLaCoda(t *testing.T) {
	f := nuovo(t, 4, avvelenato)
	r := f.m.Ciclo(context.Background())
	if r.Inviate != 4 || r.Rifiutate != 1 || r.Attesa != 0 {
		t.Fatalf("risultato %+v", r)
	}
	if k := f.m.Coda.Conta(); k.InAttesa != 0 || k.Inviate != 3 || k.Scartate != 1 {
		t.Fatalf("coda %+v", k)
	}
	m, err := os.ReadFile(filepath.Join(f.m.Coda.Dir(), "scartate", fmt.Sprintf("%012d-%s.motivo.txt", 2, chiave(2))))
	if err != nil || !strings.Contains(string(m), "HTTP_400") {
		t.Fatalf("motivo %q err %v", m, err)
	}
}

func TestSingoloElementoCon4xxDiversiRestaInCoda(t *testing.T) {
	for _, stato := range []int{404, 408, 409} {
		f := nuovo(t, 1, func(w http.ResponseWriter, r *http.Request, f *fixture) {
			rispondi(w, stato, map[string]string{"error": "boh"})
		})
		r := f.m.Ciclo(context.Background())
		if r.Errore == nil || f.m.Coda.Conta().InAttesa != 1 {
			t.Fatalf("stato %d: %+v", stato, r)
		}
	}
}

func TestLottoEffettivo(t *testing.T) {
	for in, atteso := range map[int]int{0: 50, -3: 50, 1: 1, 10: 10, 50: 50, 51: 50, 1000: 50} {
		if got := (&Mittente{Lotto: in}).LottoEffettivo(); got != atteso {
			t.Errorf("Lotto %d -> %d, atteso %d", in, got, atteso)
		}
	}
}

func TestRetryAfterEnormeHaUnTetto(t *testing.T) {
	f := nuovo(t, 1, func(w http.ResponseWriter, r *http.Request, f *fixture) {
		w.Header().Set("Retry-After", "86400")
		rispondi(w, 429, map[string]string{"error": "TROPPE_RICHIESTE"})
	})
	if r := f.m.Ciclo(context.Background()); r.Attesa != 10*time.Minute {
		t.Fatalf("attesa %v", r.Attesa)
	}
}

func TestChiaveDellEsitoDiversaNonSegnaNulla(t *testing.T) {
	f := nuovo(t, 1, func(w http.ResponseWriter, r *http.Request, f *fixture) {
		esitiPer(w, 1, func(int) map[string]any {
			return map[string]any{"chiaveIdempotenza": chiave(99), "esito": "ACCETTATA"}
		})
	})
	r := f.m.Ciclo(context.Background())
	if r.Errore == nil || f.m.Coda.Conta().InAttesa != 1 {
		t.Fatalf("risultato %+v", r)
	}
}

func TestMutexLiberoDuranteLaChiamataHTTP(t *testing.T) {
	dentro, via := make(chan struct{}), make(chan struct{})
	f := nuovo(t, 1, func(w http.ResponseWriter, r *http.Request, f *fixture) {
		close(dentro)
		<-via
		esitiPer(w, 1, func(int) map[string]any { return map[string]any{"esito": "ACCETTATA"} })
	})
	fine := make(chan Risultato)
	go func() { fine <- f.m.Ciclo(context.Background()) }()
	<-dentro
	ok := make(chan struct{})
	go func() { f.m.SegnaRevocato(); close(ok) }()
	select {
	case <-ok:
	case <-time.After(2 * time.Second):
		t.Fatal("SegnaRevocato bloccato mentre l'invio e' in corso")
	}
	close(via)
	<-fine
}

func TestRedirectNonSeguiti(t *testing.T) {
	var arrivi atomic.Int32
	altro := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		arrivi.Add(1)
		rispondi(w, 200, map[string]any{})
	}))
	defer altro.Close()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, altro.URL+"/x", http.StatusTemporaryRedirect)
	}))
	defer srv.Close()
	cl, _ := NuovoClient(srv.URL, token, "test", nil)
	if _, err := cl.Configurazione(context.Background()); err == nil {
		t.Fatal("un redirect e' un errore")
	}
	if arrivi.Load() != 0 {
		t.Fatal("il redirect e' stato seguito (e con lui l'header Authorization)")
	}
}
