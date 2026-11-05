# Grava um tutorial: abre o app num celular simulado, executa os passos com cursor visível e legendas,
# e gera o MP4 + o arquivo de legendas (cues) que o app usa para a narração.
# Uso: python3 tools/video/gravar.py criar-escala /tmp/video-conta.json
import json, subprocess, sys, time, os, shutil
from playwright.sync_api import sync_playwright, expect

BASE = "http://127.0.0.1:8080"
CURSOR = """
(() => {
  const mk = () => {
    if (document.getElementById('__cur')) return;
    const s = document.createElement('style');
    s.textContent = '#__cur{position:fixed;z-index:2147483647;width:30px;height:30px;margin:-15px 0 0 -15px;border-radius:50%;background:rgba(255,255,255,.35);border:3px solid #fff;box-shadow:0 0 0 2px rgba(61,139,255,.9);pointer-events:none;transition:transform .12s;left:-50px;top:-50px}#__cur.down{transform:scale(.7);background:rgba(61,139,255,.6)}';
    document.head.appendChild(s);
    const c = document.createElement('div'); c.id = '__cur'; document.body.appendChild(c);
    addEventListener('mousemove', e => { c.style.left = e.clientX + 'px'; c.style.top = e.clientY + 'px'; }, true);
    addEventListener('mousedown', () => c.classList.add('down'), true);
    addEventListener('mouseup', () => c.classList.remove('down'), true);
  };
  if (document.body) mk(); else addEventListener('DOMContentLoaded', mk);
  new MutationObserver(mk).observe(document.documentElement, { childList: true });
})();
"""

def dur(text): return max(3.0, len(text) / 12.0)

class Rec:
    def __init__(self, page): self.p, self.cues, self.t0 = page, [], time.time()
    def now(self): return time.time() - self.t0
    def say(self, text, action=None, lead=0.9):
        t = self.now(); self.cues.append({"t": round(t, 2), "text": text})
        time.sleep(lead)
        if action: action()
        rest = dur(text) - (self.now() - t)
        if rest > 0: time.sleep(rest)
    def click(self, loc):
        loc.scroll_into_view_if_needed(); b = loc.bounding_box(); x, y = b["x"] + b["width"] / 2, b["y"] + b["height"] / 2
        self.p.mouse.move(x, y, steps=22); time.sleep(0.3); self.p.mouse.down(); time.sleep(0.12); self.p.mouse.up(); time.sleep(0.5)
    def type(self, loc, text):
        self.click(loc); self.p.keyboard.type(text, delay=70); time.sleep(0.4)

def main(slug, conta):
    global BASE
    import importlib.util
    spec = importlib.util.spec_from_file_location("roteiro", os.path.join(os.path.dirname(__file__), "roteiros", f"{slug}.py"))
    mod = importlib.util.module_from_spec(spec); spec.loader.exec_module(mod)
    allc = json.load(open(conta)); acc = allc[getattr(mod, "USER", "ana")]; out = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "app", "tutoriais")); os.makedirs(out, exist_ok=True)
    tmp = f"/tmp/claude-0/video-{slug}"; shutil.rmtree(tmp, ignore_errors=True); os.makedirs(tmp)
    W, H = 390, 844
    with sync_playwright() as pw:
        br = pw.chromium.launch(executable_path="/usr/bin/google-chrome", args=["--force-device-scale-factor=2"])
        c0 = br.new_context(viewport={"width": W, "height": H}, locale="pt-BR", timezone_id="America/Sao_Paulo"); p0 = c0.new_page()
        p0.goto(BASE + "/"); p0.fill("input[name=email]", acc["email"]); p0.fill("input[name=password]", acc["password"]); p0.locator("#go").click()
        p0.wait_for_selector(".hero", timeout=20000); state = c0.storage_state(); c0.close()
        ctx = br.new_context(viewport={"width": W, "height": H}, no_viewport=False, locale="pt-BR", timezone_id="America/Sao_Paulo", storage_state=state,
                             record_video_dir=tmp, record_video_size={"width": 780, "height": 1688}, has_touch=False)
        ctx.add_init_script(CURSOR)
        page = ctx.new_page()
        start = getattr(mod, "START", None)
        page.goto(BASE + (f"/#/times/{allc["teams"][start]}" if start else "/")); page.wait_for_selector(".pagehead, .hero", timeout=20000); time.sleep(0.8)
        if start: page.goto(BASE + "/#/"); page.wait_for_selector(".hero", timeout=20000)
        time.sleep(1.0)
        rec = Rec(page); mod.run(rec, page, allc, expect)
        time.sleep(1.2); end = rec.now(); vpath = page.video.path(); ctx.close(); br.close()
    mp4 = os.path.join(out, f"{slug}.mp4")
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", vpath, "-an", "-vf", "scale=540:-2", "-c:v", "libx264", "-preset", "veryfast", "-crf", "30", "-pix_fmt", "yuv420p", "-movflags", "+faststart", mp4], check=True)
    meta = {"slug": slug, "title": mod.TITLE, "about": mod.ABOUT, "duration": round(end, 1), "cues": rec.cues}
    json.dump(meta, open(os.path.join(out, f"{slug}.json"), "w"), ensure_ascii=False, indent=1)
    print(mp4, os.path.getsize(mp4) // 1024, "KB", len(rec.cues), "legendas", round(end, 1), "s")

if __name__ == "__main__": main(sys.argv[1], sys.argv[2])
