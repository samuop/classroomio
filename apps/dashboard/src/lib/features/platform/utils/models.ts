/** Shared labelling for the two model pickers (deployment-wide and per-organisation). */

export interface SelectableModel {
  id: string;
  multiplier: number;
  isMeasuredCost: boolean;
  isLive: boolean;
}

/**
 * Stands in for "no model of my own — inherit".
 *
 * Not the empty string: bits-ui reads `''` as nothing selected, so the inherit
 * option would be unpickable and the trigger would sit blank.
 */
export const INHERIT_MODEL = '__inherit__';

/**
 * "≈" marks a model nobody has priced. It is counted at 1× against the monthly
 * cap and that 1× is a guess, which is exactly the kind of thing an operator
 * setting caps in those units needs to see before choosing.
 */
export function modelCostLabel(model: SelectableModel): string {
  return model.isMeasuredCost ? `${model.multiplier}×` : `≈${model.multiplier}×`;
}

export function modelOptionLabel(model: SelectableModel): string {
  return `${model.id} (${modelCostLabel(model)})`;
}

/** What the closed trigger shows. Falls back to the raw id for a stored model Google no longer lists. */
export function selectedModelLabel(models: SelectableModel[], id: string | null, inheritLabel: string): string {
  if (!id) return inheritLabel;

  const found = models.find((model) => model.id === id);

  return found ? modelOptionLabel(found) : id;
}
