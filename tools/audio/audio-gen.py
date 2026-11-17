#!/usr/bin/env python3
"""
Musik (Lyria 3.5) und Sprecheransagen (Gemini 3.8 Flash TTS) über Google AI Studio erzeugen und prüfen.

Quelle der Prompts und Texte: src/data/audio.ts (MUSIC, VOICE, VOICE_SPEAKER), gelesen über Node (Typ-Stripping).
Ziel: assets/audio/musik/<key>.mp3 und assets/audio/stimme/<key>.mp3, Verzeichnis assets/audio/manifest.json.

  python3 tools/audio/audio-gen.py stimme bau_fertig            # eine Ansage
  python3 tools/audio/audio-gen.py stimme --alle                # alle fehlenden Ansagen
  python3 tools/audio/audio-gen.py musik aufbau_tal             # ein Musikstück
  python3 tools/audio/audio-gen.py musik --alle
  python3 tools/audio/audio-gen.py pruefen                      # alle vorhandenen Dateien erneut prüfen
  Optionen: --ersetzen (vorhandene Datei überschreiben), --stimme NAME (Sprecher, Standard VOICE_SPEAKER), --versuche N

Prüfung (Pflicht, sonst wird nichts nach assets/ geschrieben):
  Ansage: Gemini 3.8 Flash transkribiert die Datei, der Text muss dem Soll-Text entsprechen (Ähnlichkeit ≥ 0,9),
          Länge plausibel (nicht leer, nicht deutlich zu lang, d. h. Stilanweisung nicht mitgesprochen).
  Musik:  Gemini 3.8 Flash beschreibt das Stück; abgelehnt, wenn Gesang mit Worten erkannt wird oder es leer/kaputt ist.
Der Schlüssel kommt aus dem macOS-Schlüsselbund (Dienst "google-api-key") oder GEMINI_API_KEY und wird nie ausgegeben.
Rohdaten und Berichte: .local/audio-runs/ (von git ignoriert).
"""
from __future__ import annotations

import argparse
import base64
import datetime as dt
import difflib
import json
import os
import re
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
ASSETS = ROOT / "assets"
RUNS = ROOT / ".local" / "audio-runs"
MANIFEST = ASSETS / "audio" / "manifest.json"
API = "https://generativelanguage.googleapis.com/v1beta/models"
MUSIC_MODEL = "lyria-3.5"
TTS_MODEL = "gemini-3.8-flash-tts"
CHECK_MODEL = "gemini-3.8-flash"
MOODS = {
    "aufbau": "ruhig, friedlich bis heiter, Hintergrund beim Aufbau einer mittelalterlichen Siedlung",
    "kampf": "angespannt, bedrohlich und drängend, Gefecht an der Burgmauer (keine fröhliche Tanzmusik)",
    "sieg": "festlich und erleichtert nach einem abgewehrten Angriff",
}


def api_key() -> str:
    k = os.environ.get("GEMINI_API_KEY", "").strip()
    if not k:
        try:
            k = subprocess.run(["security", "find-generic-password", "-s", "google-api-key", "-w"],
                               capture_output=True, text=True, check=True).stdout.strip()
        except Exception:
            k = ""
    if not k.startswith("AIza"):
        sys.exit("Kein Google-AI-Studio-Schlüssel gefunden (Schlüsselbund-Dienst google-api-key oder GEMINI_API_KEY).")
    return k


def load_data() -> dict:
    code = ("import('./src/data/audio.ts').then(m => process.stdout.write(JSON.stringify("
            "{MUSIC: m.MUSIC, VOICE: m.VOICE, VOICE_SPEAKER: m.VOICE_SPEAKER})))")
    out = subprocess.run(["node", "--no-warnings", "-e", code], cwd=ROOT, capture_output=True, text=True)
    if out.returncode != 0:
        sys.exit("src/data/audio.ts ließ sich nicht lesen:\n" + out.stderr)
    return json.loads(out.stdout)


def call(model: str, body: dict, key: str, timeout: int = 600, tries: int = 3) -> dict:
    req = urllib.request.Request(f"{API}/{model}:generateContent", data=json.dumps(body).encode(),
                                 headers={"Content-Type": "application/json", "x-goog-api-key": key})
    last = None
    for i in range(tries):
        try:
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return json.loads(r.read())
        except urllib.error.HTTPError as e:
            last = f"HTTP {e.code}: {e.read()[:400].decode(errors='replace')}"
            if e.code not in (429, 500, 502, 503, 504):
                break
        except Exception as e:  # Netz, Zeitüberschreitung
            last = str(e)
        time.sleep(5 * (i + 1))
    raise RuntimeError(f"{model}: {last}")


def inline_audio(resp: dict) -> tuple[bytes, str, str]:
    """(Bytes, MIME, Begleittext) aus einer generateContent-Antwort."""
    data, mime, text = b"", "", []
    for c in resp.get("candidates", []):
        for p in c.get("content", {}).get("parts", []):
            if "inlineData" in p and not data:
                data, mime = base64.b64decode(p["inlineData"]["data"]), p["inlineData"]["mimeType"]
            elif "text" in p:
                text.append(p["text"])
    if not data:
        raise RuntimeError("Antwort ohne Audio: " + json.dumps(resp)[:400])
    return data, mime, "\n".join(text)


