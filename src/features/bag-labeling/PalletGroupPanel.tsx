import type { PalletLabelGroup, PalletView } from './types';

const VIEWS: Array<{ value: PalletView; label: string }> = [
  { value: 'front', label: 'Front' },
  { value: 'side_1', label: 'Side 1' },
  { value: 'back', label: 'Back' },
  { value: 'side_2', label: 'Side 2' },
  { value: 'other', label: 'Other' },
];

interface Props {
  groups: readonly PalletLabelGroup[];
  selectedGroupId: string | null;
  selectedPhotoId: string | null;
  onSelectGroup: (id: string) => void;
  onSelectPhoto: (id: string) => void;
  onCreateGroup: () => void;
  onDeleteGroup: (id: string) => void;
  onAddPhotos: (files: FileList) => void;
  onSetView: (photoId: string, view: PalletView) => void;
}

export function PalletGroupPanel(props: Props) {
  const selected = props.groups.find((group) => group.id === props.selectedGroupId);
  return (
    <aside className="bag-label-sidebar">
      <div className="row-between">
        <strong>Pallet groups</strong>
        <button className="btn btn--sm" onClick={props.onCreateGroup}>+ Pallet</button>
      </div>
      <div className="bag-label-groups">
        {props.groups.map((group) => (
          <button
            key={group.id}
            className={group.id === props.selectedGroupId ? 'bag-label-group active' : 'bag-label-group'}
            onClick={() => props.onSelectGroup(group.id)}
          >
            <span>{group.displayName}</span>
            <small>{group.split} · {group.photos.filter((photo) => photo.reviewed).length}/{group.photos.length}</small>
          </button>
        ))}
      </div>

      {selected && (
        <>
          <div className="row-between bag-label-subhead">
            <strong>Photos</strong>
            <button className="btn btn--sm btn--danger" onClick={() => props.onDeleteGroup(selected.id)}>Delete</button>
          </div>
          <label className="btn btn--ghost" style={{ textAlign: 'center' }}>
            Add photos
            <input type="file" accept="image/*" multiple hidden onChange={(event) => event.target.files && props.onAddPhotos(event.target.files)} />
          </label>
          <div className="bag-label-photos">
            {selected.photos.map((photo) => (
              <div key={photo.id} className={photo.id === props.selectedPhotoId ? 'bag-label-photo active' : 'bag-label-photo'}>
                <button onClick={() => props.onSelectPhoto(photo.id)}>
                  <span>{photo.fileName}</span>
                  <small>{photo.reviewed ? '✓ reviewed' : `${photo.flaps.filter((flap) => flap.status === 'accepted').length} accepted`}</small>
                </button>
                <select value={photo.view} onChange={(event) => props.onSetView(photo.id, event.target.value as PalletView)}>
                  {VIEWS.map((view) => <option key={view.value} value={view.value}>{view.label}</option>)}
                </select>
              </div>
            ))}
          </div>
        </>
      )}
    </aside>
  );
}
