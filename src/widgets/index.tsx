import {
	declareIndexPlugin,
	ReactRNPlugin,
	WidgetLocation,
	BuiltInPowerupCodes,
} from "@remnote/plugin-sdk";
import "../style.css";
import {
	FRONT_SLOT,
	BACK_SLOT,
	readExtraSlotIds,
	writeExtraSlotIds,
	getCandidateSlots,
	describeSlotIds,
	resolveTagRem,
	SLOT_POWERUP,
	richTextToString as slotRichTextToString,
} from "../lib/slotConfig";

const WRITE_TEST_BACKUP_KEY = 'slotWriteTestBackup';

interface WriteTestBackup {
	remId: string;
	remName: string;
	front: string[];
	back: string[];
	appendedId: string;
	appendedName: string;
	/** Absent on backups written before this field existed. */
	hadSlotPowerup?: boolean;
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

	// Repairs a rem that was accidentally turned into a table column. `isProperty`
	// is backed by the Slot powerup, so writing any Slot powerup property to a rem
	// promotes it to a slot of its parent — a table row treated this way starts
	// appearing as a column.
	await plugin.app.registerCommand({
		id: 'repair-strip-slot-powerup',
		name: 'Repair: Strip Slot Powerup From Focused Rem',
		description:
			'Removes the Slot powerup from the focused rem, undoing an accidental promotion of a row into a table column.',
		quickCode: 'rss',
		action: async () => {
			const rem = await plugin.focus.getFocusedRem();
			if (!rem) {
				await plugin.app.toast('Focus the rem to repair first.');
				return;
			}

			const name = slotRichTextToString(rem.text) || '[unnamed]';
			console.group(`[SlotRepair] "${name}" (${rem._id})`);

			const has = await rem.hasPowerup(SLOT_POWERUP).catch(() => false);
			console.log('isProperty:', await rem.isProperty().catch(() => null));
			console.log(`has Slot powerup ("${SLOT_POWERUP}"):`, has);
			if (!has) {
				console.log('Nothing to strip.');
				console.groupEnd();
				await plugin.app.toast('This rem has no Slot powerup — nothing to strip.');
				return;
			}

			const front = await readExtraSlotIds(rem, FRONT_SLOT);
			const back = await readExtraSlotIds(rem, BACK_SLOT);
			console.log('front:', front, '→', await describeSlotIds(plugin, front));
			console.log('back: ', back, '→', await describeSlotIds(plugin, back));

			const parent = await rem.getParentRem();
			const parentName = parent
				? slotRichTextToString(parent.text) || '[unnamed]'
				: '(no parent)';
			const tags = await rem.getTagRems().catch(() => []);
			const isRowOfParent = !!parent && tags.some((t) => t._id === parent._id);
			console.log(`parent: "${parentName}"`, parent?._id ?? '');
			console.log('is a row of its parent (tagged with it):', isRowOfParent);

			const confirmed = window.confirm(
				`Strip the Slot powerup from:\n\n"${name}"\n${rem._id}\n\n` +
				(isRowOfParent
					? `This rem is a ROW of "${parentName}" that was promoted to a column. Stripping is the repair.\n\n`
					: `⚠️ This rem is NOT tagged with its parent, so it may be a LEGITIMATE column of "${parentName}". Stripping would remove it as a column.\n\n`) +
				`Stored card config that will be discarded:\n` +
				`  front: ${front.length ? front.length + ' slot(s)' : '(empty)'}\n` +
				`  back:  ${back.length ? back.length + ' slot(s)' : '(empty)'}\n\n` +
				`Proceed?`
			);
			if (!confirmed) {
				console.log('Cancelled by user.');
				console.groupEnd();
				return;
			}

			try {
				await rem.removePowerup(SLOT_POWERUP);
			} catch (e) {
				console.error('[SlotRepair] removePowerup failed:', e);
				console.groupEnd();
				await plugin.app.toast('Strip failed — see console.');
				return;
			}

			const stillHas = await rem.hasPowerup(SLOT_POWERUP).catch(() => null);
			const stillProperty = await rem.isProperty().catch(() => null);
			console.log('after — has Slot powerup:', stillHas, '| isProperty:', stillProperty);
			console.log(stillHas === false ? '✓ Stripped.' : '✗ Powerup still present.');
			console.groupEnd();

			await plugin.app.toast(
				stillHas === false ? `Stripped Slot powerup from "${name}".` : 'Powerup still present — see console.'
			);
		},
	});

