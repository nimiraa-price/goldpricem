import { useState, useEffect, useRef } from 'react';
import Head from 'next/head';

const PURITIES = [
  { key: 'gold_rate_9k',  label: '9K Gold',  karat: 9  },
];

export default function Home() {
  const [authed,    setAuthed]    = useState(false);
  const [password,  setPassword]  = useState('');
  const [authError, setAuthError] = useState('');
  const [rates,     setRates]     = useState({ gold_rate_9k: '', gst_percent: '3' });
  const [saving,    setSaving]    = useState(false);
  const [running,   setRunning]   = useState(false);
  const [log,       setLog]       = useState([]);
  const [stats,     setStats]     = useState({ total: 0, updated: 0, skipped: 0 });
  const [saveMsg,   setSaveMsg]   = useState('');
  const logRef = useRef(null);

  useEffect(() => {
    // Check session
    const saved = sessionStorage.getItem('gpm_auth');
    if (saved === 'true') { setAuthed(true); loadRates(); }
  }, []);

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [log]);

  async function login() {
    setAuthError('');
    try {
      const res = await fetch('/api/get-rates', { headers: { 'x-admin-password': password } });
      if (res.status === 401) {
        setAuthError('Wrong password. Try again.');
        return;
      }
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setAuthError(data.error || `Server error: ${res.status}`);
        return;
      }
      const data = await res.json();
      setRates(data);
      sessionStorage.setItem('gpm_auth', 'true');
      sessionStorage.setItem('gpm_pass', password);
      setAuthed(true);
    } catch (err) {
      setAuthError(`Connection error: ${err.message}`);
    }
  }

  async function loadRates() {
    const pass = sessionStorage.getItem('gpm_pass');
    const res  = await fetch('/api/get-rates', { headers: { 'x-admin-password': pass } });
    const data = await res.json();
    setRates(data);
  }

  async function saveRates() {
    setSaving(true); setSaveMsg('');
    const pass = sessionStorage.getItem('gpm_pass');
    const res  = await fetch('/api/save-rates', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-admin-password': pass },
      body: JSON.stringify(rates),
    });
    setSaving(false);
    setSaveMsg(res.ok ? '✓ Rates saved successfully!' : '✗ Failed to save rates.');
    setTimeout(() => setSaveMsg(''), 4000);
  }

  async function recalculate() {
    setRunning(true);
    setLog([]);
    setStats({ total: 0, updated: 0, skipped: 0 });
    const pass = sessionStorage.getItem('gpm_pass');

    setLog(l => [...l, { type: 'info', text: 'Fetching all products from Shopify...' }]);

    let products = [];
    try {
      const res = await fetch('/api/products', {
        headers: { 'x-admin-password': pass },
      });
      if (!res.ok) {
        throw new Error(await res.text() || 'Failed to fetch products');
      }
      const data = await res.json();
      products = data.products || [];
    } catch (err) {
      setLog(l => [...l, { type: 'error', text: `✗ Error: ${err.message}` }]);
      setRunning(false);
      return;
    }

    setStats(s => ({ ...s, total: products.length }));
    setLog(l => [...l, { type: 'info', text: `Found ${products.length} products. Recalculating prices...` }]);

    let updatedCount = 0;
    let skippedCount = 0;

    for (const product of products) {
      try {
        const res = await fetch('/api/recalculate', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-admin-password': pass,
          },
          body: JSON.stringify({
            productId: product.id,
            variants: product.variants,
            goldRate: parseFloat(rates.gold_rate_9k) || 0,
            gstPercent: parseFloat(rates.gst_percent) || 0,
          }),
        });

        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          throw new Error(errData.reason || `Server error ${res.status}`);
        }

        const result = await res.json();

        if (result.status === 'updated') {
          setLog(l => [...l, { type: 'success', text: `✓ ${product.title} (Updated to ₹${result.price.toLocaleString('en-IN')})` }]);
          updatedCount++;
        } else if (result.status === 'skipped') {
          setLog(l => [...l, { type: 'skip', text: `— ${product.title} — ${result.reason}` }]);
          skippedCount++;
        } else {
          setLog(l => [...l, { type: 'error', text: `✗ ${product.title} — ${result.reason || 'Unknown error'}` }]);
        }
      } catch (err) {
        setLog(l => [...l, { type: 'error', text: `✗ ${product.title} — Error: ${err.message}` }]);
      }

      setStats(s => ({
        ...s,
        updated: updatedCount,
        skipped: skippedCount,
      }));

      // Small delay to respect rate limits
      await new Promise(r => setTimeout(r, 100));
    }

    setLog(l => [...l, { type: 'done', text: `✓ Done — ${updatedCount} updated, ${skippedCount} skipped` }]);
    setRunning(false);
  }

  function logout() {
    sessionStorage.clear();
    setAuthed(false);
    setPassword('');
  }

  // ── Login Screen ─────────────────────────────────────────────────────────────
  if (!authed) return (
    <>
      <Head><title>Gold Price Manager</title></Head>
      <div className="login-wrap">
        <div className="login-card">
          <div className="login-logo">◈</div>
          <h1 className="login-title">Gold Price Manager</h1>
          <p className="login-sub">Enter your admin password to continue</p>
          <input
            className="input"
            type="password"
            placeholder="Admin Password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && login()}
          />
          {authError && <p className="error-msg">{authError}</p>}
          <button className="btn-primary" onClick={login}>Login →</button>
        </div>
      </div>
    </>
  );

  // ── Main Dashboard ────────────────────────────────────────────────────────────
  const progress = stats.total > 0 ? Math.round(((stats.updated + stats.skipped) / stats.total) * 100) : 0;

  return (
    <>
      <Head><title>Gold Price Manager</title></Head>
      <div className="app">

        {/* Header */}
        <header className="header">
          <div className="header-inner">
            <div className="header-brand">
              <span className="brand-icon">◈</span>
              <span className="brand-name">Gold Price Manager</span>
            </div>
            <button className="btn-ghost" onClick={logout}>Logout</button>
          </div>
        </header>

        <main className="main">

          {/* Gold Rates Card */}
          <div className="card">
            <div className="card-header">
              <h2 className="card-title">Gold Rate — 9K (Today)</h2>
              <p className="card-sub">Enter the 9K gold rate per gram (changes daily)</p>
            </div>

            <div className="rates-grid">
              {PURITIES.map(p => (
                <div key={p.key} className="rate-item">
                  <label className="rate-label">
                    <span className="rate-karat">{p.label}</span>
                    <span className="rate-purity">{p.karat}/24 pure</span>
                  </label>
                  <div className="rate-input-wrap">
                    <span className="rate-symbol">₹</span>
                    <input
                      className="rate-input"
                      type="number"
                      placeholder="0.00"
                      value={rates[p.key]}
                      onChange={e => setRates(r => ({ ...r, [p.key]: e.target.value }))}
                    />
                    <span className="rate-unit">/g</span>
                  </div>
                </div>
              ))}
            </div>

            {/* GST */}
            <div className="gst-row">
              <label className="rate-label">
                <span className="rate-karat">GST Percentage</span>
                <span className="rate-purity">Applied on final output</span>
              </label>
              <div className="rate-input-wrap" style={{ maxWidth: 200 }}>
                <input
                  className="rate-input"
                  type="number"
                  placeholder="3"
                  value={rates.gst_percent}
                  onChange={e => setRates(r => ({ ...r, gst_percent: e.target.value }))}
                />
                <span className="rate-unit">%</span>
              </div>
            </div>

            {/* Save Button */}
            <div className="card-footer">
              {saveMsg && <span className={saveMsg.startsWith('✓') ? 'msg-success' : 'msg-error'}>{saveMsg}</span>}
              <button className="btn-primary" onClick={saveRates} disabled={saving}>
                {saving ? 'Saving...' : 'Save Rates'}
              </button>
            </div>
          </div>

          {/* Recalculate Card */}
          <div className="card">
            <div className="card-header">
              <h2 className="card-title">Update All Product Prices</h2>
              <p className="card-sub">Save rates first, then click below to recalculate and update all products in Shopify</p>
            </div>

            <div className="formula-box">
              <p className="formula-title">Formula being applied (9K Gold Only):</p>
              <p className="formula-text">
                <strong>TGP</strong> = Gold Price (9K) × Weight of Metal<br />
                <strong>TGPM</strong> = TGP + (Fixed Making Charge × Weight of Metal)<br />
                <strong>Output</strong> = TGPM + Diamond Price (if available) + Stone Price (if available)<br />
                <strong>Final Price</strong> = Output + GST %
              </p>
              <p className="formula-note">Products without gold weight are skipped automatically.</p>
            </div>

            <button
              className="btn-update"
              onClick={recalculate}
              disabled={running}
            >
              {running ? '⟳ Updating Prices...' : '⚡ Update All Prices Now'}
            </button>

            {/* Progress */}
            {(running || log.length > 0) && (
              <div className="progress-section">
                {stats.total > 0 && (
                  <>
                    <div className="progress-bar-wrap">
                      <div className="progress-bar" style={{ width: `${progress}%` }} />
                    </div>
                    <div className="progress-stats">
                      <span>{stats.updated} updated</span>
                      <span>{stats.skipped} skipped</span>
                      <span>{stats.total} total</span>
                    </div>
                  </>
                )}
                <div className="log-box" ref={logRef}>
                  {log.map((l, i) => (
                    <div key={i} className={`log-line log-${l.type}`}>{l.text}</div>
                  ))}
                  {running && <div className="log-line log-info">⟳ Processing...</div>}
                </div>
              </div>
            )}
          </div>

          {/* Formula Reference */}
          <div className="card card-slim">
            <h3 className="card-title" style={{ fontSize: 14 }}>Quick Reference — Product Metafields to Fill in Shopify</h3>
            <table className="ref-table">
              <thead><tr><th>Metafield</th><th>What to enter</th></tr></thead>
              <tbody>
                <tr><td>gold_weight_grams</td><td>Weight of gold in grams</td></tr>
                <tr><td>diamond_value</td><td>Direct ₹ value of diamond (0 if none)</td></tr>
                <tr><td>stone_price</td><td>Fixed ₹ value of stones (0 if none)</td></tr>
                <tr><td>making_charge_fixed</td><td>Fixed making charge per gram of gold in ₹</td></tr>
              </tbody>
            </table>
          </div>

        </main>
      </div>
    </>
  );
}


