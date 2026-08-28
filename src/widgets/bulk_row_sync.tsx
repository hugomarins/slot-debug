import { useState } from 'react';
import {
  renderWidget,
  usePlugin,
  useRunAsync,
  WidgetLocation,
} from '@remnote/plugin-sdk';
import {
  resolveTagRem,
  getColumnSlots,
  planRowSync,
  applyRowSync,
  applyColumnOrder,
  applyValueOrder,
  RowSyncPlan,
  BULK_ORDER_BACKUP_KEY,
  BulkOrderBackup,
  richTextToString,
} from '../lib/slotConfig';

/**
 * Confirmation surface for the two bulk row-order commands.
 *
 * These used to ask with `window.confirm` from the plugin's index frame. That
 * call is inert inside RemNote's sandboxed plugin iframe — no dialog is shown
 * and the return value is truthy — so both commands went straight from the dry
 * run to rewriting every row. A command has no UI of its own, so the only place
 * a real question can be asked is a widget: the commands now open this popup,
 * and the scan/confirm/apply sequence lives here.
 */

type Op = 'sync' | 'undo';

interface SyncScan {
  op: 'sync';
  tagId: string;
  tagName: string;
  columnNames: string[];
  targetColumnIds: string[];
  plans: RowSyncPlan[];
  totalRows: number;
  discardsUndo: BulkOrderBackup | null;
}

interface UndoScan {
  op: 'undo';
  backup: BulkOrderBackup;
}

type Scan = SyncScan | UndoScan | { op: 'none'; message: string };

const btn: React.CSSProperties = {
  padding: '4px 12px',
  backgroundColor: 'transparent',
  color: 'var(--rn-clr-content-primary)',
  border: '1px solid var(--rn-clr-background-tertiary)',
  borderRadius: 4,
  cursor: 'pointer',
  fontSize: 12,
  fontWeight: 600,
};

