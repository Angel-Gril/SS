package main

import (
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"sync"

	"github.com/getlantern/systray"
)

type Config struct {
	Port           int      `json:"port"`
	DefaultPrinter string   `json:"defaultPrinter"`
	Copies         int      `json:"copies"`
	PaperSize      string   `json:"paperSize"`
	Silent         bool     `json:"silent"`
	AllowedOrigins []string `json:"allowedOrigins"`
}

var (
	cfg     Config
	cfgPath string
	cfgMu   sync.RWMutex
)

func defaultConfig() Config {
	return Config{
		Port:           9100,
		DefaultPrinter: "",
		Copies:         1,
		PaperSize:      "",
		Silent:         true,
		AllowedOrigins: []string{"http://localhost:3000", "http://localhost:3001"},
	}
}

func configDir() string {
	var base string
	switch runtime.GOOS {
	case "windows":
		base = os.Getenv("APPDATA")
	case "darwin":
		home, _ := os.UserHomeDir()
		base = filepath.Join(home, "Library", "Application Support")
	default:
		home, _ := os.UserHomeDir()
		base = filepath.Join(home, ".config")
	}
	dir := filepath.Join(base, "ss-erp-print-agent")
	os.MkdirAll(dir, 0755)
	return dir
}

func loadConfig() {
	cfgPath = filepath.Join(configDir(), "config.json")
	cfg = defaultConfig()
	data, err := os.ReadFile(cfgPath)
	if err == nil {
		json.Unmarshal(data, &cfg)
	}
}

func saveConfig() error {
	cfgMu.RLock()
	data, _ := json.MarshalIndent(cfg, "", "  ")
	cfgMu.RUnlock()
	return os.WriteFile(cfgPath, data, 0644)
}

func corsMiddleware(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		origin := r.Header.Get("Origin")
		cfgMu.RLock()
		allowed := false
		for _, o := range cfg.AllowedOrigins {
			if o == origin {
				allowed = true
				break
			}
		}
		cfgMu.RUnlock()
		if allowed || strings.HasPrefix(origin, "http://localhost") {
			w.Header().Set("Access-Control-Allow-Origin", origin)
		} else if origin == "" {
			w.Header().Set("Access-Control-Allow-Origin", "*")
		}
		w.Header().Set("Access-Control-Allow-Methods", "GET,POST,OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next(w, r)
	}
}

func handleStatus(w http.ResponseWriter, _ *http.Request) {
	cfgMu.RLock()
	defer cfgMu.RUnlock()
	json.NewEncoder(w).Encode(map[string]any{
		"ok":             true,
		"version":        "1.0.0",
		"defaultPrinter": cfg.DefaultPrinter,
		"platform":       runtime.GOOS,
	})
}

func handlePrinters(w http.ResponseWriter, _ *http.Request) {
	list, err := listPrinters()
	if err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]any{"ok": false, "error": err.Error()})
		return
	}
	json.NewEncoder(w).Encode(map[string]any{"ok": true, "printers": list})
}

func handlePrint(w http.ResponseWriter, r *http.Request) {
	if err := r.ParseMultipartForm(32 << 20); err != nil {
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(map[string]any{"ok": false, "error": err.Error()})
		return
	}
	file, header, err := r.FormFile("file")
	if err != nil {
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(map[string]any{"ok": false, "error": "no file uploaded"})
		return
	}
	defer file.Close()

	tmp, err := os.CreateTemp("", "label-*.pdf")
	if err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]any{"ok": false, "error": err.Error()})
		return
	}
	defer os.Remove(tmp.Name())
	io.Copy(tmp, file)
	tmp.Close()

	cfgMu.RLock()
	printer := r.FormValue("printer")
	if printer == "" {
		printer = cfg.DefaultPrinter
	}
	copies, _ := strconv.Atoi(r.FormValue("copies"))
	if copies < 1 {
		copies = cfg.Copies
		if copies < 1 {
			copies = 1
		}
	}
	silent := cfg.Silent
	paperSize := cfg.PaperSize
	cfgMu.RUnlock()

	log.Printf("printing %s (printer=%q copies=%d size=%s)", header.Filename, printer, copies, paperSize)
	if err := printPDF(tmp.Name(), printer, copies, paperSize, silent); err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]any{"ok": false, "error": err.Error()})
		return
	}
	json.NewEncoder(w).Encode(map[string]any{"ok": true, "printer": printer})
}

func startServer(addr string) error {
	mux := http.NewServeMux()
	mux.HandleFunc("/status", corsMiddleware(handleStatus))
	mux.HandleFunc("/printers", corsMiddleware(handlePrinters))
	mux.HandleFunc("/print", corsMiddleware(handlePrint))
	log.Printf("Print agent listening on http://%s", addr)
	return http.ListenAndServe(addr, mux)
}

func main() {
	loadConfig()
	go func() {
		addr := fmt.Sprintf("127.0.0.1:%d", cfg.Port)
		if err := startServer(addr); err != nil {
			log.Fatalf("server failed: %v", err)
		}
	}()
	systray.Run(onTrayReady, func() {})
}

func onTrayReady() {
	systray.SetTitle("SS ERP")
	systray.SetTooltip(fmt.Sprintf("SS ERP 打印代理 :%d", cfg.Port))

	mStatus := systray.AddMenuItem(fmt.Sprintf("监听 :%d", cfg.Port), "")
	mStatus.Disable()
	systray.AddSeparator()

	mPrinters := systray.AddMenuItem("选择默认打印机", "")
	go func() {
		printers, _ := listPrinters()
		for _, p := range printers {
			name := p
			item := mPrinters.AddSubMenuItemCheckbox(name, "", name == cfg.DefaultPrinter)
			go func() {
				for range item.ClickedCh {
					cfgMu.Lock()
					cfg.DefaultPrinter = name
					cfgMu.Unlock()
					saveConfig()
				}
			}()
		}
	}()

	mTest := systray.AddMenuItem("测试打印", "")
	systray.AddSeparator()
	mQuit := systray.AddMenuItem("退出", "")

	go func() {
		for {
			select {
			case <-mTest.ClickedCh:
				cfgMu.RLock()
				p := cfg.DefaultPrinter
				cfgMu.RUnlock()
				if err := printPDF("", p, 1, "", false); err != nil {
					log.Printf("test print failed: %v", err)
				}
			case <-mQuit.ClickedCh:
				systray.Quit()
				return
			}
		}
	}()
}
