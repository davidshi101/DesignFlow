export const PRINTS = [
  { id: "floral", label: "Floral", src: "/prints/floral.png" },
  { id: "stripe", label: "Stripe", src: "/prints/stripe.png" },
  { id: "check", label: "Check", src: "/prints/check.png" },
  { id: "dots", label: "Dots", src: "/prints/dots.png" },
] as const;

export type PrintId = (typeof PRINTS)[number]["id"];

export interface CadControls {
  printId: PrintId;
  scale: number; // 0.5–2
  rotation: number; // 0–360
  mirrored: boolean;
  hue: number; // 0–360 colorway / hue-rotate
}

export const DEFAULT_CAD_CONTROLS: CadControls = {
  printId: "floral",
  scale: 1,
  rotation: 0,
  mirrored: false,
  hue: 0,
};

export const BATCH_SCALES = [0.8, 1.4] as const;
export const BATCH_HUES = [0, 180] as const;
