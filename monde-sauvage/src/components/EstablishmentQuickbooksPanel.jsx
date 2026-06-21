import { useState } from 'react';
import {
  syncEstablishmentQuickbooksInvoices,
  listEstablishmentQuickbooksInvoices,
  buildEstablishmentQuickbooksConnectUrl,
} from '../utils/quickbooksService.js';
import { retryFailedTransfers } from '../utils/stripeService.js';

/**
 * QuickBooks accounting + Stripe transfer reconciliation for an establishment.
 * Mirrors the guide-side panel in accountSettingsModal so owners get the same
 * one-click sync / invoice listing, plus a button to replay failed Connect
 * transfers from combined bookings.
 *
 * @param {{ establishment: { key: string, quickbooks_connected?: boolean } }} props
 */
export default function EstablishmentQuickbooksPanel({ establishment }) {
  const establishmentId = establishment?.key;
  const connected = !!establishment?.quickbooks_connected;

  const [invoices, setInvoices] = useState(null);
  const [invoicesLoading, setInvoicesLoading] = useState(false);
  const [invoicesError, setInvoicesError] = useState(null);
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState(null);

  const [retrying, setRetrying] = useState(false);
  const [retryResult, setRetryResult] = useState(null);

  const currency = (n) =>
    new Intl.NumberFormat('fr-CA', { style: 'currency', currency: 'CAD' }).format(n || 0);

  const handleConnect = () => {
    if (!establishmentId) return;
    const redirectTo = encodeURIComponent(globalThis.location.href);
    globalThis.location.href = buildEstablishmentQuickbooksConnectUrl(establishmentId, redirectTo);
  };

  const handleLoadInvoices = async () => {
    setInvoicesLoading(true);
    setInvoicesError(null);
    try {
      const result = await listEstablishmentQuickbooksInvoices(establishmentId, 20);
      setInvoices(result.invoices || []);
    } catch (err) {
      setInvoicesError(err.message || 'Erreur lors du chargement des factures');
    } finally {
      setInvoicesLoading(false);
    }
  };

  const handleSync = async () => {
    setSyncing(true);
    setSyncResult(null);
    try {
      const result = await syncEstablishmentQuickbooksInvoices(establishmentId);
      setSyncResult(result);
      if (result.synced > 0) await handleLoadInvoices();
    } catch (err) {
      setSyncResult({ error: err.message || 'Erreur de synchronisation QuickBooks' });
    } finally {
      setSyncing(false);
    }
  };

  const handleRetryTransfers = async () => {
    setRetrying(true);
    setRetryResult(null);
    try {
      const result = await retryFailedTransfers({ entity: 'establishment', establishmentId });
      setRetryResult(result);
    } catch (err) {
      setRetryResult({ error: err.message || 'Erreur lors de la réconciliation des transferts' });
    } finally {
      setRetrying(false);
    }
  };

  return (
    <div style={{ padding: 20, background: 'white', borderRadius: 12, border: '1px solid #E5E7EB' }}>
      <h3 style={{ margin: '0 0 4px', fontSize: 16, color: '#1F3A2E' }}>📒 Comptabilité QuickBooks</h3>
      <p style={{ margin: '0 0 16px', fontSize: 13, color: '#5A7766' }}>
        Synchronisez vos réservations de chalet payées vers QuickBooks Online en un clic.
      </p>

      {/* Connection badge */}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 16 }}>
        {connected ? (
          <span style={{ padding: '4px 12px', borderRadius: 12, background: '#dcfce7', color: '#166534', fontSize: 13, fontWeight: 500 }}>
            ✅ QuickBooks connecté
          </span>
        ) : (
          <span style={{ padding: '4px 12px', borderRadius: 12, background: '#f1f5f9', color: '#64748b', fontSize: 13 }}>
            Non connecté
          </span>
        )}
        <button
          type="button"
          onClick={handleConnect}
          style={{
            padding: '4px 12px',
            backgroundColor: connected ? '#f1f5f9' : '#2CA01C',
            color: connected ? '#64748b' : 'white',
            border: `1px solid ${connected ? '#e2e8f0' : '#2CA01C'}`,
            borderRadius: 8,
            fontSize: 12,
            fontWeight: 500,
            cursor: 'pointer',
          }}
        >
          {connected ? '🔄 Reconnecter' : 'Connecter QuickBooks'}
        </button>
      </div>

      {connected && (
        <>
          {/* Sync action */}
          <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
            <button
              type="button"
              onClick={handleSync}
              disabled={syncing}
              style={{
                flex: '1 1 auto',
                padding: '10px 16px',
                backgroundColor: syncing ? '#94a3b8' : '#1F3A2E',
                color: 'white',
                border: 'none',
                borderRadius: 10,
                fontSize: 13,
                fontWeight: 600,
                cursor: syncing ? 'not-allowed' : 'pointer',
              }}
            >
              {syncing ? '⏳ Synchronisation...' : '⬆️ Synchroniser vers QuickBooks'}
            </button>
            <button
              type="button"
              onClick={handleLoadInvoices}
              disabled={invoicesLoading}
              title="Actualiser la liste"
              style={{
                padding: '10px 14px',
                backgroundColor: 'white',
                color: '#1F3A2E',
                border: '1px solid #E5E7EB',
                borderRadius: 10,
                fontSize: 13,
                cursor: invoicesLoading ? 'not-allowed' : 'pointer',
              }}
            >
              {invoicesLoading ? '⏳' : '↺'}
            </button>
          </div>

          {/* Sync result */}
          {syncResult && !syncing && (
            <div style={{
              padding: '10px 14px',
              borderRadius: 8,
              marginBottom: 12,
              fontSize: 12,
              background: syncResult.error ? '#FEF2F2' : '#F0FDF4',
              color: syncResult.error ? '#991B1B' : '#166534',
              border: `1px solid ${syncResult.error ? '#FECACA' : '#BBF7D0'}`,
            }}>
              {syncResult.error
                ? `⚠️ ${syncResult.error}`
                : `✅ ${syncResult.synced} synchronisée(s)${syncResult.skipped > 0 ? `, ${syncResult.skipped} ignorée(s)` : ''}${syncResult.errors?.length > 0 ? ` — ${syncResult.errors.length} erreur(s)` : ''}`}
            </div>
          )}

          {/* Invoices list */}
          <div style={{ borderTop: '1px solid #F1F5F9', paddingTop: 14 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: '#1F3A2E', marginBottom: 10 }}>
              Factures récentes
            </div>

            {invoicesLoading && (
              <div style={{ color: '#9CA3AF', fontSize: 13, textAlign: 'center', padding: 16 }}>Chargement...</div>
            )}

            {invoicesError && !invoicesLoading && (
              <div style={{ padding: '10px 14px', background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 8, fontSize: 12, color: '#991B1B', marginBottom: 8 }}>
                ⚠️ {invoicesError}
              </div>
            )}

            {!invoicesLoading && !invoicesError && invoices !== null && (
              invoices.length === 0 ? (
                <div style={{ color: '#9CA3AF', fontSize: 13, textAlign: 'center', padding: 12 }}>
                  Aucune facture trouvée dans QuickBooks
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {invoices.map((inv) => (
                    <div key={inv.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 12px', background: '#F8FAF9', borderRadius: 8, border: '1px solid #E5E7EB', gap: 8, flexWrap: 'wrap' }}>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontSize: 12, fontWeight: 600, color: '#1F3A2E' }}>
                          #{inv.docNumber || inv.id} — {inv.customerName}
                        </div>
                        <div style={{ fontSize: 11, color: '#9CA3AF', marginTop: 2 }}>{inv.date}</div>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                        <span style={{ fontSize: 13, fontWeight: 700, color: '#1F3A2E' }}>{currency(inv.total)}</span>
                        <span style={{ padding: '2px 8px', borderRadius: 10, fontSize: 11, fontWeight: 500, background: inv.isPaid ? '#dcfce7' : '#fef9c3', color: inv.isPaid ? '#166534' : '#92400e' }}>
                          {inv.isPaid ? 'Payée' : 'En attente'}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )
            )}

            {!invoicesLoading && invoices === null && !invoicesError && (
              <div style={{ color: '#9CA3AF', fontSize: 13, textAlign: 'center', padding: 12 }}>
                Cliquez sur ↺ pour charger les factures
              </div>
            )}
          </div>
        </>
      )}

      {!connected && (
        <div style={{ marginTop: 4, padding: '10px 14px', background: '#f8fafc', borderRadius: 10, border: '1px solid #e2e8f0', fontSize: 12, color: '#64748b' }}>
          ℹ️ Connectez votre compte QuickBooks Online via le bouton ci-dessus pour activer la synchronisation des factures.
        </div>
      )}

      {/* ── Stripe transfer reconciliation ── */}
      <div style={{ borderTop: '1px solid #F1F5F9', marginTop: 18, paddingTop: 16 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: '#1F3A2E', marginBottom: 4 }}>
          🔁 Transferts Stripe en attente
        </div>
        <p style={{ margin: '0 0 12px', fontSize: 12, color: '#5A7766' }}>
          Relancez les versements Stripe Connect qui ont échoué lors d'une réservation combinée (guide + chalet).
        </p>
        <button
          type="button"
          onClick={handleRetryTransfers}
          disabled={retrying}
          style={{
            padding: '10px 16px',
            backgroundColor: retrying ? '#94a3b8' : '#635BFF',
            color: 'white',
            border: 'none',
            borderRadius: 10,
            fontSize: 13,
            fontWeight: 600,
            cursor: retrying ? 'not-allowed' : 'pointer',
          }}
        >
          {retrying ? '⏳ Réconciliation...' : 'Relancer les transferts en attente'}
        </button>

        {retryResult && !retrying && (
          <div style={{
            marginTop: 12,
            padding: '10px 14px',
            borderRadius: 8,
            fontSize: 12,
            background: retryResult.error || retryResult.failed > 0 ? '#FEF2F2' : '#F0FDF4',
            color: retryResult.error || retryResult.failed > 0 ? '#991B1B' : '#166534',
            border: `1px solid ${retryResult.error || retryResult.failed > 0 ? '#FECACA' : '#BBF7D0'}`,
          }}>
            {retryResult.error
              ? `⚠️ ${retryResult.error}`
              : retryResult.retried === 0
                ? '✅ Aucun transfert en attente'
                : `✅ ${retryResult.succeeded} transfert(s) relancé(s)${retryResult.failed > 0 ? `, ${retryResult.failed} échec(s)` : ''}`}
          </div>
        )}
      </div>
    </div>
  );
}
