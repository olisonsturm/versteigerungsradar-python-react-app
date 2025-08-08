#!/usr/bin/env python3
# -*- coding: utf-8 -*-

"""
Simple backend server for the Zwangsversteigerung WebApp.

This server exposes an HTTP API at `/api/search` that accepts query
parameters and returns a JSON list of foreclosure entries scraped from
zvg-portal.de. It relies on the local copy of the ZvgPortalScraper
repository and does not require external dependencies beyond the
standard library. Because the upstream library expects a German
locale ("de_DE") that may not be installed, the backend uses a
custom date parser for German date strings instead of the library's
locale-based parser.

Usage:
    python3 server.py --port 8000

Query parameters for /api/search:
    state=Bundeslandname (required, e.g. "Baden-Württemberg")
    auctionTypes=comma-separated list of auction type strings
        ("Versteigerung im Wege der Zwangsvollstreckung",
         "Zwangsversteigerung zum Zwecke der Aufhebung der Gemeinschaft")
    propertyTypes=comma-separated list of property type filters
        ("Reihenhaus","Doppelhaushälfte","Einfamilienhaus",
         "Wohn- und Geschäftshaus","Gewerbeeinheit")
    minDays=integer number of days from today (default 0)

Example:
    http://localhost:8000/api/search?state=Baden-Württemberg&auctionTypes=Versteigerung%20im%20Wege%20der%20Zwangsvollstreckung&propertyTypes=Reihenhaus,Einfamilienhaus&minDays=5
"""

from http.server import BaseHTTPRequestHandler, HTTPServer
import json
import datetime
import logging
import urllib.parse
import sys
import os
import locale
from typing import List, Dict, Optional, Any
import time

# Patch locale.setlocale to gracefully handle missing German locale
# The upstream ZvgPortalScraper attempts to set the system locale to
# 'de_DE' which is not available in this container. We override
# locale.setlocale to fall back to the C locale when the requested
# locale cannot be set. This must happen before importing zvg_portal.
_real_setlocale = locale.setlocale
def _patched_setlocale(category, loc=None):
    try:
        return _real_setlocale(category, loc)
    except locale.Error:
        # If the requested locale isn't supported (e.g. de_DE), use C locale instead
        return _real_setlocale(category, 'C')
locale.setlocale = _patched_setlocale

# Ensure the local ZvgPortalScraper module can be imported
LIB_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'ZvgPortalScraper')
if os.path.isdir(LIB_DIR) and LIB_DIR not in sys.path:
    sys.path.insert(0, LIB_DIR)

try:
    from zvg_portal.scraper import ZvgPortal
    from zvg_portal.model import Land, ObjektEntry
except ImportError as e:
    raise SystemExit(f"Could not import zvg_portal library: {e}. Ensure ZvgPortalScraper is cloned in the expected location.")


class GermanDateParser:
    """Parse German date strings such as 'Montag, 07. August 2025, 10:00 Uhr'."""
    MONTHS = {
        'Januar': 1, 'Februar': 2, 'März': 3, 'April': 4,
        'Mai': 5, 'Juni': 6, 'Juli': 7, 'August': 8,
        'September': 9, 'Oktober': 10, 'November': 11, 'Dezember': 12,
    }

    @staticmethod
    def parse(s: str) -> Optional[datetime.datetime]:
        """Return a datetime object or None if parsing fails."""
        try:
            # Expected format: "Wochentag, dd. Monat YYYY, HH:MM Uhr"
            parts = s.split(',')
            if len(parts) < 3:
                return None
            # The second part contains day and month: ' dd. Monat YYYY'
            second = parts[1].strip()
            # Remove trailing '.' after day and split
            day_part, month_name, year_str = second.replace('.', '').split()
            day = int(day_part)
            month = GermanDateParser.MONTHS.get(month_name)
            year = int(year_str)
            # Third part contains time: ' HH:MM Uhr'
            time_str = parts[2].strip()
            # Remove the trailing 'Uhr'
            if time_str.lower().endswith('uhr'):
                time_str = time_str[:-3].strip()
            hour_str, minute_str = time_str.split(':')
            hour = int(hour_str)
            minute = int(minute_str)
            return datetime.datetime(year, month, day, hour, minute)
        except Exception:
            return None


