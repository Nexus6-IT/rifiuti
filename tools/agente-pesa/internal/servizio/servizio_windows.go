//go:build windows

// Package servizio integra l'agente con il gestore dei servizi di Windows.
package servizio

import (
	"context"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"time"

	"golang.org/x/sys/windows/svc"
	"golang.org/x/sys/windows/svc/eventlog"
	"golang.org/x/sys/windows/svc/mgr"
)

// NomeServizio e' il nome del servizio Windows.
const NomeServizio = "WasteFlowAgentePesa"

// accountVirtuale: privilegi minimi, nessuna password da custodire (decisione Q5).
const accountVirtuale = `NT SERVICE\` + NomeServizio

// Esegui esegue f come servizio se avviato dal gestore dei servizi, altrimenti in primo piano.
func Esegui(ctx context.Context, f func(ctx context.Context) error) error {
	ok, err := svc.IsWindowsService()
	if err != nil || !ok {
		return f(ctx)
	}
	return svc.Run(NomeServizio, &gestore{f: f})
}

type gestore struct {
	f func(ctx context.Context) error
}

func (g *gestore) Execute(_ []string, r <-chan svc.ChangeRequest, s chan<- svc.Status) (bool, uint32) {
	s <- svc.Status{State: svc.StartPending}
	ctx, annulla := context.WithCancel(context.Background())
	defer annulla()
	fine := make(chan error, 1)
	go func() { fine <- g.f(ctx) }()
	s <- svc.Status{State: svc.Running, Accepts: svc.AcceptStop | svc.AcceptShutdown}
	for {
		select {
		case c := <-r:
			switch c.Cmd {
			case svc.Interrogate:
				s <- c.CurrentStatus
			case svc.Stop, svc.Shutdown:
				s <- svc.Status{State: svc.StopPending, WaitHint: 30000}
				annulla()
				select {
				case <-fine:
				case <-time.After(30 * time.Second):
				}
				return false, 0
			}
		case err := <-fine:
			if err != nil {
				if l, e := eventlog.Open(NomeServizio); e == nil {
					l.Error(1, "agente di pesa fermato: "+err.Error())
					l.Close()
				}
				return false, 1
			}
			return false, 0
		}
	}
}

// Gestisci esegue installa, rimuovi, avvia o ferma (serve un terminale da amministratore).
func Gestisci(azione, exe, dati string) error {
	m, err := mgr.Connect()
	if err != nil {
		return fmt.Errorf("gestore dei servizi: %w (servono i diritti di amministratore)", err)
	}
	defer m.Disconnect()
	switch azione {
	case "installa":
		return installa(m, exe, dati)
	case "rimuovi":
		s, err := m.OpenService(NomeServizio)
		if err != nil {
			return fmt.Errorf("servizio non trovato: %w", err)
		}
		defer s.Close()
		if err := s.Delete(); err != nil {
			return err
		}
		_ = eventlog.Remove(NomeServizio)
		return nil
	case "avvia":
		s, err := m.OpenService(NomeServizio)
		if err != nil {
			return fmt.Errorf("servizio non trovato: %w", err)
		}
		defer s.Close()
		return s.Start("servizio", "esegui", "--dati", dati)
	case "ferma":
		s, err := m.OpenService(NomeServizio)
		if err != nil {
			return fmt.Errorf("servizio non trovato: %w", err)
		}
		defer s.Close()
		st, err := s.Control(svc.Stop)
		if err != nil {
			return err
		}
		for i := 0; st.State != svc.Stopped && i < 60; i++ {
			time.Sleep(500 * time.Millisecond)
			if st, err = s.Query(); err != nil {
				return err
			}
		}
		return nil
	}
	return errors.New("azione sconosciuta (installa, rimuovi, avvia, ferma)")
}

func installa(m *mgr.Mgr, exe, dati string) error {
	if s, err := m.OpenService(NomeServizio); err == nil {
		s.Close()
		return errors.New("il servizio e' gia' installato")
	}
	if err := os.MkdirAll(dati, 0o755); err != nil {
		return err
	}
	s, err := m.CreateService(NomeServizio, exe, mgr.Config{
		DisplayName:      "WasteFlow Agente di pesa",
		Description:      "Legge lo strumento di pesa, firma le letture e le invia a WasteFlow.",
		StartType:        mgr.StartAutomatic,
		DelayedAutoStart: true,
		ServiceStartName: accountVirtuale,
	}, "servizio", "esegui", "--dati", dati)
	if err != nil {
		return err
	}
	defer s.Close()
	// riavvio dopo un errore: 10 s, 60 s, 5 min
	if err := s.SetRecoveryActions([]mgr.RecoveryAction{
		{Type: mgr.ServiceRestart, Delay: 10 * time.Second},
		{Type: mgr.ServiceRestart, Delay: 60 * time.Second},
		{Type: mgr.ServiceRestart, Delay: 5 * time.Minute},
	}, 24*3600); err != nil {
		return fmt.Errorf("azioni di ripristino: %w", err)
	}
	_ = eventlog.InstallAsEventCreate(NomeServizio, eventlog.Error|eventlog.Warning|eventlog.Info)
	// ACL: solo amministratori, SYSTEM e l'account del servizio (rimuove l'ereditarieta')
	out, err := exec.Command("icacls", dati, "/inheritance:r",
		"/grant", `BUILTIN\Administrators:(OI)(CI)F`,
		"/grant", `NT AUTHORITY\SYSTEM:(OI)(CI)F`,
		"/grant", accountVirtuale+`:(OI)(CI)M`).CombinedOutput()
	if err != nil {
		return fmt.Errorf("icacls: %w: %s", err, out)
	}
	return nil
}
