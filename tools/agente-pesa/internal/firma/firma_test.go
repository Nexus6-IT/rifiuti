package firma

import (
	"crypto/ed25519"
	"testing"
)

func chiaveProva(t *testing.T) (ed25519.PublicKey, ed25519.PrivateKey) {
	t.Helper()
	seed := make([]byte, ed25519.SeedSize)
	for i := range seed {
		seed[i] = byte(i)
	}
	priv := ed25519.NewKeyFromSeed(seed)
	return priv.Public().(ed25519.PublicKey), priv
}

func TestFirmaVerificabile(t *testing.T) {
	pub, priv := chiaveProva(t)
	payload := []byte(`{"v":1}`)
	sig := Firma(priv, payload)
	if len(sig) != ed25519.SignatureSize {
		t.Fatalf("lunghezza firma %d", len(sig))
	}
	if !Verifica(pub, payload, sig) {
		t.Fatal("firma valida rifiutata")
	}
}

func TestUnByteCambiatoRompeLaFirma(t *testing.T) {
	pub, priv := chiaveProva(t)
	payload := []byte(`{"v":1}`)
	sig := Firma(priv, payload)
	alterato := append([]byte(nil), payload...)
	alterato[2] ^= 0x01
	if Verifica(pub, alterato, sig) {
		t.Fatal("payload alterato accettato")
	}
	sig2 := append([]byte(nil), sig...)
	sig2[0] ^= 0x01
	if Verifica(pub, payload, sig2) {
		t.Fatal("firma alterata accettata")
	}
}

func TestPrefissoDiDominio(t *testing.T) {
	pub, priv := chiaveProva(t)
	payload := []byte(`{"v":1}`)
	// Una firma fatta senza il prefisso di dominio (o con un altro) non vale come firma di lettura.
	senza := ed25519.Sign(priv, payload)
	if Verifica(pub, payload, senza) {
		t.Fatal("firma senza prefisso accettata")
	}
	altro := ed25519.Sign(priv, append([]byte("wasteflow-altro-v1\n"), payload...))
	if Verifica(pub, payload, altro) {
		t.Fatal("firma con altro prefisso accettata")
	}
	if !Verifica(pub, payload, ed25519.Sign(priv, append([]byte(PrefissoLettura), payload...))) {
		t.Fatal("prefisso di dominio non corrisponde a PrefissoLettura")
	}
}

func TestVerificaChiaveMalformata(t *testing.T) {
	if Verifica(ed25519.PublicKey([]byte{1, 2, 3}), []byte("x"), make([]byte, 64)) {
		t.Fatal("chiave corta accettata")
	}
}
