// M11 UI kit (P02): shared components and theme. Styles: import './theme.css' once in the root.
export { Badge, badgeVariants, type BadgeProps } from './badge';
export { Button, buttonVariants, type ButtonProps } from './button';
export { Card, type CardProps } from './card';
export { Checkbox, type CheckboxProps } from './checkbox';
export { CompareSlider, type CompareSliderProps } from './compare-slider';
export { HelpTip, type HelpTipProps } from './help-tip';
export { IconButton, type IconButtonProps } from './icon-button';
export { Input, inputClass } from './input';
export { Kbd } from './kbd';
export { Helper, Label } from './label';
export { Logo, type LogoProps } from './logo';
export { Note, type NoteProps } from './note';
export { clamp, NumberField, type NumberFieldProps } from './number-field';
export { ProgressBar, type ProgressBarProps } from './progress-bar';
export {
  FitFillPicture,
  RadioCards,
  type RadioCardOption,
  type RadioCardsProps,
} from './radio-cards';
export { ResetButton } from './reset-button';
export { Segmented, type SegmentedOption, type SegmentedProps } from './segmented';
export { Select, type SelectOption, type SelectProps } from './select';
export { Slider, type SliderProps } from './slider';
export { strings } from './strings';
export { Swatches, type SwatchOption, type SwatchesProps } from './swatches';
export { ThemeScript, themeScript } from './theme-script';
export { ThemeToggle, type ThemeToggleProps } from './theme-toggle';
export { Toaster, toast, type ToastOptions } from './toaster';
export {
  applyTheme,
  nextTheme,
  setTheme,
  THEME_STORAGE_KEY,
  useTheme,
  type Theme,
  type UseTheme,
} from './hooks/use-theme';
