package lettura

import (
	"bytes"
	"crypto/ed25519"
	"encoding/base64"
	"encoding/json"
	"flag"
	"os"
	"regexp"
	"strings"
	"testing"
	"time"

	"wasteflow/agente-pesa/internal/driver"
	"wasteflow/agente-pesa/internal/firma"
)

var update = flag.Bool("update", false, "riscrive testdata/contratto/lettura-v1.json")

const (
	agenteID    = "6f1c2f7e-3d5a-4b8e-9a41-0c2d7e5b9a10"
	strumentoID = "a3b8d1b6-0b3b-4b3a-8a1a-5c1d2e3f4a5b"
)

func TestFormattaCentesimi(t *testing.T) {
	casi := map[int64]string{
		1234000:    "12340.00",
		5:          "0.05",
		0:          "0.00",
		99:         "0.99",
		100:        "1.00",
		9999999999: "99999999.99",
	}
	for in, atteso := range casi {
		got, err := FormattaCentesimi(in)
		if err != nil || got != atteso {
			t.Errorf("FormattaCentesimi(%d) = %q, %v; atteso %q", in, got, err, atteso)
		}
	}
	for _, in := range []int64{-1, 10000000000} {
		if _, err := FormattaCentesimi(in); err == nil {
			t.Errorf("FormattaCentesimi(%d): atteso errore", in)
		}
	}
}

func campioneBase() driver.Campione {
	ora := time.Date(2026, 11, 13, 10, 15, 2, 0, time.FixedZone("CET", 3600))
	return driver.Campione{
		Centesimi: 1234000, Stato: driver.Stabile, AlibiID: "SIM-000041",
		OraStrumento: &ora, Grezzo: []byte("ST,GS,  12340.00kg"), Definitivo: true,
	}
}

var oraAgente = time.Date(2026, 11, 13, 9, 15, 3, 123_000_000, time.UTC)

func TestNuovaPayloadHaSoloLeChiaviDiD6(t *testing.T) {
	p, err := Nuova(agenteID, strumentoID, 41, campioneBase(), oraAgente, "SIMULATA", true)
	if err != nil {
		t.Fatal(err)
	}
	var generico map[string]any
	if err := json.Unmarshal(p.Bytes(), &generico); err != nil {
		t.Fatal(err)
	}
	attese := []string{"v", "agenteId", "strumentoId", "chiaveIdempotenza", "sequenza", "pesoKg", "unita",
		"stabile", "alibiId", "oraStrumento", "oraAgente", "driver", "simulata", "grezzo"}
	if len(generico) != len(attese) {
		t.Fatalf("%d chiavi, attese %d: %s", len(generico), len(attese), p.Bytes())
	}
	for _, k := range attese {
		if _, ok := generico[k]; !ok {
			t.Errorf("chiave mancante %q", k)
		}
	}
	// Decodifica rigorosa: nessuna chiave sconosciuta.
	dec := json.NewDecoder(bytes.NewReader(p.Bytes()))
	dec.DisallowUnknownFields()
	var q Payload
	if err := dec.Decode(&q); err != nil {
		t.Fatal(err)
	}
	if q.V != 1 || q.PesoKg != "12340.00" || q.Unita != "kg" || !q.Stabile || q.Sequenza != 41 ||
		q.Driver != "SIMULATA" || !q.Simulata || q.AgenteID != agenteID || q.StrumentoID != strumentoID {
		t.Errorf("valori inattesi: %+v", q)
	}
	if !regexp.MustCompile(`^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$`).MatchString(q.ChiaveIdempotenza) {
		t.Errorf("chiaveIdempotenza non e' un uuid v4: %s", q.ChiaveIdempotenza)
	}
	if q.OraStrumento == nil || *q.OraStrumento != "2026-11-13T10:15:02+01:00" {
		t.Errorf("oraStrumento = %v", q.OraStrumento)
	}
	if q.OraAgente != "2026-11-13T09:15:03.123Z" {
		t.Errorf("oraAgente = %q", q.OraAgente)
	}
	if q.Grezzo == nil || *q.Grezzo != base64.StdEncoding.EncodeToString([]byte("ST,GS,  12340.00kg")) {
		t.Errorf("grezzo = %v", q.Grezzo)
	}
}