def ffmpeg(args: list[str]) -> None:
    subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", *args], check=True)


def duration(path: Path) -> float:
    out = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(path)],
                         capture_output=True, text=True, check=True).stdout.strip()
    return float(out or 0)


def ask_about_audio(path: Path, mime: str, question: str, key: str) -> str:
    body = {"contents": [{"parts": [
        {"inlineData": {"mimeType": mime, "data": base64.b64encode(path.read_bytes()).decode()}},
        {"text": question}]}], "generationConfig": {"temperature": 0}}
    resp = call(CHECK_MODEL, body, key, timeout=300)
    return "".join(p.get("text", "") for c in resp.get("candidates", []) for p in c.get("content", {}).get("parts", [])).strip()


def norm(s: str) -> str:
    return " ".join(re.sub(r"[^a-zäöü0-9 ]", " ", s.lower().replace("ß", "ss")).split())


def load_manifest() -> dict:
    try:
        return json.loads(MANIFEST.read_text())
    except Exception:
        return {"musik": {}, "stimme": {}}


def save_manifest(m: dict) -> None:
    MANIFEST.parent.mkdir(parents=True, exist_ok=True)
    MANIFEST.write_text(json.dumps(m, ensure_ascii=False, indent=2) + "\n")


def run_dir(kind: str, key: str) -> Path:
    d = RUNS / f"{dt.datetime.now():%Y%m%d-%H%M%S}-{kind}-{key}"
    d.mkdir(parents=True, exist_ok=True)
    return d


# ------------------------------------------------------------------ Ansagen

def make_voice(key: str, data: dict, apikey: str, voice: str, tries: int, replace: bool) -> dict:
    d = data["VOICE"][key]
    out = ASSETS / d["file"]
    if out.exists() and not replace:
        return {"key": key, "status": "vorhanden", "file": str(out.relative_to(ROOT))}
    rd = run_dir("stimme", key)
    text = d["text"]
    # Nur der Satz selbst: gemini-3.8-flash-tts liest jede Stilanweisung (auch kurze Präfixe oder [Tags]) mit vor.
    # Der Ton ergibt sich aus Sprecher und Text (Alarmrufe werden von selbst laut und drängend).
    prompt = text
    last = {}
    for attempt in range(1, tries + 1):
        body = {"contents": [{"parts": [{"text": prompt}]}],
                "generationConfig": {"responseModalities": ["AUDIO"],
                                     "speechConfig": {"voiceConfig": {"prebuiltVoiceConfig": {"voiceName": voice}}}}}
        raw, mime, _ = inline_audio(call(TTS_MODEL, body, apikey))
        wav = rd / f"roh{attempt}.wav"
        wav.write_bytes(raw)
        mp3 = rd / f"versuch{attempt}.mp3"
        # Stille an den Rändern weg, Lautheit angleichen, Mono-MP3
        ffmpeg(["-i", str(wav), "-af",
                "silenceremove=start_periods=1:start_threshold=-50dB:start_silence=0.05,areverse,"
                "silenceremove=start_periods=1:start_threshold=-50dB:start_silence=0.15,areverse,"
                "loudnorm=I=-16:TP=-1.5:LRA=11,apad=pad_dur=0.1",
                "-ar", "44100", "-ac", "1", "-b:a", "96k", str(mp3)])
        dur = duration(mp3)
        heard = ask_about_audio(mp3, "audio/mpeg",
                                "Transkribiere diese deutsche Sprachaufnahme wörtlich. Antworte nur mit dem gesprochenen Text.", apikey)
        sim = difflib.SequenceMatcher(None, norm(heard), norm(text)).ratio()
        words = len(text.split())
        # grob: 1,6–3,5 Wörter pro Sekunde für ruhiges Sprechen
        too_long = dur > words / 1.4 + 1.5
        ok = sim >= 0.9 and dur > 0.5 and not too_long
        last = {"key": key, "versuch": attempt, "dauer": round(dur, 2), "gehoert": heard, "aehnlichkeit": round(sim, 3),
                "zu_lang": too_long, "ok": ok}
        (rd / "bericht.json").write_text(json.dumps(last, ensure_ascii=False, indent=2))
        if ok:
            out.parent.mkdir(parents=True, exist_ok=True)
            out.write_bytes(mp3.read_bytes())
            m = load_manifest()
            m["stimme"][key] = {"file": d["file"], "text": text, "dauer": round(dur, 2), "modell": TTS_MODEL,
                                "sprecher": voice, "gehoert": heard, "aehnlichkeit": round(sim, 3),
                                "erzeugt": dt.date.today().isoformat()}
            save_manifest(m)
            return {**last, "status": "ok", "file": str(out.relative_to(ROOT))}
    return {**last, "status": "abgelehnt", "lauf": str(rd)}


