import React from 'react';
import Select from 'react-select';

/**
 * SearchForm component
 *
 * Provides input controls for selecting Bundesland, auction types,
 * property types and minimum days. The form does not perform
 * validation beyond presence; since the target user may not be
 * technically inclined, we keep the layout clear and labels simple.
 */
function SearchForm({ criteria, setCriteria, onSearch, loading }) {
  // List of Bundesländer available, formatted for react-select
  const stateOptions = [
    { value: 'Baden-Württemberg', label: 'Baden-Württemberg' },
    { value: 'Hessen', label: 'Hessen' },
    { value: 'Nordrhein-Westfalen', label: 'Nordrhein-Westfalen' },
    { value: 'Bayern', label: 'Bayern' },
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

  // Update criteria when state dropdown changes (multi-select with react-select)
  const handleStateChange = (selectedOptions) => {
    const selected = selectedOptions ? selectedOptions.map(opt => opt.value) : [];
    setCriteria(prev => ({ ...prev, states: selected }));
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

  // Derive value for react-select from criteria
  const selectedStateValues = stateOptions.filter(option =>
    (criteria.states || []).includes(option.value)
  );

  return (
    <form className="search-form" onSubmit={handleSubmit}>
      <div className="form-row">
        <label>Bundesländer</label>
        <Select
          isMulti
          options={stateOptions}
          value={selectedStateValues}
          onChange={handleStateChange}
          className="react-select-container"
          classNamePrefix="react-select"
          placeholder="Bundesländer auswählen..."
        />
      </div>
      <div className="form-row">
        <label>Versteigerungsart</label>
        <div className="checkbox-group">
          {auctionOptions.map(option => (
            <label key={option} className="checkbox-label">
              <input
                type="checkbox"
                value={option}
                checked={(criteria.auctionTypes || []).includes(option)}
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
                checked={(criteria.propertyTypes || []).includes(option)}
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
        <button type="submit" disabled={loading}>
          {loading ? 'Suchen...' : 'Suchen'}
        </button>
      </div>
    </form>
  );
}

export default SearchForm;