func TestChiaveIdempotenzaDiversaPerLettura(t *testing.T) {
	a, _ := Nuova(agenteID, strumentoID, 1, campioneBase(), oraAgente, "SIMULATA", true)
	b, _ := Nuova(agenteID, strumentoID, 2, campioneBase(), oraAgente, "SIMULATA", true)
	if a.ChiaveIdempotenza == b.ChiaveIdempotenza {
		t.Fatal("due letture con la stessa chiave di idempotenza")
	}
}

func TestOraAgenteConOffset(t *testing.T) {
	loc := time.FixedZone("CET", 3600)
	p, err := Nuova(agenteID, strumentoID, 1, campioneBase(), oraAgente.In(loc), "SIMULATA", true)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasSuffix(p.OraAgente, "Z") && !regexp.MustCompile(`[+-]\d\d:\d\d$`).MatchString(p.OraAgente) {
		t.Errorf("oraAgente senza offset: %q", p.OraAgente)
	}
	if _, err := time.Parse(time.RFC3339Nano, p.OraAgente); err != nil {
		t.Errorf("oraAgente non e' ISO 8601: %v", err)
	}
}

func TestNullPerCampiOpzionali(t *testing.T) {
	c := campioneBase()
	c.AlibiID, c.OraStrumento, c.Grezzo = "", nil, nil
	p, err := Nuova(agenteID, strumentoID, 1, c, oraAgente, "D800-MP", false)
	if err != nil {
		t.Fatal(err)
	}
	var m map[string]any
	_ = json.Unmarshal(p.Bytes(), &m)
	for _, k := range []string{"alibiId", "oraStrumento", "grezzo"} {
		if v, ok := m[k]; !ok || v != nil {
			t.Errorf("%s dovrebbe essere null, e' %v", k, v)
		}
	}
	if m["simulata"] != false {
		t.Errorf("simulata = %v", m["simulata"])
	}
}

func TestGrezzoTroppoLungoErrore(t *testing.T) {
	c := campioneBase()
	c.Grezzo = bytes.Repeat([]byte{'x'}, 256)
	if _, err := Nuova(agenteID, strumentoID, 1, c, oraAgente, "SIMULATA", true); err != nil {
		t.Fatalf("256 byte ammessi: %v", err)
	}
	c.Grezzo = bytes.Repeat([]byte{'x'}, 257)
	if _, err := Nuova(agenteID, strumentoID, 1, c, oraAgente, "SIMULATA", true); err == nil {
		t.Fatal("257 byte: atteso errore, non troncamento")
	}
}

func TestNuovaRifiutaInputSbagliati(t *testing.T) {
	casi := map[string]func(c *driver.Campione, id *string, seq *int64, drv *string, sim *bool){
		"instabile":           func(c *driver.Campione, _ *string, _ *int64, _ *string, _ *bool) { c.Stato = driver.Instabile },
		"sovraccarico":        func(c *driver.Campione, _ *string, _ *int64, _ *string, _ *bool) { c.Stato = driver.Sovraccarico },
		"peso zero":           func(c *driver.Campione, _ *string, _ *int64, _ *string, _ *bool) { c.Centesimi = 0 },
		"peso negativo":       func(c *driver.Campione, _ *string, _ *int64, _ *string, _ *bool) { c.Centesimi = -5 },
		"peso enorme":         func(c *driver.Campione, _ *string, _ *int64, _ *string, _ *bool) { c.Centesimi = 10000000000 },
		"sequenza zero":       func(_ *driver.Campione, _ *string, s *int64, _ *string, _ *bool) { *s = 0 },
		"agente non uuid":     func(_ *driver.Campione, id *string, _ *int64, _ *string, _ *bool) { *id = "xyz" },
		"driver minuscolo":    func(_ *driver.Campione, _ *string, _ *int64, d *string, _ *bool) { *d = "simulata" },
		"simulata incoerente": func(_ *driver.Campione, _ *string, _ *int64, _ *string, s *bool) { *s = false },
		"alibi troppo lungo": func(c *driver.Campione, _ *string, _ *int64, _ *string, _ *bool) {
			c.AlibiID = strings.Repeat("A", 41)
		},
		"alibi non stampabile": func(c *driver.Campione, _ *string, _ *int64, _ *string, _ *bool) { c.AlibiID = "AB\nCD" },
	}
	for nome, muta := range casi {
		c, id, seq, drv, sim := campioneBase(), agenteID, int64(1), "SIMULATA", true
		muta(&c, &id, &seq, &drv, &sim)
		if _, err := Nuova(id, strumentoID, seq, c, oraAgente, drv, sim); err == nil {
			t.Errorf("%s: atteso errore", nome)
		}
	}
}

// --- contratto con il backend -------------------------------------------------

