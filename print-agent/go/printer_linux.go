//go:build linux

package main

import (
	"fmt"
	"os/exec"
	"strconv"
	"strings"
)

func listPrinters() ([]string, error) {
	out, err := exec.Command("lpstat", "-a").Output()
	if err != nil {
		return nil, err
	}
	lines := strings.Split(strings.TrimSpace(string(out)), "\n")
	result := make([]string, 0, len(lines))
	for _, l := range lines {
		fields := strings.Fields(l)
		if len(fields) > 0 {
			result = append(result, fields[0])
		}
	}
	return result, nil
}

func printPDF(file, printer string, copies int, paperSize string, _ bool) error {
	if file == "" {
		return fmt.Errorf("no file to print")
	}
	args := []string{}
	if printer != "" {
		args = append(args, "-d", printer)
	}
	if copies > 1 {
		args = append(args, "-n", strconv.Itoa(copies))
	}
	if paperSize != "" {
		args = append(args, "-o", "media="+paperSize)
	}
	args = append(args, file)
	return exec.Command("lp", args...).Run()
}
