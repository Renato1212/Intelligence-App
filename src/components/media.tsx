import { useLiveQuery } from 'dexie-react-hooks';
import { useRef, useState } from 'react';
import type { LinkItem, Photo } from '../domain/types';
import { db } from '../lib/db';
import { fileToDataUrl } from '../lib/images';
import { Modal, useToast } from './ui';

/**
 * Photo + link attachments for a parent record (trade / debrief / prep).
 * Photos live in the local `photos` table; links live on the parent record
 * and are managed through the `links` / `onLinksChange` props.
 */
export function MediaEditor({
  parentType,
  parentId,
  links,
  onLinksChange,
  ensureParentId,
}: {
  parentType: Photo['parentType'];
  parentId: number | null;
  links: LinkItem[];
  onLinksChange: (links: LinkItem[]) => void;
  /** Called before adding a photo when the parent has no id yet (unsaved record). */
  ensureParentId?: () => Promise<number>;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const toast = useToast();
  const [label, setLabel] = useState('');
  const [url, setUrl] = useState('');
  const [preview, setPreview] = useState<Photo | null>(null);

  const photos =
    useLiveQuery(
      () => (parentId != null ? db.photos.where('[parentType+parentId]').equals([parentType, parentId]).toArray() : Promise.resolve([] as Photo[])),
      [parentType, parentId],
    ) ?? [];

  const addPhotos = async (files: FileList | null) => {
    if (!files?.length) return;
    let pid = parentId;
    if (pid == null) {
      if (!ensureParentId) {
        toast('Save first, then attach photos');
        return;
      }
      pid = await ensureParentId();
    }
    for (const f of Array.from(files)) {
      try {
        const dataUrl = await fileToDataUrl(f);
        await db.photos.add({ parentType, parentId: pid, name: f.name, dataUrl, createdAt: new Date().toISOString() });
      } catch (e) {
        toast(`Could not add ${f.name}: ${e instanceof Error ? e.message : e}`);
      }
    }
  };

  const addLink = () => {
    const u = url.trim();
    if (!u) return;
    const withScheme = /^https?:\/\//i.test(u) ? u : `https://${u}`;
    onLinksChange([...links, { label: label.trim() || withScheme.replace(/^https?:\/\//, ''), url: withScheme }]);
    setLabel('');
    setUrl('');
  };

  return (
    <div className="stack" style={{ gap: 10 }}>
      <div>
        <div className="small muted" style={{ marginBottom: 6 }}>
          Photos — chart screenshots, DOM captures, phone shots
        </div>
        <div className="row">
          {photos.map((p) => (
            <div key={p.id} style={{ position: 'relative' }}>
              <img
                src={p.dataUrl}
                alt={p.name}
                title={p.name}
                style={{ width: 92, height: 64, objectFit: 'cover', borderRadius: 6, border: '1px solid var(--hairline)', cursor: 'zoom-in', display: 'block' }}
                onClick={() => setPreview(p)}
              />
              <button
                className="btn sm danger"
                style={{ position: 'absolute', top: 2, right: 2, padding: '0 5px', lineHeight: '16px' }}
                title="Remove photo"
                onClick={() => db.photos.delete(p.id!)}
              >
                ✕
              </button>
            </div>
          ))}
          <button className="btn sm" onClick={() => fileRef.current?.click()}>
            + Add photos
          </button>
          <input ref={fileRef} type="file" accept="image/*" multiple style={{ display: 'none' }} onChange={(e) => addPhotos(e.target.files)} />
        </div>
      </div>

      <div>
        <div className="small muted" style={{ marginBottom: 6 }}>
          Links — headlines, replays, shared charts, docs
        </div>
        <div className="row" style={{ marginBottom: links.length ? 6 : 0 }}>
          {links.map((l, i) => (
            <span key={i} className="chip">
              <a href={l.url} target="_blank" rel="noreferrer">
                {l.label} ↗
              </a>
              <span style={{ cursor: 'pointer', color: 'var(--muted)' }} title="Remove link" onClick={() => onLinksChange(links.filter((_, j) => j !== i))}>
                ✕
              </span>
            </span>
          ))}
        </div>
        <div className="row">
          <input placeholder="Label" value={label} onChange={(e) => setLabel(e.target.value)} style={{ width: 140 }} />
          <input
            placeholder="https://…"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && addLink()}
            style={{ flex: 1, minWidth: 180 }}
          />
          <button className="btn sm" onClick={addLink} disabled={!url.trim()}>
            Add link
          </button>
        </div>
      </div>

      {preview && (
        <Modal title={preview.name} onClose={() => setPreview(null)}>
          <img src={preview.dataUrl} alt={preview.name} style={{ maxWidth: '100%', borderRadius: 8 }} />
        </Modal>
      )}
    </div>
  );
}
