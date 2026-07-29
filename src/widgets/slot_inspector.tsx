import { useState } from 'react';
import {
  renderWidget,
  usePlugin,
  useRunAsync,
  WidgetLocation,
  BuiltInPowerupCodes,
} from '@remnote/plugin-sdk';

/**
 * Slot Inspector
 *
 * RemNote stores "which extra properties show on the front / back of the card"
 * inside the built-in `Slot` powerup (code "y"), which is applied to the slot
 * (column / property) rem itself:
 *
 *   y.t  SelectTag
 *   y.f  ExtraSlotsOnFrontOfCard
 *   y.b  ExtraSlotsOnBackOfCard
 *
 * `f` / `b` hold rich text made of rem references (i === 'q') pointing at the
 * other slot rems to render. This widget dumps those raw values for a rem and
 * all of its children so we can see where the config lives for table columns
 * that no longer expose a "Configure Cards" menu (e.g. the primary / Name
 * column that generates cloze cards).
 */

const SLOT_POWERUP = 'y';

// The SDK resolves built-in powerup slots via PowerupSlotCodeMap[powerupCode][slot],
// so these methods must be called with the slot *name*, not the one-letter code.
// The code is kept only for display.
const SLOT_DEFS = [
  { name: 'SelectTag', code: 't' },
  { name: 'ExtraSlotsOnFrontOfCard', code: 'f' },
  { name: 'ExtraSlotsOnBackOfCard', code: 'b' },
] as const;

const richTextToString = (text: any[]): string =>
  (text || [])
    .map((n: any) => {
      if (typeof n === 'string') return n;
      if (n?.i === 'q') return `[[${n._id}]]`;
      return n?.text || '';
    })
    .join('');

interface RefInfo {
  id: string;
  name: string;
  found: boolean;
}

interface SlotProbe {
  code: string;
  label: string;
  raw: string | null;
  richText: any[] | null;
  refs: RefInfo[];
  storageRemId: string | null;
  error: string | null;
}

interface RemReport {
  id: string;
  name: string;
  isProperty: boolean;
  isSlot: boolean;
  propertyType: string | null;
  remType: string;
  powerups: string[];
  hasSlotPowerup: boolean;
  probes: SlotProbe[];
  cardCount: number;
  childCount: number;
}

const preStyle: React.CSSProperties = {
  backgroundColor: 'var(--rn-clr-background-secondary)',
  padding: '5px 7px',
  borderRadius: '3px',
  fontSize: '10px',
  fontFamily: 'monospace',
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-all',
  userSelect: 'all',
  margin: 0,
  maxHeight: 180,
  overflowY: 'auto',
};

const label: React.CSSProperties = {
  fontSize: '10px',
  fontWeight: 600,
  textTransform: 'uppercase',
  letterSpacing: '0.06em',
  color: 'var(--rn-clr-content-tertiary)',
  marginBottom: '3px',
};

const chip = (bg: string): React.CSSProperties => ({
  display: 'inline-block',
  padding: '1px 6px',
  borderRadius: 3,
  fontSize: 10,
  fontWeight: 600,
  backgroundColor: bg,
  color: 'white',
  marginRight: 4,
});

