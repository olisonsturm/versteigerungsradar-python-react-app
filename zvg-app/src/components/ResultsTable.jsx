import React from 'react';

/**
 * ResultsTable component
 *
 * Displays a table of search results and allows the user to select
 * individual rows for export. Each row includes a checkbox for
 * selection. We avoid fancy styling to keep the UI clear and
 * approachable for non-technical users.
 */
function ResultsTable({ results, selected, onToggleSelect }) {
  if (!results || results.length === 0) {
    return <p>Keine Ergebnisse gefunden.</p>;
  }
  return (
    <table className="results-table">
      <thead>
        <tr>
          <th></th>
          <th>Datum</th>
          <th>Zeit</th>
          <th>Straße</th>
          <th>Hausnr.</th>
          <th>PLZ</th>
          <th>Ort</th>
          <th>Bundesland</th>
          <th>Versteigerung</th>
          <th>Objektart</th>
        </tr>
      </thead>
      <tbody>
        {results.map(item => (
          <tr key={item.id}>
            <td>
              <input
                type="checkbox"
                checked={!!selected[item.id]}
                onChange={() => onToggleSelect(item.id)}
              />
            </td>
            <td>{item.date}</td>
            <td>{item.time}</td>
            <td>{item.street}</td>
            <td>{item.houseNumbers}</td>
            <td>{item.zip}</td>
            <td>{item.city}</td>
            <td>{item.state}</td>
            <td>{item.auctionType}</td>
            <td>{item.propertyType}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export default ResultsTable;