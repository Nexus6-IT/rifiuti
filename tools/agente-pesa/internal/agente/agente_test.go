package agente

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"wasteflow/agente-pesa/internal/config"
	_ "wasteflow/agente-pesa/internal/driver/simulata"
)

func attendi(t *testing.T, cosa string, cond func() bool) {
	t.Helper()
	fine := time.Now().Add(15 * time.Second)
	for time.Now().Before(fine) {
		if cond() {
			return
		}
		time.Sleep(5 * time.Millisecond)
	}
	t.Fatalf("scaduto il tempo: %s", cosa)
}

func opzioni(t *testing.T) Opzioni {
	return Opzioni{
		Dati: t.TempDir(), Versione: "test",
		IntervalloInvio: 5 * time.Millisecond, IntervalloBattito: 20 * time.Millisecond,
		BackoffMin: 5 * time.Millisecond, BackoffMax: 20 * time.Millisecond,
	}
}

// preparata abbina l'agente al server finto e compila driver e parametri come farebbe il tecnico.
func preparata(t *testing.T, srv *serverFinto, sim bool, parametri string) Opzioni {
	t.Helper()
	o := opzioni(t)
	r, err := Abbina(context.Background(), o, srv.URL, "ABCD-EFGH-JKMN")
	if err != nil || r.AgenteID != idAgente || r.Token != tokenProva {
		t.Fatalf("abbinamento %+v err %v", r, err)
	}
	pc := filepath.Join(o.Dati, config.NomeFile)
	c, err := config.Carica(pc)
	if err != nil || len(c.Strumenti) != 1 || c.Strumenti[0].StrumentoID != idStrumento {
		t.Fatalf("config dopo l'abbinamento %+v err %v", c, err)
	}
	c.Simulazione = sim
	c.Strumenti[0].Driver = "SIMULATA"
	c.Strumenti[0].Parametri = []byte(parametri)
	if err := config.Salva(pc, c); err != nil {
		t.Fatal(err)
	}
	return o
}

type avviato struct {
	stop func() error
}

// avvia lancia Esegui; stop e' idempotente e aspetta davvero la fine (prima della pulizia delle cartelle).
func avvia(t *testing.T, o Opzioni) *avviato {
	ctx, annulla := context.WithCancel(context.Background())
	fine := make(chan error, 1)
	go func() { fine <- Esegui(ctx, o) }()
	var once sync.Once
	var esito error
	stop := func() error {
		once.Do(func() { annulla(); esito = <-fine })
		return esito
	}
	t.Cleanup(func() { stop() })
	return &avviato{stop: stop}
}

func TestAbbinaEEseguiConDueLetture(t *testing.T) {
	srv := nuovoServerFinto(t)
	o := preparata(t, srv, true, `{"pesi":[24880,12540],"intervalloMs":10}`)
	a := avvia(t, o)
	attendi(t, "due letture accettate", func() bool { return srv.numAccettate() >= 2 })
	attendi(t, "tre battiti", func() bool { srv.mu.Lock(); defer srv.mu.Unlock(); return len(srv.battiti) >= 3 })
	if err := a.stop(); err != nil {
		t.Fatal(err)
	}
	srv.mu.Lock()
	defer srv.mu.Unlock()
	if srv.firmeErrate != 0 {
		t.Fatalf("%d firme errate", srv.firmeErrate)
	}
	for i, p := range srv.accettate {
		if !p.Stabile || !p.Simulata || p.Driver != "SIMULATA" || p.AgenteID != idAgente || p.StrumentoID != idStrumento {
			t.Fatalf("lettura %d: %+v", i, p)
		}
		if p.Sequenza != int64(i+1) {
			t.Fatalf("sequenza %d alla posizione %d", p.Sequenza, i)
		}
	}
	if srv.accettate[0].PesoKg != "24880.00" || srv.accettate[1].PesoKg != "12540.00" {
		t.Fatalf("pesi %s %s", srv.accettate[0].PesoKg, srv.accettate[1].PesoKg)
	}
	if srv.accettate[0].AlibiID == nil || *srv.accettate[0].AlibiID != "SIM-000001" {
		t.Fatalf("alibi %v", srv.accettate[0].AlibiID)
	}
	b := srv.battiti[0]
	if b["versione"] != "test" || b["oraAgente"] == nil {
		t.Fatalf("battito %+v", b)
	}
	sts := b["strumenti"].([]any)
	if len(sts) != 1 || sts[0].(map[string]any)["strumentoId"] != idStrumento {
		t.Fatalf("strumenti nel battito %+v", sts)
	}
	st, k, err := LeggiStato(o.Dati)
	if err != nil || st.AgenteID != idAgente || st.Instabili == 0 || len(st.Strumenti) != 1 || st.Strumenti[0].Stato != "OK" || k.Inviate < 2 {
		t.Fatalf("stato %+v coda %+v err %v", st, k, err)
	}
}

