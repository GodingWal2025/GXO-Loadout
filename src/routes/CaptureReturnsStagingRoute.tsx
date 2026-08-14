import { generateId } from '../shared';
import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { dbGetInspection, dbSavePhotoBlob, dbSaveInspection } from '../shared';
import { useCameraCapture } from '../shared';
import { checkImageQuality, type QualityIssue } from '../shared';
import { ImageQualityModal } from '../shared';
import { StepBackLink } from '../shared';
import type { Inspection, InspectionPhoto, PhotoCategory } from '../shared';
import { normalizeCloudPhotoUrl } from '../shared/services/resolvePhotoUrls';
import { useT } from '../shared/i18n/LanguageContext';

type ReturnsCaptureCategory = 'staging-lane' | 'pallets' | 'seedpaks';

// Prefer the in-session object URL, then a legacy external URL if present.
function photoSrc(p: InspectionPhoto): string | undefined {
  if (p.localBlobUrl) return p.localBlobUrl;
  if (p.sharePointUrl) return normalizeCloudPhotoUrl(p.sharePointUrl, p.id);
  return undefined;
}

export function CaptureReturnsStagingRoute() {
  const t = useT();
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [inspection, setInspection] = useState<Inspection | null>(null);
  const [activeCategory, setActiveCategory] = useState<ReturnsCaptureCategory>('staging-lane');
  const [analyzing, setAnalyzing] = useState(false);
  const [pending, setPending] = useState<{
    blob: Blob;
    previewUrl: string;
    issues: QualityIssue[];
  } | null>(null);

  useEffect(() => {
    if (!id) return;
    dbGetInspection(id).then((i) => {
      if (!i) navigate('/');
      else setInspection(i);
    });
  }, [id, navigate]);

  const capture = useCameraCapture(async (blob) => {
    const quality = await checkImageQuality(blob);
    if (!quality.passed) {
      const previewUrl = URL.createObjectURL(blob);
      setPending({ blob, previewUrl, issues: quality.issues });
      return;
    }
    await processPhoto(blob);
  });

  async function processPhoto(blob: Blob) {
    if (!inspection) return;

    const bitmap = await createImageBitmap(blob);
    let category: PhotoCategory = 'Staging_Final_Lane';
    if (activeCategory === 'pallets') category = 'Returns_Packaging_Pallets';
    if (activeCategory === 'seedpaks') category = 'Returns_Packaging_Seedpaks';

    const photo: InspectionPhoto = {
      id: generateId(),
      capturedAt: new Date().toISOString(),
      capturedBy: inspection.startedBy || 'unknown',
      category,
      localBlobUrl: URL.createObjectURL(blob),
      metadata: {
        deviceModel: navigator.userAgent.includes('iPad') ? 'iPad' : 'web',
        orientation: bitmap.width > bitmap.height ? 'landscape' : 'portrait',
        originalWidth: bitmap.width,
        originalHeight: bitmap.height,
        fileSizeBytes: blob.size,
      },
    };

    await dbSavePhotoBlob(photo.id, inspection.id, blob);

    setAnalyzing(true);
    try {
      const currentStaging = inspection.staging || {
        stagingLocation: '',
        stagedCorrectly: 'N/A',
        paperBagsProperlyStacked: 'N/A',
        ltlPalletsSecured: 'N/A',
        mixedPalletsLabeled: 'N/A',
        multiStopStickersAttached: 'N/A',
        palletQuantityMatchesBOL: 'N/A',
        overviewPhotos: [],
        coverSheetPhotos: [],
        finalLanePhotos: [],
        palletsPackagingPhotos: [],
        seedpaksPackagingPhotos: [],
      };

      const updatedStaging = { ...currentStaging };
      if (activeCategory === 'staging-lane') {
        updatedStaging.finalLanePhotos = [...(updatedStaging.finalLanePhotos || []), photo];
      } else if (activeCategory === 'pallets') {
        updatedStaging.palletsPackagingPhotos = [...(updatedStaging.palletsPackagingPhotos || []), photo];
      } else if (activeCategory === 'seedpaks') {
        updatedStaging.seedpaksPackagingPhotos = [...(updatedStaging.seedpaksPackagingPhotos || []), photo];
      }

      const updated: Inspection = {
        ...inspection,
        staging: updatedStaging,
        lastEditedAt: new Date().toISOString(),
      };
      await dbSaveInspection(updated);
      setInspection(updated);
    } finally {
      setAnalyzing(false);
    }
  }

  const handleRetake = () => {
    if (pending) URL.revokeObjectURL(pending.previewUrl);
    setPending(null);
    setTimeout(() => capture(), 50);
  };

  const handleKeep = async () => {
    if (!pending) return;
    const { blob, previewUrl } = pending;
    URL.revokeObjectURL(previewUrl);
    setPending(null);
    await processPhoto(blob);
  };

  const continueToVerify = async () => {
    if (!inspection) return;
    navigate(`/inspection/${inspection.id}/verify-returns`);
  };

  const removePhoto = async (photoId: string, category: ReturnsCaptureCategory) => {
    if (!inspection) return;
    const updatedStaging = { ...(inspection.staging || {}) };

    if (category === 'staging-lane') {
      updatedStaging.finalLanePhotos = (updatedStaging.finalLanePhotos || []).filter(p => p.id !== photoId);
    } else if (category === 'pallets') {
      updatedStaging.palletsPackagingPhotos = (updatedStaging.palletsPackagingPhotos || []).filter(p => p.id !== photoId);
    } else if (category === 'seedpaks') {
      updatedStaging.seedpaksPackagingPhotos = (updatedStaging.seedpaksPackagingPhotos || []).filter(p => p.id !== photoId);
    }

    const updated: Inspection = {
      ...inspection,
      staging: updatedStaging,
      lastEditedAt: new Date().toISOString()
    };
    await dbSaveInspection(updated);
    setInspection(updated);
  };

  if (!inspection) return null;

  const stagingPhotos = inspection.staging?.finalLanePhotos || [];
  const palletsPhotos = inspection.staging?.palletsPackagingPhotos || [];
  const seedpaksPhotos = inspection.staging?.seedpaksPackagingPhotos || [];

  const getPhotosForCategory = (cat: ReturnsCaptureCategory) => {
    if (cat === 'staging-lane') return stagingPhotos;
    if (cat === 'pallets') return palletsPhotos;
    return seedpaksPhotos;
  };

  const currentPhotos = getPhotosForCategory(activeCategory);
  const latestPhoto = currentPhotos[currentPhotos.length - 1];
  const totalPhotosCount = stagingPhotos.length + palletsPhotos.length + seedpaksPhotos.length;

  const categoryConfigs: Record<
    ReturnsCaptureCategory,
    { title: string; hint: string; icon: string; tag: string }
  > = {
    'staging-lane': {
      title: t('returnsStaging.tabStagingLane', 'Staging Lane'),
      hint: t(
        'returnsStaging.stagingHint',
        'Please take photos of the staging lane containing the returned product. You can take as many pictures as needed.'
      ),
      icon: '🏢',
      tag: t('returnsStaging.tabStagingLane', 'Staging Lane'),
    },
    'pallets': {
      title: t('returnsStaging.tabPallets', 'Wooden Pallets'),
      hint: t(
        'returnsStaging.palletsHint',
        'Photograph the condition of the wooden pallets (54×40 and 40×40 pallets, base wood condition, stacking).'
      ),
      icon: '🪵',
      tag: t('returnsStaging.tabPallets', 'Pallets Packaging'),
    },
    'seedpaks': {
      title: t('returnsStaging.tabSeedpaks', 'SeedPaks'),
      hint: t(
        'returnsStaging.seedpaksHint',
        'Photograph the condition of the SeedPak packaging (empty totes, product totes, lids/collars, damage/dirtiness).'
      ),
      icon: '📦',
      tag: t('returnsStaging.tabSeedpaks', 'SeedPaks Packaging'),
    },
  };

  return (
    <main style={{ maxWidth: 560 }}>
      <StepBackLink to={`/inspection/${inspection.id}/capture-returns-bol`} />

      <div className="page-head">
        <div>
          <h1 className="page-head__title">
            {t('returnsStaging.titleLead', 'Capture')}{' '}
            <em>{t('returnsStaging.titleEm', 'Returns Staging & Packaging')}</em>
          </h1>
          <div className="page-head__sub">
            {t(
              'returnsStaging.subtitle',
              'Step 3 of 5 · Photograph the staging lane and packaging (pallets & SeedPaks)'
            )}
          </div>
        </div>
      </div>

      {/* Category selector tabs */}
      <div
        style={{
          display: 'flex',
          gap: 6,
          background: 'var(--surface-tint)',
          padding: 4,
          borderRadius: 'var(--radius-sm)',
          marginBottom: 16,
        }}
      >
        {(['staging-lane', 'pallets', 'seedpaks'] as ReturnsCaptureCategory[]).map((cat) => {
          const count = getPhotosForCategory(cat).length;
          const isActive = activeCategory === cat;
          return (
            <button
              key={cat}
              type="button"
              onClick={() => setActiveCategory(cat)}
              style={{
                flex: 1,
                padding: '8px 6px',
                border: 'none',
                borderRadius: 'calc(var(--radius-sm) - 2px)',
                background: isActive ? 'var(--paper)' : 'transparent',
                color: isActive ? 'var(--ink)' : 'var(--ink-soft)',
                fontWeight: isActive ? 600 : 500,
                fontSize: 13,
                cursor: 'pointer',
                boxShadow: isActive ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 6,
                transition: 'all 0.15s ease',
              }}
            >
              <span>{categoryConfigs[cat].icon}</span>
              <span>{categoryConfigs[cat].title}</span>
              {count > 0 && (
                <span
                  style={{
                    background: isActive ? 'var(--accent)' : 'var(--rule-soft)',
                    color: isActive ? '#fff' : 'var(--ink-soft)',
                    fontSize: 11,
                    fontWeight: 700,
                    borderRadius: 10,
                    padding: '1px 6px',
                    minWidth: 16,
                    textAlign: 'center',
                  }}
                >
                  {count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Main Preview Box */}
      {latestPhoto ? (
        <div style={{ position: 'relative', marginBottom: 16 }}>
          <img
            src={photoSrc(latestPhoto)}
            alt={t('returnsStaging.latestPhotoAlt', 'Latest photo')}
            style={{
              width: '100%',
              aspectRatio: '4 / 3',
              objectFit: 'cover',
              borderRadius: 'var(--radius-sm)',
              border: '1px solid var(--rule-soft)',
            }}
          />
          <div
            className="xs"
            style={{
              position: 'absolute',
              bottom: 8,
              left: 8,
              background: 'rgba(28,25,23,0.75)',
              color: '#fff',
              padding: '4px 8px',
              borderRadius: '4px',
              display: 'flex',
              alignItems: 'center',
              gap: 4,
            }}
          >
            <span>{categoryConfigs[activeCategory].icon}</span>
            <span>{categoryConfigs[activeCategory].tag}</span>
            <span style={{ opacity: 0.7 }}>·</span>
            <span>{t('returnsStaging.latestPhoto', 'Latest Photo')}</span>
          </div>
        </div>
      ) : (
        <div
          style={{
            aspectRatio: '4 / 3',
            background: 'var(--surface-tint)',
            border: '2px dashed var(--rule-soft)',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            marginBottom: 16,
            padding: 24,
            borderRadius: 'var(--radius-sm)',
          }}
        >
          <div style={{ fontSize: 44, marginBottom: 8 }}>{categoryConfigs[activeCategory].icon}</div>
          <div className="small soft" style={{ fontWeight: 500 }}>
            {analyzing
              ? t('returnsStaging.processing', 'Processing photo…')
              : t('returnsStaging.noPhotos', 'No photos taken yet for {category}', {
                  category: categoryConfigs[activeCategory].title,
                })}
          </div>
          <div className="xs soft" style={{ marginTop: 4 }}>
            {categoryConfigs[activeCategory].tag}
          </div>
        </div>
      )}

      {/* Grid of thumbnails for the active category */}
      {currentPhotos.length > 0 && (
        <div style={{ marginBottom: 16 }}>
          <div className="xs soft" style={{ marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            {t('returnsStaging.capturedPhotos', 'Captured Photos ({count})', {
              count: currentPhotos.length,
            })}
          </div>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(80px, 1fr))',
              gap: 8,
            }}
          >
            {currentPhotos.map((p, idx) => (
              <div key={p.id} style={{ position: 'relative' }}>
                <img
                  src={photoSrc(p)}
                  alt={t('returnsStaging.thumbAlt', 'Photo {n}', { n: idx + 1 })}
                  style={{
                    width: '100%',
                    aspectRatio: '1',
                    objectFit: 'cover',
                    borderRadius: 'var(--radius-sm)',
                    border: '1px solid var(--rule-soft)',
                  }}
                />
                <button
                  type="button"
                  onClick={() => removePhoto(p.id, activeCategory)}
                  style={{
                    position: 'absolute',
                    top: 2,
                    right: 2,
                    background: 'rgba(178,36,28,0.9)',
                    color: '#fff',
                    border: 'none',
                    borderRadius: '50%',
                    width: 18,
                    height: 18,
                    fontSize: 10,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    cursor: 'pointer',
                  }}
                  title={t('returnsStaging.deletePhoto', 'Delete photo')}
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Category instruction banner */}
      <div className="banner banner--info" style={{ marginBottom: 16 }}>
        <span className="banner__icon">{categoryConfigs[activeCategory].icon}</span>
        <div className="banner__body">
          {categoryConfigs[activeCategory].hint}
        </div>
      </div>

      {/* Photo capture button */}
      <button
        className="btn btn--accent btn--lg"
        onClick={capture}
        disabled={analyzing}
        style={{ width: '100%', marginBottom: 16 }}
      >
        📷{' '}
        {currentPhotos.length > 0
          ? t('returnsStaging.takeAnotherPhoto', 'Take another photo')
          : t('returnsStaging.takePhoto', 'Take photo')}
      </button>

      {/* Category status summary cards */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(3, 1fr)',
          gap: 8,
          marginBottom: 16,
        }}
      >
        {(['staging-lane', 'pallets', 'seedpaks'] as ReturnsCaptureCategory[]).map((cat) => {
          const count = getPhotosForCategory(cat).length;
          const isCurrent = activeCategory === cat;
          return (
            <div
              key={cat}
              onClick={() => setActiveCategory(cat)}
              className="card"
              style={{
                cursor: 'pointer',
                margin: 0,
                padding: '10px 8px',
                border: isCurrent ? '2px solid var(--accent)' : '1px solid var(--rule-soft)',
                background: isCurrent ? 'var(--surface-tint)' : 'var(--paper)',
                textAlign: 'center',
              }}
            >
              <div style={{ fontSize: 20 }}>{categoryConfigs[cat].icon}</div>
              <div className="xs fw-500" style={{ marginTop: 2, color: 'var(--ink)' }}>
                {categoryConfigs[cat].title}
              </div>
              <div className="xs soft" style={{ marginTop: 2 }}>
                {count === 1
                  ? t('returnsStaging.summaryBadgeOne', '1 photo')
                  : t('returnsStaging.summaryBadgeMany', '{count} photos', { count })}
              </div>
            </div>
          );
        })}
      </div>

      {/* Navigation action */}
      <div className="center mt-16">
        <button className="btn btn--ghost" onClick={continueToVerify}>
          {totalPhotosCount > 0
            ? t('returnsStaging.continue', 'Continue to verify →')
            : t('returnsStaging.skipNoPhotos', 'Skip — verify without photos')}
        </button>
      </div>

      {pending && (
        <ImageQualityModal
          previewUrl={pending.previewUrl}
          issues={pending.issues}
          onRetake={handleRetake}
          onKeep={handleKeep}
        />
      )}
    </main>
  );
}
