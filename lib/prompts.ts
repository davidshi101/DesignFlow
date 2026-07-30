/** Shared prompt defaults (safe for client + server). */

export const DEFAULT_SKETCH_PROMPT =
  "Single garment, one view per generation (front and back, run separately using the corresponding reference for each and produce both images). Preserve the exact silhouette, proportions, seam placement, stitching detail, and hardware (buttons, zippers, drawstrings, trims) from the reference — do not add, remove, or reinterpret design details not present in the source. Adjust construction detail to the garment category shown (e.g., collars and closures for outerwear, seaming for knits) without altering the process. If the input is a reference photo, convert it to flat-sketch form: remove the body, remove fabric drape and folds, and flatten the garment as if laid on a table. If the input is an existing flat sketch, preserve its exact linework and apply only the requested style-match or light reinterpretation — do not regenerate from scratch. Generate once within [BRAND]'s locked line-art conventions ([line weight, croqui proportions, stitch-line style — insert brand standard]) — this is a single ced pass, not an iterative regeneration loop. Render as clean black-and-white technical line art only: uniform line weight, no shading, no rendering, no color fill, no texture fill, unless a specific colorway or print is provided. Output must be clean vector line art that opens as fully editable paths — no rasterized or flattened linework, no merged/closed compound paths that block node-level editing.\n" +
  "Avoid: rendered or shaded artwork, fashion illustration style, photographic texture, a body or mannequin in the output, multiple garments or views in one frame, altered proportions or silhouette, invented design elements, color or print unless specified, raster output, text, watermarks, logos, measurement callouts.";

export const DEFAULT_MINIBODY_PROMPT =
  "Transform this flat CAD-filled garment sketch into a photorealistic product laydown render — add natural fabric drape, dimensional shading, soft realistic shadows, and subtle depth as if photographed lying flat or on an invisible mannequin. Keep the exact print, pattern placement, scale, and colors from the sketch unchanged — do not reinterpret, recolor, or resize any design element. Do not add a person, model, or 3D avatar — this is a flat product shot, just rendered with realistic dimensionality instead of flat vector color. Camera angle, framing, crop, lighting direction, and background must stay identical across every colorway generated for this product, so the full set aligns cleanly side by side in a deck or tech pack. Background is plain and consistent (white or transparent), with no props, surfaces, or added scene elements.\n" +
  "Avoid: a person, model, mannequin form, or 3D avatar of any kind; multiple garments in one frame; collage or grid layout; altered silhouette, proportions, or construction details; invented design elements; recolored or shifted print; mismatched framing, lighting, or background between colorways; text, watermarks, logos, borders.";

/**
 * Hard constraints always prepended server-side (not shown in the editable
 * textarea). Keep short so the user's prompt still has room to steer style.
 */
export const SKETCH_GUARDRAIL = `You are generating a garment-only technical flat sketch for a fashion design pipeline.

Hard rules (do not break these):
- Output ONLY the garment as line art. No person, model, mannequin, body, face, hands, legs, hair, or skin.
- Remove the wearer completely — draw the clothing as a standalone product flat, not worn.
- Plain white background. No props, hangers, tags, or environment.
- Preserve the garment's shape and construction from the reference image; do not invent a second view (no front+back composite unless the reference already shows both).

Follow the user instructions below within those rules:`;

export const MINIBODY_GUARDRAIL = `You are generating a garment-only dimensional product render for a fashion design pipeline.

Hard rules (do not break these):
- Output ONLY the garment. No person, model, 3D avatar, mannequin body, face, hands, legs, hair, or skin.
- No lifestyle scene, studio set, or props — just the garment with realistic fabric depth on a clean neutral background.
- Do not change the print, pattern placement, or colors from the input filled sketch.

Follow the user instructions below within those rules:`;

/** Combine always-on guardrail with the (editable) user prompt. */
export function withSketchGuardrail(userPrompt: string): string {
  return `${SKETCH_GUARDRAIL}\n\n${userPrompt.trim()}`;
}

export function withMinibodyGuardrail(userPrompt: string): string {
  return `${MINIBODY_GUARDRAIL}\n\n${userPrompt.trim()}`;
}
