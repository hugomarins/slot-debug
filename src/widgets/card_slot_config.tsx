import { useEffect, useState } from 'react';
import {
  renderWidget,
  usePlugin,
  useRunAsync,
  WidgetLocation,
} from '@remnote/plugin-sdk';
import {
  FRONT_SLOT,
  BACK_SLOT,
  readExtraSlotIds,
  writeExtraSlotIds,
  resolveTagRem,
  getColumnSlots,
  planRowSync,
  applyRowSync,
  planColumnOrder,
  applyColumnOrder,
  BULK_ORDER_BACKUP_KEY,
  BulkOrderBackup,
  richTextToString,
} from '../lib/slotConfig';

/**
 * Card Extras Configurator
 *
 * Rebuilds the "Extra properties to show on front / back of card" picker that
 * RemNote removed from the primary column of a table.
 *
 * The primary card — the row's front -> backText, and any cloze cards made from
 * the row's own text — stores its config on the TAG rem. RemNote used to expose
 * that through the pseudo-column rendering the row's backText ("Definition"),
 * so tables without one (cloze tables) lost the entry point entirely while
 * keeping the stored values live. Slot columns that generate their own cards
 * store their config on the slot rem and keep their own menu.
 */

interface SlotOption {
  id: string;
  name: string;
}

interface Target {
  id: string;
  label: string;
  isPrimary: boolean;
}

interface Setup {
  tagId: string;
  tagName: string;
  targets: Target[];
  candidates: SlotOption[];
  resolvedFrom: string | null;
}

