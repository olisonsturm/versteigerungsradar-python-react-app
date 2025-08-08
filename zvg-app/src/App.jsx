import { useState, useEffect } from 'react';
import SearchForm from './components/SearchForm';
import ResultsTable from './components/ResultsTable';
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
  const parts = houseString.split(/[;,\/]+/);
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
    state: 'Baden-Württemberg',
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
    // Build query parameters
    const params = new URLSearchParams();
    params.append('state', criteria.state);
    params.append('auctionTypes', (criteria.auctionTypes || []).join(','));
    params.append('propertyTypes', (criteria.propertyTypes || []).join(','));
    params.append('minDays', criteria.minDays ?? 0);

    try {
      const response = await fetch(`${API_URL}?${params.toString()}`);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const data = await response.json();
      // Apply duplicate filtering on client side
      const now = new Date();
      const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const firstOfCurrent = new Date(now.getFullYear(), now.getMonth(), 1);
      const filtered = data.filter(item => {
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
      setSelected({});
    } catch (err) {
      console.error('Search failed', err);
      setResults([]);
    }
  };

  // Handle selecting or deselecting a result row
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
        const base = `${item.street}`;
        numbers.forEach(num => {
          list.push({
            street: `${base} ${num}`,
            zip: item.zip,
            city: item.city,
          });
        });
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
      csvContent += `${addr.street},${addr.zip},${addr.city}\n`;
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
    <div className="container">
      <h1>Zwangsversteigerung Terminrecherche</h1>
      <SearchForm criteria={criteria} setCriteria={setCriteria} onSearch={handleSearch} />
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
    </div>
  );
}

export default App;