# app/main.py
import os, sys, json, logging, datetime, locale, re
from typing import List, Dict, Optional

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

# ---- Locale-Fallback VOR Import des Scrapers ----
_real_setlocale = locale.setlocale
def _patched_setlocale(category, loc=None):
    try:
        return _real_setlocale(category, loc)
    except locale.Error:
        return _real_setlocale(category, 'C')
locale.setlocale = _patched_setlocale

# ---- Pfad für ZvgPortalScraper sicherstellen ----
ROOT = os.path.dirname(os.path.abspath(__file__))
REPO_ROOT = os.path.dirname(ROOT)
SCRAPER_DIR = os.path.join(REPO_ROOT, "ZvgPortalScraper")
if SCRAPER_DIR not in sys.path:
    sys.path.insert(0, SCRAPER_DIR)

from zvg_portal.scraper import ZvgPortal
from zvg_portal.model import Land, ObjektEntry

# ---- Deutscher Datumsparser ohne System-Locale ----
class GermanDateParser:
    MONTHS = {'Januar':1,'Februar':2,'März':3,'April':4,'Mai':5,'Juni':6,'Juli':7,'August':8,
              'September':9,'Oktober':10,'November':11,'Dezember':12}
    @staticmethod
    def parse(s: str) -> Optional[datetime.datetime]:
        try:
            parts = s.split(',')
            if len(parts) < 3: return None
            # Teil 1: Wochentag (ignorieren)
            second = parts[1].strip()  # "dd. Monat YYYY"
            day_part, month_name, year_str = second.replace('.', '').split()
            day = int(day_part); year = int(year_str)
            month = GermanDateParser.MONTHS.get(month_name)
            time_str = parts[2].strip()  # "HH:MM Uhr"
            if time_str.lower().endswith('uhr'):
                time_str = time_str[:-3].strip()
            hour, minute = map(int, time_str.split(':'))
            return datetime.datetime(year, month, day, hour, minute)
        except Exception:
            return None

# ---- App init ----
app = FastAPI(title="ZVG Fullstack App")
logger = logging.getLogger("ZVGBackend")
logger.setLevel(logging.INFO)

portal = ZvgPortal(logger, user_agent="ZvgFullstack/1.0", base_url="https://www.zvg-portal.de")

# Bundesländer-Map (mit Synonymen/Kürzeln)
state_map: Dict[str, Land] = {}
for land in portal.get_laender():
    # Originalname (z. B. "Baden-Wuerttemberg")
    state_map[land.name.lower()] = land
    # Umlaute/Varianten
    variants = {land.name.lower(),
                land.name.lower().replace('ue','ü').replace('oe','ö').replace('ae','ä'),
                land.name.lower().replace('ü','ue').replace('ö','oe').replace('ä','ae')}
    short2full = {
        'bw': 'baden-wuerttemberg',
        'by': 'bayern', 'be': 'berlin', 'br': 'brandenburg', 'hb': 'bremen',
        'hh': 'hamburg', 'he': 'hessen', 'mv': 'mecklenburg-vorpommern',
        'ni': 'niedersachsen', 'nw': 'nordrhein-westfalen', 'rp': 'rheinland-pfalz',
        'sl': 'saarland', 'sn': 'sachsen', 'st': 'sachsen-anhalt', 'sh': 'schleswig-holstein',
        'th': 'thueringen'
    }
    variants.update(short2full.keys())
    for v in variants:
        key = v
        if v in short2full:
            key = short2full[v]
        state_map[key] = land

property_keywords = {
    'Reihenhaus': ['reihenhaus'],
    'Doppelhaushälfte': ['doppelhaushälfte','doppelhaushaelfte','doppelhaus'],
    'Einfamilienhaus': ['einfamilienhaus'],
    'Wohn- und Geschäftshaus': ['wohn- und geschäftshaus','wohn- und geschaeftshaus','wohn-und geschäftshaus','wohn-und geschaeftshaus'],
    'Gewerbeeinheit': ['gewerbeeinheit','gewerbefläche','gewerbeobjekt'],
}

def determine_property_type(text: str, selected: List[str]) -> Optional[str]:
    for ptype in selected:
        kws = property_keywords.get(ptype, [])
        for kw in kws:
            if kw in text:
                return ptype
    return None

@app.get("/api/health")
def health():
    return {"status": "ok"}

@app.get("/api/search")
def search(state: str,
           auctionTypes: str = "",
           propertyTypes: str = "",
           minDays: int = 0):
    # state normalisieren
    s = state.strip().lower().replace('ü','ue').replace('ö','oe').replace('ä','ae')
    land = state_map.get(s) or state_map.get(state.strip().lower())
    if not land:
        raise HTTPException(status_code=400, detail=f"Unbekanntes Bundesland: {state}")

    auction_types = [a for a in auctionTypes.split(',') if a]
    property_types = [p for p in propertyTypes.split(',') if p]

    now = datetime.datetime.now()
    min_date = (now + datetime.timedelta(days=minDays)).date()

    results = []
    for raw in portal.list(land):
        if not isinstance(raw, ObjektEntry):
            continue
        try:
            entry = raw

            # Datum
            auction_dt = entry.termin_as_date or (GermanDateParser.parse(entry.termin_as_str) if entry.termin_as_str else None)
            if not auction_dt or auction_dt.date() < min_date:
                continue

            # Versteigerungsart
            art = (entry.art_der_versteigerung or '').strip()
            if auction_types and art and art not in auction_types:
                continue

            # Objektart
            text = ' '.join(filter(None, [entry.objekt_lage or '', entry.beschreibung or ''])).lower()
            prop = ''
            if property_types:
                p = determine_property_type(text, property_types)
                if not p: 
                    continue
                prop = p

            # Adresse robust
            street = ''
            house_numbers = ''
            zip_code = ''
            city = ''
            if entry.adresse:
                street = (entry.adresse.strasse or '')
                zip_code = (entry.adresse.plz or '')
                city = (entry.adresse.ort or '')
                m = re.match(r'^([^\d]+?)\s*(\d.*)?$', street)
                if m:
                    street = (m.group(1) or '').strip()
                    house_numbers = (m.group(2) or '').strip()
            else:
                parts = (entry.objekt_lage or '').split(',')
                if parts:
                    street = parts[0].strip()
                    if len(parts) > 1:
                        tokens = parts[1].strip().split()
                        house_numbers = tokens[0] if tokens else ''

            results.append({
                "id": entry.zvg_id,
                "date": auction_dt.strftime('%Y-%m-%d'),
                "time": auction_dt.strftime('%H:%M'),
                "street": street,
                "houseNumbers": house_numbers,
                "zip": zip_code,
                "city": city,
                "state": state,
                "auctionType": art,
                "propertyType": prop,
            })

        except Exception as e:
            logger.warning(f"Skip entry {getattr(raw,'zvg_id',None)}: {e}")
            continue

    return results

# ---- Statisches Frontend (aus zvg-app/dist) ----
DIST_DIR = os.path.join(REPO_ROOT, "zvg-app", "dist")
if os.path.isdir(DIST_DIR):
    app.mount("/", StaticFiles(directory=DIST_DIR, html=True), name="static")

# Fallback für SPA (wenn nötig):
@app.get("/")
def index():
    index_path = os.path.join(DIST_DIR, "index.html")
    return FileResponse(index_path)
