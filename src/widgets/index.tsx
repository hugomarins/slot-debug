import {
	declareIndexPlugin,
	ReactRNPlugin,
	SelectionType,
	WidgetLocation,
} from "@remnote/plugin-sdk";
import "../style.css";

const CSS = `
/* General Hidden Styles */
.rn-queue__content--answer-hidden [data-queue-rem-container-tags~="hide-in-queue"]:not(.rn-question-rem) > .RichTextViewer,
.rn-queue__content--answer-hidden [data-queue-rem-container-tags~="hide-in-queue"]:not(.rn-question-rem) > .rn-flashcard-delimiter,
.rn-queue__content--answer-hidden [data-queue-rem-container-tags~="hide-in-queue"]:not(.rn-question-rem) > .rn-queue-rem > .RichTextViewer,
.rn-queue__content--answer-hidden [data-queue-rem-container-tags~="hide-in-queue"]:not(.rn-question-rem) > .rem-bullet__document {
  display: none;
}

/* Hidden in Queue Text */
.rn-queue__content--answer-hidden [data-queue-rem-container-tags~="hide-in-queue"]:not(.rn-question-rem) > .rn-queue-rem > .rn-bullet-container,
.rn-queue__content--answer-hidden [data-queue-rem-container-tags~="hide-in-queue"]:not(.rn-question-rem) > .rn-queue-rem > .rem-bullet__document {
  position: relative;
}

.rn-queue__content--answer-hidden [data-queue-rem-container-tags~="hide-in-queue"]:not(.rn-question-rem) > .rn-queue-rem > .rn-bullet-container:after,
.rn-queue__content--answer-hidden [data-queue-rem-container-tags~="hide-in-queue"]:not(.rn-question-rem) > .rn-queue-rem > .rem-bullet__document:after {
  content: "Hidden in queue";
  opacity: .3;
  white-space: nowrap;
  position: absolute;
  left: 25px;
  top: 0;
}

/* Remove from Queue Styles */
.rn-queue__content [data-queue-rem-container-tags~="remove-from-queue"]:not(.rn-question-rem) > .rn-queue-rem {
  display: none;
}

.rn-queue__content [data-queue-rem-container-tags~="remove-from-queue"]:not(.rn-question-rem),
.rn-breadcrumb-item[data-rem-tags~="remove-from-queue"] {
	margin-left: 0px !important; // makes it look like its not indented to the removed parent
}

/* No Hierarchy Styles */
.rn-queue__content:has(.rn-question-rem[data-queue-rem-container-tags~="no-hierarchy"]) .indented-rem:not(.rn-question-rem) {
  margin-left: 0px !important;
}

.rn-queue__content:has(.rn-question-rem[data-queue-rem-container-tags~="no-hierarchy"]) .indented-rem:not(.rn-question-rem) > .rn-queue-rem,
.rn-queue__content:has(.rn-question-rem[data-queue-rem-container-tags~="no-hierarchy"]) .indented-rem:not(.rn-question-rem) > .rn-flashcard-delimiter,
.rn-queue__content:has(.rn-question-rem[data-queue-rem-container-tags~="no-hierarchy"]) .indented-rem:not(.rn-question-rem) > .RichTextViewer {
  display: none;
}

/* Hide Parent Styles */
.rn-queue__content--answer-hidden .indented-rem:has(> .rn-question-rem[data-queue-rem-container-tags~="hide-parent"]) > .RichTextViewer,
.rn-queue__content--answer-hidden .indented-rem:has(> .rn-question-rem[data-queue-rem-container-tags~="hide-parent"]) > .rn-flashcard-delimiter,
.rn-queue__content--answer-hidden .indented-rem:has(> .rn-question-rem[data-queue-rem-container-tags~="hide-parent"]) > .rn-queue-rem > .RichTextViewer,
.rn-queue__content--answer-hidden .indented-rem:has(> .rn-question-rem[data-queue-rem-container-tags~="hide-parent"]) > .rem-bullet__document {
  display: none !important;
}

.rn-queue__content--answer-hidden .indented-rem:has(> .rn-question-rem[data-queue-rem-container-tags~="hide-parent"]) > .rn-queue-rem > .rn-bullet-container,
.rn-queue__content--answer-hidden .indented-rem:has(> .rn-question-rem[data-queue-rem-container-tags~="hide-parent"]) > .rn-queue-rem > .rem-bullet__document {
  position: relative;
}

.rn-queue__content--answer-hidden .indented-rem:has(> .rn-question-rem[data-queue-rem-container-tags~="hide-parent"]) > .rn-queue-rem > .rn-bullet-container:after,
.rn-queue__content--answer-hidden .indented-rem:has(> .rn-question-rem[data-queue-rem-container-tags~="hide-parent"]) > .rn-queue-rem > .rem-bullet__document:after {
  content: "Hidden in queue";
  opacity: .3;
  white-space: nowrap;
  position: absolute;
  left: 25px;
  top: 0;
}

/* Hide Grandparent Styles */
.rn-queue__content--answer-hidden .indented-rem:has(> .indented-rem > .rn-question-rem[data-queue-rem-container-tags~="hide-grandparent"]) > .RichTextViewer,
.rn-queue__content--answer-hidden .indented-rem:has(> .indented-rem > .rn-question-rem[data-queue-rem-container-tags~="hide-grandparent"]) > .rn-flashcard-delimiter,
.rn-queue__content--answer-hidden .indented-rem:has(> .indented-rem > .rn-question-rem[data-queue-rem-container-tags~="hide-grandparent"]) > .rn-queue-rem > .RichTextViewer,
.rn-queue__content--answer-hidden .indented-rem:has(> .indented-rem > .rn-question-rem[data-queue-rem-container-tags~="hide-grandparent"]) > .rem-bullet__document {
  display: none !important;
}

.rn-queue__content--answer-hidden .indented-rem:has(> .indented-rem > .rn-question-rem[data-queue-rem-container-tags~="hide-grandparent"]) > .rn-queue-rem > .rn-bullet-container,
.rn-queue__content--answer-hidden .indented-rem:has(> .indented-rem > .rn-question-rem[data-queue-rem-container-tags~="hide-grandparent"]) > .rn-queue-rem > .rem-bullet__document {
  position: relative;
}

.rn-queue__content--answer-hidden .indented-rem:has(> .indented-rem > .rn-question-rem[data-queue-rem-container-tags~="hide-grandparent"]) > .rn-queue-rem > .rn-bullet-container:after,
.rn-queue__content--answer-hidden .indented-rem:has(> .indented-rem > .rn-question-rem[data-queue-rem-container-tags~="hide-grandparent"]) > .rn-queue-rem > .rem-bullet__document:after {
  content: "Hidden in queue";
  opacity: .3;
  white-space: nowrap;
  position: absolute;
  left: 25px;
  top: 0;
}

`;

