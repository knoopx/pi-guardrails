/**
 * Stub settings module for standalone testing.
 * In production, this is provided by the PI coding agent framework.
 */

export interface EnabledSetting {
  enabled: boolean;
}

let store: Map<string, EnabledSetting> = new Map();

export async function loadEnabledSetting<T extends EnabledSetting>(
  key: string,
  defaults: T,
): Promise<T> {
  const existing = store.get(key);
  if (existing) return existing as T;
  store.set(key, defaults);
  return defaults;
}

export async function saveEnabledSetting<T extends EnabledSetting>(
  key: string,
  settings: T,
  readFn: () => Promise<T>,
): Promise<void> {
  store.set(key, settings);
}