func TestServerGiuPoiSuTutteInviateInOrdine(t *testing.T) {
	srv := nuovoServerFinto(t)
	srv.giu.Store(true)
	o := preparata(t, srv, true, `{"pesi":[100,200,300],"intervalloMs":2}`)
	avvia(t, o)
	inAttesa := func() int {
		es, _ := os.ReadDir(filepath.Join(o.Dati, "in-attesa"))
		n := 0
		for _, e := range es {
			if strings.HasSuffix(e.Name(), ".json") {
				n++
			}
		}
		return n
	}
	attendi(t, "50 letture in coda", func() bool { return inAttesa() >= 50 })
	if srv.numAccettate() != 0 {
		t.Fatal("il server e' giu': nessuna lettura puo' essere accettata")
	}
	srv.giu.Store(false)
	attendi(t, "50 letture accettate", func() bool { return srv.numAccettate() >= 50 })
	srv.mu.Lock()
	defer srv.mu.Unlock()
	if srv.firmeErrate != 0 || srv.duplicati != 0 {
		t.Fatalf("firme errate %d, duplicati %d", srv.firmeErrate, srv.duplicati)
	}
	for i, p := range srv.accettate {
		if p.Sequenza != int64(i+1) {
			t.Fatalf("ordine rotto: posizione %d ha sequenza %d", i, p.Sequenza)
		}
	}
}

func TestSimulazioneRifiutataDalServer(t *testing.T) {
	srv := nuovoServerFinto(t)
	srv.simAmmessa.Store(false)
	o := preparata(t, srv, true, `{"pesi":[100],"intervalloMs":2}`)
	a := avvia(t, o)
	attendi(t, "stato scritto", func() bool {
		st, _, err := LeggiStato(o.Dati)
		return err == nil && len(st.Strumenti) == 1 && st.Strumenti[0].Stato == "NON_CONFIGURATO"
	})
	time.Sleep(100 * time.Millisecond)
	if err := a.stop(); err != nil {
		t.Fatal(err)
	}
	st, k, _ := LeggiStato(o.Dati)
	if !strings.Contains(st.Strumenti[0].UltimoErrore, "simulazione non ammessa") || st.SimulazioneAmmessa {
		t.Fatalf("stato %+v", st)
	}
	if srv.letture.Load() != 0 || srv.numAccettate() != 0 || k.InAttesa != 0 || st.UltimaSequenza != 0 {
		t.Fatalf("il driver non doveva partire: letture %d coda %+v", srv.letture.Load(), k)
	}
}

func TestArrestoLasciaLaCodaCoerente(t *testing.T) {
	srv := nuovoServerFinto(t)
	srv.giu.Store(true)
	o := preparata(t, srv, true, `{"pesi":[100],"intervalloMs":2}`)
	a := avvia(t, o)
	attendi(t, "qualche lettura in coda", func() bool {
		es, _ := os.ReadDir(filepath.Join(o.Dati, "in-attesa"))
		return len(es) >= 5
	})
	if err := a.stop(); err != nil {
		t.Fatal(err)
	}
	es, _ := os.ReadDir(filepath.Join(o.Dati, "in-attesa"))
	for _, e := range es {
		if strings.HasSuffix(e.Name(), ".tmp") {
			t.Fatalf("file temporaneo rimasto: %s", e.Name())
		}
	}
	st, k, _ := LeggiStato(o.Dati)
	if st.CodaInAttesa != k.InAttesa || k.InAttesa != len(es) {
		t.Fatalf("stato %d, cartella %d, elenco %d", st.CodaInAttesa, k.InAttesa, len(es))
	}
}

func TestEseguiSenzaAbbinamento(t *testing.T) {
	o := opzioni(t)
	err := Esegui(context.Background(), o)
	if err == nil || !strings.Contains(err.Error(), "abbina") {
		t.Fatalf("errore %v", err)
	}
}

func TestAbbinaCodiceErratoEDoppio(t *testing.T) {
	srv := nuovoServerFinto(t)
	o := opzioni(t)
	if _, err := Abbina(context.Background(), o, srv.URL, "SBAGLIATO"); err == nil {
		t.Fatal("codice errato: attesa un errore")
	}
	if _, err := os.Stat(filepath.Join(o.Dati, FileCredenziali)); err == nil {
		t.Fatal("nessuna credenziale deve essere salvata se l'abbinamento fallisce")
	}
	if _, err := Abbina(context.Background(), o, srv.URL, "ABCD-EFGH-JKMN"); err != nil {
		t.Fatal(err)
	}
	if _, err := Abbina(context.Background(), o, srv.URL, "ABCD-EFGH-JKMN"); err == nil {
		t.Fatal("secondo abbinamento sullo stesso PC: atteso un errore")
	}
}
