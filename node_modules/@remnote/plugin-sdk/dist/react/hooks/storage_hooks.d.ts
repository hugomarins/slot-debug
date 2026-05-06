export declare function useSessionStorageState<Value>(key: string, defaultValue: Value): [Value, (value: Value) => Promise<void>];
export declare function useLocalStorageState<Value>(key: string, defaultValue: Value): [Value, (value: Value) => Promise<void>];
export declare function useSyncedStorageState<Value>(key: string, defaultValue: Value): [Value, (value: Value) => Promise<void>];
