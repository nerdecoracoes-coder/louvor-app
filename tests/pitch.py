# Verifica o deslocamento de tom: uma senoide de 440 Hz passa pelo worklet e a frequência medida deve ser a esperada.
import sys, math
from playwright.sync_api import sync_playwright
BASE = "http://127.0.0.1:8080"
with sync_playwright() as p:
    b = p.chromium.launch(); pg = b.new_page(); pg.goto(BASE + "/tests/pitch.html")
    bad = 0
    for semi in (0, 2, -3, 5, -5, 7):
        r = pg.evaluate("([s, f]) => run(s, f)", [semi, 440])
        want = 440 * 2 ** (semi / 12); err = abs(r["f"] - want) / want * 1200  # em cents
        ok = err < 30 and r["rms"] > 0.1
        print(f"{semi:+d} st: esperado {want:.1f} Hz, medido {r['f']:.1f} Hz ({err:.0f} cents), nível {r['rms']:.2f}", "OK" if ok else "FALHOU")
        bad += 0 if ok else 1
    b.close(); sys.exit(1 if bad else 0)