class ZVGBackend:
    def __init__(self, base_url: str = 'https://www.zvg-portal.de', user_agent: str = 'ZvgPortalBackend/1.0'):
        self.logger = logging.getLogger('ZVGBackend')
        self.portal = ZvgPortal(self.logger, user_agent, base_url)
        # Simple in-memory cache for entries per Land
        self._entries_cache: Dict[str, Dict[str, Any]] = {}
        # Cache TTL can be configured via env var (seconds), default 30 minutes
        self._cache_ttl_seconds: int = int(os.environ.get('ZVG_CACHE_TTL', '1800'))
        # Build mapping from state names to Land objects
        self.state_map: Dict[str, Land] = {}
        for land in self.portal.get_laender():
            # Store the canonical name from the portal
            self.state_map[land.name] = land
            # Also map common variants of the name to the same Land object.
            # Users might provide names with German umlauts (e.g. "Baden-Württemberg")
            # while the scraper uses ue/ae/oe replacements (e.g. "Baden-Wuerttemberg").
            # Add both forms to the lookup. In addition, map the short code in upper
            # case (e.g. "BW") to the Land.
            name_variants = set()
            # If the name contains "ae", "oe", "ue" replace with German umlaut equivalents
            # e.g. "Baden-Wuerttemberg" -> "Baden-Württemberg"
            rep_map = {"ae": "ä", "oe": "ö", "ue": "ü", "Ae": "Ä", "Oe": "Ö", "Ue": "Ü"}
            variant = land.name
            for ascii_umlaut, umlaut in rep_map.items():
                if ascii_umlaut in variant:
                    variant = variant.replace(ascii_umlaut, umlaut)
            name_variants.add(variant)
            # Conversely, replace umlaut characters with their ascii counterparts
            umlaut_map = {"ä": "ae", "ö": "oe", "ü": "ue", "Ä": "Ae", "Ö": "Oe", "Ü": "Ue"}
            variant2 = land.name
            for umlaut, ascii_umlaut in umlaut_map.items():
                if umlaut in variant2:
                    variant2 = variant2.replace(umlaut, ascii_umlaut)
            name_variants.add(variant2)
            # Also add the existing name again to ensure it's present
            name_variants.add(land.name)
            # Add each variant mapping
            for nm in name_variants:
                if nm not in self.state_map:
                    self.state_map[nm] = land
            # Add the two-letter abbreviation in uppercase
            short_upper = land.short.upper()
            if short_upper not in self.state_map:
                self.state_map[short_upper] = land

        # Precompile property type keywords for filtering
        self.property_keywords = {
            'Reihenhaus': ['reihenhaus'],
            'Doppelhaushälfte': ['doppelhaushälfte', 'doppelhaushaelfte', 'doppelhaushaelfte', 'doppelhaus'],
            'Einfamilienhaus': ['einfamilienhaus'],
            'Wohn- und Geschäftshaus': ['wohn- und geschäftshaus', 'wohn- und geschaeftshaus', 'wohn-und geschäftshaus', 'wohn-und geschaeftshaus'],
            'Gewerbeeinheit': ['gewerbeeinheit', 'gewerbefläche', 'gewerbeobjekt'],
        }

    def _fix_encoding(self, s: Optional[str]) -> str:
        """Fix common mojibake (UTF-8 seen as Latin-1) if detected.

        If the text contains 'Ã' or 'Â', try latin-1 -> utf-8 roundtrip.
        """
        if not s:
            return ''
        try:
            if 'Ã' in s or 'Â' in s:
                return s.encode('latin-1', errors='ignore').decode('utf-8', errors='ignore')
            return s
        except Exception:
            return s

    def _get_entries_cached(self, land: Land) -> List[ObjektEntry]:
        key = land.name
        now = time.time()
        entry = self._entries_cache.get(key)
        if entry and (now - entry['ts'] < self._cache_ttl_seconds):
            return entry['entries']
        # Refresh cache
        t0 = time.time()
        entries = list(self.portal.list(land))
        dt = time.time() - t0
        self._entries_cache[key] = {'ts': now, 'entries': entries}
        self.logger.info(f"Fetched {len(entries)} raw entries for '{land.name}' in {dt:.1f}s (cache ttl {self._cache_ttl_seconds}s)")
        return entries

    def _determine_property_type(self, text: str, selected_types: List[str]) -> Optional[str]:
        """Return the first matching property type for the given text.

        :param text: combined object location and description in lowercase
        :param selected_types: list of property type filters (strings)
        :return: property type or None if no match
        """
        for ptype in selected_types:
            keywords = self.property_keywords.get(ptype, [])
            for kw in keywords:
                if kw in text:
                    return ptype
        return None

    def search(self, state: str, auction_types: List[str], property_types: List[str], min_days: int) -> List[Dict]:
        """
        Perform a search and return a list of dictionaries containing selected fields for each entry.

        :param state: full name of the federal state
        :param auction_types: list of allowed auction types
        :param property_types: list of allowed property types
        :param min_days: minimum number of days from now for the auction date
        :return: list of results
        """
        results = []
        land = self.state_map.get(state)
        if not land:
            return results

        now = datetime.datetime.now()
        min_date = (now + datetime.timedelta(days=min_days)).date()

        for raw in self._get_entries_cached(land):
            # Wir interessieren uns nur für „ObjektEntry“
            if not isinstance(raw, ObjektEntry):
                continue

            try:
                entry = raw  # alias

                # --- Datum robust parsen ---
                auction_dt = entry.termin_as_date
                if not auction_dt and entry.termin_as_str:
                    fixed_date_str = self._fix_encoding(entry.termin_as_str)
                    auction_dt = GermanDateParser.parse(fixed_date_str)
                if not auction_dt or auction_dt.date() < min_date:
                    continue

                # --- Versteigerungsart filtern (optional) ---
                art = self._fix_encoding((entry.art_der_versteigerung or '').strip())
                if auction_types and art and art not in auction_types:
                    continue

                # --- Objektart erkennen (optional) ---
                objekt_lage = self._fix_encoding(entry.objekt_lage or '')
                beschreibung = self._fix_encoding(entry.beschreibung or '')
                combined_text = ' '.join(filter(None, [objekt_lage, beschreibung])).lower()
                prop_type = ''
                if property_types:
                    p = self._determine_property_type(combined_text, property_types)
                    if not p:
                        continue
                    prop_type = p

                # --- Adresse robust zerlegen ---
                street = ''
                house_numbers = ''
                zip_code = ''
                city = ''

                if entry.adresse:
                    street = self._fix_encoding(entry.adresse.strasse or '')
                    zip_code = self._fix_encoding(entry.adresse.plz or '')
                    city = self._fix_encoding(entry.adresse.ort or '')
                    # Hausnummern vom Straßenstring abtrennen (wenn vorhanden)
                    import re
                    m = re.match(r'^([^\d]+?)\s*(\d.*)?$', street)
                    if m:
                        street = (m.group(1) or '').strip()
                        house_numbers = (m.group(2) or '').strip()
                else:
                    # Fallback: „Objekt/Lage“ sehr defensiv parsen
                    parts = (objekt_lage or '').split(',')
                    if parts:
                        street = parts[0].strip()
                        if len(parts) > 1:
                            # Nur das erste „Wort“ nach dem Komma als Nr. nehmen, falls sinnvoll
                            hn_tokens = parts[1].strip().split()
                            house_numbers = hn_tokens[0] if hn_tokens else ''
                        # PLZ/Ort evtl. in späteren Komma-Teilen/mit Semikolon; NICHT erzwingen

                results.append({
                    'id': entry.zvg_id,
                    'date': auction_dt.strftime('%Y-%m-%d'),
                    'time': auction_dt.strftime('%H:%M'),
                    'street': street,
                    'houseNumbers': house_numbers,
                    'zip': zip_code,
                    'city': city,
                    'state': state,
                    'auctionType': art,
                    'propertyType': prop_type,
                })

            except Exception as e:
                # Wichtig: einzelne Ausreißer schlucken, nicht die gesamte Antwort sprengen
                self.logger.warning(f"Skip entry {getattr(raw, 'zvg_id', None)} due to error: {e}")
                continue
        return results