type fileContratto struct {
	Descrizione       string `json:"descrizione"`
	SeedHex           string `json:"seedHex"`
	ChiavePubblicaB64 string `json:"chiavePubblicaB64"`
	PrefissoDominio   string `json:"prefissoDominio"`
	PayloadB64        string `json:"payloadB64"`
	FirmaB64          string `json:"firmaB64"`
}

const percorsoContratto = "../../testdata/contratto/lettura-v1.json"

func contrattoAtteso(t *testing.T) fileContratto {
	t.Helper()
	seed := make([]byte, ed25519.SeedSize)
	for i := range seed {
		seed[i] = byte(i)
	}
	priv := ed25519.NewKeyFromSeed(seed)
	ora := "2026-11-13T10:15:02+01:00"
	grezzo := base64.StdEncoding.EncodeToString([]byte("ST,GS,  12340.00kg\r\n"))
	alibi := "SIM-000041"
	p := Payload{
		V: 1, AgenteID: agenteID, StrumentoID: strumentoID,
		ChiaveIdempotenza: "0b9c6f0e-8d2a-4c57-9e1b-7a3f5d2c4e68", Sequenza: 41,
		PesoKg: "12340.00", Unita: "kg", Stabile: true, AlibiID: &alibi, OraStrumento: &ora,
		OraAgente: "2026-11-13T09:15:03.123Z", Driver: "SIMULATA", Simulata: true, Grezzo: &grezzo,
	}
	payload := p.Bytes()
	return fileContratto{
		Descrizione:       "Contratto di firma delle letture v1: stesso seed e stesso payload danno la stessa firma (Ed25519 e' deterministico). Verificato dal test Go e da payload-lettura.spec.ts.",
		SeedHex:           "000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f",
		ChiavePubblicaB64: base64.StdEncoding.EncodeToString(priv.Public().(ed25519.PublicKey)),
		PrefissoDominio:   firma.PrefissoLettura,
		PayloadB64:        base64.StdEncoding.EncodeToString(payload),
		FirmaB64:          base64.StdEncoding.EncodeToString(firma.Firma(priv, payload)),
	}
}

func TestContratto(t *testing.T) {
	atteso := contrattoAtteso(t)
	if *update {
		b, err := json.MarshalIndent(atteso, "", "  ")
		if err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(percorsoContratto, append(b, '\n'), 0o644); err != nil {
			t.Fatal(err)
		}
		return
	}
	raw, err := os.ReadFile(percorsoContratto)
	if err != nil {
		t.Fatalf("manca %s (rigenerare con -update): %v", percorsoContratto, err)
	}
	var su fileContratto
	if err := json.Unmarshal(raw, &su); err != nil {
		t.Fatal(err)
	}
	if su != atteso {
		t.Fatalf("il file di contratto non coincide con quello prodotto dal codice:\n su disco: %+v\n atteso:   %+v\n(se il cambio e' voluto: -update e aggiornare il lato backend)", su, atteso)
	}
	// Verifica indipendente dalla generazione: chiave pubblica, payload e firma del file.
	pub, _ := base64.StdEncoding.DecodeString(su.ChiavePubblicaB64)
	payload, _ := base64.StdEncoding.DecodeString(su.PayloadB64)
	sig, _ := base64.StdEncoding.DecodeString(su.FirmaB64)
	if !firma.Verifica(pub, payload, sig) {
		t.Fatal("la firma del file di contratto non e' valida")
	}
}

func TestRinumeraCambiaSoloSequenzaEChiave(t *testing.T) {
	p, err := Nuova(agenteID, strumentoID, 5, campioneBase(), oraAgente, "SIMULATA", true)
	if err != nil {
		t.Fatal(err)
	}
	n, err := p.Rinumera(90)
	if err != nil {
		t.Fatal(err)
	}
	if n.Sequenza != 90 || n.ChiaveIdempotenza == p.ChiaveIdempotenza {
		t.Fatalf("sequenza %d, chiave invariata? %v", n.Sequenza, n.ChiaveIdempotenza == p.ChiaveIdempotenza)
	}
	n.Sequenza, n.ChiaveIdempotenza = p.Sequenza, p.ChiaveIdempotenza
	if string(n.Bytes()) != string(p.Bytes()) {
		t.Fatal("la rinumerazione ha cambiato altro oltre a sequenza e chiave")
	}
	if _, err := p.Rinumera(0); err == nil {
		t.Fatal("sequenza 0 deve dare errore")
	}
}
