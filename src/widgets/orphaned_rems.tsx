import { useState } from 'react';
import {
  renderWidget,
  usePlugin,
  useRunAsync,
  WidgetLocation,
} from '@remnote/plugin-sdk';

const richTextToString = (text: any[]): string =>
  (text || []).map((n: any) => (typeof n === 'string' ? n : n?.text || '')).join('');

interface OrphanedRem {
  id: string;
  instanceId: string;
  instanceName: string;
  backText: string;
}

const thStyle: React.CSSProperties = {
  padding: '5px 10px',
  textAlign: 'left',
  fontSize: 10,
  fontWeight: 600,
  textTransform: 'uppercase',
  letterSpacing: '0.06em',
  color: 'var(--rn-clr-content-tertiary)',
  borderBottom: '2px solid var(--rn-clr-background-tertiary)',
  whiteSpace: 'nowrap',
};

const tdStyle: React.CSSProperties = {
  padding: '5px 10px',
  verticalAlign: 'top',
  borderBottom: '1px solid var(--rn-clr-background-secondary)',
};

function OrphanedRems() {
  const plugin = usePlugin();
  const [refreshKey, setRefreshKey] = useState(0);
  const [deleting, setDeleting] = useState(false);
  const [deletedCount, setDeletedCount] = useState<number | null>(null);

  const ctx = useRunAsync(
    async () => plugin.widget.getWidgetContext<WidgetLocation.Popup>(),
    []
  );
  const remId = ctx?.contextData?.remId as string | undefined;
  const tagName = ctx?.contextData?.tagName as string | undefined;

  const orphans = useRunAsync<OrphanedRem[] | null>(async () => {
    if (!remId) return null;

    console.log(`[OrphanedRems] Scanning tag "${tagName}" (${remId}) for orphaned rems…`);
    const tagRem = await plugin.rem.findOne(remId);
    if (!tagRem) {
      console.error('[OrphanedRems] Tag rem not found:', remId);
      return null;
    }

    const taggedRems = await tagRem.taggedRem();
    console.log(`[OrphanedRems] ${taggedRems.length} tagged rems found. Scanning children in parallel…`);

    // A front is truly empty only when every node is a plain string trimming to "".
    // Object nodes (references, powerup slot links) must count as non-empty —
    // richTextToString() silently converts them to "" causing false positives.
    const isTrulyEmptyFront = (nodes: any[]): boolean =>
      nodes.length === 0 || nodes.every((n: any) =>
        typeof n === 'string' ? n.trim() === '' : false
      );

    const perInstance = await Promise.all(
      taggedRems.map(async (r) => {
        const instanceName = richTextToString(r.text || []) || '[unnamed]';
        const children = await r.getChildrenRem();
        const found: OrphanedRem[] = [];
        for (const c of children) {
          const back = richTextToString((c as any).backText || []).trim();
          if (isTrulyEmptyFront(c.text || []) && back !== '') {
            found.push({ id: c._id, instanceId: r._id, instanceName, backText: back });
          }
        }
        if (found.length > 0) {
          console.log(`[OrphanedRems]   "${instanceName}" (${r._id}): ${found.length} orphan(s)`);
        }
        return found;
      })
    );

    const all = perInstance.flat();
    const instancesAffected = perInstance.filter(g => g.length > 0).length;
    console.log(`[OrphanedRems] Scan complete: ${all.length} orphaned rem(s) across ${instancesAffected} instance(s).`);
    return all;
  }, [remId, refreshKey]);

  const handleDeleteAll = async () => {
    if (!orphans || orphans.length === 0) return;
    const confirmed = window.confirm(
      `⚠️ DANGER — Delete Orphaned Rems\n\n` +
      `This will permanently delete ${orphans.length} orphaned rem(s)\n` +
      `across ${new Set(orphans.map(o => o.instanceId)).size} instance(s).\n\n` +
      `Criteria: empty front + non-empty back.\n\n` +
      `MAKE A BACKUP FIRST. This is IRREVERSIBLE.\n\nProceed?`
    );
    if (!confirmed) {
      console.log('[OrphanedRems] Deletion cancelled by user.');
      return;
    }

    console.log(`[OrphanedRems] Starting deletion of ${orphans.length} orphaned rems…`);
    setDeleting(true);
    let count = 0;
    for (const orphan of orphans) {
      const rem = await plugin.rem.findOne(orphan.id);
      if (rem) {
        try {
          await rem.remove();
          count++;
          console.log(`[OrphanedRems] Deleted rem ${orphan.id} from instance "${orphan.instanceName}" (${count}/${orphans.length})`);
        } catch (e) {
          console.error(`[OrphanedRems] Failed to delete rem ${orphan.id}:`, e);
        }
      } else {
        console.warn(`[OrphanedRems] Rem ${orphan.id} not found — may already be deleted.`);
      }
    }
    const msg = `Deleted ${count} of ${orphans.length} orphaned rem(s).`;
    console.log('[OrphanedRems]', msg);
    await plugin.app.toast(msg);
    setDeletedCount(count);
    setDeleting(false);
    setRefreshKey(k => k + 1);
  };

  if (!remId) {
    return (
      <div style={{ padding: 16, fontSize: 13, color: 'var(--rn-clr-content-primary)' }}>
        No tag context. Open this via the Tag Slot Debugger.
      </div>
    );
  }

  if (!orphans) {
    return (
      <div style={{ padding: 16, fontSize: 13, color: 'var(--rn-clr-content-primary)' }}>
        Scanning {tagName ? `"${tagName}"` : 'tag'} for orphaned rems…
      </div>
    );
  }

  return (
    <div style={{ padding: 16, fontFamily: 'system-ui, -apple-system, sans-serif', color: 'var(--rn-clr-content-primary)', maxHeight: '90vh', overflowY: 'auto' }}>

      {/* Header */}
      <div style={{ borderBottom: '1px solid var(--rn-clr-background-tertiary)', marginBottom: 12, paddingBottom: 6, display: 'flex', alignItems: 'baseline', gap: 10 }}>
        <span style={{ fontSize: 15, fontWeight: 700 }}>Orphaned Rems</span>
        {tagName && (
          <span style={{ fontSize: 12, color: 'var(--rn-clr-content-tertiary)' }}>tag: {tagName}</span>
        )}
      </div>

      {/* Summary + delete button */}
      <div style={{ marginBottom: 14, display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
        <div style={{ fontSize: 13 }}>
          <strong>{orphans.length}</strong> orphaned rem(s) found —{' '}
          <span style={{ color: 'var(--rn-clr-content-tertiary)', fontSize: 11 }}>
            empty front + non-empty back
          </span>
        </div>

        {deletedCount !== null ? (
          <div style={{ fontSize: 12, color: '#22c55e', fontWeight: 600 }}>
            ✓ Deleted — {deletedCount} rem(s) removed.
          </div>
        ) : (
          <button
            disabled={deleting || orphans.length === 0}
            onClick={handleDeleteAll}
            style={{
              padding: '4px 14px',
              backgroundColor: orphans.length === 0 ? '#374151' : '#dc2626',
              color: 'white',
              border: 'none',
              borderRadius: 4,
              cursor: (deleting || orphans.length === 0) ? 'default' : 'pointer',
              fontSize: 12,
              fontWeight: 600,
              opacity: deleting ? 0.6 : 1,
            }}
          >
            {deleting ? 'Deleting…' : `Delete All ${orphans.length} Orphaned Rem(s)`}
          </button>
        )}
      </div>

      {/* Table */}
      {orphans.length === 0 ? (
        <div style={{ fontSize: 12, color: 'var(--rn-clr-content-tertiary)' }}>
          No orphaned rems found. Nothing to delete.
        </div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr>
                <th style={{ ...thStyle, width: '22%' }}>Instance</th>
                <th style={{ ...thStyle, width: '20%' }}>Rem ID</th>
                <th style={{ ...thStyle }}>Back Text</th>
              </tr>
            </thead>
            <tbody>
              {orphans.map((o, i) => (
                <tr
                  key={o.id}
                  style={{ backgroundColor: i % 2 === 0 ? 'transparent' : 'var(--rn-clr-background-secondary)' }}
                >
                  <td style={{ ...tdStyle, fontWeight: 600 }}>{o.instanceName}</td>
                  <td style={{ ...tdStyle, fontFamily: 'monospace', fontSize: 10, color: 'var(--rn-clr-content-tertiary)', wordBreak: 'break-all' }}>{o.id}</td>
                  <td style={{ ...tdStyle, color: 'var(--rn-clr-content-secondary)' }}>{o.backText}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div style={{ marginTop: 14, padding: 8, backgroundColor: 'var(--rn-clr-background-secondary)', borderRadius: 4, fontSize: 11, color: 'var(--rn-clr-content-tertiary)' }}>
        ⚠️ Back up your knowledge base before deleting. Disable this plugin when not in use.
      </div>
    </div>
  );
}

renderWidget(OrphanedRems);
