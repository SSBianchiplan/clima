#!/usr/bin/env python3
"""Amplia public/data-webcams.json com câmeras ao vivo do YouTube (transmissões 24 h).

Para cada lugar da lista: busca no YouTube com o filtro "ao vivo", fica com as transmissões cujo título cita o lugar,
confere no oEmbed oficial que a incorporação é permitida e guarda vídeo + canal (o player usa o canal como reserva
quando a transmissão é reiniciada e o vídeo muda de ID). Pula vídeos e canais já cadastrados no mesmo lugar.

Uso: python3 tools/webcams_busca.py [máximo por lugar, padrão 2]
"""
import json, re, sys, time, unicodedata, urllib.parse, urllib.request
from pathlib import Path

OUT = Path(__file__).resolve().parent.parent / "public" / "data-webcams.json"
UA = {"User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36", "Accept-Language": "pt-BR,pt;q=0.9,en;q=0.8"}
POR = int(sys.argv[1]) if len(sys.argv) > 1 else 2

# (nome no mapa, onde, lon, lat, busca, palavras que o título precisa ter — qualquer uma)
LUGARES = [
  # Brasil — litoral e capitais
  ("Barra da Lagoa", "Florianópolis, Brasil", -48.4239, -27.5752, "Barra da Lagoa ao vivo", ["barra da lagoa"]),
  ("Praia dos Ingleses", "Florianópolis, Brasil", -48.3906, -27.4369, "praia dos ingleses ao vivo", ["ingleses"]),
  ("Campeche", "Florianópolis, Brasil", -48.4686, -27.6789, "Campeche Florianópolis ao vivo", ["campeche"]),
  ("Ponte Hercílio Luz", "Florianópolis, Brasil", -48.5664, -27.5939, "ponte Hercilio Luz ao vivo", ["hercilio", "hercílio"]),
  ("Lagoinha do Norte", "Florianópolis, Brasil", -48.3786, -27.3919, "Lagoinha do Norte Florianópolis ao vivo", ["lagoinha"]),
  ("Jurerê", "Florianópolis, Brasil", -48.4949, -27.4387, "Jurerê ao vivo", ["jurer"]),
  ("Joaquina", "Florianópolis, Brasil", -48.4570, -27.6281, "praia da Joaquina ao vivo", ["joaquina"]),
  ("Balneário Camboriú", "Santa Catarina, Brasil", -48.6276, -26.9926, "Balneário Camboriú ao vivo câmera", ["camboriú", "camboriu"]),
  ("Itapema", "Santa Catarina, Brasil", -48.6075, -27.0905, "Itapema ao vivo câmera praia", ["itapema"]),
  ("Bombinhas", "Santa Catarina, Brasil", -48.5167, -27.1381, "Bombinhas ao vivo câmera", ["bombinhas"]),
  ("Garopaba", "Santa Catarina, Brasil", -48.6136, -28.0261, "Garopaba ao vivo câmera", ["garopaba"]),
  ("Imbituba", "Santa Catarina, Brasil", -48.6700, -28.2400, "Imbituba praia ao vivo", ["imbituba", "rosa"]),
  ("Joinville", "Santa Catarina, Brasil", -48.8456, -26.3045, "Joinville ao vivo câmera", ["joinville"]),
  ("Blumenau", "Santa Catarina, Brasil", -49.0661, -26.9194, "Blumenau ao vivo câmera", ["blumenau"]),
  ("Copacabana", "Rio de Janeiro, Brasil", -43.1822, -22.9711, "Copacabana ao vivo câmera", ["copacabana"]),
  ("Ipanema", "Rio de Janeiro, Brasil", -43.2075, -22.9868, "Ipanema ao vivo câmera", ["ipanema"]),
  ("Barra da Tijuca", "Rio de Janeiro, Brasil", -43.3650, -23.0120, "Barra da Tijuca ao vivo câmera", ["barra da tijuca"]),
  ("Niterói", "Rio de Janeiro, Brasil", -43.1040, -22.9050, "Niterói ao vivo câmera", ["niterói", "niteroi"]),
  ("Paulista", "São Paulo, Brasil", -46.6560, -23.5614, "Avenida Paulista ao vivo", ["paulista"]),
  ("Santos", "São Paulo, Brasil", -46.3336, -23.9667, "Santos praia ao vivo câmera", ["santos"]),
  ("Guarujá", "São Paulo, Brasil", -46.2564, -23.9933, "Guarujá ao vivo câmera", ["guarujá", "guaruja"]),
  ("Ubatuba", "São Paulo, Brasil", -45.0712, -23.4336, "Ubatuba ao vivo câmera", ["ubatuba"]),
  ("Curitiba", "Paraná, Brasil", -49.2733, -25.4284, "Curitiba ao vivo câmera", ["curitiba"]),
  ("Foz do Iguaçu", "Paraná, Brasil", -54.5854, -25.5163, "Foz do Iguaçu ao vivo câmera", ["iguaçu", "iguacu", "iguazu"]),
  ("Porto Alegre", "Rio Grande do Sul, Brasil", -51.2177, -30.0346, "Porto Alegre ao vivo câmera", ["porto alegre"]),
  ("Gramado", "Rio Grande do Sul, Brasil", -50.8761, -29.3746, "Gramado ao vivo câmera", ["gramado"]),
  ("Torres", "Rio Grande do Sul, Brasil", -49.7272, -29.3350, "Torres RS praia ao vivo", ["torres"]),
  ("Belo Horizonte", "Minas Gerais, Brasil", -43.9378, -19.9208, "Belo Horizonte ao vivo câmera", ["belo horizonte"]),
  ("Salvador", "Bahia, Brasil", -38.5108, -12.9718, "Salvador Bahia ao vivo câmera", ["salvador"]),
  ("Porto Seguro", "Bahia, Brasil", -39.0647, -16.4497, "Porto Seguro ao vivo câmera", ["porto seguro"]),
  ("Recife", "Pernambuco, Brasil", -34.8770, -8.0476, "Recife Boa Viagem ao vivo câmera", ["recife", "boa viagem"]),
  ("Porto de Galinhas", "Pernambuco, Brasil", -35.0028, -8.5035, "Porto de Galinhas ao vivo", ["porto de galinhas"]),
  ("Maceió", "Alagoas, Brasil", -35.7353, -9.6658, "Maceió ao vivo câmera praia", ["maceió", "maceio"]),
  ("Natal", "Rio Grande do Norte, Brasil", -35.2094, -5.7945, "Natal Ponta Negra ao vivo", ["natal", "ponta negra"]),
  ("Fortaleza", "Ceará, Brasil", -38.5014, -3.7172, "Fortaleza ao vivo câmera praia", ["fortaleza"]),
  ("Fernando de Noronha", "Pernambuco, Brasil", -32.4234, -3.8547, "Fernando de Noronha ao vivo", ["noronha"]),
  ("Brasília", "Distrito Federal, Brasil", -47.8825, -15.7942, "Brasília ao vivo câmera", ["brasília", "brasilia"]),
  ("Manaus", "Amazonas, Brasil", -60.0217, -3.1190, "Manaus ao vivo câmera", ["manaus"]),
  ("Vitória", "Espírito Santo, Brasil", -40.3089, -20.3155, "Vitória ES ao vivo câmera", ["vitória", "vitoria", "camburi"]),
  ("Guarapari", "Espírito Santo, Brasil", -40.4975, -20.6711, "Guarapari ao vivo câmera", ["guarapari"]),
  ("Cabo Frio", "Rio de Janeiro, Brasil", -42.0189, -22.8894, "Cabo Frio ao vivo câmera", ["cabo frio"]),
  ("Búzios", "Rio de Janeiro, Brasil", -41.8819, -22.7469, "Búzios ao vivo câmera", ["búzios", "buzios"]),
  ("Arraial do Cabo", "Rio de Janeiro, Brasil", -42.0277, -22.9661, "Arraial do Cabo ao vivo", ["arraial"]),
  ("Ilhabela", "São Paulo, Brasil", -45.3578, -23.7781, "Ilhabela ao vivo câmera", ["ilhabela"]),
  ("Campos do Jordão", "São Paulo, Brasil", -45.5872, -22.7394, "Campos do Jordão ao vivo", ["campos do jordão", "campos do jordao"]),
  # América do Sul e Central
  ("Buenos Aires", "Argentina", -58.3816, -34.6037, "Buenos Aires live cam", ["buenos aires"]),
  ("Bariloche", "Argentina", -71.3103, -41.1335, "Bariloche en vivo cámara", ["bariloche"]),
  ("Mar del Plata", "Argentina", -57.5426, -38.0055, "Mar del Plata en vivo cámara", ["mar del plata"]),
  ("Montevidéu", "Uruguai", -56.1645, -34.9011, "Montevideo en vivo cámara", ["montevideo"]),
  ("Punta del Este", "Uruguai", -54.9333, -34.9667, "Punta del Este en vivo cámara", ["punta del este"]),
  ("Santiago", "Chile", -70.6693, -33.4489, "Santiago Chile en vivo cámara", ["santiago"]),
  ("Viña del Mar", "Chile", -71.5518, -33.0245, "Viña del Mar en vivo cámara", ["viña", "vina"]),
  ("Lima", "Peru", -77.0428, -12.0464, "Lima Miraflores en vivo cámara", ["lima", "miraflores"]),
  ("Cartagena", "Colômbia", -75.5144, 10.3910, "Cartagena en vivo cámara", ["cartagena"]),
  ("Cancún", "México", -86.8515, 21.1619, "Cancun live cam", ["cancun", "cancún"]),
  ("Playa del Carmen", "México", -87.0739, 20.6296, "Playa del Carmen live cam", ["playa del carmen"]),
  ("Cidade do México", "México", -99.1332, 19.4326, "Ciudad de México en vivo cámara", ["méxico", "mexico", "cdmx"]),
  ("Punta Cana", "Rep. Dominicana", -68.3725, 18.5820, "Punta Cana live cam", ["punta cana"]),
  ("Aruba", "Aruba", -70.0270, 12.5211, "Aruba live cam", ["aruba"]),
  # América do Norte
  ("Miami Beach", "Flórida, EUA", -80.1300, 25.7907, "Miami Beach live cam", ["miami"]),
  ("Key West", "Flórida, EUA", -81.7800, 24.5551, "Key West live cam", ["key west"]),
  ("Orlando", "Flórida, EUA", -81.3792, 28.5383, "Orlando live cam", ["orlando"]),
  ("Nova Orleans", "Louisiana, EUA", -90.0715, 29.9511, "New Orleans Bourbon Street live cam", ["new orleans", "bourbon"]),
  ("Las Vegas", "Nevada, EUA", -115.1728, 36.1147, "Las Vegas strip live cam", ["las vegas"]),
  ("Chicago", "Illinois, EUA", -87.6298, 41.8781, "Chicago live cam", ["chicago"]),
  ("Washington", "EUA", -77.0369, 38.9072, "Washington DC live cam", ["washington"]),
  ("San Francisco", "Califórnia, EUA", -122.4194, 37.7749, "San Francisco live cam", ["san francisco", "golden gate"]),
  ("Los Angeles", "Califórnia, EUA", -118.2437, 34.0522, "Los Angeles live cam", ["los angeles", "venice", "santa monica"]),
  ("Honolulu", "Havaí, EUA", -157.8583, 21.3069, "Waikiki live cam", ["waikiki", "honolulu"]),
  ("Cataratas do Niágara", "Canadá/EUA", -79.0742, 43.0799, "Niagara Falls live cam", ["niagara"]),
  ("Toronto", "Canadá", -79.3832, 43.6532, "Toronto live cam", ["toronto"]),
  ("Vancouver", "Canadá", -123.1207, 49.2827, "Vancouver live cam", ["vancouver"]),
  ("Banff", "Canadá", -115.5708, 51.1784, "Banff live cam", ["banff"]),
  ("Yellowstone", "EUA", -110.8281, 44.4605, "Old Faithful live cam", ["old faithful", "yellowstone"]),
  ("Anchorage", "Alasca, EUA", -149.9003, 61.2181, "Alaska live cam Anchorage", ["anchorage", "alaska"]),
  # Europa
  ("Londres", "Reino Unido", -0.1276, 51.5072, "London live cam", ["london", "londres"]),
  ("Paris", "França", 2.2945, 48.8584, "Paris Eiffel live cam", ["paris", "eiffel"]),
  ("Nice", "França", 7.2620, 43.7102, "Nice live cam", ["nice"]),
  ("Amsterdã", "Holanda", 4.9041, 52.3676, "Amsterdam live cam", ["amsterdam"]),
  ("Veneza", "Itália", 12.3155, 45.4408, "Venice live cam", ["venice", "venezia", "veneza"]),
  ("Roma", "Itália", 12.4964, 41.9028, "Roma live cam", ["roma", "rome"]),
  ("Positano", "Itália", 14.4848, 40.6281, "Positano live cam", ["positano", "amalfi"]),
  ("Barcelona", "Espanha", 2.1734, 41.3851, "Barcelona live cam", ["barcelona"]),
  ("Madri", "Espanha", -3.7038, 40.4168, "Madrid live cam", ["madrid"]),
  ("Tenerife", "Espanha", -16.6291, 28.2916, "Tenerife live cam", ["tenerife"]),
  ("Lisboa", "Portugal", -9.1393, 38.7223, "Lisboa ao vivo câmera", ["lisboa", "lisbon"]),
  ("Porto", "Portugal", -8.6291, 41.1579, "Porto Portugal ao vivo câmera", ["porto"]),
  ("Algarve", "Portugal", -8.6740, 37.1028, "Algarve live cam", ["algarve", "lagos", "albufeira"]),
  ("Praga", "Tchéquia", 14.4378, 50.0755, "Prague live cam", ["prague", "praha", "praga"]),
  ("Viena", "Áustria", 16.3738, 48.2082, "Vienna live cam", ["vienna", "wien"]),
  ("Zermatt", "Suíça", 7.7491, 46.0207, "Zermatt Matterhorn live cam", ["zermatt", "matterhorn"]),
  ("Interlaken", "Suíça", 7.8632, 46.6863, "Interlaken live cam", ["interlaken", "jungfrau"]),
  ("Santorini", "Grécia", 25.4615, 36.3932, "Santorini live cam", ["santorini"]),
  ("Atenas", "Grécia", 23.7275, 37.9838, "Athens Acropolis live cam", ["athens", "acropolis"]),
  ("Dubrovnik", "Croácia", 18.0944, 42.6507, "Dubrovnik live cam", ["dubrovnik"]),
  ("Reykjavík", "Islândia", -21.9426, 64.1466, "Reykjavik live cam", ["reykjavik", "iceland"]),
  ("Tromsø", "Noruega", 18.9553, 69.6492, "Tromso aurora live cam", ["tromsø", "tromso", "aurora"]),
  ("Berlim", "Alemanha", 13.4050, 52.5200, "Berlin live cam", ["berlin"]),
  ("Istambul", "Turquia", 28.9784, 41.0082, "Istanbul live cam", ["istanbul"]),
  # África e Oriente Médio
  ("Cidade do Cabo", "África do Sul", 18.4241, -33.9249, "Cape Town live cam", ["cape town"]),
  ("Savana (Kruger)", "África do Sul", 31.5547, -24.0110, "Africam live cam Kruger", ["africam", "kruger", "safari"]),
  ("Namíbia (poço)", "Namíbia", 15.9500, -24.7300, "Namibia waterhole live cam", ["namibia", "waterhole"]),
  ("Dubai", "Emirados Árabes", 55.2744, 25.1972, "Dubai live cam", ["dubai"]),
  ("Jerusalém", "Israel", 35.2345, 31.7767, "Jerusalem Western Wall live cam", ["jerusalem", "western wall", "kotel"]),
  ("Meca", "Arábia Saudita", 39.8262, 21.4225, "Makkah live", ["makkah", "mecca", "haram"]),
  # Ásia e Oceania
  ("Tóquio", "Japão", 139.7005, 35.6595, "Tokyo Shibuya live cam", ["shibuya", "tokyo"]),
  ("Monte Fuji", "Japão", 138.7274, 35.3606, "Mount Fuji live cam", ["fuji"]),
  ("Osaka", "Japão", 135.5023, 34.6937, "Osaka Dotonbori live cam", ["osaka", "dotonbori"]),
  ("Seul", "Coreia do Sul", 126.9780, 37.5665, "Seoul live cam", ["seoul"]),
  ("Hong Kong", "China", 114.1694, 22.3193, "Hong Kong Victoria Harbour live cam", ["hong kong"]),
  ("Singapura", "Singapura", 103.8545, 1.2834, "Singapore Marina Bay live cam", ["singapore"]),
  ("Bangkok", "Tailândia", 100.5018, 13.7563, "Bangkok live cam", ["bangkok"]),
  ("Phuket", "Tailândia", 98.2961, 7.8804, "Phuket Patong live cam", ["phuket", "patong"]),
  ("Bali", "Indonésia", 115.1889, -8.4095, "Bali Kuta live cam", ["bali", "kuta"]),
  ("Sydney", "Austrália", 151.2153, -33.8568, "Sydney Harbour live cam", ["sydney"]),
  ("Bondi", "Austrália", 151.2743, -33.8915, "Bondi Beach live cam", ["bondi"]),
  ("Gold Coast", "Austrália", 153.4300, -28.0167, "Gold Coast Surfers Paradise live cam", ["gold coast", "surfers paradise"]),
  ("Auckland", "Nova Zelândia", 174.7633, -36.8485, "Auckland live cam", ["auckland"]),
  ("Queenstown", "Nova Zelândia", 168.6626, -45.0312, "Queenstown live cam", ["queenstown"]),
  # natureza e espaço
  ("Estação Espacial (ISS)", "órbita", -40.0, 0.0, "ISS live earth view", ["iss", "space station", "earth"]),
  ("Kilauea", "Havaí, EUA", -155.2867, 19.4069, "Kilauea volcano live cam", ["kilauea", "volcano"]),
  ("Etna", "Itália", 14.9934, 37.7510, "Etna live cam", ["etna"]),
]


