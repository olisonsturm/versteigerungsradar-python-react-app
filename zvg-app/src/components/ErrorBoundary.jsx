import React from 'react';

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, info) {
    // Log to console for debugging
    console.error('ErrorBoundary caught an error:', error, info);
    if (this.props.onError) {
      this.props.onError(error);
    }
  }

  render() {
    if (this.state.hasError) {
      const message = this.props.fallbackMessage || 'Es ist ein unerwarteter Fehler aufgetreten.';
      return (
        <div style={{ padding: 16 }}>
          <h3>Fehler</h3>
          <p>{message}</p>
        </div>
      );
    }
    return this.props.children;
  }
}

export default ErrorBoundary;
