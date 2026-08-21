import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { AnnotationCanvas, type AnnotationMode } from '../features/bag-labeling/AnnotationCanvas';
import { PalletGroupPanel } from '../features/bag-labeling/PalletGroupPanel';
import { canonicalizeImage } from '../features/bag-labeling/exif';
import { buildDatasetZip, downloadDataset, publishDataset, validateDataset } from '../features/bag-labeling/exportDataset';
import { deletePalletGroup, listPalletGroups, savePalletGroup } from '../features/bag-labeling/storage';
import { splitForPalletGroup } from '../features/bag-labeling/split';
import type { BagFlapAnnotation, PalletLabelGroup, PalletLabelPhoto, PalletView } from '../features/bag-labeling/types';
import type { NormalizedXyxy } from '../features/bag-labeling/coordinates';
import { locateTargetPallet, proposeBagFlaps } from '../shared/services/sam3Vision';

function replaceGroup(groups: readonly PalletLabelGroup[], group: PalletLabelGroup): PalletLabelGroup[] {
  return groups.map((candidate) => candidate.id === group.id ? group : candidate);
}

export function BagCountConsoleRoute() {
  const [groups, setGroups] = useState<PalletLabelGroup[]>([]);
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);
  const [selectedPhotoId, setSelectedPhotoId] = useState<string | null>(null);
  const [mode, setMode] = useState<AnnotationMode>('pallet');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    void listPalletGroups().then((loaded) => {
      setGroups(loaded);
      if (loaded[0]) setSelectedGroupId(loaded[0].id);
    });
  }, []);

  const group = groups.find((candidate) => candidate.id === selectedGroupId) ?? null;
  const photo = group?.photos.find((candidate) => candidate.id === selectedPhotoId) ?? group?.photos[0] ?? null;

  useEffect(() => {
    if (group && !group.photos.some((candidate) => candidate.id === selectedPhotoId)) {
      setSelectedPhotoId(group.photos[0]?.id ?? null);
    }
  }, [group, selectedPhotoId]);

  const updateSelectedGroup = async (transform: (value: PalletLabelGroup) => PalletLabelGroup) => {
    if (!group) return;
    const updated = { ...transform(group), updatedAt: new Date().toISOString() };
    setGroups((current) => replaceGroup(current, updated));
    await savePalletGroup(updated);
  };

  const updatePhoto = async (photoId: string, transform: (value: PalletLabelPhoto) => PalletLabelPhoto) => {
    await updateSelectedGroup((current) => ({
      ...current,
      photos: current.photos.map((item) => item.id === photoId ? transform(item) : item),
    }));
  };

  const createGroup = async () => {
    const displayName = window.prompt('Pallet name or identifier', `Pallet ${groups.length + 1}`)?.trim();
    if (!displayName) return;
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const created: PalletLabelGroup = {
      id,
      displayName,
      split: await splitForPalletGroup(id),
      photos: [],
      createdAt: now,
      updatedAt: now,
    };
    await savePalletGroup(created);
    setGroups((current) => [created, ...current]);
    setSelectedGroupId(id);
    setSelectedPhotoId(null);
  };

  const addPhotos = async (files: FileList) => {
    if (!group) return;
    setBusy(true);
    setMessage('Normalizing photos…');
    try {
      const next: PalletLabelPhoto[] = [];
      for (const file of Array.from(files)) {
        const canonical = await canonicalizeImage(file);
        if (groups.some((existing) => existing.photos.some((item) => item.sha256 === canonical.sha256))) {
          setMessage(`Skipped duplicate image: ${file.name}`);
          continue;
        }
        next.push({
          id: crypto.randomUUID(),
          fileName: file.name,
          view: 'other',
          width: canonical.width,
          height: canonical.height,
          sha256: canonical.sha256,
          flaps: [],
          reviewed: false,
          blob: canonical.blob,
          createdAt: new Date().toISOString(),
        });
      }
      await updateSelectedGroup((current) => ({ ...current, photos: [...current.photos, ...next] }));
      if (next[0]) setSelectedPhotoId(next[0].id);
      setMessage(next.length ? `Added ${next.length} canonical photo(s).` : 'No new photos added.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not add photos');
    } finally {
      setBusy(false);
    }
  };

  const requestProposals = async (promptBoxes: readonly NormalizedXyxy[] = []) => {
    if (!photo?.targetPalletBox) {
      setMessage('Draw the target pallet box first.');
      return;
    }
    setBusy(true);
    setMessage('SAM 3 is segmenting bag flaps…');
    try {
      const response = await proposeBagFlaps(photo.blob, photo.targetPalletBox, promptBoxes);
      const proposals: BagFlapAnnotation[] = response.instances.map((instance) => ({
        ...instance,
        promptBox: promptBoxes[0],
        status: 'proposed',
      }));
      await updatePhoto(photo.id, (current) => ({
        ...current,
        reviewed: false,
        flaps: [...current.flaps.filter((item) => item.status === 'accepted'), ...proposals],
      }));
      setMessage(`SAM 3 proposed ${proposals.length} flap mask(s).`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'SAM 3 proposal failed');
    } finally {
      setBusy(false);
    }
  };

  const onDrawBox = async (box: NormalizedXyxy) => {
    if (!photo) return;
    if (mode === 'pallet') {
      await updatePhoto(photo.id, (current) => ({ ...current, targetPalletBox: box, reviewed: false, flaps: [] }));
      setMode('prompt');
    } else {
      await requestProposals([box]);
    }
  };

  const setProposalStatus = async (id: string, status: BagFlapAnnotation['status']) => {
    if (!photo) return;
    await updatePhoto(photo.id, (current) => ({
      ...current,
      reviewed: false,
      flaps: current.flaps.map((flap) => flap.id === id ? { ...flap, status } : flap),
    }));
  };

  const acceptedCount = photo?.flaps.filter((flap) => flap.status === 'accepted').length ?? 0;
  const proposed = photo?.flaps.filter((flap) => flap.status === 'proposed') ?? [];
  const progress = useMemo(() => {
    const photos = groups.flatMap((item) => item.photos);
    return { total: photos.length, reviewed: photos.filter((item) => item.reviewed).length };
  }, [groups]);

  return (
    <main className="bag-label-page">
      <div className="page-head">
        <div>
          <h1 className="page-head__title">Bag-count <em>labeling console</em></h1>
          <div className="page-head__sub">Cosmos pallet ROI · SAM 3 bag-flap masks · {progress.reviewed}/{progress.total} photos reviewed</div>
        </div>
        <div className="page-head__actions">
          <Link className="btn btn--ghost" to="/admin">← Admin</Link>
          <button className="btn" disabled={!groups.length || busy} onClick={async () => {
            try {
              setBusy(true);
              const dataset = await buildDatasetZip(groups);
              downloadDataset(dataset);
              setMessage(`Exported ${(dataset.size / 1024 / 1024).toFixed(1)} MB dataset.`);
            } catch (error) {
              setMessage(error instanceof Error ? error.message : 'Export failed');
            } finally { setBusy(false); }
          }}>Export dataset</button>
          <button className="btn btn--accent" disabled={!groups.length || busy} onClick={async () => {
            try {
              setBusy(true);
              const dataset = await buildDatasetZip(groups);
              const result = await publishDataset(dataset);
              setMessage(`Published immutable dataset ${result.blobName}.`);
            } catch (error) {
              setMessage(error instanceof Error ? error.message : 'Publish failed');
            } finally { setBusy(false); }
          }}>Publish for training</button>
        </div>
      </div>

      {message && <div className="banner banner--info"><div className="banner__body" style={{ whiteSpace: 'pre-wrap' }}>{message}</div></div>}
      <div className="bag-label-layout">
        <PalletGroupPanel
          groups={groups}
          selectedGroupId={group?.id ?? null}
          selectedPhotoId={photo?.id ?? null}
          onSelectGroup={setSelectedGroupId}
          onSelectPhoto={setSelectedPhotoId}
          onCreateGroup={() => void createGroup()}
          onDeleteGroup={(id) => void (async () => {
            if (!window.confirm('Delete this pallet group and its local labels?')) return;
            await deletePalletGroup(id);
            const remaining = groups.filter((item) => item.id !== id);
            setGroups(remaining);
            setSelectedGroupId(remaining[0]?.id ?? null);
          })()}
          onAddPhotos={(files) => void addPhotos(files)}
          onSetView={(photoId, view: PalletView) => void updatePhoto(photoId, (current) => ({ ...current, view }))}
        />

        <section className="bag-label-workspace">
          {!photo ? (
            <div className="empty"><div className="empty__title">Create a pallet group and add its photos.</div></div>
          ) : (
            <>
              <div className="bag-label-toolbar">
                <button className={mode === 'pallet' ? 'btn active' : 'btn'} onClick={() => setMode('pallet')}>1 · Target pallet</button>
                <button className={mode === 'prompt' ? 'btn active' : 'btn'} disabled={!photo.targetPalletBox} onClick={() => setMode('prompt')}>2 · Bag-flap prompt</button>
                <button className="btn" disabled={!photo.targetPalletBox || busy} onClick={() => void requestProposals()}>Find all flaps</button>
                <button className="btn" disabled={busy} onClick={() => void (async () => {
                  setBusy(true);
                  try {
                    const result = await locateTargetPallet(photo.blob);
                    if (result.success && result.targetPalletBox && !result.targetAmbiguous) {
                      setMessage(`Cosmos proposed a pallet ROI${typeof result.confidence === 'number' ? ` (${Math.round(result.confidence * 100)}%)` : ''}. Draw the verified human box to replace it.`);
                      await updatePhoto(photo.id, (current) => ({ ...current, targetPalletBox: result.targetPalletBox, reviewed: false, flaps: [] }));
                    } else setMessage(result.reviewReason || 'Cosmos could not locate an unambiguous pallet. Draw the target box manually.');
                  } catch (error) { setMessage(error instanceof Error ? error.message : 'Cosmos request failed'); }
                  finally { setBusy(false); }
                })()}>Test Cosmos</button>
                <span>{acceptedCount} accepted</span>
                <label className="bag-label-reviewed">
                  <input type="checkbox" checked={photo.reviewed} disabled={!photo.targetPalletBox || proposed.length > 0} onChange={(event) => void updatePhoto(photo.id, (current) => ({ ...current, reviewed: event.target.checked }))} />
                  Reviewed
                </label>
              </div>
              <AnnotationCanvas photo={photo} mode={mode} busy={busy} onDrawBox={(box) => void onDrawBox(box)} />
              <div className="bag-label-proposals">
                {photo.flaps.map((flap, index) => (
                  <div key={flap.id} className={`bag-label-proposal ${flap.status}`}>
                    <span>Flap {index + 1} · {Math.round((flap.score ?? 0) * 100)}%</span>
                    <div className="flex gap-8">
                      {flap.status !== 'accepted' && <button className="btn btn--sm" onClick={() => void setProposalStatus(flap.id, 'accepted')}>Accept</button>}
                      {flap.status !== 'rejected' && <button className="btn btn--sm btn--danger" onClick={() => void setProposalStatus(flap.id, 'rejected')}>Reject</button>}
                    </div>
                  </div>
                ))}
              </div>
              {validateDataset(groups).length > 0 && <div className="xs soft">Dataset export remains locked by review and split validation.</div>}
            </>
          )}
        </section>
      </div>
    </main>
  );
}
