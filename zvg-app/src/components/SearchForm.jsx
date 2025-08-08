import React from 'react';

/**
 * SearchForm component
 *
 * Provides input controls for selecting Bundesland, auction types,
 * property types and minimum days. The form does not perform
 * validation beyond presence; since the target user may not be
 * technically inclined, we keep the layout clear and labels simple.
 */
function SearchForm({ criteria, setCriteria, onSearch }) {
  // List of Bundesländer available
  const states = [
    'Baden-Württemberg',
    'Hessen',
    'Nordrhein-Westfalen',
    'Bayern',
  ];

  // List of auction type options
  const auctionOptions = [
    'Versteigerung im Wege der Zwangsvollstreckung',
    'Zwangsversteigerung zum Zwecke der Aufhebung der Gemeinschaft',
  ];

  // List of property type options
  const propertyOptions = [
    'Reihenhaus',
    'Doppelhaushälfte',
    'Einfamilienhaus',
    'Wohn- und Geschäftshaus',
    'Gewerbeeinheit',
  ];

  // Update criteria when state dropdown changes
  const handleStateChange = (e) => {
    setCriteria(prev => ({ ...prev, state: e.target.value }));
  };

  // Update criteria for auction type checkboxes
  const handleAuctionChange = (e) => {
    const value = e.target.value;
    setCriteria(prev => {
      const current = prev.auctionTypes || [];
      if (e.target.checked) {
        return { ...prev, auctionTypes: [...current, value] };
      }
      return { ...prev, auctionTypes: current.filter(item => item !== value) };
    });
  };

  // Update criteria for property type checkboxes
  const handlePropertyChange = (e) => {
    const value = e.target.value;
    setCriteria(prev => {
      const current = prev.propertyTypes || [];
      if (e.target.checked) {
        return { ...prev, propertyTypes: [...current, value] };
      }
      return { ...prev, propertyTypes: current.filter(item => item !== value) };
    });
  };

  // Update minimum days
  const handleMinDaysChange = (e) => {
    const num = parseInt(e.target.value, 10);
    setCriteria(prev => ({ ...prev, minDays: isNaN(num) ? 0 : num }));
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    onSearch();
  };

  return (
    <form className="search-form" onSubmit={handleSubmit}>
      <div className="form-row">
        <label>Bundesland</label>
        <select value={criteria.state} onChange={handleStateChange}>
          {states.map(state => (
            <option key={state} value={state}>{state}</option>
          ))}
        </select>
      </div>
      <div className="form-row">
        <label>Versteigerungsart</label>
        <div className="checkbox-group">
          {auctionOptions.map(option => (
            <label key={option} className="checkbox-label">
              <input
                type="checkbox"
                value={option}
                checked={criteria.auctionTypes.includes(option)}
                onChange={handleAuctionChange}
              />
              {option}
            </label>
          ))}
        </div>
      </div>
      <div className="form-row">
        <label>Objektart</label>
        <div className="checkbox-group">
          {propertyOptions.map(option => (
            <label key={option} className="checkbox-label">
              <input
                type="checkbox"
                value={option}
                checked={criteria.propertyTypes.includes(option)}
                onChange={handlePropertyChange}
              />
              {option}
            </label>
          ))}
        </div>
      </div>
      <div className="form-row">
        <label>Minimale Tage bis Termin</label>
        <input
          type="number"
          min="0"
          value={criteria.minDays}
          onChange={handleMinDaysChange}
        />
      </div>
      <div className="form-row">
        <button type="submit">Suchen</button>
      </div>
    </form>
  );
}

export default SearchForm;