def get(url, tries=3):
    for n in range(tries):
        try:
            return urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=40).read().decode("utf-8", "ignore")
        except Exception:
            if n == tries - 1: raise
            time.sleep(4 * (n + 1))


def norm(s): return unicodedata.normalize("NFKD", s.lower()).encode("ascii", "ignore").decode()


def busca(q):
    """Transmissões AO VIVO da busca: [(videoId, título, canal, channelId)]."""
    html = get("https://www.youtube.com/results?search_query=" + urllib.parse.quote(q) + "&sp=EgJAAQ%253D%253D")
    m = re.search(r"var ytInitialData = (\{.*?\});</script>", html)
    if not m: return []
    out = []
    def walk(o):
        if isinstance(o, dict):
            v = o.get("videoRenderer")
            if v and v.get("videoId"):
                live = "LIVE" in json.dumps(v.get("badges", [])) + json.dumps(v.get("thumbnailOverlays", []))
                own = (v.get("ownerText") or {}).get("runs", [{}])[0]
                if live: out.append((v["videoId"], "".join(r.get("text", "") for r in v.get("title", {}).get("runs", [])), own.get("text", ""),
                                     own.get("navigationEndpoint", {}).get("browseEndpoint", {}).get("browseId", "")))
            for x in o.values(): walk(x)
        elif isinstance(o, list):
            for x in o: walk(x)
    walk(json.loads(m.group(1)))
    return out


