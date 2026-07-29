import { useEffect, useState } from 'react';
import {
  renderWidget,
  usePlugin,
  useRunAsync,
  WidgetLocation,
  BuiltInPowerupCodes,
} from '@remnote/plugin-sdk';
import {
  FRONT_SLOT,
  BACK_SLOT,
  readExtraSlotIds,
  writeExtraSlotIds,
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

    // Resolve the tag rem: the focused rem itself if it is used as a tag,
    // otherwise a tag it carries, otherwise its parent if it is a slot.
    let tag = focused;
    let resolvedFrom: string | null = null;

    const isTag = await focused.hasPowerup(BuiltInPowerupCodes.UsedAsTag).catch(() => false);
    if (!isTag) {
      const tags = await focused.getTagRems().catch(() => [] as typeof focused[]);
      const withProps: typeof focused[] = [];
      for (const t of tags) {
        const kids = await t.getChildrenRem();
        for (const k of kids) {
          if (await k.isProperty().catch(() => false)) {
            withProps.push(t);
            break;
          }
        }
      }
      if (withProps.length > 0) {
        tag = withProps[0];
        resolvedFrom = `tag of the focused rem`;
      } else if (await focused.isProperty().catch(() => false)) {
        const parent = await focused.getParentRem();
        if (parent) {
          tag = parent;
          resolvedFrom = `parent of the focused slot`;
        }
      }
    }

    const children = await tag.getChildrenRem();
    const candidates: SlotOption[] = [];
    for (const c of children) {
      if (await c.isProperty().catch(() => false)) {
        candidates.push({ id: c._id, name: richTextToString(c.text) || '[unnamed]' });
      }
    }

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

  const toggle = (side: 'front' | 'back', id: string) => {
    const current = side === 'front' ? front : back;
    const next = current.includes(id)
      ? current.filter((x) => x !== id)
      : [...current, id];
    if (side === 'front') apply(next, back);
    else apply(front, next);
  };

  const move = (side: 'front' | 'back', id: string, delta: number) => {
    const current = [...(side === 'front' ? front : back)];
    const i = current.indexOf(id);
    const j = i + delta;
    if (i < 0 || j < 0 || j >= current.length) return;
    [current[i], current[j]] = [current[j], current[i]];
    if (side === 'front') apply(current, back);
    else apply(front, current);
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

  const nameOf = (id: string) =>
    setup.candidates.find((c) => c.id === id)?.name ?? `[outside this tag: ${id}]`;

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
                  disabled={busy || i === 0}
                  onClick={() => move(side, id, -1)}
                  style={{ ...iconBtn, opacity: i === 0 ? 0.3 : 1 }}
                  title="Move up"
                >
                  ↑
                </button>
                <button
                  disabled={busy || i === selected.length - 1}
                  onClick={() => move(side, id, 1)}
                  style={{ ...iconBtn, opacity: i === selected.length - 1 ? 0.3 : 1 }}
                  title="Move down"
                >
                  ↓
                </button>
                <button
                  disabled={busy}
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
