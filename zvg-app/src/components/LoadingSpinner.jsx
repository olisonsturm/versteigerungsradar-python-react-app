import React from 'react';
import './LoadingSpinner.css';

function LoadingSpinner() {
  return (
    <div className="spinner-overlay">
      <div className="loading-spinner"></div>
    </div>
  );
}

export default LoadingSpinner;
