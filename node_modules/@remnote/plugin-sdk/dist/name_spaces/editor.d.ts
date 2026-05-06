import { RichTextInterface } from '..';
import { RemSelection, MoveUnit, RemId, SelectionType, TextSelection, EditorRange } from '../interfaces';
import { InternalCallMethod, NamespaceBase } from './base';
/**
 * # Editor Namespace
 *
 * The API Editor namespace. Call with `plugin.Editor.apiMethodName()`.
 */
export declare class EditorNamespace extends NamespaceBase {
    /** @hidden */
    constructor(_call: InternalCallMethod);
    /**
     * Set the text in the current active editor.
     */
    setText: (richText: RichTextInterface) => Promise<void>;
    /**
     * Copy the current selection to the user's clipboard.
     *
     * @returns type of selection (line, text) which was copied, or undefined if there was no selection.
     */
    copy: () => Promise<SelectionType>;
    /**
     * Cut the current selection, saving the selection to the user's clipboard.
     *
     * @returns type of selection (line, text) which was cut, or undefined if there was no selection.
     */
    cut: () => Promise<SelectionType | undefined>;
    /**
     * Delete a certain number of characters in a given direction in the active editor beginning from the current caret position.
     */
    deleteCharacters: (characters: number, direction: -1 | 1) => Promise<any>;
    /**
     * Delete the currently selected range (line, text).
     */
    delete: () => Promise<any>;
    /**
     * Get the currently selected Rem, or undefined if there is no selection.
     */
    getSelectedRem: () => Promise<RemSelection | undefined>;
    /**
     * Get the currently selected text, or undefined if there is no selection.
     */
    getSelectedText: () => Promise<TextSelection | undefined>;
    /**
     * Get the current selection (Rem, text), or undefined if there is no selection.
     */
    getSelection: () => Promise<RemSelection | TextSelection | undefined>;
    /**
     * Set the selection in the active editor to a range of selected lines.
     */
    selectRem: (range: RemId[], portalId?: RemId) => Promise<any>;
    /**
     * Set the selection in the active editor to a range of rich text.
     */
    selectText: (range: EditorRange) => Promise<any>;
    /**
     * Collapse the current selection to the start or end of the selection range.
     */
    collapseSelection: (to: 'start' | 'end') => Promise<void>;
    /**
     * Undo the last change.
     */
    undo: () => Promise<void>;
    /**
     * Redo the last undone change.
     */
    redo: () => Promise<void>;
    /**
     * Move the caret horizontally in the active editor.
     */
    moveCaret: (amount: number, unit: MoveUnit) => Promise<void>;
    /**
     * Move the caret vertically in the active editor.
     */
    moveCaretVertical: (direction: -1 | 1) => Promise<any>;
    /**
     * Get the DOMRect representing the user's current caret position.
     */
    getCaretPosition: () => Promise<DOMRect | undefined>;
    /**
     * Insert plain text at the current caret location.
     */
    insertPlainText: (string: string) => Promise<void>;
    /**
     * Insert rich text at the current caret location.
     */
    insertRichText: (richText: RichTextInterface) => Promise<void>;
    /**
     * Insert markdown at the current caret location.
     */
    insertMarkdown: (markdown: string) => Promise<void>;
    /**
     * Get the text from the currently focused editor.
     *
     * If you are focusing a Rem in a HierarchyEditor, this will get the focused Rem's text.
     */
    getFocusedEditorText: () => Promise<RichTextInterface | undefined>;
}