def incorporavel(vid):
    try:
        urllib.request.urlopen(urllib.request.Request("https://www.youtube.com/oembed?format=json&url=" + urllib.parse.quote(f"https://www.youtube.com/watch?v={vid}"), headers=UA), timeout=20)
        return True
    except Exception:
        return False


def main():
    D = json.loads(OUT.read_text())
    F = D["features"]
    vistos = {f["properties"]["v"] for f in F}
    novos = 0
    for nome, onde, lon, lat, q, chaves in LUGARES:
        try:
            res = busca(q)
        except Exception as e:
            print(f"  {nome}: busca falhou ({e})"); continue
        ok = 0
        for vid, tit, ch, cid in res:
            if ok >= POR: break
            if vid in vistos or not any(norm(k) in norm(tit) for k in chaves): continue
            if not incorporavel(vid): continue
            # a mesma câmera não entra duas vezes: mesmo canal no mesmo lugar só se o título for de outro ponto
            n = nome if ok == 0 else f"{nome} {ok + 1}"
            F.append({"type": "Feature", "properties": {"n": n, "w": onde, "v": vid, "c": cid, "ch": ch, "t": tit[:120]},
                      "geometry": {"type": "Point", "coordinates": [round(lon + ok * .004, 5), round(lat + ok * .003, 5)]}})
            vistos.add(vid); ok += 1; novos += 1
        print(f"  {nome}: +{ok}" + (f" ({', '.join(t[:40] for _, t, _, _ in res[:1])})" if ok == 0 and res else ""))
        time.sleep(1.5)
    OUT.write_text(json.dumps(D, ensure_ascii=False, separators=(",", ":")))
    print(f"novas câmeras: {novos} · total: {len(F)}")


if __name__ == "__main__":
    main()