const HIDE_IN_QUEUE_POWERUP_CODE = "hideInQueue";
const REMOVE_FROM_QUEUE_POWERUP_CODE = "removeFromQueue";
const NO_HIERARCHY_POWERUP_CODE = "noHierarchy";
const HIDE_PARENT_POWERUP_CODE = "hideParent";
const HIDE_GRANDPARENT_POWERUP_CODE = "hideGrandparent";

async function onActivate(plugin: ReactRNPlugin) {
	await plugin.app.registerPowerup({
		name: "No Hierarchy",
		code: NO_HIERARCHY_POWERUP_CODE,
		description:
			"Removes the ancestor hierarchy of the tagged Rem in the queue view.",
		options: {
			slots: [],
		},
	});

	const runAddPowerupCommand = async (powerup: string) => {
		// 1. Check if we are currently in the queue AND targeting the flashcard
		const url = await plugin.window.getURL();
		const currentCard = await plugin.queue.getCurrentCard();
		const sel = await plugin.editor.getSelection();
		const selType = sel?.type;

		if (url.includes("/flashcards") && currentCard) {
			let isTargetingCurrentCard = false;
			if (!selType) {
				// No active text/rem selection (e.g. pressed a queue keyboard shortcut)
				isTargetingCurrentCard = true;
			} else if (selType === SelectionType.Rem && sel.remIds.includes(currentCard.remId)) {
				// Selected the flashcard rem explicitly
				isTargetingCurrentCard = true;
			} else if (selType === SelectionType.Text && sel.remId === currentCard.remId) {
				// Editing the text of the flashcard rem explicitly
				isTargetingCurrentCard = true;
			}

			if (isTargetingCurrentCard) {
				// If in the queue, check if it's one of the problematic powerups
				if (
					powerup === HIDE_IN_QUEUE_POWERUP_CODE ||
					powerup === REMOVE_FROM_QUEUE_POWERUP_CODE
				) {
					const powerupName =
						powerup === HIDE_IN_QUEUE_POWERUP_CODE
							? "Hide in Queue"
							: "Remove from Queue";

					// Show the warning popup with Cancel/OK buttons
					const userConfirmed = window.confirm(
						`Warning: "${powerupName}" is meant for parent/ancestor Rems, not the flashcard directly.\n\n` +
						`Click "OK" to navigate to the parent Rem and apply the powerup there, or "Cancel" to abort.\n\n` +
						`Consider these alternatives if you want to affect ONLY this flashcard, not others descendants from the same ancestor:\n` +
						`  "Hide Parent"\n` +
						`  "Hide Grandparent"\n\n`
					);

					if (userConfirmed) {
						const rem = await plugin.rem.findOne(currentCard.remId);
						const parent = await rem?.getParentRem();

						if (parent) {
							// Apply powerup to parent
							await parent.addPowerup(powerup);
							await plugin.app.toast(`Applied "${powerupName}" to parent.`);
						} else {
							await plugin.app.toast("Could not find a parent Rem.");
						}
					}
				} else {
					// For noHierarchy, hideParent, hideGrandparent: apply directly to current flashcard
					const rem = await plugin.rem.findOne(currentCard.remId);
					await rem?.addPowerup(powerup);
					await plugin.app.toast(
						"Powerup added (will take effect next time you see this card)."
					);
				}
				// Abort applying it to the current card regardless of user choice
				return;
			}
		}

		// 2. Fallback to standard editor logic if not in the queue
		if (!selType) {
			return;
		}
		if (selType === SelectionType.Rem) {
			const rems = (await plugin.rem.findMany(sel.remIds)) || [];
			rems.forEach((r) => r.addPowerup(powerup));
		} else {
			const rem = await plugin.rem.findOne(sel.remId);
			rem?.addPowerup(powerup);
		}
	};

	await plugin.app.registerCommand({
		id: `${NO_HIERARCHY_POWERUP_CODE}Cmd`,
		name: "No Hierarchy",
		description: `Any ancestors will be hidden on the front and back of the flashcard.`,
		quickCode: "nh",
		action: async () => {
			await runAddPowerupCommand(NO_HIERARCHY_POWERUP_CODE);
		},
	});

	await plugin.app.registerPowerup({
		name: "Hide in Queue",
		code: HIDE_IN_QUEUE_POWERUP_CODE,
		description: "Hides the tagged Rem in the queue view.",
		options: {
			slots: [],
		},
	});

	await plugin.app.registerCommand({
		id: `${HIDE_IN_QUEUE_POWERUP_CODE}Cmd`,
		name: "Hide in Queue",
		description: `Hide the tagged Rem in the queue, displaying only “Hidden in Queue."`,
		quickCode: "hiq",
		action: async () => {
			await runAddPowerupCommand(HIDE_IN_QUEUE_POWERUP_CODE);
		},
	});

	await plugin.app.registerPowerup({
		name: "Remove from Queue",
		code: REMOVE_FROM_QUEUE_POWERUP_CODE,
		description: "Removes the tagged Rem in the queue view.",
		options: {
			slots: [],
		},
	});

	await plugin.app.registerCommand({
		id: `${REMOVE_FROM_QUEUE_POWERUP_CODE}Cmd`,
		name: "Remove from Queue",
		description: `Completely remove the tagged Rem from the queue view.`,
		quickCode: "rfq",
		action: async () => {
			await runAddPowerupCommand(REMOVE_FROM_QUEUE_POWERUP_CODE);
		},
	});

	await plugin.app.registerPowerup({
		name: "Hide Parent",
		code: HIDE_PARENT_POWERUP_CODE,
		description: "Hides the immediate parent in the queue view.",
		options: {
			slots: [],
		},
	});

	await plugin.app.registerCommand({
		id: `${HIDE_PARENT_POWERUP_CODE}Cmd`,
		name: "Hide Parent",
		description: `Hide the immediate parent of the tagged Rem in the queue.`,
		quickCode: "hp",
		action: async () => {
			await runAddPowerupCommand(HIDE_PARENT_POWERUP_CODE);
		},
	});

	await plugin.app.registerPowerup({
		name: "Hide Grandparent",
		code: HIDE_GRANDPARENT_POWERUP_CODE,
		description: "Hides the grandparent in the queue view.",
		options: {
			slots: [],
		},
	});

	await plugin.app.registerCommand({
		id: `${HIDE_GRANDPARENT_POWERUP_CODE}Cmd`,
		name: "Hide Grandparent",
		description: `Hide the grandparent of the tagged Rem in the queue.`,
		quickCode: "hgp",
		action: async () => {
			await runAddPowerupCommand(HIDE_GRANDPARENT_POWERUP_CODE);
		},
	});

	await plugin.app.registerCSS("powerup", CSS);

	// Tag Slot Debugger
	plugin.app.registerWidget('tag_debug', WidgetLocation.Popup, {
		dimensions: { width: '500px', height: 'auto' },
	});

	await plugin.app.registerCommand({
		id: 'debug-tag-slots',
		name: 'Debug Tag Slots',
		description: 'Inspect slots/properties of the focused tag rem and force-delete ghost slots.',
		quickCode: 'tsd',
		action: async () => {
			const rem = await plugin.focus.getFocusedRem();
			if (!rem) {
				await plugin.app.toast('Focus on a tag rem first.');
				return;
			}
			await plugin.widget.openPopup('tag_debug', { remId: rem._id });
		},
	});
}

async function onDeactivate(_: ReactRNPlugin) { }

declareIndexPlugin(onActivate, onDeactivate);