# ------------------------------------------------------------------ Musik

def make_music(key: str, data: dict, apikey: str, tries: int, replace: bool) -> dict:
    d = data["MUSIC"][key]
    out = ASSETS / d["file"]
    if out.exists() and not replace:
        return {"key": key, "status": "vorhanden", "file": str(out.relative_to(ROOT))}
    rd = run_dir("musik", key)
    last = {}
    for attempt in range(1, tries + 1):
        raw, mime, side = inline_audio(call(MUSIC_MODEL, {"contents": [{"parts": [{"text": d["prompt"]}]}]}, apikey, timeout=900))
        ext = ".mp3" if "mpeg" in mime else ".wav"
        src = rd / f"roh{attempt}{ext}"
        src.write_bytes(raw)
        (rd / f"roh{attempt}.txt").write_text(side)
        mp3 = rd / f"versuch{attempt}.mp3"
        ffmpeg(["-i", str(src), "-af", "loudnorm=I=-18:TP=-1.5:LRA=11", "-ar", "44100", "-ac", "2", "-b:a", "128k", str(mp3)])
        dur = duration(mp3)
        want = MOODS.get(d["mood"], d["mood"])
        desc = ask_about_audio(mp3, "audio/mpeg",
                               f"Gewünschte Stimmung für dieses Stück im Spiel: {want}. "
                               "Beschreibe dieses Musikstück knapp als JSON mit den Feldern "
                               "{\"passt_zur_stimmung\": bool, "
                               "{\"gesang_mit_worten\": bool, \"summender_chor\": bool, \"instrumente\": [..], "
                               "\"stimmung\": \"..\", \"tempo_bpm\": Zahl, \"mittelalterlich\": bool, "
                               "\"moderne_elemente\": [..], \"stille_oder_defekt\": bool}. Nur JSON.", apikey)
        try:
            info = json.loads(re.sub(r"^```(json)?|```$", "", desc.strip(), flags=re.M).strip())
        except Exception:
            info = {"roh": desc}
        ok = (dur > 15 and info.get("passt_zur_stimmung", False) and not info.get("gesang_mit_worten", False) and not info.get("stille_oder_defekt", False)
              and info.get("mittelalterlich", True) and not info.get("moderne_elemente"))
        last = {"key": key, "versuch": attempt, "dauer": round(dur, 1), "beschreibung": info, "ok": ok}
        (rd / "bericht.json").write_text(json.dumps(last, ensure_ascii=False, indent=2))
        if ok:
            out.parent.mkdir(parents=True, exist_ok=True)
            out.write_bytes(mp3.read_bytes())
            m = load_manifest()
            m["musik"][key] = {"file": d["file"], "titel": d["title"], "dauer": round(dur, 1), "modell": MUSIC_MODEL,
                               "beschreibung": info, "erzeugt": dt.date.today().isoformat()}
            save_manifest(m)
            return {**last, "status": "ok", "file": str(out.relative_to(ROOT))}
    return {**last, "status": "abgelehnt", "lauf": str(rd)}


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("art", choices=["stimme", "musik", "pruefen"])
    ap.add_argument("keys", nargs="*")
    ap.add_argument("--alle", action="store_true")
    ap.add_argument("--ersetzen", action="store_true")
    ap.add_argument("--stimme", default=None, help="Sprecher, Standard VOICE_SPEAKER aus src/data/audio.ts")
    ap.add_argument("--versuche", type=int, default=3)
    a = ap.parse_args()
    data = load_data()
    key = api_key()
    RUNS.mkdir(parents=True, exist_ok=True)
    results = []
    if a.art == "pruefen":
        m = load_manifest()
        for kind in ("musik", "stimme"):
            for k, e in m.get(kind, {}).items():
                p = ASSETS / e["file"]
                results.append({"art": kind, "key": k, "vorhanden": p.exists(), "dauer": round(duration(p), 2) if p.exists() else None})
        print(json.dumps(results, ensure_ascii=False, indent=2))
        return
    table = data["VOICE"] if a.art == "stimme" else data["MUSIC"]
    keys = list(table) if a.alle else a.keys
    unknown = [k for k in keys if k not in table]
    if unknown or not keys:
        sys.exit(f"Unbekannte oder fehlende Schlüssel: {unknown or '(keine)'}; vorhanden: {', '.join(table)}")
    for k in keys:
        try:
            r = make_voice(k, data, key, a.stimme or data["VOICE_SPEAKER"], a.versuche, a.ersetzen) if a.art == "stimme" \
                else make_music(k, data, key, a.versuche, a.ersetzen)
        except Exception as e:
            r = {"key": k, "status": "fehler", "fehler": str(e)[:500]}
        results.append(r)
        print(json.dumps(r, ensure_ascii=False), flush=True)
    bad = [r for r in results if r["status"] not in ("ok", "vorhanden")]
    sys.exit(1 if bad else 0)


if __name__ == "__main__":
    main()
