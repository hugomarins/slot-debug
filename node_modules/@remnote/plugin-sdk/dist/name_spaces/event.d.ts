import { AppEvent, AppEventListerKey } from '../events';
import { EventCallbackFn } from '../interfaces';
import { RNPlugin } from '../plugin_base';
import { InternalCallMethod, NamespaceBase } from './base';
/**
 * # Event Namespace
 */
export declare class EventNamespace extends NamespaceBase {
    private plugin;
    /** @hidden */
    constructor(_call: InternalCallMethod, plugin: RNPlugin);
    /**
     * Registers a listener, which will run a custom function based on a specific event inside RemNote
     */
    addListener: (eventId: AppEvent, listenerKey: AppEventListerKey, callback: EventCallbackFn) => void;
    removeListener: (eventId: AppEvent, listenerKey: AppEventListerKey, callback?: EventCallbackFn) => void;
}
