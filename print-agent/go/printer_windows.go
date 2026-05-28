//go:build windows

package main

import (
	"fmt"
	"os/exec"
	"strings"
)

func listPrinters() ([]string, error) {
	cmd := exec.Command("powershell", "-NoProfile", "-Command",
		"Get-Printer | Select-Object -ExpandProperty Name")
	out, err := cmd.Output()
	if err != nil {
		return nil, err
	}
	lines := strings.Split(strings.TrimSpace(string(out)), "\r\n")
	result := make([]string, 0, len(lines))
	for _, l := range lines {
		l = strings.TrimSpace(l)
		if l != "" {
			result = append(result, l)
		}
	}
	return result, nil
}

func findSumatra() string {
	for _, p := range []string{
		`C:\Program Files\SumatraPDF\SumatraPDF.exe`,
		`C:\Program Files (x86)\SumatraPDF\SumatraPDF.exe`,
	} {
		if _, err := exec.LookPath(p); err == nil {
			return p
		}
	}
	if p, err := exec.LookPath("SumatraPDF.exe"); err == nil {
		return p
	}
	return ""
}

func printPDF(file, printer string, copies int, paperSize string, silent bool) error {
	if file == "" {
		return fmt.Errorf("no file to print")
	}
	sumatra := findSumatra()
	if sumatra != "" {
		args := []string{"-print-to"}
		if printer == "" {
			args = []string{"-print-to-default"}
		} else {
			args = append(args, printer)
		}
		settings := []string{}
		if copies > 1 {
			settings = append(settings, fmt.Sprintf("%dx", copies))
		}
		if paperSize != "" {
			settings = append(settings, "paper="+paperSize)
		}
		if len(settings) > 0 {
			args = append(args, "-print-settings", strings.Join(settings, ","))
		}
		if silent {
			args = append(args, "-silent")
		}
		args = append(args, file)
		return exec.Command(sumatra, args...).Run()
	}
	verb := "print"
	if printer != "" {
		verb = "printto"
	}
	psCmd := fmt.Sprintf(
		`Start-Process -FilePath '%s' -Verb %s -ArgumentList '"%s"' -WindowStyle Hidden -Wait`,
		strings.ReplaceAll(file, "'", "''"), verb, printer)
	return exec.Command("powershell", "-NoProfile", "-Command", psCmd).Run()
}
