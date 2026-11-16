// APP-05: remembered settings per tool (P13).
export { SETTINGS_VERSION, settingsKey, useToolSettings } from './use-tool-settings';
export {
  numberIn,
  oneOf,
  parseSettings,
  sanitizeSettings,
  type SettingCheck,
  type SettingsSchema,
} from './schema';
