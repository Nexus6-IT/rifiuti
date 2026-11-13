// Package lettura costruisce il payload firmato v1 di una lettura di pesa (D6 del piano 4.8b).
//
// Il server non ricostruisce mai il payload: l'agente firma i byte prodotti da Payload.Bytes() e
// li invia tali e quali; nessuna canonicalizzazione fra Go e JavaScript.
package lettura

import (
	"bytes"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"regexp"
	"strconv"
	"strings"
	"time"

	"wasteflow/agente-pesa/internal/driver"
)

const (
	// MaxCentesimi e' il peso massimo esprimibile da `^\d{1,8}\.\d{2}$` (99.999.999,99 kg).
	MaxCentesimi = 9_999_999_999
	// MaxGrezzo e' la lunghezza massima del frame originale: uno piu' lungo e' un frame sbagliato.
	MaxGrezzo = 256
	maxAlibi  = 40
)

var (
	reUUID   = regexp.MustCompile(`^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`)
	reDriver = regexp.MustCompile(`^[A-Z0-9_-]{2,30}$`)
)

// Payload e' l'oggetto JSON firmato. L'ordine dei campi e' quello di D6; i campi opzionali
// sono sempre presenti, con valore null.
type Payload struct {
	V                 int     `json:"v"`
	AgenteID          string  `json:"agenteId"`
	StrumentoID       string  `json:"strumentoId"`
	ChiaveIdempotenza string  `json:"chiaveIdempotenza"`
	Sequenza          int64   `json:"sequenza"`
	PesoKg            string  `json:"pesoKg"`
	Unita             string  `json:"unita"`
	Stabile           bool    `json:"stabile"`
	AlibiID           *string `json:"alibiId"`
	OraStrumento      *string `json:"oraStrumento"`
	OraAgente         string  `json:"oraAgente"`
	Driver            string  `json:"driver"`
	Simulata          bool    `json:"simulata"`
	Grezzo            *string `json:"grezzo"`
}

// Bytes serializza il payload in JSON UTF-8 compatto, senza escape HTML. Sono i byte da firmare.
func (p Payload) Bytes() []byte {
	var buf bytes.Buffer
	enc := json.NewEncoder(&buf)
	enc.SetEscapeHTML(false)
	if err := enc.Encode(p); err != nil {
		panic("lettura: payload non serializzabile: " + err.Error()) // solo tipi semplici: non succede
	}
	return bytes.TrimRight(buf.Bytes(), "\n")
}

// FormattaCentesimi scrive i centesimi come stringa decimale fissa `^\d{1,8}\.\d{2}$`,
// con il punto, senza dipendere dalla lingua del sistema (difetto 6 di WinWaste).
func FormattaCentesimi(c int64) (string, error) {
	if c < 0 || c > MaxCentesimi {
		return "", fmt.Errorf("peso fuori intervallo: %d centesimi", c)
	}
	return strconv.FormatInt(c/100, 10) + "." + fmt.Sprintf("%02d", c%100), nil
}

// Nuova costruisce il payload di una lettura stabile. Errore se il campione non e' una lettura
// valida: un instabile, un sovraccarico o un frame oltre 256 byte non vengono mai firmati.
func Nuova(agenteID, strumentoID string, seq int64, c driver.Campione, oraAgente time.Time, nomeDriver string, simulata bool) (Payload, error) {
	if !reUUID.MatchString(agenteID) {
		return Payload{}, errors.New("agenteId non e' un uuid")
	}
	if !reUUID.MatchString(strumentoID) {
		return Payload{}, errors.New("strumentoId non e' un uuid")
	}
	if seq < 1 {
		return Payload{}, errors.New("la sequenza parte da 1")
	}
	if c.Stato != driver.Stabile {
		return Payload{}, errors.New("solo un campione stabile diventa una lettura")
	}
	if c.Centesimi <= 0 {
		return Payload{}, errors.New("il peso deve essere maggiore di zero")
	}
	peso, err := FormattaCentesimi(c.Centesimi)
	if err != nil {
		return Payload{}, err
	}
	if !reDriver.MatchString(nomeDriver) {
		return Payload{}, fmt.Errorf("nome del driver non valido: %q", nomeDriver)
	}
	if simulata != (nomeDriver == "SIMULATA") {
		return Payload{}, errors.New("simulata deve valere driver == SIMULATA")
	}
	if len(c.Grezzo) > MaxGrezzo {
		return Payload{}, fmt.Errorf("frame di %d byte oltre il massimo di %d", len(c.Grezzo), MaxGrezzo)
	}
	if oraAgente.IsZero() {
		return Payload{}, errors.New("oraAgente mancante")
	}

	p := Payload{
		V: 1, AgenteID: agenteID, StrumentoID: strumentoID, Sequenza: seq,
		PesoKg: peso, Unita: "kg", Stabile: true,
		OraAgente: oraAgente.Format("2006-01-02T15:04:05.000Z07:00"),
		Driver:    nomeDriver, Simulata: simulata,
	}
	if p.ChiaveIdempotenza, err = uuidV4(); err != nil {
		return Payload{}, err
	}
	if alibi := strings.TrimSpace(c.AlibiID); alibi != "" {
		if len(alibi) > maxAlibi || !stampabile(alibi) {
			return Payload{}, errors.New("alibiId: da 1 a 40 caratteri ASCII stampabili")
		}
		p.AlibiID = &alibi
	}
	if c.OraStrumento != nil {
		s := c.OraStrumento.Format("2006-01-02T15:04:05Z07:00")
		p.OraStrumento = &s
	}
	if len(c.Grezzo) > 0 {
		g := base64.StdEncoding.EncodeToString(c.Grezzo)
		p.Grezzo = &g
	}
	return p, nil
}

// Rinumera copia il payload con una nuova sequenza e una nuova chiave di idempotenza: serve quando
// il server dice che la sequenza era gia' usata (contatore perso). Il resto della lettura, ora
// compresa, resta quello misurato; il payload va ri-firmato con Bytes().
func (p Payload) Rinumera(seq int64) (Payload, error) {
	if seq < 1 {
		return Payload{}, errors.New("la sequenza parte da 1")
	}
	k, err := uuidV4()
	if err != nil {
		return Payload{}, err
	}
	p.Sequenza, p.ChiaveIdempotenza = seq, k
	return p, nil
}

func stampabile(s string) bool {
	for i := 0; i < len(s); i++ {
		if s[i] < 0x20 || s[i] > 0x7e {
			return false
		}
	}
	return true
}

func uuidV4() (string, error) {
	var b [16]byte
	if _, err := rand.Read(b[:]); err != nil {
		return "", fmt.Errorf("generazione uuid: %w", err)
	}
	b[6] = b[6]&0x0f | 0x40
	b[8] = b[8]&0x3f | 0x80
	return fmt.Sprintf("%x-%x-%x-%x-%x", b[0:4], b[4:6], b[6:8], b[8:10], b[10:16]), nil
}