	// --- Write test -------------------------------------------------------
	// Appends one unused slot to the focused rem's ExtraSlotsOnFrontOfCard and
	// snapshots the previous value so it can be restored. Purpose: confirm that
	// a plugin write to the Slot powerup actually re-renders already-generated
	// cards (especially cloze cards, whose table has no Configure Cards menu).
	await plugin.app.registerCommand({
		id: 'test-card-slot-write',
		name: 'TEST: Append Extra Slot to Card Front',
		description:
			'Reversible write test — appends one unused slot to the focused rem\'s card-front config. Undo with "TEST: Restore Card Slot Config".',
		quickCode: 'tcw',
		action: async () => {
			const focused = await plugin.focus.getFocusedRem();
			if (!focused) {
				await plugin.app.toast('Focus on the tag rem (or a rem tagged with it) first.');
				return;
			}
			const { tag: rem, resolvedFrom } = await resolveTagRem(plugin, focused);

			const remName = slotRichTextToString(rem.text) || '[unnamed]';
			console.group(`[SlotWriteTest] Target: "${remName}" (${rem._id})`);
			if (resolvedFrom) {
				console.log(
					`Focused "${slotRichTextToString(focused.text)}" (${focused._id}) → resolved to the tag rem via ${resolvedFrom}.`
				);
			}

			const existing = await plugin.storage.getLocal<WriteTestBackup>(WRITE_TEST_BACKUP_KEY);
			if (existing) {
				console.warn('[SlotWriteTest] A previous backup is still pending:', existing);
				console.groupEnd();
				await plugin.app.toast(
					`A previous test on "${existing.remName}" is not restored yet. Run "TEST: Restore Card Slot Config" first.`
				);
				return;
			}

			const front = await readExtraSlotIds(rem, FRONT_SLOT);
			const back = await readExtraSlotIds(rem, BACK_SLOT);
			console.log('BEFORE front:', front, '→', await describeSlotIds(plugin, front));
			console.log('BEFORE back: ', back, '→', await describeSlotIds(plugin, back));

			const candidates = await getCandidateSlots(plugin, rem);
			console.log(
				'Candidate slots:',
				candidates.map((c) => `"${slotRichTextToString(c.text)}" (${c._id})`)
			);

			const used = new Set([...front, ...back]);
			const pick = candidates.find((c) => !used.has(c._id));
			if (!pick) {
				console.warn('[SlotWriteTest] Every candidate slot is already assigned — nothing to append.');
				console.groupEnd();
				await plugin.app.toast('No unused slot available to append.');
				return;
			}

			const pickName = slotRichTextToString(pick.text) || '[unnamed]';
			const nextFront = [...front, pick._id];
			console.log(`Appending "${pickName}" (${pick._id}) to ${FRONT_SLOT}…`);

			await plugin.storage.setLocal(WRITE_TEST_BACKUP_KEY, {
				remId: rem._id,
				remName,
				front,
				back,
				appendedId: pick._id,
				appendedName: pickName,
				hadSlotPowerup: await rem.hasPowerup(SLOT_POWERUP).catch(() => true),
				timestamp: Date.now(),
			} as WriteTestBackup);

			try {
				await writeExtraSlotIds(rem, FRONT_SLOT, nextFront);
			} catch (e) {
				console.error('[SlotWriteTest] Write FAILED:', e);
				await plugin.storage.setLocal(WRITE_TEST_BACKUP_KEY, undefined);
				console.groupEnd();
				await plugin.app.toast('Write failed — see console.');
				return;
			}

			// Read back from the KB rather than trusting the write call.
			const verifyFront = await readExtraSlotIds(rem, FRONT_SLOT);
			const ok =
				verifyFront.length === nextFront.length &&
				verifyFront.every((id, i) => id === nextFront[i]);
			console.log('AFTER front: ', verifyFront, '→', await describeSlotIds(plugin, verifyFront));
			console.log(ok ? '✓ Read-back matches what was written.' : '✗ Read-back MISMATCH.');
			console.groupEnd();

			await plugin.app.toast(
				ok
					? `Appended "${pickName}" to card front. Open a card for this tag in the queue, then run "TEST: Restore Card Slot Config".`
					: `Write did not read back correctly — see console.`
			);
		},
	});

