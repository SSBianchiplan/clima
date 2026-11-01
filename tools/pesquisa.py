#!/usr/bin/env python3
"""Pesquisa no Google via API do Gemini ("Grounding with Google Search").

Uso:
  python3 tools/pesquisa.py "o que fazer em Florianópolis em novembro"
  python3 tools/pesquisa.py -f perguntas.txt -o resultados.json
  python3 tools/pesquisa.py "melhores praias de surf em SC" --csv resultados.csv

A chave fica em tools/.env (GEMINI_API_KEY=...) ou na variável de ambiente.
Cada resultado traz: pergunta, resposta, fontes (título + link) e as buscas
que o Google fez. Só biblioteca padrão do Python.
"""
import argparse, csv, json, os, sys, time, urllib.error, urllib.request
from pathlib import Path

API = "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"
# tenta do mais leve para o mais forte; a cota gratuita varia por modelo
MODELS = ["gemini-flash-lite-latest", "gemini-flash-latest", "gemini-3.8-flash"]


def load_key():
    k = os.environ.get("GEMINI_API_KEY")
    env = Path(__file__).with_name(".env")
    if not k and env.exists():
        for line in env.read_text().splitlines():
            if line.startswith("GEMINI_API_KEY="):
                k = line.split("=", 1)[1].strip()
    if not k:
        sys.exit("Defina GEMINI_API_KEY em tools/.env ou no ambiente.")
    return k


def ask(key, question, model, tries=4):
    body = json.dumps({
        "contents": [{"parts": [{"text": f"{question}\n\nResponda em português do Brasil, de forma objetiva, citando dados concretos."}]}],
        "tools": [{"google_search": {}}],
    }).encode()
    req = urllib.request.Request(API.format(model=model), data=body,
                                 headers={"Content-Type": "application/json", "x-goog-api-key": key})
    for n in range(tries):
        try:
            with urllib.request.urlopen(req, timeout=120) as r:
                return json.load(r)
        except urllib.error.HTTPError as e:
            msg = e.read().decode(errors="ignore")
            if e.code in (429, 500, 503) and n < tries - 1:
                time.sleep(2 ** n * 5)  # espera crescente: 5, 10, 20 s
                continue
            raise RuntimeError(f"{e.code}: {json.loads(msg).get('error', {}).get('message', msg)[:200]}") from None


def search(key, question):
    last = None
    for m in MODELS:
        try:
            j = ask(key, question, m)
            c = j["candidates"][0]
            g = c.get("groundingMetadata", {})
            return {
                "pergunta": question, "modelo": m,
                "resposta": "".join(p.get("text", "") for p in c["content"]["parts"]).strip(),
                "fontes": [{"titulo": x["web"].get("title"), "link": x["web"].get("uri")} for x in g.get("groundingChunks", []) if "web" in x],
                "buscas": g.get("webSearchQueries", []),
            }
        except RuntimeError as e:
            last = e
    return {"pergunta": question, "erro": str(last)}


def main():
    ap = argparse.ArgumentParser(description="Pesquisa no Google via Gemini")
    ap.add_argument("perguntas", nargs="*")
    ap.add_argument("-f", "--arquivo", help="arquivo com uma pergunta por linha")
    ap.add_argument("-o", "--json", help="salvar resultados em JSON")
    ap.add_argument("--csv", help="salvar resultados em CSV")
    a = ap.parse_args()
    qs = list(a.perguntas)
    if a.arquivo:
        qs += [l.strip() for l in Path(a.arquivo).read_text().splitlines() if l.strip()]
    if not qs:
        ap.error("informe ao menos uma pergunta")
    key, out = load_key(), []
    for q in qs:
        r = search(key, q)
        out.append(r)
        print(f"\n■ {q}")
        if "erro" in r:
            print(f"  ERRO: {r['erro']}")
            continue
        print(r["resposta"])
        for f in r["fontes"][:6]:
            print(f"  · {f['titulo']}  {f['link']}")
        time.sleep(1.5)
    if a.json:
        Path(a.json).write_text(json.dumps(out, ensure_ascii=False, indent=2))
    if a.csv:
        with open(a.csv, "w", newline="") as fh:
            w = csv.writer(fh)
            w.writerow(["pergunta", "resposta", "fontes"])
            for r in out:
                w.writerow([r["pergunta"], r.get("resposta", r.get("erro")), " | ".join(f["link"] for f in r.get("fontes", []))])


if __name__ == "__main__":
    main()