function SlotInspector() {
  const plugin = usePlugin();
  const [refreshKey, setRefreshKey] = useState(0);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const ctx = useRunAsync(
    async () => plugin.widget.getWidgetContext<WidgetLocation.Popup>(),
    []
  );
  const remId = ctx?.contextData?.remId as string | undefined;

  const report = useRunAsync(async () => {
    if (!remId) return null;
    const rem = await plugin.rem.findOne(remId);
    if (!rem) return null;

    const resolveRefs = async (richText: any[] | null): Promise<RefInfo[]> => {
      const out: RefInfo[] = [];
      for (const node of richText || []) {
        if (node && typeof node === 'object' && node.i === 'q' && node._id) {
          const target = await plugin.rem.findOne(node._id);
          out.push({
            id: node._id,
            name: target ? richTextToString(target.text || []) || '[unnamed]' : '[NOT FOUND]',
            found: !!target,
          });
        }
      }
      return out;
    };

    const probeSlot = async (r: any, slotName: string, code: string): Promise<SlotProbe> => {
      const probe: SlotProbe = {
        code,
        label: slotName,
        raw: null,
        richText: null,
        refs: [],
        storageRemId: null,
        error: null,
      };
      try {
        probe.raw = await r.getPowerupProperty(SLOT_POWERUP, slotName);
      } catch (e) {
        probe.error = String(e);
      }
      try {
        probe.richText = await r.getPowerupPropertyAsRichText(SLOT_POWERUP, slotName);
        probe.refs = await resolveRefs(probe.richText);
      } catch (e) {
        probe.error = probe.error ?? String(e);
      }
      try {
        const storage = await r.getPowerupPropertyAsRem(SLOT_POWERUP, slotName);
        probe.storageRemId = storage?._id ?? null;
      } catch {
        /* storage rem is optional info */
      }
      return probe;
    };

    const describe = async (r: any): Promise<RemReport> => {
      const powerups: string[] = [];
      for (const [name, code] of Object.entries(BuiltInPowerupCodes)) {
        try {
          if (await r.hasPowerup(code as any)) powerups.push(`${name}(${code})`);
        } catch {
          /* some codes throw on some rem types */
        }
      }

      const hasSlotPowerup = powerups.some((p) => p.endsWith(`(${SLOT_POWERUP})`));

      // Probe unconditionally: the powerup may be absent from hasPowerup while
      // the stored property rem still exists (the case we are hunting).
      const probes = await Promise.all(
        SLOT_DEFS.map((d) => probeSlot(r, d.name, d.code))
      );

      let propertyType: string | null = null;
      try {
        propertyType = (await r.getPropertyType()) ?? null;
      } catch {
        /* not a property */
      }

      let cardCount = 0;
      try {
        cardCount = (await r.getCards()).length;
      } catch {
        /* ignore */
      }

      let remType = '?';
      try {
        const t = await r.getType();
        remType = t === undefined ? `raw:${(r as any).type ?? '?'}` : String(t);
      } catch (e) {
        remType = `error:${String(e)}`;
      }

      return {
        id: r._id,
        name: richTextToString(r.text || []) || '[unnamed]',
        isProperty: await r.isProperty().catch(() => false),
        isSlot: await r.isSlot().catch(() => false),
        propertyType,
        remType,
        powerups,
        hasSlotPowerup,
        probes,
        cardCount,
        childCount: ((r as any).children || []).length,
      };
    };

    const target = await describe(rem);

    // A tag rem can have hundreds of children (rows). Only property children are
    // table columns / slots, and `describe` costs ~50 round trips each, so scan
    // properties only and report how many were skipped.
    const children = await rem.getChildrenRem();
    const propertyChildren: any[] = [];
    for (const c of children) {
      if (await c.isProperty().catch(() => false)) propertyChildren.push(c);
    }

    const childReports: RemReport[] = [];
    for (const c of propertyChildren) {
      childReports.push(await describe(c));
    }

    return {
      target,
      children: childReports,
      skippedChildren: children.length - propertyChildren.length,
    };
  }, [remId, refreshKey]);

  const dumpToConsole = () => {
    console.group('[SlotInspector] Full report');
    console.log(JSON.stringify(report, null, 2));
    console.groupEnd();
    plugin.app.toast('Report logged to browser console (F12).');
  };

  if (!remId) {
    return (
      <div style={{ padding: 16, fontSize: 13, color: 'var(--rn-clr-content-primary)' }}>
        Focus on a rem, then run <strong>Inspect Slot Config</strong>.
      </div>
    );
  }

  if (!report) {
    return (
      <div style={{ padding: 16, fontSize: 13, color: 'var(--rn-clr-content-primary)' }}>
        Loading…
      </div>
    );
  }

  const renderProbe = (p: SlotProbe) => {
    const isEmpty = !p.raw && (!p.richText || p.richText.length === 0);
    return (
      <div key={p.code} style={{ marginBottom: 8 }}>
        <div style={label}>
          y.{p.code} — {p.label}{' '}
          {isEmpty ? (
            <span style={{ color: 'var(--rn-clr-content-tertiary)', fontWeight: 400 }}>(empty)</span>
          ) : (
            <span style={{ color: '#22c55e', fontWeight: 700 }}>● SET</span>
          )}
        </div>
        {!isEmpty && (
          <>
            <pre style={preStyle}>{JSON.stringify(p.richText, null, 1)}</pre>
            {p.refs.length > 0 && (
              <div style={{ fontSize: 11, marginTop: 4 }}>
                <strong>Resolved refs:</strong>{' '}
                {p.refs.map((r) => (
                  <span
                    key={r.id}
                    style={chip(r.found ? '#2563eb' : '#dc2626')}
                    title={r.id}
                  >
                    {r.name}
                  </span>
                ))}
              </div>
            )}
            {p.storageRemId && (
              <div style={{ fontSize: 10, color: 'var(--rn-clr-content-tertiary)', marginTop: 3 }}>
                storage rem: {p.storageRemId}
              </div>
            )}
          </>
        )}
        {p.error && (
          <div style={{ fontSize: 10, color: '#f59e0b', marginTop: 3 }}>error: {p.error}</div>
        )}
      </div>
    );
  };

  const renderRem = (r: RemReport, isTarget: boolean) => {
    const anySet = r.probes.some(
      (p) => p.raw || (p.richText && p.richText.length > 0)
    );
    const open = expanded[r.id] ?? (isTarget || anySet);
    return (
      <div
        key={r.id}
        style={{
          border: `1px solid ${anySet ? '#2563eb' : 'var(--rn-clr-background-tertiary)'}`,
          borderRadius: 6,
          padding: 10,
          marginBottom: 8,
        }}
      >
        <div
          style={{ display: 'flex', alignItems: 'baseline', gap: 8, cursor: 'pointer' }}
          onClick={() => setExpanded((e) => ({ ...e, [r.id]: !open }))}
        >
          <span style={{ fontSize: 11, color: 'var(--rn-clr-content-tertiary)' }}>
            {open ? '▾' : '▸'}
          </span>
          <div style={{ fontWeight: 600, fontSize: 14, flex: 1 }}>{r.name}</div>
          {anySet && <span style={chip('#2563eb')}>card config</span>}
          {r.isProperty && <span style={chip('#6b7280')}>property</span>}
          {r.cardCount > 0 && <span style={chip('#7c3aed')}>{r.cardCount} cards</span>}
        </div>

        {open && (
          <div style={{ marginTop: 8 }}>
            <div style={{ marginBottom: 6 }}>
              <div style={label}>Rem ID</div>
              <pre style={preStyle}>{r.id}</pre>
            </div>
            <div style={{ fontSize: 11, marginBottom: 6, color: 'var(--rn-clr-content-secondary)' }}>
              isProperty={String(r.isProperty)} · isSlot={String(r.isSlot)} · propertyType=
              {r.propertyType ?? '—'} · remType={r.remType} · children={r.childCount}
            </div>
            <div style={{ marginBottom: 8 }}>
              <div style={label}>Powerups</div>
              <pre style={preStyle}>{r.powerups.join('\n') || '(none)'}</pre>
            </div>
            {r.probes.map(renderProbe)}
            <button
              onClick={async () => {
                const rr = await plugin.rem.findOne(r.id);
                if (rr) await plugin.window.openRem(rr);
              }}
              style={{
                padding: '3px 10px',
                backgroundColor: 'transparent',
                color: 'var(--rn-clr-content-primary)',
                border: '1px solid var(--rn-clr-background-tertiary)',
                borderRadius: 4,
                cursor: 'pointer',
                fontSize: 11,
                fontWeight: 600,
              }}
            >
              Open Rem
            </button>
          </div>
        )}
      </div>
    );
  };

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
          paddingBottom: 6,
          display: 'flex',
          alignItems: 'baseline',
          gap: 8,
        }}
      >
        <span style={{ fontSize: 15, fontWeight: 700 }}>Slot Inspector</span>
        <span style={{ fontSize: 11, color: 'var(--rn-clr-content-tertiary)' }}>
          powerup "y" · front=f · back=b
        </span>
      </div>

      <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
        <button
          onClick={() => setRefreshKey((k) => k + 1)}
          style={{
            padding: '3px 10px',
            backgroundColor: 'transparent',
            color: 'var(--rn-clr-content-primary)',
            border: '1px solid var(--rn-clr-background-tertiary)',
            borderRadius: 4,
            cursor: 'pointer',
            fontSize: 11,
            fontWeight: 600,
          }}
        >
          Refresh
        </button>
        <button
          onClick={dumpToConsole}
          style={{
            padding: '3px 10px',
            backgroundColor: 'transparent',
            color: 'var(--rn-clr-content-primary)',
            border: '1px solid var(--rn-clr-background-tertiary)',
            borderRadius: 4,
            cursor: 'pointer',
            fontSize: 11,
            fontWeight: 600,
          }}
        >
          Dump JSON to console
        </button>
      </div>

      <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8 }}>Target rem</div>
      {renderRem(report.target, true)}

      <div style={{ fontSize: 13, fontWeight: 700, margin: '16px 0 8px' }}>
        Property children ({report.children.length}) — table columns / slots live here
        {report.skippedChildren > 0 && (
          <span
            style={{
              fontWeight: 400,
              fontSize: 11,
              color: 'var(--rn-clr-content-tertiary)',
              marginLeft: 6,
            }}
          >
            · {report.skippedChildren} non-property children skipped
          </span>
        )}
      </div>
      {report.children.length === 0 ? (
        <div style={{ fontSize: 12, color: 'var(--rn-clr-content-tertiary)' }}>No children.</div>
      ) : (
        report.children.map((c) => renderRem(c, false))
      )}
    </div>
  );
}

renderWidget(SlotInspector);
