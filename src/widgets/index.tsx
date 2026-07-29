import {
	declareIndexPlugin,
	ReactRNPlugin,
	WidgetLocation,
	BuiltInPowerupCodes,
} from "@remnote/plugin-sdk";
import "../style.css";
import {
	resolveTagRem,
	getColumnSlots,
	getColumnPositions,
	swapSiblingPositions,
	applyColumnOrder,
	getRowValueOrder,
	applyValueOrder,
	planRowSync,
	applyRowSync,
	BULK_ORDER_BACKUP_KEY,
	BulkOrderBackup,
	readExtraSlotIds,
	describeSlotIds,
	FRONT_SLOT,
	BACK_SLOT,
	richTextToString as slotRichTextToString,
} from "../lib/slotConfig";

const ROW_ORDER_BACKUP_KEY = 'rowOrderProbeBackup';
const COLUMN_ORDER_BACKUP_KEY = 'columnOrderProbeBackup';

interface ColumnOrderBackup {
	tagId: string;
	tagName: string;
	aId: string;
	aName: string;
	bId: string;
	bName: string;
	/** Absolute positions among the tag's children, before the swap. */
	aPos: number | null;
	bPos: number | null;
	timestamp: number;
}

interface RowOrderBackup {
	rowId: string;
	rowName: string;
	/** Value rem ids in their original order, index = original position. */
	originalOrder: string[];
	timestamp: number;
}

const richTextToString = (text: any[]): string =>
  (text || []).map((n: any) => (typeof n === 'string' ? n : n?.text || '')).join('');

