import { useState, useEffect } from 'react';
import SearchForm from './components/SearchForm';
import ResultsTable from './components/ResultsTable';
import LoadingSpinner from './components/LoadingSpinner';
import ErrorPopup from './components/ErrorPopup';
import ErrorBoundary from './components/ErrorBoundary';
import './App.css';

// Base URL for the backend API. Adjust this if the backend runs on a
// different host or port. For development, the backend server runs
// locally on port 8000 as defined in backend/server.py.
const API_URL = '/api/search';

// Helper function to parse house numbers into individual entries
// Accepts a string like "1,3-5" and returns an array of strings
function parseHouseNumbers(houseString) {
  const results = [];
  if (!houseString) return results;
  // split by comma, semicolon or slash
  const parts = houseString.split(/[;,/]+/);
  parts.forEach(part => {
    const trimmed = part.trim();
    if (trimmed.includes('-')) {
      const [start, end] = trimmed.split('-').map(s => s.trim());
      // check if both ends are purely numeric
      const isNumericRange = /^\d+$/.test(start) && /^\d+$/.test(end);
      if (isNumericRange) {
        const s = parseInt(start, 10);
        const e = parseInt(end, 10);
        if (s <= e && e - s < 20) { // limit range to avoid huge expansions
          for (let i = s; i <= e; i++) {
            results.push(String(i));
          }
          return;
        }
      }
      // otherwise treat the range as a single entry
      results.push(trimmed);
    } else if (trimmed) {
      results.push(trimmed);
    }
  });
  return results;
}

function App() {
  // Search criteria state
  const [criteria, setCriteria] = useState({
    states: ['Baden-Württemberg'],
    auctionTypes: [
      'Versteigerung im Wege der Zwangsvollstreckung',
      'Zwangsversteigerung zum Zwecke der Aufhebung der Gemeinschaft',
    ],
    propertyTypes: [
      'Reihenhaus',
      'Doppelhaushälfte',
      'Einfamilienhaus',
      'Wohn- und Geschäftshaus',
      'Gewerbeeinheit',
    ],
    minDays: 5,
  });

  // Results after filtering
  const [results, setResults] = useState([]);

  // Loading state for search
  const [loading, setLoading] = useState(false);

  // Error state for search
  const [error, setError] = useState(null);

  // Selected addresses for export
  const [selected, setSelected] = useState({});

  // Load contact history from localStorage
  const [contactHistory, setContactHistory] = useState(() => {
    const stored = localStorage.getItem('contactHistory');
    return stored ? JSON.parse(stored) : {};
  });

  // Save contact history to localStorage whenever it changes
  useEffect(() => {
    localStorage.setItem('contactHistory', JSON.stringify(contactHistory));
  }, [contactHistory]);

  // Perform search via backend API and update results. Applies
  // additional duplicate filtering client-side based on contact history.
  const handleSearch = async () => {
    setLoading(true);
    setError(null);

    const selectedStates = (criteria.states && criteria.states.length > 0)
      ? criteria.states
      : [];

    if (selectedStates.length === 0) {
      setResults([]);
      setLoading(false);
      return;
    }

    // Build shared query parameters (without state)
    const baseParams = new URLSearchParams();
    baseParams.append('auctionTypes', (criteria.auctionTypes || []).join(','));
    baseParams.append('propertyTypes', (criteria.propertyTypes || []).join(','));
    baseParams.append('minDays', criteria.minDays ?? 0);

    try {
      // Fetch each state in parallel
      const fetches = selectedStates.map(async (state) => {
        const params = new URLSearchParams(baseParams);
        params.append('state', state);
        try {
          const resp = await fetch(`${API_URL}?${params.toString()}`);
          if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
          return await resp.json();
        } catch (e) {
          console.error(`Failed to fetch results for ${state}:`, e);
          // Continue with other states; return empty list for this one
          return [];
        }
      });

      const resultsByState = await Promise.all(fetches);
      const combined = resultsByState.flat();

      // Apply duplicate/contact-history filtering on client side
      const now = new Date();
      const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const firstOfCurrent = new Date(now.getFullYear(), now.getMonth(), 1);
      const filtered = combined.filter(item => {
        const history = contactHistory[item.id];
        if (history) {
          const contactDate = new Date(history);
          if (contactDate >= lastMonth && contactDate < firstOfCurrent) {
            return false;
          }
        }
        return true;
      });

      setResults(filtered);
    } catch (error) {
      console.error('Failed to fetch search results:', error);
      setError(`Die Suche ist fehlgeschlagen. Bitte überprüfen Sie die Netzwerkverbindung und stellen Sie sicher, dass der Backend-Server erreichbar ist. Details: ${error.message}`);
      setResults([]);
    } finally {
      setLoading(false);
    }
  };

  // Toggle selection for a single result
  const handleToggleSelect = (id) => {
    setSelected(prev => ({
      ...prev,
      [id]: !prev[id],
    }));
  };

  // When user exports addresses, we mark them as contacted for current date
  const markSelectedAsContacted = () => {
    const today = new Date().toISOString();
    setContactHistory(prev => {
      const updated = { ...prev };
      Object.keys(selected).forEach(id => {
        if (selected[id]) {
          updated[id] = today;
        }
      });
      return updated;
    });
  };

  // Generate addresses for export. This expands multi-house-number entries.
  const generateAddresses = () => {
    const list = [];
    results.forEach(item => {
      if (selected[item.id]) {
        const numbers = parseHouseNumbers(item.houseNumbers);
        const baseStreet = `${item.street}`.trim();
        if (numbers.length === 0) {
          list.push({ street: baseStreet, zip: item.zip, city: item.city });
        } else {
          numbers.forEach(num => {
            const street = num ? `${baseStreet} ${num}` : baseStreet;
            list.push({ street, zip: item.zip, city: item.city });
          });
        }
      }
    });
    return list;
  };

  // Export selected addresses to CSV
  const exportToCSV = () => {
    const addresses = generateAddresses();
    if (addresses.length === 0) return;
    let csvContent = 'Straße,PLZ,Ort\n';
    addresses.forEach(addr => {
      // Escape potential commas by wrapping fields in quotes
      const street = `"${addr.street.replace(/"/g, '""')}"`;
      const zip = `"${String(addr.zip || '').replace(/"/g, '""')}"`;
      const city = `"${String(addr.city || '').replace(/"/g, '""')}"`;
      csvContent += `${street},${zip},${city}\n`;
    });
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', 'adressliste.csv');
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    markSelectedAsContacted();
  };

  return (
    <div className="app">
      {loading && <LoadingSpinner />}
      {error && <ErrorPopup message={error} onClose={() => setError(null)} />}
      <header className="app-header">
        <h1>Versteigerungsradar</h1>
      </header>
      <main>
        <ErrorBoundary fallbackMessage="Beim Anzeigen der Ergebnisse ist ein Fehler aufgetreten.">
          <SearchForm
            criteria={criteria}
            setCriteria={setCriteria}
            onSearch={handleSearch}
            loading={loading}
          />
          <ResultsTable
            results={results}
            selected={selected}
            onToggleSelect={handleToggleSelect}
          />
          {results.length > 0 && (
            <div className="actions">
              <button
                type="button"
                onClick={exportToCSV}
                disabled={Object.keys(selected).filter(key => selected[key]).length === 0}
              >
                Adressen als CSV exportieren
              </button>
            </div>
          )}
        </ErrorBoundary>
      </main>
    </div>
  );
}

export default App;