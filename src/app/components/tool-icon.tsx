import {
  ArrowLeftRight,
  Camera,
  Combine,
  Eraser,
  FileImage,
  Gauge,
  Images,
  Layers,
  LayoutGrid,
  Scaling,
  Scan,
  Shrink,
  Smartphone,
  Split,
  Wrench,
  type LucideIcon,
  type LucideProps,
} from 'lucide-react';

/**
 * Lucide icons by the names used in the registry (`ToolMeta.icon`). Listed one by one so only
 * these icons end up in the bundle. Add a line here when a tool uses a new icon.
 */
const icons: Record<string, LucideIcon> = {
  'arrow-left-right': ArrowLeftRight,
  camera: Camera,
  combine: Combine,
  eraser: Eraser,
  'file-image': FileImage,
  gauge: Gauge,
  images: Images,
  layers: Layers,
  'layout-grid': LayoutGrid,
  scaling: Scaling,
  scan: Scan,
  shrink: Shrink,
  smartphone: Smartphone,
  split: Split,
};

export function hasToolIcon(name: string): boolean {
  return name in icons;
}

/** Decorative tool icon; falls back to a wrench for an unknown name. */
export function ToolIcon({ name, ...props }: { name: string } & LucideProps) {
  const Icon = icons[name] ?? Wrench;
  return <Icon aria-hidden="true" {...props} />;
}
