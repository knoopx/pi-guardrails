import {
  loadEnabledSetting,
  saveEnabledSetting,
} from "./settings.js";

const GUARDRAILS_SETTINGS_KEY = "guardrails";

interface GuardrailsSettings {
  enabled: boolean;
}

const DEFAULT_GUARDRAILS_SETTINGS: GuardrailsSettings = {
  enabled: true,
};

export class GuardrailsConfigLoader {
  private enabledRef: { value: boolean };

  constructor() {
    this.enabledRef = { value: true };
  }

  get enabled(): boolean {
    return this.enabledRef.value;
  }

  set enabled(value: boolean) {
    this.enabledRef.value = value;
  }

  async load(): Promise<void> {
    this.enabledRef.value = (
      await loadEnabledSetting(
        GUARDRAILS_SETTINGS_KEY,
        DEFAULT_GUARDRAILS_SETTINGS,
      )
    ).enabled;
  }

  async save(): Promise<void> {
    await saveEnabledSetting(
      GUARDRAILS_SETTINGS_KEY,
      { enabled: this.enabledRef.value },
      () =>
        loadEnabledSetting(
          GUARDRAILS_SETTINGS_KEY,
          DEFAULT_GUARDRAILS_SETTINGS,
        ),
    );
  }
}

export const configLoader = new GuardrailsConfigLoader();
