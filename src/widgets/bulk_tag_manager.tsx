import { useEffect, useState } from 'react';
import {
  renderWidget,
  usePlugin,
  useRunAsync,
  WidgetLocation,
  PluginRem,
  BuiltInPowerupCodes,
} from '@remnote/plugin-sdk';
import { richTextToString } from '../lib/slotConfig';
import {
  readScopeContext,
  buildScope,
  scanMembers,
  applyBulk,
  applyUndo,
  ScopeContext,
  ScopeKind,
  ScopeMember,
  RefShape,
  SHAPE_LABELS,
  FoundEntry,
  BulkOp,
  BulkTagBackup,
  BULK_TAG_BACKUP_KEY,
  MANAGEABLE_POWERUPS,
  HIGHLIGHT_COLOR_PRESETS,
  PowerupDef,
} from '../lib/bulkTags';

/**
 * Bulk Tags & Powerups
 *
 * Takes a set of rems — everything referencing the focused rem, or a table's
 * cells resolved through its tag — inventories the tags and powerups they carry,
 * and adds or removes one across the whole set.
 *
 * The scan is read-only and the write is a separate, counted, confirmed step.
 * The confirmation is drawn here rather than by `window.confirm`: inside
 * RemNote's sandboxed plugin iframe that call shows no dialog and returns a
 * truthy value, so a guard built on it approves itself.
 */

const ALL_SHAPES: RefShape[] = ['leading', 'embedded', 'back', 'other'];

const label: React.CSSProperties = {
  fontSize: 10,
  fontWeight: 600,
  textTransform: 'uppercase',
  letterSpacing: '0.06em',
  color: 'var(--rn-clr-content-tertiary)',
  marginBottom: 6,
};

const btn: React.CSSProperties = {
  padding: '3px 10px',
  backgroundColor: 'transparent',
  color: 'var(--rn-clr-content-primary)',
  border: '1px solid var(--rn-clr-background-tertiary)',
  borderRadius: 4,
  cursor: 'pointer',
  fontSize: 11,
  fontWeight: 600,
};

const card: React.CSSProperties = {
  padding: '6px 8px',
  marginBottom: 4,
  borderRadius: 4,
  backgroundColor: 'var(--rn-clr-background-secondary)',
  border: '1px solid var(--rn-clr-background-tertiary)',
};

const input: React.CSSProperties = {
  padding: '3px 6px',
  fontSize: 12,
  borderRadius: 4,
  border: '1px solid var(--rn-clr-background-tertiary)',
  backgroundColor: 'var(--rn-clr-background-primary)',
  color: 'var(--rn-clr-content-primary)',
  width: '100%',
};

interface Scan {
  members: ScopeMember[];
  entries: FoundEntry[];
  scopeKind: ScopeKind;
  slotId: string | null;
  /** How many rems the powerup discovery pass asked. */
  sampled: number;
  /** Powerups discovery never saw — absent from the results, but not proven absent. */
  unverified: PowerupDef[];
  exhaustive: boolean;
}

/** A costed operation waiting for the user. Nothing is written while it is set. */
interface Pending {
  op: BulkOp;
  remIds: string[];
  discards: BulkTagBackup | null;
}