const label: React.CSSProperties = {
  fontSize: '10px',
  fontWeight: 600,
  textTransform: 'uppercase',
  letterSpacing: '0.06em',
  color: 'var(--rn-clr-content-tertiary)',
  marginBottom: '6px',
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

const iconBtn: React.CSSProperties = {
  ...btn,
  padding: '0 5px',
  lineHeight: '18px',
  fontSize: 10,
};

function CardSlotConfig() {
  const plugin = usePlugin();

  const ctx = useRunAsync(
    async () => plugin.widget.getWidgetContext<WidgetLocation.Popup>(),
    []
  );
  const remId = ctx?.contextData?.remId as string | undefined;

  const setup = useRunAsync<Setup | null>(async () => {
    if (!remId) return null;
    const focused = await plugin.rem.findOne(remId);
    if (!focused) return null;

    const { tag, resolvedFrom } = await resolveTagRem(plugin, focused);

    const candidates: SlotOption[] = (await getColumnSlots(tag)).map((c) => ({
      id: c._id,
      name: richTextToString(c.text) || '[unnamed]',
    }));

    const tagName = richTextToString(tag.text) || '[unnamed]';
    const targets: Target[] = [
      {
        id: tag._id,
        label: 'Primary card (row front → back, and clozes)',
        isPrimary: true,
      },
      ...candidates.map((c) => ({ id: c.id, label: `Column: ${c.name}`, isPrimary: false })),
    ];

    return { tagId: tag._id, tagName, targets, candidates, resolvedFrom };
  }, [remId]);

  const [targetId, setTargetId] = useState<string | null>(null);
  const [front, setFront] = useState<string[]>([]);
  const [back, setBack] = useState<string[]>([]);
  const [opened, setOpened] = useState<{ front: string[]; back: string[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const [syncing, setSyncing] = useState<string | null>(null);
  const [alsoColumns, setAlsoColumns] = useState(true);
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  /** Rows whose value order disagrees with the stored order. null = checking. */
  const [outOfSyncRows, setOutOfSyncRows] = useState<number | null>(null);

  useEffect(() => {
    if (setup && targetId === null) setTargetId(setup.targets[0].id);
  }, [setup, targetId]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!targetId) return;
      const rem = await plugin.rem.findOne(targetId);
      if (!rem || cancelled) return;
      const f = await readExtraSlotIds(rem, FRONT_SLOT);
      const b = await readExtraSlotIds(rem, BACK_SLOT);
      if (cancelled) return;
      setFront(f);
      setBack(b);
      setOpened({ front: f, back: b });
      setLoadedFor(targetId);
    })();
    return () => {
      cancelled = true;
    };
  }, [targetId]);

  // The stored config order persists across sessions, so it cannot serve as the
  // baseline for "has anything changed" — an order the user set with the arrows
  // but never applied would look already-applied on reopening. The real baseline
  // is the rows, so measure them against the stored order whenever a target is
  // (re)loaded.
  useEffect(() => {
    if (!setup || loadedFor !== targetId) return;
    let cancelled = false;
    (async () => {
      setOutOfSyncRows(null);
      try {
        const tag = await plugin.rem.findOne(setup.tagId);
        if (!tag || cancelled) return;
        const columns = await getColumnSlots(tag);
        const target = planColumnOrder(columns.map((c) => c._id), [...front, ...back]);
        const { plans } = await planRowSync(tag, columns, target);
        if (!cancelled) setOutOfSyncRows(plans.length);
      } catch (e) {
        console.error('[CardSlotConfig] Could not check row order:', e);
        if (!cancelled) setOutOfSyncRows(0);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [setup, targetId, loadedFor]);

  const apply = async (nextFront: string[], nextBack: string[]) => {
    if (!targetId) return;
    setBusy(true);
    // Optimistic: the UI is the source of truth for ordering while writing.
    setFront(nextFront);
    setBack(nextBack);
    try {
      const rem = await plugin.rem.findOne(targetId);
      if (!rem) throw new Error(`Target rem ${targetId} not found`);
      await writeExtraSlotIds(rem, FRONT_SLOT, nextFront);
      await writeExtraSlotIds(rem, BACK_SLOT, nextBack);
    } catch (e) {
      console.error('[CardSlotConfig] Write failed:', e);
      await plugin.app.toast('Write failed — see console.');
      // Re-read so the UI stops lying about what is stored.
      const rem = await plugin.rem.findOne(targetId);
      if (rem) {
        setFront(await readExtraSlotIds(rem, FRONT_SLOT));
        setBack(await readExtraSlotIds(rem, BACK_SLOT));
      }
    }
    setBusy(false);
  };

  // A slot present on both sides only renders on the front — the back copy is
  // silently dropped — so adding to one side removes it from the other, which
  // is also why RemNote's own chip lists are always disjoint.
  const toggle = (side: 'front' | 'back', id: string) => {
    if (side === 'front') {
      const removing = front.includes(id);
      apply(removing ? front.filter((x) => x !== id) : [...front, id],
            removing ? back : back.filter((x) => x !== id));
    } else {
      const removing = back.includes(id);
      apply(removing ? front : front.filter((x) => x !== id),
            removing ? back.filter((x) => x !== id) : [...back, id]);
    }
  };

  const nameOf = (id: string) =>
    setup?.candidates.find((c) => c.id === id)?.name ?? `[outside this tag: ${id}]`;

  // Arrows only edit this list's order — no rows are touched until "Apply order
  // to cards". Cards read each ROW's value order, so making an order real means
  // rewriting every row, which must never sit behind a single arrow click.
  const move = (side: 'front' | 'back', id: string, delta: number) => {
    const current = [...(side === 'front' ? front : back)];
    const i = current.indexOf(id);
    const j = i + delta;
    if (i < 0 || j < 0 || j >= current.length) return;
    [current[i], current[j]] = [current[j], current[i]];
    if (side === 'front') apply(current, back);
    else apply(front, current);
  };

  // Applying rewrites every row, so it stays disabled until the arrows have
  // actually changed an order. Adding or removing an extra does not need it —
  // a newly added extra slots into the row order that already exists — so this
  // compares only the relative order of the slots common to both states, which
  // also re-disables the button if the user undoes a move by hand.
  const orderChanged = (() => {
    if (!opened) return false;
    const reordered = (now: string[], then: string[]) => {
      const a = now.filter((id) => then.includes(id));
      const b = then.filter((id) => now.includes(id));
      return a.join() !== b.join();
    };
    return reordered(front, opened.front) || reordered(back, opened.back);
  })();

  // Enabled either because the arrows moved something in this session, or
  // because the rows still do not match the stored order from a previous one.
  const checkingRows = outOfSyncRows === null;
  const canApply = !busy && !syncing && !checkingRows && (orderChanged || outOfSyncRows > 0);

  const applyOrderToCards = async () => {
    if (!setup) return;
    setSyncing('Scanning rows…');
    try {
      const tag = await plugin.rem.findOne(setup.tagId);
      if (!tag) throw new Error('Tag rem not found');

      // Only one undo snapshot is kept, so proceeding overwrites any earlier
      // one — making that earlier reordering permanent. Say so explicitly rather
      // than refusing, since refusing left no way forward.
      const pending = await plugin.storage.getLocal<BulkOrderBackup>(BULK_ORDER_BACKUP_KEY);
      const pendingWarning = pending
        ? `⚠️ THIS MAKES AN EARLIER REORDERING PERMANENT\n\n` +
          `A previous reordering has not been undone:\n` +
          `  Table: "${pending.tagName}"\n` +
          `  Rows changed: ${pending.rows.length}\n` +
          (pending.originalColumnOrder ? `  Table columns: also reordered\n` : '') +
          `  When: ${new Date(pending.timestamp).toLocaleString()}\n\n` +
          `Only one undo is stored. Proceeding replaces it, so that earlier ` +
          `reordering can no longer be reverted with "Undo Row Order Sync". ` +
          `Its details have been logged to the console.\n\n` +
          `${'─'.repeat(40)}\n\n`
        : '';

      if (pending) {
        console.warn(
          '[CardSlotConfig] Proceeding will discard the undo for this earlier sync:',
          pending
        );
      }

      // Front and back are disjoint sets over the same columns, and only the
      // order *within* a side is observable, so concatenating them gives one
      // sequence satisfying both. Unlisted columns keep their existing slots.
      const columns = await getColumnSlots(tag);
      const currentColumnIds = columns.map((c) => c._id);
      const targetColumnIds = planColumnOrder(currentColumnIds, [...front, ...back]);

      // Rows are synced to the resulting COLUMN order, not just to the listed
      // extras, so rows and columns agree and unlisted columns stay put.
      const { plans, totalRows } = await planRowSync(tag, columns, targetColumnIds);
      const columnsWouldMove = targetColumnIds.join() !== currentColumnIds.join();

      console.group('[CardSlotConfig] Apply order to cards');
      console.log('Current column order:', currentColumnIds.map(nameOf).join(', '));
      console.log('Target order:        ', targetColumnIds.map(nameOf).join(', '));
      console.log(`Columns would move: ${columnsWouldMove ? 'yes' : 'no'}`);
      console.log(`${plans.length} of ${totalRows} rows would change.`);
      plans.slice(0, 10).forEach((p) =>
        console.log(`  "${p.name.slice(0, 60)}" from: ${p.from.join(', ')}`)
      );
      if (plans.length > 10) console.log(`  …and ${plans.length - 10} more.`);
      console.groupEnd();

      const willMoveColumns = alsoColumns && columnsWouldMove;
      if (plans.length === 0 && !willMoveColumns) {
        setSyncing(null);
        await plugin.app.toast('Every row already renders in this order.');
        return;
      }

      const confirmed = window.confirm(
        pendingWarning +
        `Apply this order to cards?\n\n` +
        `Order: ${targetColumnIds.map(nameOf).join(', ')}\n` +
        `Rows to rewrite: ${plans.length} of ${totalRows}\n` +
        (willMoveColumns
          ? `Table columns: WILL BE REORDERED to match.\n\n`
          : `Table columns: left alone — rows created later will follow the ` +
            `current column order instead.\n\n`) +
        `Cards render extras in each ROW's value order, so this rewrites the ` +
        `property-value rems of every affected row — rems RemNote maintains itself.\n\n` +
        `NOTE: that order is shared by every card a row generates, so cards from ` +
        `other columns of this table are affected too.\n\n` +
        `BACK UP YOUR KNOWLEDGE BASE FIRST. Undo with "Undo Row Order Sync".\n\nProceed?`
      );
      if (!confirmed) {
        setSyncing(null);
        await plugin.app.toast('Cancelled — nothing was written.');
        return;
      }

      // Snapshot before the first write, including the column order when we are
      // about to change it, so the undo command can put both back.
      await plugin.storage.setLocal(BULK_ORDER_BACKUP_KEY, {
        tagId: tag._id,
        tagName: setup.tagName,
        rows: plans.map((p) => ({ rowId: p.rowId, originalOrder: p.originalOrder })),
        originalColumnOrder: willMoveColumns ? currentColumnIds : undefined,
        timestamp: Date.now(),
      } as BulkOrderBackup);

      if (willMoveColumns) {
        setSyncing('Reordering columns…');
        const result = await applyColumnOrder(plugin, tag, targetColumnIds);
        console.log(
          `[CardSlotConfig] Column reorder: ${result.swaps} swap(s), ` +
          (result.matched ? 'order matches target.' : 'ORDER DID NOT MATCH TARGET.')
        );
        if (!result.matched) {
          console.warn('Final column order:', result.finalOrder.map(nameOf).join(', '));
        }
      }

      const { done, failed } = await applyRowSync(plugin, plans, (completed, total) => {
        setSyncing(`Rewriting rows… ${completed}/${total}`);
      });

      setSyncing(null);
      // This order is now the applied one, so the button greys out until the
      // arrows are used again.
      if (failed === 0) {
        setOpened({ front, back });
        setOutOfSyncRows(0);
      }
      await plugin.app.toast(
        failed === 0
          ? `Reordered ${done} rows${willMoveColumns ? ' and the columns' : ''}. "Undo Row Order Sync" reverts.`
          : `Reordered ${done} rows, ${failed} failed — see console.`
      );
    } catch (e) {
      console.error('[CardSlotConfig] Apply order failed:', e);
      setSyncing(null);
      await plugin.app.toast('Apply order failed — see console.');
    }
  };

  if (!remId) {
    return (
      <div style={{ padding: 16, fontSize: 13, color: 'var(--rn-clr-content-primary)' }}>
        Focus a tag rem (or any rem tagged with it), then run{' '}
        <strong>Configure Card Extras</strong>.
      </div>
    );
  }

  if (!setup || loadedFor !== targetId) {
    return (
      <div style={{ padding: 16, fontSize: 13, color: 'var(--rn-clr-content-primary)' }}>
        Loading…
      </div>
    );
  }

  const renderSide = (side: 'front' | 'back', selected: string[], title: string) => {
    const unselected = setup.candidates.filter((c) => !selected.includes(c.id));
    return (
      <div style={{ marginBottom: 18 }}>
        <div style={label}>{title}</div>

        {selected.length === 0 ? (
          <div
            style={{
              fontSize: 12,
              color: 'var(--rn-clr-content-tertiary)',
              marginBottom: 8,
              fontStyle: 'italic',
            }}
          >
            Nothing shown here.
          </div>
        ) : (
          <div style={{ marginBottom: 8 }}>
            {selected.map((id, i) => (
              <div
                key={id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '4px 8px',
                  marginBottom: 4,
                  borderRadius: 4,
                  backgroundColor: 'var(--rn-clr-background-secondary)',
                  border: '1px solid #2563eb',
                }}
              >
                <span
                  style={{ fontSize: 10, color: 'var(--rn-clr-content-tertiary)', width: 14 }}
                >
                  {i + 1}.
                </span>
                <span style={{ fontSize: 13, fontWeight: 600, flex: 1 }}>{nameOf(id)}</span>
                <button
                  disabled={busy || !!syncing || i === 0}
                  onClick={() => move(side, id, -1)}
                  style={{ ...iconBtn, opacity: i === 0 ? 0.3 : 1 }}
                  title="Move up (takes effect on cards via Apply order)"
                >
                  ↑
                </button>
                <button
                  disabled={busy || !!syncing || i === selected.length - 1}
                  onClick={() => move(side, id, 1)}
                  style={{ ...iconBtn, opacity: i === selected.length - 1 ? 0.3 : 1 }}
                  title="Move down (takes effect on cards via Apply order)"
                >
                  ↓
                </button>
                <button
                  disabled={busy || !!syncing}
                  onClick={() => toggle(side, id)}
                  style={{ ...iconBtn, color: '#dc2626' }}
                  title="Remove"
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        )}

        {unselected.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
            {unselected.map((c) => (
              <button
                key={c.id}
                disabled={busy}
                onClick={() => toggle(side, c.id)}
                style={{
                  ...btn,
                  color: 'var(--rn-clr-content-tertiary)',
                  fontWeight: 500,
                }}
                title={`Add "${c.name}" to the ${side}`}
              >
                + {c.name}
              </button>
            ))}
          </div>
        )}
      </div>
    );
  };

  const dirty =
    opened !== null &&
    (opened.front.join() !== front.join() || opened.back.join() !== back.join());

  return (
    <div
      style={{
        padding: 16,
        fontFamily: 'system-ui, -apple-system, sans-serif',
        color: 'var(--rn-clr-content-primary)',
        maxHeight: '90vh',
        overflowY: 'auto',
      }}
    >
      <div
        style={{
          borderBottom: '1px solid var(--rn-clr-background-tertiary)',
          marginBottom: 12,
          paddingBottom: 8,
        }}
      >
        <div style={{ fontSize: 15, fontWeight: 700 }}>Configure Card Extras</div>
        <div style={{ fontSize: 12, color: 'var(--rn-clr-content-tertiary)', marginTop: 2 }}>
          {setup.tagName}
          {setup.resolvedFrom && ` · resolved from ${setup.resolvedFrom}`}
        </div>
      </div>

      <div style={{ marginBottom: 16 }}>
        <div style={label}>Configure cards for</div>
        <select
          value={targetId ?? ''}
          onChange={(e) => setTargetId(e.target.value)}
          disabled={busy}
          style={{
            width: '100%',
            padding: '5px 7px',
            fontSize: 13,
            borderRadius: 4,
            backgroundColor: 'var(--rn-clr-background-secondary)',
            color: 'var(--rn-clr-content-primary)',
            border: '1px solid var(--rn-clr-background-tertiary)',
          }}
        >
          {setup.targets.map((t) => (
            <option key={t.id} value={t.id}>
              {t.label}
            </option>
          ))}
        </select>
      </div>

      {renderSide('front', front, 'Extra properties to show on front of card')}
      {renderSide('back', back, 'Extra properties to show on back of card')}

      <div
        style={{
          fontSize: 11,
          color: 'var(--rn-clr-content-tertiary)',
          backgroundColor: 'var(--rn-clr-background-secondary)',
          borderRadius: 4,
          padding: '8px 10px',
          marginBottom: 12,
          lineHeight: 1.5,
        }}
      >
        Cards render these in <strong>each row's own value order</strong> — the order that
        row's properties were first filled in. The arrows above set the order you want, but
        they change nothing on their own: use <strong>Apply order to cards</strong> to
        rewrite the rows. A slot placed on the front is skipped on the back, so adding it to
        one side removes it from the other, and blank cells never appear.
      </div>

      <div
        style={{
          border: '1px solid #7c3aed',
          borderRadius: 6,
          padding: 10,
          marginBottom: 12,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button
            disabled={!canApply}
            onClick={applyOrderToCards}
            title={
              canApply
                ? 'Counts the affected rows and asks before writing'
                : checkingRows
                  ? 'Checking how many rows match this order…'
                  : 'Use the ↑ / ↓ arrows to change an order first'
            }
            style={{
              ...btn,
              backgroundColor: canApply ? '#7c3aed' : 'var(--rn-clr-background-secondary)',
              color: canApply ? 'white' : 'var(--rn-clr-content-tertiary)',
              border: canApply ? 'none' : '1px solid var(--rn-clr-background-tertiary)',
              cursor: canApply ? 'pointer' : 'default',
              opacity: busy || !!syncing ? 0.5 : 1,
            }}
          >
            {syncing ? syncing : 'Apply order to cards'}
          </button>
          <span style={{ fontSize: 11, color: 'var(--rn-clr-content-tertiary)' }}>
            {checkingRows
              ? 'Checking which rows match this order…'
              : orderChanged
                ? 'Counts the rows first and asks before writing.'
                : outOfSyncRows > 0
                  ? `${outOfSyncRows} row${outOfSyncRows === 1 ? '' : 's'} do not use this order yet.`
                  : 'Every row already uses this order. Use the ↑ / ↓ arrows to change it.'}
          </span>
        </div>

        <label
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            gap: 6,
            marginTop: 8,
            fontSize: 11,
            cursor: 'pointer',
          }}
        >
          <input
            type="checkbox"
            checked={alsoColumns}
            disabled={busy || !!syncing}
            onChange={(e) => setAlsoColumns(e.target.checked)}
            style={{ marginTop: 2 }}
          />
          <span>
            Also reorder the <strong>table columns</strong> to match, so rows you create
            later inherit this order. Changes your table layout.
          </span>
        </label>

        <div
          style={{ fontSize: 11, color: 'var(--rn-clr-content-tertiary)', marginTop: 8, lineHeight: 1.5 }}
        >
          Rewrites every affected row so its cards render in the order above. The order is
          shared by <strong>all</strong> cards a row generates, not just the target selected
          here. Undo with the <em>Undo Row Order Sync</em> command.
        </div>
      </div>

      <div
        style={{
          display: 'flex',
          gap: 6,
          alignItems: 'center',
          borderTop: '1px solid var(--rn-clr-background-tertiary)',
          paddingTop: 10,
        }}
      >
        <button
          disabled={busy || !dirty}
          onClick={() => opened && apply(opened.front, opened.back)}
          style={{ ...btn, opacity: dirty ? 1 : 0.4 }}
        >
          Revert to opened state
        </button>
        <span style={{ fontSize: 11, color: 'var(--rn-clr-content-tertiary)' }}>
          {busy ? 'Saving…' : 'Changes save immediately.'}
        </span>
      </div>
    </div>
  );
}

renderWidget(CardSlotConfig);