	// Disambiguates two hypotheses for how the renderer orders the extras:
	//   (A) it walks the tag's property children (= table column order) and
	//       ignores the stored array order entirely;
	//   (B) it honours the stored array order.
	// Writes the first two candidate slots to the front in REVERSE column order,
	// so the two hypotheses predict visibly different cards.
	await plugin.app.registerCommand({
		id: 'test-card-slot-order',
		name: 'TEST: Probe Extra-Slot Render Order',
		description:
			'Reversible — writes two slots to the card front in reverse column order to see whether stored order is honoured.',
		quickCode: 'tco',
		action: async () => {
			const focused = await plugin.focus.getFocusedRem();
			if (!focused) {
				await plugin.app.toast('Focus on the tag rem (or a rem tagged with it) first.');
				return;
			}
			const { tag: rem, resolvedFrom } = await resolveTagRem(plugin, focused);

			const remName = slotRichTextToString(rem.text) || '[unnamed]';
			console.group(`[SlotOrderTest] Target: "${remName}" (${rem._id})`);
			if (resolvedFrom) {
				console.log(
					`Focused "${slotRichTextToString(focused.text)}" (${focused._id}) → resolved to the tag rem via ${resolvedFrom}.`
				);
			}

			const existing = await plugin.storage.getLocal<WriteTestBackup>(WRITE_TEST_BACKUP_KEY);
			if (existing) {
				console.warn('[SlotOrderTest] A previous backup is still pending:', existing);
				console.groupEnd();
				await plugin.app.toast(
					`A previous test on "${existing.remName}" is not restored yet. Run "TEST: Restore Card Slot Config" first.`
				);
				return;
			}

			const front = await readExtraSlotIds(rem, FRONT_SLOT);
			const back = await readExtraSlotIds(rem, BACK_SLOT);
			const candidates = await getCandidateSlots(plugin, rem);
			if (candidates.length < 2) {
				console.warn('[SlotOrderTest] Need at least two candidate slots.');
				console.groupEnd();
				await plugin.app.toast('Need at least two slots to probe ordering.');
				return;
			}

			// candidates come back in child order === table column order.
			const [first, second] = candidates;
			const firstName = slotRichTextToString(first.text) || '[unnamed]';
			const secondName = slotRichTextToString(second.text) || '[unnamed]';
			const reversed = [second._id, first._id];

			console.log(`Column order:  1. ${firstName}   2. ${secondName}`);
			console.log(`Writing front in REVERSE order: [${secondName}, ${firstName}]`);
			console.log(`  If the card renders "${firstName}" then "${secondName}" → stored order is IGNORED (column order wins).`);
			console.log(`  If the card renders "${secondName}" then "${firstName}" → stored order IS honoured.`);

			await plugin.storage.setLocal(WRITE_TEST_BACKUP_KEY, {
				remId: rem._id,
				remName,
				front,
				back,
				appendedId: second._id,
				appendedName: secondName,
				hadSlotPowerup: await rem.hasPowerup(SLOT_POWERUP).catch(() => true),
				timestamp: Date.now(),
			} as WriteTestBackup);

			try {
				await writeExtraSlotIds(rem, FRONT_SLOT, reversed);
			} catch (e) {
				console.error('[SlotOrderTest] Write FAILED:', e);
				await plugin.storage.setLocal(WRITE_TEST_BACKUP_KEY, undefined);
				console.groupEnd();
				await plugin.app.toast('Write failed — see console.');
				return;
			}

			const verify = await readExtraSlotIds(rem, FRONT_SLOT);
			console.log('Stored front is now:', verify, '→', await describeSlotIds(plugin, verify));
			console.groupEnd();

			await plugin.app.toast(
				`Front set to [${secondName}, ${firstName}]. Open a card whose row has BOTH values filled, then run "TEST: Restore Card Slot Config".`
			);
		},
	});

	await plugin.app.registerCommand({
		id: 'test-card-slot-restore',
		name: 'TEST: Restore Card Slot Config',
		description: 'Undo the last "TEST: Append Extra Slot to Card Front" write.',
		quickCode: 'tcr',
		action: async () => {
			const backup = await plugin.storage.getLocal<WriteTestBackup>(WRITE_TEST_BACKUP_KEY);
			if (!backup) {
				await plugin.app.toast('No pending write test to restore.');
				return;
			}

			console.group(`[SlotWriteTest] Restoring "${backup.remName}" (${backup.remId})`);
			const rem = await plugin.rem.findOne(backup.remId);
			if (!rem) {
				console.error('[SlotWriteTest] Target rem no longer exists — backup kept.');
				console.groupEnd();
				await plugin.app.toast('Target rem not found — backup kept, see console.');
				return;
			}

			try {
				await writeExtraSlotIds(rem, FRONT_SLOT, backup.front);
				await writeExtraSlotIds(rem, BACK_SLOT, backup.back);
			} catch (e) {
				console.error('[SlotWriteTest] Restore FAILED — backup kept:', e);
				console.groupEnd();
				await plugin.app.toast('Restore failed — backup kept, see console.');
				return;
			}

			const verifyFront = await readExtraSlotIds(rem, FRONT_SLOT);
			const verifyBack = await readExtraSlotIds(rem, BACK_SLOT);
			const ok =
				verifyFront.join() === backup.front.join() && verifyBack.join() === backup.back.join();
			console.log('front now:', verifyFront, '→', await describeSlotIds(plugin, verifyFront));
			console.log('back now: ', verifyBack, '→', await describeSlotIds(plugin, verifyBack));
			console.log(ok ? '✓ Restored to the original values.' : '✗ Restore MISMATCH — backup kept.');

			// Writing a powerup property applies the powerup. If the rem did not
			// carry it beforehand, restoring the values alone would leave an empty
			// Slot powerup behind, so strip it.
			if (ok && backup.hadSlotPowerup === false) {
				try {
					await rem.removePowerup(SLOT_POWERUP);
					console.log(`Removed the "${SLOT_POWERUP}" powerup — the rem did not carry it before the test.`);
				} catch (e) {
					console.warn('Could not remove the leftover Slot powerup:', e);
				}
			} else if (ok && backup.hadSlotPowerup === undefined) {
				console.warn(
					'This backup predates powerup tracking. If the target was not a tag/slot rem, ' +
					`it may now carry an empty "${SLOT_POWERUP}" powerup — check with "Inspect Slot Config (Cards)".`
				);
			}
			console.groupEnd();

			if (ok) await plugin.storage.setLocal(WRITE_TEST_BACKUP_KEY, undefined);
			await plugin.app.toast(
				ok ? `Restored "${backup.remName}".` : 'Restore mismatch — backup kept, see console.'
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
