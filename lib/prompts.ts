/** Shared prompt defaults (safe for client + server). */

export const DEFAULT_SKETCH_PROMPT =
  "Generate a clean flat 2D fashion line-art sketch of this garment, front and back view, in the style of a technical fashion CAD flat sketch — black line art on white background, no shading, no color, no model.";

export const DEFAULT_MINIBODY_PROMPT =
  "Transform this flat CAD-filled garment sketch into a photorealistic product laydown render — add natural fabric drape, dimensional shading, soft realistic shadows, and subtle depth as if photographed lying flat or on an invisible mannequin. Keep the exact print, pattern placement, and colors from the sketch unchanged. Do not add a person, model, or 3D avatar — this is a flat product shot, just rendered with realistic dimensionality instead of flat vector color.";
