package invio

import (
	"context"
	"net/http"
	"sync/atomic"
	"testing"
	"time"

	"wasteflow/agente-pesa/internal/coda"
)

// Il server elabora il lotto ma la risposta si perde (connessione chiusa prima di rispondere):
// l'agente non sa nulla, la lettura resta in coda; al giro dopo il server dice GIA_RICEVUTA e la
// lettura va in inviate. Nessuna perdita, nessun duplicato.
func TestRispostaPersaDopoLElaborazioneEPoiGiaRicevuta(t *testing.T) {
	var giro atomic.Int32
	f := nuovo(t, 1, func(w http.ResponseWriter, r *http.Request, f *fixture) {
		if giro.Add(1) == 1 {
			conn, _, err := w.(http.Hijacker).Hijack()
			if err != nil {
				t.Error(err)
				return
			}
			conn.Close() // elaborata lato server, risposta mai arrivata
			return
		}
		rispondi(w, 200, map[string]any{"esiti": []map[string]any{{"chiaveIdempotenza": chiave(1), "esito": "GIA_RICEVUTA"}}})
	})
	r := f.m.Ciclo(context.Background())
	if r.Errore == nil || r.Inviate != 0 || f.m.Coda.Conta().InAttesa != 1 {
		t.Fatalf("primo giro %+v, coda %+v", r, f.m.Coda.Conta())
	}
	f.clock.Avanza(time.Minute)
	r = f.m.Ciclo(context.Background())
	if k := f.m.Coda.Conta(); r.Inviate != 1 || r.Errore != nil || k.InAttesa != 0 || k.Inviate != 1 || k.Scartate != 0 {
		t.Fatalf("secondo giro %+v, coda %+v", r, k)
	}
}

// Riavvio a meta' coda: 2 letture su 4 gia' consegnate, un nuovo Mittente su una Coda riaperta
// dalla stessa cartella invia solo le altre, in ordine di sequenza.
func TestRiavvioAMetaCodaInviaSoloLeRimaste(t *testing.T) {
	var viste []int
	var corrente *Mittente
	f := nuovo(t, 4, func(w http.ResponseWriter, r *http.Request, f *fixture) {
		el, _ := corrente.Coda.Prossimi(corrente.LottoEffettivo())
		esiti := make([]map[string]any, len(el))
		for i, e := range el {
			viste = append(viste, int(e.Sequenza))
			esiti[i] = map[string]any{"chiaveIdempotenza": e.ChiaveIdempotenza, "esito": "ACCETTATA"}
		}
		rispondi(w, 200, map[string]any{"esiti": esiti})
	})
	corrente = f.m
	f.m.Lotto = 2
	if r := f.m.Ciclo(context.Background()); r.Inviate != 2 {
		t.Fatalf("primo lotto %+v", r)
	}
	// "crash" e riavvio: nuova coda e nuovo mittente sulla stessa cartella
	c2, err := coda.Apri(f.m.Coda.Dir())
	if err != nil {
		t.Fatal(err)
	}
	c2.Adesso = f.clock.Adesso
	m2 := &Mittente{Client: f.m.Client, Coda: c2, Orologio: f.clock, Log: f.m.Log, Lotto: 2, BackoffMin: time.Second, BackoffMax: 5 * time.Minute}
	corrente = m2
	if r := m2.Ciclo(context.Background()); r.Inviate != 2 || r.Errore != nil {
		t.Fatalf("dopo il riavvio %+v", r)
	}
	if len(viste) != 4 || viste[0] != 1 || viste[1] != 2 || viste[2] != 3 || viste[3] != 4 {
		t.Fatalf("sequenze viste dal server %v: ognuna una sola volta, in ordine", viste)
	}
	if k := m2.Coda.Conta(); k.InAttesa != 0 || k.Inviate != 4 {
		t.Fatalf("coda %+v", k)
	}
}

// 401 sulle letture (token non piu' valido): invio fermo come per una revoca, coda intatta.
func Test401SuLettureFermaLInvio(t *testing.T) {
	f := nuovo(t, 2, func(w http.ResponseWriter, r *http.Request, f *fixture) {
		rispondi(w, 401, map[string]string{"error": "NON_AUTORIZZATO", "message": "token non valido"})
	})
	r := f.m.Ciclo(context.Background())
	if !r.Revocato || r.Attesa != PausaRevoca || !f.m.Revocato() || f.m.Coda.Conta().InAttesa != 2 {
		t.Fatalf("risultato %+v, coda %+v", r, f.m.Coda.Conta())
	}
	n := f.chiamate.Load()
	f.clock.Avanza(PausaRevoca - time.Second)
	f.m.Ciclo(context.Background())
	if f.chiamate.Load() != n {
		t.Fatal("nessun invio durante la pausa")
	}
}
