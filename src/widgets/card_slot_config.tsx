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
  const [loadedFor, setLoadedFor] = useState<string | null>(null);

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

  const applyOrderToCards = async () => {
    if (!setup) return;
    setSyncing('Scanning rows…');
    try {
      const tag = await plugin.rem.findOne(setup.tagId);
      if (!tag) throw new Error('Tag rem not found');

      const pending = await plugin.storage.getLocal<BulkOrderBackup>(BULK_ORDER_BACKUP_KEY);
      if (pending) {
        setSyncing(null);
        await plugin.app.toast(
          `A previous sync of "${pending.tagName}" (${pending.rows.length} rows) is not undone yet. ` +
          `Run "Undo Row Order Sync" first, or accept it.`
        );
        return;
      }

      // Front and back are disjoint sets over the same columns, and only the
      // order *within* a side is observable, so concatenating them yields a
      // single row sequence that satisfies both. Unlisted columns sort after.
      const targetSlotIds = [...front, ...back];
      const columns = await getColumnSlots(tag);
      const { plans, totalRows } = await planRowSync(tag, columns, targetSlotIds);

      console.group('[CardSlotConfig] Apply order to cards');
      console.log('Target order:', targetSlotIds.map(nameOf).join(', '));
      console.log(`${plans.length} of ${totalRows} rows would change.`);
      plans.slice(0, 10).forEach((p) =>
        console.log(`  "${p.name.slice(0, 60)}" from: ${p.from.join(', ')}`)
      );
      if (plans.length > 10) console.log(`  …and ${plans.length - 10} more.`);
      console.groupEnd();

      if (plans.length === 0) {
        setSyncing(null);
        await plugin.app.toast('Every row already renders in this order.');
        return;
      }

      const confirmed = window.confirm(
        `Apply this order to cards?\n\n` +
        `Order: ${targetSlotIds.map(nameOf).join(', ')}\n` +
        `Rows to rewrite: ${plans.length} of ${totalRows}\n\n` +
        `Cards render extras in each ROW's value order, so this rewrites the ` +
        `property-value rems of every affected row — rems RemNote maintains itself.\n\n` +
        `NOTE: that order is shared by every card a row generates, so cards from ` +
        `other columns of this table are affected too.\n\n` +
        `This does NOT reorder the table's columns, so rows you create later will ` +
        `still follow the current column order — drag the columns to match.\n\n` +
        `BACK UP YOUR KNOWLEDGE BASE FIRST. Undo with "Undo Row Order Sync".\n\nProceed?`
      );
      if (!confirmed) {
        setSyncing(null);
        await plugin.app.toast('Cancelled — nothing was written.');
        return;
      }

      await plugin.storage.setLocal(BULK_ORDER_BACKUP_KEY, {
        tagId: tag._id,
        tagName: setup.tagName,
        rows: plans.map((p) => ({ rowId: p.rowId, originalOrder: p.originalOrder })),
        timestamp: Date.now(),
      } as BulkOrderBackup);

      const { done, failed } = await applyRowSync(plugin, plans, (completed, total) => {
        setSyncing(`Rewriting rows… ${completed}/${total}`);
      });

      setSyncing(null);
      await plugin.app.toast(
        failed === 0
          ? `Reordered ${done} rows. "Undo Row Order Sync" reverts.`
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
            disabled={busy || !!syncing || front.length + back.length < 2}
            onClick={applyOrderToCards}
            style={{
              ...btn,
              backgroundColor: '#7c3aed',
              color: 'white',
              border: 'none',
              opacity: busy || !!syncing || front.length + back.length < 2 ? 0.5 : 1,
            }}
          >
            {syncing ? syncing : 'Apply order to cards'}
          </button>
          <span style={{ fontSize: 11, color: 'var(--rn-clr-content-tertiary)' }}>
            Counts the rows first and asks before writing.
          </span>
        </div>
        <div
          style={{ fontSize: 11, color: 'var(--rn-clr-content-tertiary)', marginTop: 8, lineHeight: 1.5 }}
        >
          Rewrites every affected row so its cards render in the order above. The order is
          shared by <strong>all</strong> cards a row generates, not just the target selected
          here. Rows created later follow the table's <strong>column</strong> order instead,
          so drag the columns to match if you want new rows to agree. Undo with the{' '}
          <em>Undo Row Order Sync</em> command.
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
