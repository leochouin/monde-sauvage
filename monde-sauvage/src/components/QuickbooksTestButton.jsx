import { useState } from 'react';
import supabase from '../utils/supabase';

export default function QuickbooksTestButton() {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

  const runTest = async () => {
    setLoading(true);
    setError(null);
    setResult(null);

    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const accessToken = sessionData?.session?.access_token;
      if (!accessToken) throw new Error('Not signed in');

      const res = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/test-quickbooks`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
        }
      );

      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`);
      setResult(json);
    } catch (err) {
      console.error('test-quickbooks failed:', err);
      setError(err.message || 'Unknown error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ padding: 16, border: '1px solid #e2e8f0', borderRadius: 10, background: '#fff' }}>
      <button
        onClick={runTest}
        disabled={loading}
        style={{
          padding: '10px 16px',
          borderRadius: 8,
          background: '#2D5F4C',
          color: '#fff',
          border: 'none',
          cursor: loading ? 'wait' : 'pointer',
          fontWeight: 600,
        }}
      >
        {loading ? 'Testing…' : 'Test QuickBooks Connection'}
      </button>

      {error && (
        <pre style={{ marginTop: 12, padding: 12, background: '#fef2f2', color: '#991b1b', borderRadius: 8, whiteSpace: 'pre-wrap' }}>
          {error}
        </pre>
      )}

      {result && (
        <pre style={{ marginTop: 12, padding: 12, background: '#f8fafc', borderRadius: 8, maxHeight: 400, overflow: 'auto', fontSize: 12 }}>
          {JSON.stringify(result, null, 2)}
        </pre>
      )}
    </div>
  );
}
