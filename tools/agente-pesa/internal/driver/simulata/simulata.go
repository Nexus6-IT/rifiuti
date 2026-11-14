// Package simulata e' il driver SIMULATA: pesi finti per collaudo e dimostrazioni. Ogni campione
// stabile e' marcato "simulata" nel payload firmato; il server li accetta solo per le aziende con
// il permesso di simulazione (D14 del piano 4.8b).
package simulata

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"math/rand/v2"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"

	"wasteflow/agente-pesa/internal/driver"
	"wasteflow/agente-pesa/internal/driver/trasporto"
	"wasteflow/agente-pesa/internal/fsatomic"
	"wasteflow/agente-pesa/internal/orologio"
)

// Nome e' il nome con cui il driver si registra e compare nel payload.
const Nome = "SIMULATA"

func init() { driver.Registra(Nome, nuovo) }

type parametri struct {
	Pesi                    []json.Number `json:"pesi"` // kg, anche con decimali ("12.5")
	IntervalloS             int           `json:"intervalloS"`
	IntervalloMs            int           `json:"intervalloMs"` // per le prove: prevale su intervalloS
	SemeCasuale             uint64        `json:"semeCasuale"`
	ProbabilitaSovraccarico float64       `json:"probabilitaSovraccarico"`
}

var rePeso = regexp.MustCompile(`^(\d{1,8})(?:\.(\d{1,2}))?$`)

type simulata struct {
	pesi       []int64 // centesimi
	intervallo time.Duration
	seme       uint64
	prob       float64
	file       string
	clock      orologio.Orologio
}

// mu serializza il progressivo degli alibi fra piu' strumenti simulati dello stesso agente.
var mu sync.Mutex

func nuovo(p driver.Parametri, _ trasporto.Apri) (driver.Driver, error) {
	var pr parametri
	dec := json.NewDecoder(strings.NewReader(string(p.Dati)))
	dec.DisallowUnknownFields()
	if len(p.Dati) > 0 {
		if err := dec.Decode(&pr); err != nil {
			return nil, fmt.Errorf("parametri SIMULATA: %w", err)
		}
	}
	if len(pr.Pesi) == 0 {
		return nil, errors.New("parametri SIMULATA: serve almeno un peso in \"pesi\"")
	}
	s := &simulata{seme: pr.SemeCasuale, prob: pr.ProbabilitaSovraccarico, clock: p.Orologio}
	for _, n := range pr.Pesi {
		m := rePeso.FindStringSubmatch(n.String())
		if m == nil {
			return nil, fmt.Errorf("parametri SIMULATA: peso non valido %q", n.String())
		}
		kg, _ := strconv.ParseInt(m[1], 10, 64)
		dec := m[2]
		for len(dec) < 2 {
			dec += "0"
		}
		c, _ := strconv.ParseInt(dec, 10, 64)
		if kg*100+c <= 0 {
			return nil, errors.New("parametri SIMULATA: i pesi devono essere maggiori di zero")
		}
		s.pesi = append(s.pesi, kg*100+c)
	}
	if pr.ProbabilitaSovraccarico < 0 || pr.ProbabilitaSovraccarico > 1 {
		return nil, errors.New("parametri SIMULATA: probabilitaSovraccarico fra 0 e 1")
	}
	switch {
	case pr.IntervalloMs > 0:
		s.intervallo = time.Duration(pr.IntervalloMs) * time.Millisecond
	case pr.IntervalloS > 0:
		s.intervallo = time.Duration(pr.IntervalloS) * time.Second
	default:
		s.intervallo = 30 * time.Second
	}
	if s.clock == nil {
		s.clock = orologio.Reale
	}
	if p.CartellaDati == "" {
		return nil, errors.New("SIMULATA: cartella dati mancante (serve a ricordare il progressivo degli alibi)")
	}
	s.file = filepath.Join(p.CartellaDati, "simulata.json")
	return s, nil
}

func (s *simulata) Nome() string   { return Nome }
func (s *simulata) Simulato() bool { return true }

type stato struct {
	Progressivo int64 `json:"progressivo"`
}

// prossimoAlibi incrementa e persiste il progressivo (mai riusato dopo un riavvio).
func (s *simulata) prossimoAlibi() (string, error) {
	mu.Lock()
	defer mu.Unlock()
	var st stato
	if b, err := os.ReadFile(s.file); err == nil {
		if err := json.Unmarshal(b, &st); err != nil {
			return "", fmt.Errorf("file %s illeggibile: %w", s.file, err)
		}
	} else if !errors.Is(err, os.ErrNotExist) {
		return "", err
	}
	st.Progressivo++
	b, _ := json.Marshal(st)
	if err := fsatomic.Scrivi(s.file, b, 0o600); err != nil {
		return "", err
	}
	return fmt.Sprintf("SIM-%06d", st.Progressivo), nil
}

func (s *simulata) Esegui(ctx context.Context, out chan<- driver.Campione) error {
	rng := rand.New(rand.NewPCG(s.seme, s.seme^0x9e3779b97f4a7c15))
	passo := s.intervallo / 5
	emetti := func(c driver.Campione) bool {
		select {
		case out <- c:
		case <-ctx.Done():
			return false
		}
		return s.clock.Dormi(ctx, passo) == nil
	}
	for i := 0; ; i = (i + 1) % len(s.pesi) {
		peso := s.pesi[i]
		if rng.Float64() < s.prob {
			if !emetti(driver.Campione{Centesimi: peso + 100, Stato: driver.Sovraccarico, Grezzo: []byte("SIM OVL")}) {
				return nil
			}
		}
		for k := 0; k < 3; k++ { // il peso sale e si assesta
			c := peso - rng.Int64N(peso/10+1)
			if c < 1 {
				c = 1
			}
			if !emetti(driver.Campione{Centesimi: c, Stato: driver.Instabile, Grezzo: []byte("SIM US")}) {
				return nil
			}
		}
		alibi, err := s.prossimoAlibi()
		if err != nil {
			return err
		}
		ora := s.clock.Adesso()
		if !emetti(driver.Campione{
			Centesimi: peso, Stato: driver.Stabile, Definitivo: true, AlibiID: alibi, OraStrumento: &ora,
			Grezzo: []byte("SIM ST " + strconv.FormatInt(peso, 10)),
		}) {
			return nil
		}
	}
}