function BulkRowSync() {
  const plugin = usePlugin();

  const ctx = useRunAsync(
    async () => plugin.widget.getWidgetContext<WidgetLocation.Popup>(),
    []
  );
  const op = ctx?.contextData?.op as Op | undefined;
  const remId = ctx?.contextData?.remId as string | undefined;

  const [progress, setProgress] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);

  // Read-only. Nothing below this point writes until a button is pressed.
  const scan = useRunAsync<Scan | null>(async () => {
    if (!op) return null;

    if (op === 'undo') {
      const backup = await plugin.storage.getLocal<BulkOrderBackup>(BULK_ORDER_BACKUP_KEY);
      if (!backup) return { op: 'none', message: 'No row order sync to undo.' };
      return { op: 'undo', backup };
    }

    if (!remId) return { op: 'none', message: 'Focus the tag rem (or any row of its table) first.' };
    const focused = await plugin.rem.findOne(remId);
    if (!focused) return { op: 'none', message: 'That rem no longer exists.' };

    const discardsUndo =
      (await plugin.storage.getLocal<BulkOrderBackup>(BULK_ORDER_BACKUP_KEY)) ?? null;
    if (discardsUndo) {
      console.warn(
        '[RowOrderSync] Proceeding will discard the undo for this earlier sync:',
        discardsUndo
      );
    }

    const { tag } = await resolveTagRem(plugin, focused);
    const tagName = richTextToString(tag.text) || '[unnamed]';
    const columns = await getColumnSlots(tag);
    const targetColumnIds = columns.map((c) => c._id);
    const { plans, totalRows } = await planRowSync(tag, columns, targetColumnIds);

    console.group(`[RowOrderSync] Tag "${tagName}" (${tag._id}) — DRY RUN, nothing written`);
    console.log('Column order:', columns.map((c) => richTextToString(c.text)).join(', '));
    console.log(`${plans.length} of ${totalRows} rows would change.`);
    plans.slice(0, 10).forEach((p) => {
      console.log(`  "${p.name.slice(0, 60)}"`);
      console.log(`     from: ${p.from.join(', ')}`);
    });
    if (plans.length > 10) console.log(`  …and ${plans.length - 10} more.`);
    console.log('Waiting for confirmation in the popup.');
    console.groupEnd();

    if (plans.length === 0) {
      return { op: 'none', message: 'All rows already match the column order.' };
    }

    return {
      op: 'sync',
      tagId: tag._id,
      tagName,
      columnNames: columns.map((c) => richTextToString(c.text) || '[unnamed]'),
      targetColumnIds,
      plans,
      totalRows,
      discardsUndo,
    };
  }, [op, remId]);

  const runSync = async (s: SyncScan) => {
    setProgress(`Rewriting rows… 0/${s.plans.length}`);
    try {
      // Snapshot before the first write so an interrupted run is still undoable.
      await plugin.storage.setLocal(BULK_ORDER_BACKUP_KEY, {
        tagId: s.tagId,
        tagName: s.tagName,
        rows: s.plans.map((p) => ({ rowId: p.rowId, originalOrder: p.originalOrder })),
        timestamp: Date.now(),
      } as BulkOrderBackup);
      console.log(`[RowOrderSync] Snapshot stored for ${s.plans.length} rows.`);

      const { done, failed } = await applyRowSync(plugin, s.plans, (completed, total) => {
        setProgress(`Rewriting rows… ${completed}/${total}`);
      });

      console.log(`[RowOrderSync] Done. ${done} rows reordered, ${failed} failed.`);
      setProgress(null);
      setResult(
        failed === 0
          ? `Reordered ${done} rows. Check your cards; "Undo Row Order Sync" reverts.`
          : `Reordered ${done} rows, ${failed} failed — see console.`
      );
    } catch (e) {
      console.error('[RowOrderSync] Sync failed:', e);
      setProgress(null);
      setResult('Sync failed — see console.');
    }
  };

  const runUndo = async (backup: BulkOrderBackup) => {
    setProgress('Restoring…');
    try {
      // Columns first: rows are restored to explicit id sequences, so their
      // result does not depend on column order either way.
      let columnsRestored = true;
      if (backup.originalColumnOrder) {
        const tag = await plugin.rem.findOne(backup.tagId);
        if (!tag) {
          columnsRestored = false;
          console.error('[RowOrderSync] Tag rem not found — cannot restore column order.');
        } else {
          try {
            const r = await applyColumnOrder(plugin, tag, backup.originalColumnOrder);
            columnsRestored = r.matched;
            console.log(
              `[RowOrderSync] Column order restored in ${r.swaps} swap(s) — ` +
              (r.matched ? 'matches the original.' : 'DOES NOT match the original.')
            );
          } catch (e) {
            columnsRestored = false;
            console.error('[RowOrderSync] Column order restore failed:', e);
          }
        }
      }

      let done = 0;
      let failed = 0;
      for (const entry of backup.rows) {
        const row = await plugin.rem.findOne(entry.rowId);
        if (!row) {
          failed++;
          console.warn(`[RowOrderSync] Row ${entry.rowId} no longer exists — skipped.`);
        } else {
          try {
            await applyValueOrder(plugin, row, entry.originalOrder);
            done++;
          } catch (e) {
            failed++;
            console.error(`[RowOrderSync] Row ${entry.rowId} restore failed:`, e);
          }
        }
        setProgress(`Restoring… ${done + failed}/${backup.rows.length}`);
      }

      if (failed === 0 && columnsRestored) {
        await plugin.storage.setLocal(BULK_ORDER_BACKUP_KEY, undefined);
        console.log('[RowOrderSync] Backup cleared.');
      } else {
        console.warn(
          '[RowOrderSync] Backup KEPT because ' +
          (failed > 0 ? 'some rows failed' : 'the column order was not fully restored') + '.'
        );
      }

      setProgress(null);
      setResult(
        failed === 0
          ? `Restored ${done} rows.`
          : `Restored ${done} rows, ${failed} failed — backup kept, see console.`
      );
    } catch (e) {
      console.error('[RowOrderSync] Undo failed:', e);
      setProgress(null);
      setResult('Undo failed — see console.');
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

  if (!scan) return shell('Scanning… nothing has been written.');
  if (progress) return shell(<strong>{progress}</strong>);
  if (result) return shell(result);
  if (scan.op === 'none') return shell(scan.message);

  if (scan.op === 'undo') {
    const b = scan.backup;
    return shell(
      <>
        <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 8 }}>
          Undo the row order sync?
        </div>
        <div style={{ marginBottom: 8 }}>
          <div>
            <strong>Table:</strong> "{b.tagName}"
          </div>
          <div>
            <strong>Rows to restore:</strong> {b.rows.length}
          </div>
          <div>
            <strong>Table columns:</strong>{' '}
            {b.originalColumnOrder ? 'will also be restored.' : 'were not changed.'}
          </div>
          <div>
            <strong>Synced:</strong> {new Date(b.timestamp).toLocaleString()}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          <button
            onClick={() => runUndo(b)}
            style={{ ...btn, backgroundColor: '#7c3aed', color: 'white', border: 'none' }}
          >
            Restore {b.rows.length} rows
          </button>
          <button onClick={() => plugin.widget.closePopup()} style={btn}>
            Cancel
          </button>
        </div>
      </>
    );
  }

  return shell(
    <>
      {scan.discardsUndo && (
        <div style={{ color: '#b45309', fontWeight: 600, marginBottom: 10 }}>
          ⚠️ This makes an earlier reordering permanent. "{scan.discardsUndo.tagName}" was
          reordered ({scan.discardsUndo.rows.length} rows
          {scan.discardsUndo.originalColumnOrder ? ' and its columns' : ''}) on{' '}
          {new Date(scan.discardsUndo.timestamp).toLocaleString()} and never undone. Only one
          undo is stored, so proceeding replaces it and that earlier change can no longer be
          reverted. Its details are in the console.
        </div>
      )}

      <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 8 }}>
        Sync row property order to column order?
      </div>

      <div style={{ marginBottom: 8 }}>
        <div>
          <strong>Tag:</strong> "{scan.tagName}"
        </div>
        <div>
          <strong>Rows to change:</strong> {scan.plans.length} of {scan.totalRows}
        </div>
        <div>
          <strong>Target order:</strong> {scan.columnNames.join(', ')}
        </div>
      </div>

      <div style={{ color: 'var(--rn-clr-content-tertiary)', marginBottom: 10 }}>
        This moves property-value rems that RemNote maintains itself, on every affected row.{' '}
        <strong>Back up your knowledge base first.</strong> Undo with "Undo Row Order Sync".
      </div>

      <div style={{ display: 'flex', gap: 6 }}>
        <button
          onClick={() => runSync(scan)}
          style={{ ...btn, backgroundColor: '#b45309', color: 'white', border: 'none' }}
        >
          Rewrite {scan.plans.length} rows
        </button>
        <button onClick={() => plugin.widget.closePopup()} style={btn}>
          Cancel
        </button>
      </div>
    </>
  );
}

renderWidget(BulkRowSync);