async function onActivate(plugin: ReactRNPlugin) {
	plugin.app.registerWidget('tag_debug', WidgetLocation.Popup, {
		dimensions: { width: '500px', height: 900 },
	});

	plugin.app.registerWidget('orphaned_rems', WidgetLocation.Popup, {
		dimensions: { width: '860px', height: 700 },
	});

	plugin.app.registerWidget('slot_inspector', WidgetLocation.Popup, {
		dimensions: { width: '640px', height: 900 },
	});

	await plugin.app.registerCommand({
		id: 'inspect-slot-config',
		name: 'Inspect Slot Config (Cards)',
		description:
			'Dump the Slot powerup ("y") card config — ExtraSlotsOnFront/BackOfCard — for the focused rem and its children.',
		quickCode: 'isc',
		action: async () => {
			const rem = await plugin.focus.getFocusedRem();
			if (!rem) {
				await plugin.app.toast('Focus on a rem first.');
				return;
			}
			await plugin.widget.openPopup('slot_inspector', { remId: rem._id });
		},
	});

	plugin.app.registerWidget('card_slot_config', WidgetLocation.Popup, {
		dimensions: { width: '520px', height: 700 },
	});

	await plugin.app.registerCommand({
		id: 'configure-card-extras',
		name: 'Configure Card Extras',
		description:
			'Choose which properties show on the front/back of a table\'s cards — including the primary/cloze card, whose menu RemNote removed.',
		quickCode: 'cce',
		action: async () => {
			const rem = await plugin.focus.getFocusedRem();
			if (!rem) {
				await plugin.app.toast('Focus a tag rem (or a rem tagged with it) first.');
				return;
			}
			await plugin.widget.openPopup('card_slot_config', { remId: rem._id });
		},
	});


	// --- Row value-order probe -------------------------------------------
	// Cards render extras in the order of the ROW's property-value rems. To see
	// whether that order is causal rather than merely correlated, swap two slots
	// that the card actually renders — same side, both non-empty — so the card
	// must visibly flip if the order drives rendering.
	//
	// Sorting the whole row to column order is NOT a valid test: it can permute
	// only blank or unconfigured slots and leave every rendered slot's relative
	// order intact, which looks like a negative result but proves nothing.
	await plugin.app.registerCommand({
		id: 'probe-reorder-row-values',
		name: 'PROBE: Swap Two Rendered Extras On Row',
		description:
			'Reversible — swaps two non-empty, configured extras on one row to test whether card render order follows the row\'s value order.',
		quickCode: 'prv',
		action: async () => {
			const row = await plugin.focus.getFocusedRem();
			if (!row) {
				await plugin.app.toast('Focus a table ROW first.');
				return;
			}

			const rowName = slotRichTextToString(row.text) || '[unnamed]';
			console.group(`[RowOrderProbe] Row "${rowName}" (${row._id})`);

			const pending = await plugin.storage.getLocal<RowOrderBackup>(ROW_ORDER_BACKUP_KEY);
			if (pending) {
				console.warn('[RowOrderProbe] A previous backup is still pending:', pending);
				console.groupEnd();
				await plugin.app.toast(
					`Row "${pending.rowName}" is not restored yet. Run "PROBE: Restore Row Value Order" first.`
				);
				return;
			}

			const { tag } = await resolveTagRem(plugin, row);
			const tagsOfRow = await row.getTagRems().catch(() => []);
			if (tag._id === row._id || !tagsOfRow.some((t) => t._id === tag._id)) {
				console.warn('[RowOrderProbe] Focused rem is not a row of a table tag.');
				console.groupEnd();
				await plugin.app.toast('That rem is not a table row — focus a row.');
				return;
			}

			const columns = await getColumnSlots(tag);
			const current = await getRowValueOrder(row, columns);
			const front = await readExtraSlotIds(tag, FRONT_SLOT);
			const back = await readExtraSlotIds(tag, BACK_SLOT);

			console.log('Column order:', columns.map((c) => slotRichTextToString(c.text)).join(', '));
			console.log(
				'Current value order:',
				current.map((e) => `${e.slotName}@${e.position}${e.hasValue ? '' : ' (empty)'}`).join(', ')
			);
			console.log('Card front config:', await describeSlotIds(plugin, front));
			console.log('Card back config: ', await describeSlotIds(plugin, back));

			// Only slots on the same side, both non-empty, are observable. A slot
			// on the front is suppressed on the back, so front wins.
			const eligibleOn = (side: string[]) =>
				current.filter((e) => e.hasValue && side.includes(e.slotId));
			const frontEligible = eligibleOn(front);
			const backEligible = eligibleOn(back).filter((e) => !front.includes(e.slotId));

			const [side, pair] =
				frontEligible.length >= 2
					? ['front', frontEligible.slice(0, 2)]
					: backEligible.length >= 2
						? ['back', backEligible.slice(0, 2)]
						: ['none', []];

			if (pair.length < 2) {
				console.warn(
					'[RowOrderProbe] Need two non-empty slots configured on the SAME side of the card. ' +
					`Front eligible: ${frontEligible.length}, back eligible: ${backEligible.length}.`
				);
				console.groupEnd();
				await plugin.app.toast(
					'Need two non-empty extras on the same side of the card — see console.'
				);
				return;
			}

			const [a, b] = pair;
			console.log(
				`Swapping on the ${side}: "${a.slotName}"@${a.position} <-> "${b.slotName}"@${b.position}`
			);
			console.log(
				`  Card currently renders "${a.slotName}" before "${b.slotName}" on the ${side}.`
			);
			console.log(
				`  If the row's value order drives rendering, it should flip to "${b.slotName}" then "${a.slotName}".`
			);

			const swapped = current.map((e) =>
				e.valueRemId === a.valueRemId ? b : e.valueRemId === b.valueRemId ? a : e
			);

			const confirmed = window.confirm(
				`Swap two rendered extras on this row?\n\n"${rowName}"\n${row._id}\n\n` +
				`Side: ${side} of card\n` +
				`Swap: "${a.slotName}" <-> "${b.slotName}"\n\n` +
				`from: ${current.map((e) => e.slotName).join(', ')}\n` +
				`to:   ${swapped.map((e) => e.slotName).join(', ')}\n\n` +
				`This moves rems that RemNote maintains itself. BACK UP FIRST.\n` +
				`Undo with "PROBE: Restore Row Value Order".\n\nProceed?`
			);
			if (!confirmed) {
				console.log('Cancelled by user.');
				console.groupEnd();
				return;
			}

			await plugin.storage.setLocal(ROW_ORDER_BACKUP_KEY, {
				rowId: row._id,
				rowName,
				originalOrder: current.map((e) => e.valueRemId),
				timestamp: Date.now(),
			} as RowOrderBackup);

			try {
				await applyValueOrder(plugin, row, swapped.map((e) => e.valueRemId));
			} catch (e) {
				console.error('[RowOrderProbe] Swap FAILED — backup kept:', e);
				console.groupEnd();
				await plugin.app.toast('Swap failed — backup kept, see console.');
				return;
			}

			const after = await getRowValueOrder(row, columns);
			const ok = after.every((e, i) => e.valueRemId === swapped[i]?.valueRemId);
			console.log('Value order now:', after.map((e) => `${e.slotName}@${e.position}`).join(', '));
			console.log(ok ? '✓ Swap took effect in the data.' : '✗ Data did not end up swapped.');
			console.log(
				`Now open a card for this row. Expect the ${side} to read ` +
				`"${b.slotName}" then "${a.slotName}".`
			);
			console.groupEnd();

			await plugin.app.toast(
				ok
					? `Swapped ${a.slotName} <-> ${b.slotName} on the ${side}. Check a card, then run "PROBE: Restore Row Value Order".`
					: 'Swap did not read back as requested — see console.'
			);
		},
	});

	await plugin.app.registerCommand({
		id: 'probe-restore-row-values',
		name: 'PROBE: Restore Row Value Order',
		description: 'Undo the last "PROBE: Reorder Row Values To Column Order".',
		quickCode: 'prr',
		action: async () => {
			const backup = await plugin.storage.getLocal<RowOrderBackup>(ROW_ORDER_BACKUP_KEY);
			if (!backup) {
				await plugin.app.toast('No pending row reorder to restore.');
				return;
			}

			console.group(`[RowOrderProbe] Restoring "${backup.rowName}" (${backup.rowId})`);
			const row = await plugin.rem.findOne(backup.rowId);
			if (!row) {
				console.error('[RowOrderProbe] Row no longer exists — backup kept.');
				console.groupEnd();
				await plugin.app.toast('Row not found — backup kept, see console.');
				return;
			}

			try {
				await applyValueOrder(plugin, row, backup.originalOrder);
			} catch (e) {
				console.error('[RowOrderProbe] Restore FAILED — backup kept:', e);
				console.groupEnd();
				await plugin.app.toast('Restore failed — backup kept, see console.');
				return;
			}

			const { tag } = await resolveTagRem(plugin, row);
			const after = await getRowValueOrder(row, await getColumnSlots(tag));
			const ok = backup.originalOrder.every((id, i) => after[i]?.valueRemId === id);
			console.log('Value order now:', after.map((e) => `${e.slotName}@${e.position}`).join(', '));
			console.log(ok ? '✓ Restored to the original order.' : '✗ Restore MISMATCH — backup kept.');
			console.groupEnd();

			if (ok) await plugin.storage.setLocal(ROW_ORDER_BACKUP_KEY, undefined);
			await plugin.app.toast(
				ok ? `Restored "${backup.rowName}".` : 'Restore mismatch — backup kept, see console.'
			);
		},
	});

	// --- Column-order probe ----------------------------------------------
	// Column order governs rows created later, so reordering columns is the other
	// half of controlling card extras order. But columns are slot rems interleaved
	// among every row of the table, so moving one means an absolute sibling index,
	// not an index into the column list. This probe swaps two adjacent columns and
	// checks four things:
	//   1. the absolute positions we read are sane,
	//   2. setParent's insert semantics actually produce a swap,
	//   3. the column list order changes,
	//   4. existing rows' value order is NOT disturbed.
	await plugin.app.registerCommand({
		id: 'probe-swap-columns',
		name: 'PROBE: Swap Two Table Columns',
		description:
			'Reversible — swaps two adjacent table columns to test whether column reordering is safe from a plugin.',
		quickCode: 'pcs',
		action: async () => {
			const focused = await plugin.focus.getFocusedRem();
			if (!focused) {
				await plugin.app.toast('Focus the tag rem (or any row of its table) first.');
				return;
			}

			const pending = await plugin.storage.getLocal<ColumnOrderBackup>(COLUMN_ORDER_BACKUP_KEY);
			if (pending) {
				console.warn('[ColumnOrderProbe] A previous backup is still pending:', pending);
				await plugin.app.toast(
					`Columns of "${pending.tagName}" are still swapped. Run "PROBE: Restore Column Order" first.`
				);
				return;
			}

			const { tag } = await resolveTagRem(plugin, focused);
			const tagName = slotRichTextToString(tag.text) || '[unnamed]';
			console.group(`[ColumnOrderProbe] Tag "${tagName}" (${tag._id})`);

			const columns = await getColumnSlots(tag);
			if (columns.length < 2) {
				console.warn('[ColumnOrderProbe] Need at least two columns.');
				console.groupEnd();
				await plugin.app.toast('This table has fewer than two columns.');
				return;
			}

			const positions = await getColumnPositions(columns);
			console.log('Column order (filtered list):', positions.map((p) => p.name).join(', '));
			console.log('Absolute positions among the tag\'s children:');
			positions.forEach((p) => console.log(`  ${p.name}: ${p.position}`));
			console.log(`Tag has ${((tag as any).children || []).length} children in total.`);

			const [a, b] = positions;
			if (a.position === null || b.position === null) {
				console.error('[ColumnOrderProbe] Could not read absolute positions — aborting.');
				console.groupEnd();
				await plugin.app.toast('Could not read column positions — see console.');
				return;
			}

			// Sample one row so we can prove rows are untouched by a column move.
			const rows = await tag.taggedRem();
			let sampleRowId: string | null = null;
			let sampleBefore: string[] = [];
			for (const row of rows) {
				const order = await getRowValueOrder(row, columns);
				if (order.length >= 2) {
					sampleRowId = row._id;
					sampleBefore = order.map((e) => e.slotName);
					break;
				}
			}
			if (sampleRowId) {
				console.log(`Sample row ${sampleRowId} value order BEFORE: ${sampleBefore.join(', ')}`);
			} else {
				console.warn('No row with two or more values found — cannot check row side effects.');
			}

			const confirmed = window.confirm(
				`Swap two table columns?\n\n` +
				`Tag: "${tagName}"\n` +
				`Swap: "${a.name}" (pos ${a.position}) <-> "${b.name}" (pos ${b.position})\n\n` +
				`This moves slot rems among the tag's ${((tag as any).children || []).length} children. ` +
				`It changes your TABLE LAYOUT, and should not affect existing rows.\n\n` +
				`BACK UP FIRST. Undo with "PROBE: Restore Column Order".\n\nProceed?`
			);
			if (!confirmed) {
				console.log('Cancelled by user — nothing was written.');
				console.groupEnd();
				return;
			}

			await plugin.storage.setLocal(COLUMN_ORDER_BACKUP_KEY, {
				tagId: tag._id,
				tagName,
				aId: a.id,
				aName: a.name,
				bId: b.id,
				bName: b.name,
				aPos: a.position,
				bPos: b.position,
				timestamp: Date.now(),
			} as ColumnOrderBackup);

			try {
				const { before, after } = await swapSiblingPositions(plugin, tag, a.id, b.id);
				console.log('Positions before:', before);
				console.log('Positions after: ', after);
				const swappedCleanly = after[a.id] === before[b.id] && after[b.id] === before[a.id];
				console.log(
					swappedCleanly
						? '✓ Absolute positions swapped exactly as intended.'
						: '⚠️ Positions are not an exact swap — setParent inserts differently than assumed.'
				);
			} catch (e) {
				console.error('[ColumnOrderProbe] Swap FAILED — backup kept:', e);
				console.groupEnd();
				await plugin.app.toast('Swap failed — backup kept, see console.');
				return;
			}

			const afterColumns = await getColumnSlots(tag);
			const afterPositions = await getColumnPositions(afterColumns);
			console.log('Column order AFTER:', afterPositions.map((p) => p.name).join(', '));
			const listSwapped =
				afterPositions[0]?.id === b.id && afterPositions[1]?.id === a.id;
			console.log(
				listSwapped
					? '✓ Column list order reflects the swap.'
					: '⚠️ Column list order did not come out as a clean swap of the first two.'
			);

			if (sampleRowId) {
				const row = await plugin.rem.findOne(sampleRowId);
				const afterOrder = row ? await getRowValueOrder(row, afterColumns) : [];
				const names = afterOrder.map((e) => e.slotName);
				console.log(`Sample row value order AFTER: ${names.join(', ')}`);
				console.log(
					names.join() === sampleBefore.join()
						? '✓ Existing row untouched, as expected.'
						: '⚠️ The row\'s value order CHANGED — a column move is not row-neutral.'
				);
			}

			console.log('Now check: (1) the table header shows the new order;');
			console.log('           (2) existing cards are unchanged;');
			console.log('           (3) a NEW row you add fills in the new column order.');
			console.groupEnd();

			await plugin.app.toast(
				`Swapped "${a.name}" <-> "${b.name}". Check the table, then run "PROBE: Restore Column Order".`
			);
		},
	});

	await plugin.app.registerCommand({
		id: 'probe-restore-columns',
		name: 'PROBE: Restore Column Order',
		description: 'Undo the last "PROBE: Swap Two Table Columns".',
		quickCode: 'pcr',
		action: async () => {
			const backup = await plugin.storage.getLocal<ColumnOrderBackup>(COLUMN_ORDER_BACKUP_KEY);
			if (!backup) {
				await plugin.app.toast('No pending column swap to restore.');
				return;
			}

			console.group(`[ColumnOrderProbe] Restoring "${backup.tagName}" (${backup.tagId})`);
			const tag = await plugin.rem.findOne(backup.tagId);
			if (!tag) {
				console.error('[ColumnOrderProbe] Tag rem no longer exists — backup kept.');
				console.groupEnd();
				await plugin.app.toast('Tag not found — backup kept, see console.');
				return;
			}

			try {
				const { before, after } = await swapSiblingPositions(plugin, tag, backup.aId, backup.bId);
				console.log('Positions before restore:', before);
				console.log('Positions after restore: ', after);
			} catch (e) {
				console.error('[ColumnOrderProbe] Restore FAILED — backup kept:', e);
				console.groupEnd();
				await plugin.app.toast('Restore failed — backup kept, see console.');
				return;
			}

			const positions = await getColumnPositions(await getColumnSlots(tag));
			console.log('Column order now:', positions.map((p) => p.name).join(', '));
			const restored =
				positions.find((p) => p.id === backup.aId)?.position === backup.aPos &&
				positions.find((p) => p.id === backup.bId)?.position === backup.bPos;
			console.log(
				restored
					? '✓ Original absolute positions restored.'
					: '⚠️ Positions differ from the original — backup kept, inspect manually.'
			);
			console.groupEnd();

			if (restored) await plugin.storage.setLocal(COLUMN_ORDER_BACKUP_KEY, undefined);
			await plugin.app.toast(
				restored
					? `Restored column order of "${backup.tagName}".`
					: 'Restore mismatch — backup kept, see console.'
			);
		},
	});

	// --- Bulk: sync every row to column order ----------------------------
	// Card extras render in each ROW's property-value order (verified by swapping
	// two rendered extras on one row and watching the card flip). Column order
	// only governs rows created afterwards, so making existing cards match the
	// table means rewriting every row's value order.
	//
	// Always dry-runs first and reports what it would change before asking.
	await plugin.app.registerCommand({
		id: 'sync-rows-to-column-order',
		name: 'Sync All Rows To Column Order',
		description:
			'Reorders every row\'s property values to match the table\'s column order, so card extras render in column order. Dry-runs first; reversible.',
		quickCode: 'sro',
		action: async () => {
			const focused = await plugin.focus.getFocusedRem();
			if (!focused) {
				await plugin.app.toast('Focus the tag rem (or any row of its table) first.');
				return;
			}

			// Only one undo snapshot is kept, so proceeding overwrites any earlier
			// one — making that earlier reordering permanent. Warn in the
			// confirmation instead of refusing, which left no way forward.
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
					'[RowOrderSync] Proceeding will discard the undo for this earlier sync:',
					pending
				);
			}

			const { tag } = await resolveTagRem(plugin, focused);
			const tagName = slotRichTextToString(tag.text) || '[unnamed]';
			console.group(`[RowOrderSync] Tag "${tagName}" (${tag._id})`);

			const columns = await getColumnSlots(tag);
			console.log('Column order:', columns.map((c) => slotRichTextToString(c.text)).join(', '));

			console.log('Scanning rows…');
			const { plans, totalRows } = await planRowSync(
				tag,
				columns,
				columns.map((c) => c._id)
			);

			console.log(`DRY RUN: ${plans.length} of ${totalRows} rows would change.`);
			plans.slice(0, 10).forEach((p) => {
				console.log(`  "${p.name.slice(0, 60)}"`);
				console.log(`     from: ${p.from.join(', ')}`);
			});
			if (plans.length > 10) console.log(`  …and ${plans.length - 10} more.`);

			if (plans.length === 0) {
				console.log('Nothing to do — every row already matches the column order.');
				console.groupEnd();
				await plugin.app.toast('All rows already match the column order.');
				return;
			}

			const confirmed = window.confirm(
				pendingWarning +
				`Sync row property order to column order?\n\n` +
				`Tag: "${tagName}"\n` +
				`Rows to change: ${plans.length} of ${totalRows}\n` +
				`Target order: ${columns.map((c) => slotRichTextToString(c.text)).join(', ')}\n\n` +
				`This moves property-value rems that RemNote maintains itself, on every ` +
				`affected row. BACK UP YOUR KNOWLEDGE BASE FIRST.\n\n` +
				`Undo with "Undo Row Order Sync".\n\nProceed?`
			);
			if (!confirmed) {
				console.log('Cancelled by user — nothing was written.');
				console.groupEnd();
				await plugin.app.toast('Cancelled — nothing was written.');
				return;
			}

			// Snapshot before the first write so an interrupted run is still undoable.
			await plugin.storage.setLocal(BULK_ORDER_BACKUP_KEY, {
				tagId: tag._id,
				tagName,
				rows: plans.map((p) => ({ rowId: p.rowId, originalOrder: p.originalOrder })),
				timestamp: Date.now(),
			} as BulkOrderBackup);
			console.log(`Snapshot stored for ${plans.length} rows.`);

			const { done, failed } = await applyRowSync(plugin, plans, (completed, total) => {
				if (completed % 25 === 0) console.log(`  …applied ${completed}/${total}`);
			});

			console.log(`Done. ${done} rows reordered, ${failed} failed.`);
			console.log('Backup kept — run "Undo Row Order Sync" to revert, or ignore it to accept.');
			console.groupEnd();

			await plugin.app.toast(
				failed === 0
					? `Reordered ${done} rows. Check your cards; "Undo Row Order Sync" reverts.`
					: `Reordered ${done} rows, ${failed} failed — see console.`
			);
		},
	});

	await plugin.app.registerCommand({
		id: 'undo-row-order-sync',
		name: 'Undo Row Order Sync',
		description: 'Restores every row changed by the last "Sync All Rows To Column Order".',
		quickCode: 'sru',
		action: async () => {
			const backup = await plugin.storage.getLocal<BulkOrderBackup>(BULK_ORDER_BACKUP_KEY);
			if (!backup) {
				await plugin.app.toast('No row order sync to undo.');
				return;
			}

			const confirmed = window.confirm(
				`Undo the row order sync?\n\n` +
				`Tag: "${backup.tagName}"\n` +
				`Rows to restore: ${backup.rows.length}\n` +
				(backup.originalColumnOrder
					? `Table columns: will also be restored.\n`
					: `Table columns: were not changed.\n`) +
				`Synced: ${new Date(backup.timestamp).toLocaleString()}\n\nProceed?`
			);
			if (!confirmed) return;

			console.group(`[RowOrderSync] Undoing "${backup.tagName}" — ${backup.rows.length} rows`);

			// Columns first: rows are restored to explicit id sequences, so their
			// result does not depend on column order either way.
			let columnsRestored = true;
			if (backup.originalColumnOrder) {
				const tag = await plugin.rem.findOne(backup.tagId);
				if (!tag) {
					columnsRestored = false;
					console.error('Tag rem not found — cannot restore column order.');
				} else {
					try {
						const result = await applyColumnOrder(plugin, tag, backup.originalColumnOrder);
						columnsRestored = result.matched;
						console.log(
							`Column order restored in ${result.swaps} swap(s) — ` +
							(result.matched ? 'matches the original.' : 'DOES NOT match the original.')
						);
					} catch (e) {
						columnsRestored = false;
						console.error('Column order restore failed:', e);
					}
				}
			}
			let done = 0;
			let failed = 0;
			for (const entry of backup.rows) {
				const row = await plugin.rem.findOne(entry.rowId);
				if (!row) {
					failed++;
					console.warn(`Row ${entry.rowId} no longer exists — skipped.`);
					continue;
				}
				try {
					await applyValueOrder(plugin, row, entry.originalOrder);
					done++;
				} catch (e) {
					failed++;
					console.error(`Row ${entry.rowId} restore failed:`, e);
				}
				if ((done + failed) % 25 === 0) {
					console.log(`  …restored ${done + failed}/${backup.rows.length}`);
				}
			}
			console.log(`Done. ${done} restored, ${failed} failed.`);
			if (failed === 0 && columnsRestored) {
				await plugin.storage.setLocal(BULK_ORDER_BACKUP_KEY, undefined);
				console.log('Backup cleared.');
			} else {
				console.warn(
					'Backup KEPT because ' +
					(failed > 0 ? 'some rows failed' : 'the column order was not fully restored') + '.'
				);
			}
			console.groupEnd();

			await plugin.app.toast(
				failed === 0
					? `Restored ${done} rows.`
					: `Restored ${done} rows, ${failed} failed — backup kept, see console.`
			);
		},
	});

	await plugin.app.registerCommand({
		id: 'debug-tag-slots',
		name: 'Debug Tag Slots',
		description: 'Inspect slots/properties of the focused tag rem and force-delete ghost slots.',
		quickCode: 'dts',
		action: async () => {
			const rem = await plugin.focus.getFocusedRem();
			if (!rem) {
				await plugin.app.toast('Focus on a tag rem first.');
				return;
			}
			await plugin.widget.openPopup('tag_debug', { remId: rem._id });
		},
	});

	await plugin.app.registerCommand({
		id: 'inspect-rem',
		name: 'Inspect Rem (Diagnostic)',
		description: 'Log full rem diagnostics (type, powerups, tags, children) to the browser console.',
		quickCode: 'inr',
		action: async () => {
			const rem = await plugin.focus.getFocusedRem();
			if (!rem) {
				await plugin.app.toast('Focus on a rem first.');
				return;
			}

			console.group(`[InspectRem] "${richTextToString(rem.text || [])}" (${rem._id})`);

			// Basic flags
			console.log('isProperty:', await rem.isProperty());
			console.log('isPowerup:', await rem.isPowerup());
			console.log('type:', (rem as any).type);
			console.log('remType:', (rem as any).remType);

			// All BuiltInPowerupCodes
			const codes = Object.entries(BuiltInPowerupCodes);
			console.group('hasPowerup checks:');
			for (const [name, code] of codes) {
				try {
					const has = await rem.hasPowerup(code as any);
					if (has) console.log(`  ✓ ${name} (${code})`);
				} catch {}
			}
			console.groupEnd();

			// Tags
			try {
				const tags = await rem.getTagRems();
				console.log('getTagRems():', tags.map(t => `"${richTextToString(t.text || [])}" (${t._id})`));
			} catch (e) { console.log('getTagRems() error:', e); }

			// Raw children array (synchronous)
			console.log('children (raw ids):', (rem as any).children);

			// Resolved children with isProperty check
			const children = await rem.getChildrenRem();
			console.group(`getChildrenRem() — ${children.length} children:`);
			for (const child of children) {
				const isProp = await child.isProperty();
				const firstGrandchildId = (child as any).children?.[0];
				let firstGrandchildIsProp: boolean | null = null;
				if (firstGrandchildId) {
					const fg = await plugin.rem.findOne(firstGrandchildId);
					if (fg) firstGrandchildIsProp = await fg.isProperty();
				}
				console.log(
					`  [isProperty=${isProp}] "${richTextToString(child.text || [])}" (${child._id})` +
					(firstGrandchildId ? ` | firstChild isProperty=${firstGrandchildIsProp}` : '')
				);
			}
			console.groupEnd();

			console.groupEnd();
			await plugin.app.toast('Rem diagnostics logged to browser console (F12).');
		},
	});
}

async function onDeactivate(_: ReactRNPlugin) { }

declareIndexPlugin(onActivate, onDeactivate);