function BulkTagManager() {
  const plugin = usePlugin();

  const ctx = useRunAsync(
    async () => plugin.widget.getWidgetContext<WidgetLocation.Popup>(),
    []
  );
  const remId = ctx?.contextData?.remId as string | undefined;
  const mode = (ctx?.contextData?.op as string | undefined) ?? 'manage';

  const scopeCtx = useRunAsync<ScopeContext | null>(async () => {
    if (!remId || mode === 'undo') return null;
    const focused = await plugin.rem.findOne(remId);
    if (!focused) return null;
    return readScopeContext(plugin, focused);
  }, [remId, mode]);

  const [scopeKind, setScopeKind] = useState<ScopeKind>('refs');
  const [slotId, setSlotId] = useState<string | null>(null);
  const [shapes, setShapes] = useState<RefShape[]>(['leading']);
  const [scan, setScan] = useState<Scan | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [backup, setBackup] = useState<BulkTagBackup | null | undefined>(undefined);

  // Add-side state
  const [addKind, setAddKind] = useState<'tag' | 'powerup'>('powerup');
  const [addPowerup, setAddPowerup] = useState<string>(MANAGEABLE_POWERUPS[0].code);
  const [addSlotValues, setAddSlotValues] = useState<Record<string, string>>({});
  const [tagQuery, setTagQuery] = useState('');
  const [tagResults, setTagResults] = useState<PluginRem[]>([]);
  const [pickedTag, setPickedTag] = useState<{ id: string; name: string } | null>(null);

  useEffect(() => {
    (async () => {
      setBackup((await plugin.storage.getLocal<BulkTagBackup>(BULK_TAG_BACKUP_KEY)) ?? null);
    })();
  }, [result]);

  // Default to the focused rem's own slot when it is one, so "cells of this
  // column" needs no extra pick.
  useEffect(() => {
    if (scopeCtx && slotId === null) {
      setSlotId(scopeCtx.focusedSlotId ?? scopeCtx.slots[0]?.id ?? null);
    }
  }, [scopeCtx, slotId]);

  // A scan describes one exact set. Changing the set must invalidate it rather
  // than leave counts on screen that no longer describe anything.
  useEffect(() => {
    setScan(null);
    setPending(null);
  }, [scopeKind, slotId]);

  useEffect(() => {
    setPending(null);
  }, [shapes, addKind, addPowerup, addSlotValues, pickedTag]);

  const runScan = async (exhaustivePowerups = false) => {
    if (!remId) return;
    setResult(null);
    try {
      const focused = await plugin.rem.findOne(remId);
      if (!focused) throw new Error('Focused rem not found');

      setBusy('Collecting rems…');
      const members = await buildScope(plugin, focused, scopeKind, slotId, (d, t) =>
        setBusy(`Collecting rems… ${d}/${t}`)
      );

      const { entries, sampled, unverified, exhaustive } = await scanMembers(
        plugin,
        members,
        (phase, d, t) => setBusy(`${phase}… ${d}/${t}`),
        { exhaustivePowerups }
      );

      setBusy(null);
      setScan({ members, entries, scopeKind, slotId, sampled, unverified, exhaustive });
    } catch (e) {
      console.error('[BulkTags] Scan failed:', e);
      setBusy(null);
      await plugin.app.toast('Scan failed — see console.');
    }
  };

  const shapeCounts = (() => {
    const counts: Record<string, number> = {};
    for (const m of scan?.members || []) {
      if (m.excluded) continue;
      counts[m.shape] = (counts[m.shape] || 0) + 1;
    }
    return counts;
  })();

  const excluded = (scan?.members || []).filter((m) => m.excluded);

  const usesShapes = scopeKind === 'refs';
  const selectedIds = new Set(
    (scan?.members || [])
      .filter((m) => !m.excluded && (!usesShapes || shapes.includes(m.shape)))
      .map((m) => m.id)
  );

  const inSelection = (e: FoundEntry) => e.remIds.filter((id) => selectedIds.has(id));

  /** Phase 1: cost the operation. Writes nothing. */
  const stage = async (op: BulkOp, remIds: string[]) => {
    if (remIds.length === 0) {
      await plugin.app.toast('Nothing in the current selection to change.');
      return;
    }
    const discards = (await plugin.storage.getLocal<BulkTagBackup>(BULK_TAG_BACKUP_KEY)) ?? null;
    if (discards) {
      console.warn('[BulkTags] Proceeding will discard the undo for:', discards);
    }
    console.group('[BulkTags] Staged — DRY RUN, nothing written');
    console.log(`${op.action} ${op.kind} "${op.name}" on ${remIds.length} rems.`);
    if (op.slotValues) console.log('Slot values:', op.slotValues);
    console.log('Rem ids:', remIds);
    console.groupEnd();
    setPending({ op, remIds, discards });
  };

  /** Phase 2: the user pressed the button in the confirmation panel. */
  const commit = async (p: Pending) => {
    setPending(null);
    setBusy(`Applying… 0/${p.remIds.length}`);
    try {
      const r = await applyBulk(plugin, p.remIds, p.op, (d, t) =>
        setBusy(`Applying… ${d}/${t}`)
      );

      // Snapshot only the rems actually changed, so an undo cannot touch a rem
      // that already carried the tag before this ran.
      const inverse: BulkOp = { ...p.op, action: p.op.action === 'add' ? 'remove' : 'add' };
      await plugin.storage.setLocal(BULK_TAG_BACKUP_KEY, {
        timestamp: Date.now(),
        did: `${p.op.action === 'add' ? 'Added' : 'Removed'} ${p.op.kind} "${p.op.name}" ${
          p.op.action === 'add' ? 'to' : 'from'
        } ${r.changedIds.length} rems`,
        undo: inverse,
        remIds: r.changedIds,
        slotValues: r.slotValues,
      } as BulkTagBackup);

      setBusy(null);
      setResult(
        `${p.op.action === 'add' ? 'Added' : 'Removed'} "${p.op.name}" — ` +
          `${r.changed} changed, ${r.skipped} already as wanted` +
          (r.failed ? `, ${r.failed} failed (see console)` : '') +
          '. "Undo Bulk Tag Change" reverts it.'
      );
      setScan(null);
    } catch (e) {
      console.error('[BulkTags] Apply failed:', e);
      setBusy(null);
      await plugin.app.toast('Apply failed — see console.');
    }
  };

  const commitUndo = async (b: BulkTagBackup) => {
    setBusy(`Undoing… 0/${b.remIds.length}`);
    try {
      const r = await applyUndo(plugin, b, (d, t) => setBusy(`Undoing… ${d}/${t}`));
      if (r.failed === 0) {
        await plugin.storage.setLocal(BULK_TAG_BACKUP_KEY, undefined);
      } else {
        console.warn('[BulkTags] Backup KEPT because some rems failed.');
      }
      setBusy(null);
      setResult(
        `Undo done — ${r.changed} rems restored` +
          (r.failed ? `, ${r.failed} failed (backup kept, see console)` : '.')
      );
      setScan(null);
    } catch (e) {
      console.error('[BulkTags] Undo failed:', e);
      setBusy(null);
      await plugin.app.toast('Undo failed — see console.');
    }
  };

  const searchTags = async (q: string) => {
    setTagQuery(q);
    setPickedTag(null);
    if (q.trim().length < 2) {
      setTagResults([]);
      return;
    }
    try {
      const found = await plugin.search.search([q], undefined, { numResults: 8 });
      setTagResults(found);
    } catch (e) {
      console.error('[BulkTags] Tag search failed:', e);
      setTagResults([]);
    }
  };

  const shell = (children: React.ReactNode) => (
    <div
      style={{
        padding: 16,
        fontFamily: 'system-ui, -apple-system, sans-serif',
        fontSize: 13,
        lineHeight: 1.5,
        color: 'var(--rn-clr-content-primary)',
        maxHeight: '90vh',
        overflowY: 'auto',
      }}
    >
      {children}
    </div>
  );

  if (busy) return shell(<strong>{busy}</strong>);

  // ---- Undo mode ---------------------------------------------------------
  if (mode === 'undo') {
    if (result) return shell(result);
    if (backup === undefined) return shell('Loading…');
    if (!backup) return shell('No bulk tag change to undo.');
    return shell(
      <>
        <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 8 }}>
          Undo the last bulk tag change?
        </div>
        <div style={{ marginBottom: 10 }}>
          <div>
            <strong>What was done:</strong> {backup.did}
          </div>
          <div>
            <strong>When:</strong> {new Date(backup.timestamp).toLocaleString()}
          </div>
          <div>
            <strong>Undo will:</strong> {backup.undo.action} the {backup.undo.kind} "
            {backup.undo.name}" on {backup.remIds.length} rems
            {backup.slotValues && Object.keys(backup.slotValues).length > 0
              ? `, restoring stored values on ${Object.keys(backup.slotValues).length} of them`
              : ''}
            .
          </div>
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          <button
            onClick={() => commitUndo(backup)}
            style={{ ...btn, backgroundColor: '#7c3aed', color: 'white', border: 'none' }}
          >
            Undo on {backup.remIds.length} rems
          </button>
          <button onClick={() => plugin.widget.closePopup()} style={btn}>
            Cancel
          </button>
        </div>
      </>
    );
  }

  // ---- Manage mode -------------------------------------------------------
  if (!remId) {
    return shell(
      <>
        Focus a rem — a table slot, a tag, or any rem at all — then run{' '}
        <strong>Bulk Tags & Powerups</strong>.
      </>
    );
  }
  if (!scopeCtx) return shell('Loading…');

  // Confirmation panel replaces the body: nothing is written while it is open,
  // and no other control can be reached to change what it describes.
  if (pending) {
    const p = pending;
    const removingTag = p.op.action === 'remove' && p.op.kind === 'tag';
    return shell(
      <>
        {p.discards && (
          <div style={{ color: '#b45309', fontWeight: 600, marginBottom: 10 }}>
            ⚠️ Only one undo is stored. Proceeding makes an earlier change permanent:{' '}
            {p.discards.did}, on {new Date(p.discards.timestamp).toLocaleString()}.
          </div>
        )}
        <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 8 }}>
          {p.op.action === 'add' ? 'Add' : 'Remove'} {p.op.kind} "{p.op.name}"{' '}
          {p.op.action === 'add' ? 'to' : 'from'} {p.remIds.length} rems?
        </div>
        <div style={{ marginBottom: 8 }}>
          <div>
            <strong>Scope:</strong> {scopeLabel(scopeKind, scopeCtx, slotId)}
          </div>
          {usesShapes && (
            <div>
              <strong>Included:</strong>{' '}
              {shapes.map((s) => SHAPE_LABELS[s].split(' — ')[0]).join(', ') || 'nothing'}
            </div>
          )}
          {p.op.slotValues && Object.keys(p.op.slotValues).length > 0 && (
            <div>
              <strong>Values:</strong>{' '}
              {Object.entries(p.op.slotValues)
                .map(([k, v]) => `${k} = ${v}`)
                .join(', ')}
            </div>
          )}
        </div>
        <div style={{ color: 'var(--rn-clr-content-tertiary)', marginBottom: 10 }}>
          Rems that already match are skipped, so only real changes are recorded.{' '}
          <strong>Back up your knowledge base first.</strong> Reversible with "Undo Bulk Tag
          Change".
          {removingTag && (
            <>
              {' '}
              Removing a tag can also drop property values RemNote stored under it; those are
              not snapshotted.
            </>
          )}
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          <button
            onClick={() => commit(p)}
            style={{
              ...btn,
              backgroundColor: p.op.action === 'add' ? '#2563eb' : '#b45309',
              color: 'white',
              border: 'none',
            }}
          >
            {p.op.action === 'add' ? 'Add to' : 'Remove from'} {p.remIds.length} rems
          </button>
          <button onClick={() => setPending(null)} style={btn}>
            Cancel
          </button>
        </div>
      </>
    );
  }

  const powerupDef = MANAGEABLE_POWERUPS.find((d) => d.code === addPowerup)!;
  const observedFor = (slot: string): string[] => {
    const entry = scan?.entries.find((e) => e.kind === 'powerup' && e.key === addPowerup);
    const seen = entry?.observed[slot] || [];
    if (seen.length > 0) return seen;
    return addPowerup === BuiltInPowerupCodes.Highlight && slot === 'Color'
      ? HIGHLIGHT_COLOR_PRESETS
      : [];
  };

  return shell(
    <>
      <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 2 }}>Bulk Tags & Powerups</div>
      <div style={{ color: 'var(--rn-clr-content-tertiary)', marginBottom: 14 }}>
        Focused: <strong>{scopeCtx.focusedName}</strong>
        {scopeCtx.tagName && <> · table: <strong>{scopeCtx.tagName}</strong></>}
      </div>

      {result && (
        <div style={{ ...card, borderColor: '#2563eb', marginBottom: 14 }}>{result}</div>
      )}

      <div style={label}>Which rems</div>
      <div style={{ marginBottom: 12 }}>
        <ScopeRadio
          checked={scopeKind === 'refs'}
          onChange={() => setScopeKind('refs')}
          text={`All references to "${scopeCtx.focusedName}"`}
          hint={scopeCtx.refCount === null ? undefined : `${scopeCtx.refCount} rems`}
        />
        {scopeCtx.tagId && scopeCtx.slots.length > 0 && (
          <>
            <ScopeRadio
              checked={scopeKind === 'slot-cells'}
              onChange={() => setScopeKind('slot-cells')}
              text="Table cells of one column"
            />
            {scopeKind === 'slot-cells' && (
              <select
                value={slotId ?? ''}
                onChange={(e) => setSlotId(e.target.value)}
                style={{ ...input, width: 'auto', marginLeft: 22, marginBottom: 4 }}
              >
                {scopeCtx.slots.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            )}
            <ScopeRadio
              checked={scopeKind === 'all-cells'}
              onChange={() => setScopeKind('all-cells')}
              text="Table cells, every column"
            />
            <ScopeRadio
              checked={scopeKind === 'rows'}
              onChange={() => setScopeKind('rows')}
              text={`Rows tagged with "${scopeCtx.tagName}"`}
            />
          </>
        )}
      </div>

      {!scan ? (
        <button onClick={() => runScan(false)} style={{ ...btn, backgroundColor: 'var(--rn-clr-background-secondary)' }}>
          Scan for tags &amp; powerups
        </button>
      ) : (
        <>
          {usesShapes && (
            <>
              <div style={label}>Include which references</div>
              <div style={{ marginBottom: 12 }}>
                {ALL_SHAPES.filter((s) => (shapeCounts[s] || 0) > 0).map((s) => (
                  <label
                    key={s}
                    style={{ display: 'flex', gap: 6, alignItems: 'baseline', marginBottom: 3 }}
                  >
                    <input
                      type="checkbox"
                      checked={shapes.includes(s)}
                      onChange={() =>
                        setShapes(
                          shapes.includes(s) ? shapes.filter((x) => x !== s) : [...shapes, s]
                        )
                      }
                    />
                    <span>
                      <strong>{shapeCounts[s]}</strong> — {SHAPE_LABELS[s]}
                    </span>
                  </label>
                ))}
                {excluded.length > 0 && (
                  <details style={{ marginTop: 6 }}>
                    <summary style={{ cursor: 'pointer', color: '#b45309', fontWeight: 600 }}>
                      🔒 {excluded.length} reference(s) held back and never edited
                    </summary>
                    <div style={{ marginTop: 4 }}>
                      {excluded.slice(0, 20).map((m) => (
                        <div key={m.id} style={{ fontSize: 11, marginBottom: 2 }}>
                          <span style={{ color: 'var(--rn-clr-content-tertiary)' }}>
                            {m.excluded}
                          </span>{' '}
                          — {m.name.slice(0, 70)}
                        </div>
                      ))}
                      {excluded.length > 20 && (
                        <div style={{ fontSize: 11 }}>…and {excluded.length - 20} more.</div>
                      )}
                    </div>
                  </details>
                )}
              </div>
            </>
          )}

          <div style={label}>Found on the {selectedIds.size} selected rems</div>
          <div style={{ marginBottom: 16 }}>
            {scan.entries.filter((e) => inSelection(e).length > 0).length === 0 ? (
              <div style={{ fontStyle: 'italic', color: 'var(--rn-clr-content-tertiary)' }}>
                No tags or powerups on these rems.
              </div>
            ) : (
              scan.entries
                .map((e) => ({ e, ids: inSelection(e) }))
                .filter((x) => x.ids.length > 0)
                .map(({ e, ids }) => (
                  <div key={`${e.kind}:${e.key}`} style={{ ...card, display: 'flex', gap: 8, alignItems: 'center' }}>
                    <span style={{ fontSize: 13 }}>{e.kind === 'powerup' ? '⚡' : '#'}</span>
                    <span style={{ flex: 1, fontWeight: 600 }}>
                      {e.name}
                      <span
                        style={{
                          fontWeight: 400,
                          fontSize: 11,
                          color: 'var(--rn-clr-content-tertiary)',
                          marginLeft: 6,
                        }}
                      >
                        on {ids.length} of {selectedIds.size}
                        {Object.entries(e.observed)
                          .map(([slot, vals]) => ` · ${slot}: ${vals.join(', ')}`)
                          .join('')}
                      </span>
                    </span>
                    <button
                      onClick={() =>
                        stage(
                          { action: 'remove', kind: e.kind, key: e.key, name: e.name },
                          ids
                        )
                      }
                      style={{ ...btn, color: '#b45309', borderColor: '#b45309' }}
                    >
                      Remove from {ids.length}
                    </button>
                  </div>
                ))
            )}
          </div>

          {!scan.exhaustive && scan.unverified.length > 0 && (
            <div
              style={{
                ...card,
                borderColor: '#b45309',
                marginBottom: 16,
                fontSize: 12,
              }}
            >
              RemNote cannot enumerate built-in powerup membership, so each rem is asked
              directly. The counts above are exact. But{' '}
              <strong>{scan.unverified.length} powerup(s)</strong> were not seen on the{' '}
              {scan.sampled}-rem sample used to decide what to count, so they are missing from
              the list rather than proven absent:{' '}
              <span style={{ color: 'var(--rn-clr-content-tertiary)' }}>
                {scan.unverified.map((d) => d.name).join(', ')}
              </span>
              .
              <div style={{ marginTop: 6 }}>
                <button onClick={() => runScan(true)} style={btn}>
                  Ask every rem about all {MANAGEABLE_POWERUPS.length} powerups (slower)
                </button>
              </div>
            </div>
          )}
          {scan.exhaustive && (
            <div style={{ ...card, marginBottom: 16, fontSize: 12 }}>
              Exhaustive: all {MANAGEABLE_POWERUPS.length} manageable powerups were asked of
              every one of the {scan.members.filter((m) => !m.excluded).length} rems.
            </div>
          )}

          <div style={label}>Add to the {selectedIds.size} selected rems</div>
          <div style={{ marginBottom: 10 }}>
            <div style={{ display: 'flex', gap: 12, marginBottom: 8 }}>
              <label style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                <input
                  type="radio"
                  checked={addKind === 'powerup'}
                  onChange={() => setAddKind('powerup')}
                />
                A built-in powerup
              </label>
              <label style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                <input type="radio" checked={addKind === 'tag'} onChange={() => setAddKind('tag')} />
                A tag
              </label>
            </div>

            {addKind === 'powerup' ? (
              <>
                <select
                  value={addPowerup}
                  onChange={(e) => {
                    setAddPowerup(e.target.value);
                    setAddSlotValues({});
                  }}
                  style={{ ...input, width: 'auto', marginBottom: 6 }}
                >
                  {MANAGEABLE_POWERUPS.map((d) => (
                    <option key={d.code} value={d.code}>
                      {d.name}
                    </option>
                  ))}
                </select>
                {powerupDef.slots.map((slot) => (
                  <div key={slot} style={{ marginBottom: 6 }}>
                    <div style={{ fontSize: 11, marginBottom: 2 }}>
                      {slot}{' '}
                      <span style={{ color: 'var(--rn-clr-content-tertiary)' }}>
                        (optional — leave blank to keep RemNote's default)
                      </span>
                    </div>
                    <input
                      value={addSlotValues[slot] ?? ''}
                      onChange={(e) =>
                        setAddSlotValues({ ...addSlotValues, [slot]: e.target.value })
                      }
                      placeholder={observedFor(slot)[0] ?? ''}
                      style={{ ...input, marginBottom: 4 }}
                    />
                    {observedFor(slot).length > 0 && (
                      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                        {observedFor(slot).map((v) => (
                          <button
                            key={v}
                            onClick={() => setAddSlotValues({ ...addSlotValues, [slot]: v })}
                            style={{ ...btn, padding: '1px 7px', fontSize: 10 }}
                            title="Value already in use in your knowledge base"
                          >
                            {v}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </>
            ) : (
              <>
                <input
                  value={tagQuery}
                  onChange={(e) => searchTags(e.target.value)}
                  placeholder="Search for the tag rem…"
                  style={{ ...input, marginBottom: 6 }}
                />
                {pickedTag ? (
                  <div style={{ marginBottom: 6 }}>
                    Selected: <strong>{pickedTag.name}</strong>{' '}
                    <button
                      onClick={() => setPickedTag(null)}
                      style={{ ...btn, padding: '0 6px', fontSize: 10 }}
                    >
                      change
                    </button>
                  </div>
                ) : (
                  tagResults.map((r) => (
                    <div
                      key={r._id}
                      onClick={() =>
                        setPickedTag({
                          id: r._id,
                          name: richTextToString(r.text) || '[unnamed]',
                        })
                      }
                      style={{ ...card, cursor: 'pointer' }}
                    >
                      {richTextToString(r.text) || '[unnamed]'}
                    </div>
                  ))
                )}
              </>
            )}

            <button
              disabled={addKind === 'tag' && !pickedTag}
              onClick={() => {
                const ids = [...selectedIds];
                if (addKind === 'powerup') {
                  const slotValues = Object.fromEntries(
                    Object.entries(addSlotValues).filter(([, v]) => v.trim() !== '')
                  );
                  stage(
                    {
                      action: 'add',
                      kind: 'powerup',
                      key: powerupDef.code,
                      name: powerupDef.name,
                      slotValues,
                    },
                    ids
                  );
                } else if (pickedTag) {
                  stage(
                    { action: 'add', kind: 'tag', key: pickedTag.id, name: pickedTag.name },
                    ids
                  );
                }
              }}
              style={{
                ...btn,
                marginTop: 4,
                opacity: addKind === 'tag' && !pickedTag ? 0.4 : 1,
                color: '#2563eb',
                borderColor: '#2563eb',
              }}
            >
              Add to {selectedIds.size} rems
            </button>
          </div>

          <button onClick={() => runScan(scan.exhaustive)} style={{ ...btn, marginTop: 6 }}>
            Re-scan
          </button>
        </>
      )}

      {backup && (
        <div
          style={{
            marginTop: 16,
            paddingTop: 10,
            borderTop: '1px solid var(--rn-clr-background-tertiary)',
            fontSize: 11,
            color: 'var(--rn-clr-content-tertiary)',
          }}
        >
          Undo available: {backup.did} ({new Date(backup.timestamp).toLocaleString()}). Run{' '}
          <strong>Undo Bulk Tag Change</strong>.
        </div>
      )}
    </>
  );
}

function scopeLabel(kind: ScopeKind, ctx: ScopeContext, slotId: string | null): string {
  if (kind === 'refs') return `references to "${ctx.focusedName}"`;
  if (kind === 'rows') return `rows tagged with "${ctx.tagName}"`;
  if (kind === 'all-cells') return `every cell of "${ctx.tagName}"`;
  const slot = ctx.slots.find((s) => s.id === slotId);
  return `cells of column "${slot?.name ?? '?'}"`;
}

function ScopeRadio(props: {
  checked: boolean;
  onChange: () => void;
  text: string;
  hint?: string;
}) {
  return (
    <label style={{ display: 'flex', gap: 6, alignItems: 'baseline', marginBottom: 3 }}>
      <input type="radio" checked={props.checked} onChange={props.onChange} />
      <span>
        {props.text}
        {props.hint && (
          <span style={{ color: 'var(--rn-clr-content-tertiary)', marginLeft: 6, fontSize: 11 }}>
            {props.hint}
          </span>
        )}
      </span>
    </label>
  );
}

renderWidget(BulkTagManager);
