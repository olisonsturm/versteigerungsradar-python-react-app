import React from 'react';
import './ErrorPopup.css';

function ErrorPopup({ message, onClose }) {
  if (!message) {
    return null;
  }

  return (
    <div className="popup-overlay">
      <div className="popup-content">
        <h3>Fehler bei der Suche</h3>
        <p>{message}</p>
        <button onClick={onClose}>Schließen</button>
      </div>
    </div>
  );
}

export default ErrorPopup;
