# Elementia — Meester der Vier Elementen

Een origineel 3D-actiespel in de browser, geïnspireerd door het idee van elementen "buigen":
vuur, water, aarde en lucht. Je verdedigt een vergeten heiligdom op een eiland tegen golven schimgeesten.

Alles is procedureel gegenereerd (terrein, texturen, bomen, gras, wolken, geluid) en gerenderd met
[three.js](https://threejs.org) met fysiek gebaseerde materialen, dynamische schaduwen, reflecterend water,
atmosferische hemel, bloom en filmische kleurcorrectie.

## Spelen

ES-modules werken niet via `file://`, dus start een simpele webserver in deze map:

```bash
python3 -m http.server 8000
# of: npx serve .
```

Open daarna <http://localhost:8000>.

### Online via GitHub Pages

De workflow `.github/workflows/pages.yml` zet het spel bij elke push automatisch online op
`https://rokit-beep.github.io/last-airbander/`. Eenmalig instellen:

1. Pages werkt op een gratis account alleen voor **publieke** repositories
   (*Settings → General → Danger Zone → Change visibility*). Met GitHub Pro kan het ook privé.
2. *Settings → Pages → Build and deployment → Source*: kies **GitHub Actions**.
3. *Actions → Deploy naar GitHub Pages → Run workflow* (of push een nieuwe commit).

### Op de telefoon

Op een touchscreen verschijnen automatisch touchknoppen. Liggend spelen werkt het best.

| Touch | Actie |
| --- | --- |
| Linkerduim (overal op linkerhelft) | Lopen; helemaal uitduwen = rennen |
| Rechterhelft slepen | Rondkijken en richten (met hulp bij het richten) |
| Grote knop | Basisaanval (vasthouden) |
| ★ | Speciale kracht |
| ↑ | Springen (vasthouden = zweven bij lucht) |
| Iconen bovenaan | Element wisselen |
| ⏸ | Pauze |

Telefoons krijgen automatisch lichtere grafische instellingen (minder gras, kleinere schaduwen en reflecties).

| Toets | Actie |
| --- | --- |
| WASD / pijltjes | Lopen (Shift = rennen) |
| Muis | Rondkijken en richten |
| Linkerklik | Basisaanval (ingedrukt houden) |
| Rechterklik / F | Speciale kracht |
| 1–4, Q/E, scrollwiel | Element wisselen |
| Spatie | Springen (bij lucht: vasthouden om te zweven) |
| Esc | Pauze |

(Op de computer)

### De vier elementen

| Element | Basisaanval | Speciale kracht |
| --- | --- | --- |
| 🔥 Vuur | Vuurbal met explosie, zet geesten in brand | Vlammenring rondom je |
| 💧 Water | Waterzweep die geesten vertraagt | Genezing (+40 gezondheid) |
| ⛰️ Aarde | Rotsblok uit de grond trekken en werpen | Rij rotspieken die geesten lanceren |
| 🌪️ Lucht | Windstoot die geesten wegblaast en hun bollen afweert | Luchtsprong; zweef door spatie vast te houden |

Aanvallen kosten chi (blauwe balk), die vanzelf herstelt. Het streepje in de chi-balk toont wat de speciale kracht kost.

## Grafische instellingen

Via de URL:

- `?q=low` — lage kwaliteit (geen gras, geen MSAA, kleinere schaduwen) voor zwakkere laptops
- `?grass=0.5` — grasdichtheid (0–1)
- `?msaa=0` — anti-aliasing uit

## Structuur

```
index.html        HUD, menu's en import map (three.js via CDN)
src/main.js       renderer, post-processing, spelverloop, invoer, camera
src/world.js      terrein, water, hemel, wolken, bomen, gras, rotsen, heiligdom
src/textures.js   procedurele texturen (grond, steen, golven, deeltjes)
src/effects.js    GPU-deeltjessysteem en herbruikbare lichtpool
src/bending.js    de krachten van de vier elementen
src/player.js     de zwerver (model, animatie, beweging)
src/enemies.js    schimgeesten en hun aanvallen
src/audio.js      procedurele geluidseffecten (Web Audio)
```
