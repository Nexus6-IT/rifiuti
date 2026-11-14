// Package firma firma e verifica le letture con Ed25519 (RFC 8032, senza hash preliminare).
// Il custode della chiave (file 0600 / DPAPI) arriva col task G5.
package firma

import "crypto/ed25519"

// PrefissoLettura e' la separazione di dominio: una firma di lettura non vale per altro.
const PrefissoLettura = "wasteflow-lettura-pesa-v1\n"

func daFirmare(payload []byte) []byte {
	b := make([]byte, 0, len(PrefissoLettura)+len(payload))
	b = append(b, PrefissoLettura...)
	return append(b, payload...)
}

// Firma firma PrefissoLettura + payload.
func Firma(priv ed25519.PrivateKey, payload []byte) []byte {
	return ed25519.Sign(priv, daFirmare(payload))
}

// Verifica controlla la firma di PrefissoLettura + payload; false anche per chiave o firma malformate.
func Verifica(pub ed25519.PublicKey, payload, sig []byte) bool {
	if len(pub) != ed25519.PublicKeySize || len(sig) != ed25519.SignatureSize {
		return false
	}
	return ed25519.Verify(pub, daFirmare(payload), sig)
}