class RequestHandler(BaseHTTPRequestHandler):
    backend = ZVGBackend()

    def _set_headers(self, status: int = 200, content_type: str = 'application/json'):
        self.send_response(status)
        self.send_header('Content-Type', content_type)
        # Allow cross-origin requests from any origin (for development)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.end_headers()

    def do_OPTIONS(self):
        self._set_headers(200)

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        if parsed.path == '/api/search':
            params = urllib.parse.parse_qs(parsed.query)
            state = params.get('state', [''])[0]
            auction_param = params.get('auctionTypes', [''])[0]
            prop_param = params.get('propertyTypes', [''])[0]
            min_days_str = params.get('minDays', ['0'])[0]
            auction_types = [a for a in auction_param.split(',') if a]
            property_types = [p for p in prop_param.split(',') if p]
            try:
                min_days = int(min_days_str)
            except ValueError:
                min_days = 0
            try:
                results = self.backend.search(state, auction_types, property_types, min_days)
                body = json.dumps(results, ensure_ascii=False).encode('utf-8')
                self._set_headers(200)
                self.wfile.write(body)
            except Exception as e:
                self.backend.logger.error(f"Error during search: {e}")
                err = {'error': str(e)}
                body = json.dumps(err, ensure_ascii=False).encode('utf-8')
                self._set_headers(500)
                self.wfile.write(body)
        else:
            self._set_headers(404)
            body = json.dumps({'error': 'Not Found'}).encode('utf-8')
            self.wfile.write(body)


def run_server(port: int = 8000):
    logging.basicConfig(level=logging.INFO)
    server_address = ('', port)
    httpd = HTTPServer(server_address, RequestHandler)
    logging.info(f"Starting backend on port {port}")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass
    httpd.server_close()
    logging.info("Backend stopped")


if __name__ == '__main__':
    import argparse
    parser = argparse.ArgumentParser(description='ZVG Portal Backend Server')
    parser.add_argument('--port', type=int, default=int(os.environ.get('PORT', 8000)), help='Port to listen on')
    args = parser.parse_args()
    run_server(args.port)