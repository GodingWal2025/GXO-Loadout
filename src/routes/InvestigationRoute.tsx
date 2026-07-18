import { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { listActiveSites } from '../services/sites';
import { getDeviceConfig } from '../lib/deviceConfig';
import { dbListAllInspections, PhotoLightbox } from '../shared';
import { resolvePhotoUrl } from '../shared/services/resolvePhotoUrls';
import type { InspectionPhoto } from '../shared';

/** Which pallet of which search result is being previewed inline. */
interface Glimpse {
  item: any;
  pallet: any;
}

export function InvestigationRoute() {
  const navigate = useNavigate();
  const deviceConfig = getDeviceConfig();
  const sites = listActiveSites();
  const [selectedSite, setSelectedSite] = useState(deviceConfig?.siteId || sites[0]?.id || 'all');
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [photoUrls, setPhotoUrls] = useState<Map<string, string>>(new Map());
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [glimpse, setGlimpse] = useState<Glimpse | null>(null);

  // Default to device site if not already set and sites list is loaded
  useEffect(() => {
    if (deviceConfig?.siteId && selectedSite === 'all' && sites.some(s => s.id === deviceConfig.siteId)) {
      setSelectedSite(deviceConfig.siteId);
    }
  }, [sites, deviceConfig]);

  const handleSearch = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!query.trim()) return;

    setLoading(true);
    setSearched(true);
    try {
      const all = await dbListAllInspections();
      const q = query.trim().toLowerCase();
      
      const filtered = all.filter(ins => {
        if (selectedSite !== 'all' && ins.siteId !== selectedSite) return false;
        
        const loadNum = ins.picklist?.loadNumber?.value || ins.bol?.loadNumber?.value || ins.returnsBol?.bolNumber?.value || '';
        const matchLoad = loadNum.toLowerCase().includes(q);
        const matchId = ins.id.toLowerCase().includes(q);
        
        const matchDelivery = ins.bol?.deliveries?.some(d => d.deliveryNumber.toLowerCase().includes(q));
        const matchBatch = ins.pallets?.some(p => p.batchSections?.some(b => b.batchCode?.value?.toLowerCase().includes(q)));
        
        return matchLoad || matchId || matchDelivery || matchBatch;
      });
      
      const mapped = filtered.map(ins => ({
        ...ins,
        picklistLoadNumber: ins.picklist?.loadNumber?.value,
        bolLoadNumber: ins.bol?.loadNumber?.value || ins.returnsBol?.bolNumber?.value,
        picklistShipDate: ins.picklist?.shipDate?.value,
        bolShipDate: ins.bol?.shipDate?.value || ins.returnsBol?.receivedDate?.value,
        bolCarrier: ins.bol?.carrier,
        lineItems: ins.picklist?.lineItems || [],
        deliveries: ins.bol?.deliveries || []
      }));
      
      setResults(mapped);

      // Resolve photo URLs for display (from cloud URL or local IndexedDB)
      const allPhotos: InspectionPhoto[] = [];
      for (const ins of mapped) {
        for (const p of (ins.pallets || [])) {
          allPhotos.push(...(p.photos || []));
        }
        allPhotos.push(...(ins.staging?.finalLanePhotos || []));
      }
      const urls = new Map<string, string>();
      await Promise.all(
        allPhotos.map(async (photo) => {
          const url = await resolvePhotoUrl(photo);
          if (url) urls.set(photo.id, url);
        })
      );
      setPhotoUrls(urls);
    } catch (err) {
      console.error('Search error:', err);
    } finally {
      setLoading(false);
    }
  };

  const toggleExpand = (id: string) => {
    setExpandedId(expandedId === id ? null : id);
  };

  // Previewing a single pallet — the search form and results stay mounted behind
  // this panel, so backing out returns to the exact result list.
  if (glimpse) {
    return (
      <PalletGlimpse
        item={glimpse.item}
        pallet={glimpse.pallet}
        photoUrls={photoUrls}
        onBack={() => setGlimpse(null)}
        onOpenFull={() =>
          navigate(`/inspection/${glimpse.item.id}/pallet/${glimpse.pallet.palletNumber - 1}`, {
            state: { from: 'investigation' },
          })
        }
      />
    );
  }

  return (
    <main style={{ maxWidth: '800px', margin: '0 auto', padding: '0 16px' }}>
      <div className="page-head">
        <div>
          <h1 className="page-head__title">
            <em>Investigation</em>
          </h1>
          <div className="page-head__sub">
            Trace shipments, verify final packaging, and search matching batch codes
          </div>
        </div>
        <div className="page-head__actions">
          <Link to="/" className="btn btn--ghost">
            ← Home
          </Link>
        </div>
      </div>

      <section className="section">
        <form onSubmit={handleSearch} className="card" style={{ padding: '20px', background: 'var(--surface)' }}>
          <div className="field-row" style={{ marginBottom: '16px' }}>
            <div className="field" style={{ flex: '1 1 200px' }}>
              <label className="field__label" htmlFor="site-select">Site Filter</label>
              <select
                id="site-select"
                value={selectedSite}
                onChange={(e) => setSelectedSite(e.target.value)}
              >
                <option value="all">All Sites</option>
                {sites.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="field" style={{ flex: '2 1 300px' }}>
              <label className="field__label" htmlFor="search-input">Search Query</label>
              <input
                id="search-input"
                type="text"
                placeholder="Search batch code, load #, or delivery #..."
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                autoFocus
              />
            </div>
          </div>
          <button
            type="submit"
            className="btn btn--accent btn--lg"
            style={{ width: '100%' }}
            disabled={loading || !query.trim()}
          >
            {loading ? 'Searching...' : 'Search Local Database'}
          </button>
        </form>
      </section>

      <section className="section">
        <div className="section__head">
          <h2 className="section__title">
            Search <em>results</em>
          </h2>
          {searched && (
            <span className="section__meta">
              {results.length} match{results.length === 1 ? '' : 'es'} found
            </span>
          )}
        </div>

        {loading ? (
          <div className="empty">
            <div className="empty__sub">Searching local data…</div>
          </div>
        ) : !searched ? (
          <div className="empty">
            <div className="empty__title">Ready to search</div>
            <div className="empty__sub">
              Enter a batch code, load number, or delivery number to look up historical records.
            </div>
          </div>
        ) : results.length === 0 ? (
          <div className="empty">
            <div className="empty__title">No shipments found</div>
            <div className="empty__sub">
              Check the spelling or try searching across all sites.
            </div>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {results.map((item) => {
              const isExpanded = expandedId === item.id;
              const loadNum = item.picklistLoadNumber || item.bolLoadNumber || item.id.slice(0, 8);
              const shipDate = item.picklistShipDate || item.bolShipDate || '—';
              const completedTime = item.completedAt ? new Date(item.completedAt).toLocaleString() : '—';
              
              // Count quantities scanned
              const totalBags = item.pallets?.reduce((sum: number, p: any) => {
                return sum + (p.batchSections?.reduce((bsSum: number, bs: any) => bsSum + (bs.actualBagCount?.value || 0), 0) || 0);
              }, 0) || 0;

              return (
                <div key={item.id} className="card" style={{ padding: '0', overflow: 'hidden' }}>
                  {/* Card Header summary */}
                  <div
                    onClick={() => toggleExpand(item.id)}
                    style={{
                      padding: '16px 20px',
                      cursor: 'pointer',
                      background: isExpanded ? 'var(--surface-tint)' : 'var(--surface)',
                      borderBottom: isExpanded ? '1px solid var(--rule-soft)' : 'none',
                      transition: 'background .15s',
                    }}
                    className="row-between"
                  >
                    <div>
                      <div className="row-start gap-8" style={{ marginBottom: '4px' }}>
                        <span className="mono fw-500" style={{ fontSize: '18px' }}>#{loadNum}</span>
                        <span className={`pill pill--${item.type === 'returns' ? 'info' : 'success'}`} style={{ textTransform: 'uppercase', fontSize: '11px' }}>
                          {item.type}
                        </span>
                        {item.flaggedItemsCount > 0 && (
                          <span className="pill pill--danger">⚑ {item.flaggedItemsCount} flagged</span>
                        )}
                      </div>
                      <div className="xs soft">
                        Site: <strong>{item.siteId}</strong> · Completed: {completedTime} · Inspector: {item.completedBy || item.startedBy || '—'}
                      </div>
                    </div>
                    <div className="row-start gap-12">
                      <div style={{ textAlign: 'right' }}>
                        <div className="fw-500" style={{ fontSize: '15px' }}>{totalBags} bags</div>
                        <div className="xs soft">{item.pallets?.length || 0} pallets</div>
                      </div>
                      <span style={{ transform: isExpanded ? 'rotate(90deg)' : 'none', transition: 'transform .15s', fontSize: '18px' }}>
                        →
                      </span>
                    </div>
                  </div>

                  {/* Expanded Detail view */}
                  {isExpanded && (
                    <div style={{ padding: '20px', background: 'var(--surface)' }}>
                      {/* Section 1: Overview */}
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '16px', marginBottom: '20px' }}>
                        <div>
                          <div className="xs soft">Ship Date</div>
                          <div className="fw-500">{shipDate}</div>
                        </div>
                        <div>
                          <div className="xs soft">Carrier</div>
                          <div className="fw-500">{item.bolCarrier || '—'}</div>
                        </div>
                        <div>
                          <div className="xs soft">Staging Location</div>
                          <div className="fw-500">{item.stagingLocation || '—'}</div>
                        </div>
                        <div>
                          <div className="xs soft">Inspector Sign-off</div>
                          <div className="fw-500">{item.completedBy || item.startedBy || '—'}</div>
                        </div>
                      </div>

                      {/* Section 2: Tallies / Deliveries */}
                      <div style={{ marginBottom: '20px' }}>
                        <div className="xs soft" style={{ textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '8px' }}>
                          Deliveries &amp; Picklist Items
                        </div>
                        <div className="table-card">
                          <table className="data" style={{ width: '100%', fontSize: '13px' }}>
                            <thead>
                              <tr>
                                <th>Delivery #</th>
                                <th>Batch Code</th>
                                <th>Product</th>
                                <th className="right">Expected</th>
                                <th className="right">Actual</th>
                              </tr>
                            </thead>
                            <tbody>
                              {item.lineItems?.map((li: any) => {
                                const del = item.deliveries?.find((d: any) => d.id === li.deliveryId);
                                return (
                                  <tr key={li.id}>
                                    <td className="mono">{del?.deliveryNumber || '—'}</td>
                                    <td className="mono fw-500">{li.batchCode?.value || '—'}</td>
                                    <td className="soft">{li.productName?.value || '—'}</td>
                                    <td className="right num">{li.expectedQuantity?.value || 0}</td>
                                    <td className="right num fw-500">{li.actualQuantity || 0}</td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      </div>

                      {/* Section 3: Pallet details */}
                      <div style={{ marginBottom: '20px' }}>
                        <div className="xs soft" style={{ textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '8px' }}>
                          Scanned Pallets
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                          {item.pallets?.map((p: any) => (
                            <div 
                              key={p.id} 
                              className="card" 
                              style={{ 
                                padding: '12px', 
                                borderLeft: p.qualityFlag ? '3px solid var(--danger)' : '1px solid var(--rule-soft)', 
                                background: 'var(--surface-tint)',
                                cursor: 'pointer' 
                              }}
                              onClick={() => setGlimpse({ item, pallet: p })}
                            >
                              <div className="row-between" style={{ marginBottom: '6px' }}>
                                <span className="fw-500">Pallet #{p.palletNumber} · <span className="soft" style={{ fontSize: '13px' }}>{p.palletType}</span></span>
                                <span className="xs soft">Scanned by: {p.scannedBy || '—'}</span>
                              </div>
                              <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap', marginBottom: '6px' }}>
                                {p.batchSections?.map((bs: any) => (
                                  <div key={bs.id} className="small mono">
                                    Batch: <strong>{bs.batchCode?.value || '—'}</strong> ({bs.actualBagCount?.value || 0} bags)
                                  </div>
                                ))}
                              </div>
                              {p.rejectedBagCount > 0 && (
                                <div className="xs" style={{ color: 'var(--danger)' }}>
                                  ⚠️ Rejected: {p.rejectedBagCount} bags ({p.rejectedNotes || 'no reason'})
                                </div>
                              )}
                              {/* Pallet photos */}
                              {p.photos && p.photos.length > 0 && (
                                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(70px, 1fr))', gap: '6px', marginTop: '8px' }}>
                                  {p.photos.map((ph: any) => {
                                    const photoSrc = photoUrls.get(ph.id) || ph.sharePointUrl || ph.localBlobUrl;
                                    return (
                                    <div key={ph.id} style={{ position: 'relative' }}>
                                      {photoSrc ? (
                                        <a href={photoSrc} target="_blank" rel="noopener noreferrer">
                                          <img
                                            src={photoSrc}
                                            alt={ph.category}
                                            style={{ width: '100%', aspectRatio: '1', objectFit: 'cover', borderRadius: '4px', border: '1px solid var(--rule-soft)' }}
                                          />
                                        </a>
                                      ) : (
                                        <div style={{ width: '100%', aspectRatio: '1', background: 'var(--rule-soft)', borderRadius: '4px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '9px', color: 'var(--ink-soft)' }}>
                                          No Photo
                                        </div>
                                      )}
                                      <div className="xs soft" style={{ fontSize: '8px', textAlign: 'center', marginTop: '2px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                        {ph.slotKey || ph.category}
                                      </div>
                                    </div>
                                    );
                                  })}
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>

                      {/* Section 4: Packaging used & Final Lane photos */}
                      {item.type !== 'returns' && (
                        <div style={{ marginBottom: '12px' }}>
                          <div className="xs soft" style={{ textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '8px' }}>
                            Packaging Used &amp; Final Staging Lane
                          </div>
                          <div className="card" style={{ padding: '12px', background: 'var(--surface-tint)' }}>
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '12px', marginBottom: '8px' }}>
                              <div>
                                <span className="xs soft">40×40 Pallets:</span>{' '}
                                <strong className="small">{item.staging?.pallets40x40Used ?? 0}</strong>
                              </div>
                              <div>
                                <span className="xs soft">48×40 Pallets:</span>{' '}
                                <strong className="small">{item.staging?.pallets48x40Used ?? 0}</strong>
                              </div>
                              <div>
                                <span className="xs soft">Seedpaks:</span>{' '}
                                <strong className="small">{item.staging?.seedpaksUsed ?? 0}</strong>
                              </div>
                            </div>
                            {item.staging?.otherPackagingNotes && (
                              <div className="xs soft" style={{ borderTop: '1px solid var(--rule-soft)', paddingTop: '6px' }}>
                                <strong>Notes:</strong> {item.staging.otherPackagingNotes}
                              </div>
                            )}

                            {/* Final staging lane photos */}
                            {item.photos?.filter((ph: any) => ph.category === 'Staging_Final_Lane').length > 0 && (
                              <div style={{ marginTop: '12px' }}>
                                <div className="xs soft" style={{ marginBottom: '6px' }}>Final Staging Lane Photos:</div>
                                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(80px, 1fr))', gap: '8px' }}>
                                  {item.photos
                                    .filter((ph: any) => ph.category === 'Staging_Final_Lane')
                                    .map((ph: any) => {
                                      const photoSrc = photoUrls.get(ph.id) || ph.sharePointUrl || ph.localBlobUrl;
                                      return (
                                      <div key={ph.id}>
                                        {photoSrc ? (
                                          <a href={photoSrc} target="_blank" rel="noopener noreferrer">
                                            <img
                                              src={photoSrc}
                                              alt="Staging lane"
                                              style={{ width: '100%', aspectRatio: '1.33', objectFit: 'cover', borderRadius: '4px', border: '1px solid var(--rule-soft)' }}
                                            />
                                          </a>
                                        ) : (
                                          <div style={{ width: '100%', aspectRatio: '1.33', background: 'var(--rule-soft)', borderRadius: '4px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '10px', color: 'var(--ink-soft)' }}>
                                            No Photo
                                          </div>
                                        )}
                                      </div>
                                      );
                                    })}
                                </div>
                              </div>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>
    </main>
  );
}

/**
 * Read-only close-up of one pallet from a search result. Deliberately shows
 * only this slice of the inspection — the full record is one tap away.
 */
function PalletGlimpse({
  item,
  pallet,
  photoUrls,
  onBack,
  onOpenFull,
}: {
  item: any;
  pallet: any;
  photoUrls: Map<string, string>;
  onBack: () => void;
  onOpenFull: () => void;
}) {
  const [lightbox, setLightbox] = useState<{ url?: string; label: string } | null>(null);

  const loadNum = item.picklistLoadNumber || item.bolLoadNumber || item.id.slice(0, 8);
  const delivery = item.deliveries?.find((d: any) => d.id === pallet.deliveryId);
  const totalBags =
    pallet.batchSections?.reduce(
      (sum: number, bs: any) => sum + (bs.actualBagCount?.value || 0),
      0
    ) || 0;
  const findings = (pallet.findings || '')
    .split(',')
    .map((f: string) => f.trim())
    .filter(Boolean);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !lightbox) onBack();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onBack, lightbox]);

  return (
    <main style={{ maxWidth: '800px', margin: '0 auto', padding: '0 16px' }}>
      <div className="page-head">
        <div>
          <h1 className="page-head__title">
            Pallet <em>{pallet.palletNumber}</em>
          </h1>
          <div className="page-head__sub">
            Load <span className="mono">#{loadNum}</span> · {pallet.palletType}
            {delivery && (
              <>
                {' '}· Delivery <span className="mono">{delivery.deliveryNumber}</span>
              </>
            )}
          </div>
        </div>
        <div className="page-head__actions">
          <button className="btn btn--ghost" onClick={onBack}>
            ← Back to results
          </button>
        </div>
      </div>

      <section className="section">
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
            gap: '16px',
            marginBottom: '20px',
          }}
        >
          <div>
            <div className="xs soft">Total bags</div>
            <div className="fw-500" style={{ fontSize: '20px' }}>{totalBags}</div>
          </div>
          <div>
            <div className="xs soft">Result</div>
            <div className="fw-500" style={{ color: pallet.passInspection === 'Fail' ? 'var(--danger)' : undefined }}>
              {pallet.passInspection || '—'}
            </div>
          </div>
          <div>
            <div className="xs soft">LPN</div>
            <div className="fw-500 mono">{pallet.lpnNumber || '—'}</div>
          </div>
          <div>
            <div className="xs soft">Scanned by</div>
            <div className="fw-500">{pallet.scannedBy || '—'}</div>
          </div>
        </div>

        <div className="table-card" style={{ marginBottom: '20px' }}>
          <table className="data" style={{ width: '100%', fontSize: '13px' }}>
            <thead>
              <tr>
                <th>Batch Code</th>
                <th className="right">Expected</th>
                <th className="right">Actual</th>
              </tr>
            </thead>
            <tbody>
              {pallet.batchSections?.map((bs: any) => (
                <tr key={bs.id}>
                  <td className="mono fw-500">{bs.batchCode?.value || '—'}</td>
                  <td className="right num">{bs.expectedBagCount || 0}</td>
                  <td className="right num fw-500">{bs.actualBagCount?.value ?? 0}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {findings.length > 0 && (
          <div className="banner banner--warn" style={{ marginBottom: '20px' }}>
            <span className="banner__icon">⚠</span>
            <div className="banner__body">
              <strong>Findings:</strong> {findings.join(', ')}
              {pallet.rejectedBagCount > 0 && (
                <div style={{ marginTop: 4 }}>
                  Rejected {pallet.rejectedBagCount} bags
                  {pallet.rejectedNotes ? ` — ${pallet.rejectedNotes}` : ''}
                </div>
              )}
            </div>
          </div>
        )}

        <div className="xs soft" style={{ textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '8px' }}>
          Photos
        </div>
        {pallet.photos?.length > 0 ? (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(110px, 1fr))',
              gap: '10px',
            }}
          >
            {pallet.photos.map((ph: any) => {
              const photoSrc = photoUrls.get(ph.id) || ph.sharePointUrl || ph.localBlobUrl;
              const label = (ph.slotKey || ph.category || '').replace(/_/g, ' ');
              return (
                <div key={ph.id}>
                  {photoSrc ? (
                    <img
                      src={photoSrc}
                      alt={label}
                      onClick={() => setLightbox({ url: photoSrc, label })}
                      style={{
                        width: '100%',
                        aspectRatio: '1',
                        objectFit: 'cover',
                        borderRadius: '4px',
                        border: '1px solid var(--rule-soft)',
                        cursor: 'zoom-in',
                      }}
                    />
                  ) : (
                    <div
                      style={{
                        width: '100%',
                        aspectRatio: '1',
                        background: 'var(--rule-soft)',
                        borderRadius: '4px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: '10px',
                        color: 'var(--ink-soft)',
                      }}
                    >
                      No Photo
                    </div>
                  )}
                  <div className="xs soft" style={{ textAlign: 'center', marginTop: '3px' }}>
                    {label}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="empty" style={{ padding: 16 }}>
            <div className="empty__sub">No photos on this pallet.</div>
          </div>
        )}
      </section>

      <div
        className="row-between"
        style={{
          position: 'sticky',
          bottom: 0,
          background: 'var(--paper)',
          borderTop: '1px solid var(--rule-soft)',
          padding: '16px 0',
        }}
      >
        <button className="btn btn--ghost" onClick={onBack}>
          ← Back to results
        </button>
        <button className="btn btn--accent" onClick={onOpenFull}>
          Open full inspection →
        </button>
      </div>

      {lightbox && (
        <PhotoLightbox
          url={lightbox.url}
          label={lightbox.label}
          onClose={() => setLightbox(null)}
        />
      )}
    </main>
  );
}
