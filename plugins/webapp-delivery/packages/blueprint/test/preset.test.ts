import { describe, expect, it } from 'vitest';
import {
  PRESET_PRODUCT_TYPES,
  presetForProductType,
  presetIdSchema,
  productTypesForPreset,
} from '../src/preset.js';

describe('blueprint preset convergence (②)', () => {
  it('exposes exactly the two presets', () => {
    expect(presetIdSchema.options).toEqual(['webapp-golden-path', 'storefront']);
  });

  it('keeps all six golden-path product types, with storefront as its own preset', () => {
    expect(PRESET_PRODUCT_TYPES['webapp-golden-path']).toEqual([
      'web-app',
      'landing-page',
      'browser-extension',
      'desktop',
      'mobile',
      'api-tool',
    ]);
    expect(PRESET_PRODUCT_TYPES.storefront).toEqual(['storefront']);
  });

  it('routes every product type to its preset', () => {
    expect(presetForProductType('storefront')).toBe('storefront');
    for (const productType of PRESET_PRODUCT_TYPES['webapp-golden-path']) {
      expect(presetForProductType(productType)).toBe('webapp-golden-path');
    }
    // Unknown types fall back to the golden path, not to storefront.
    expect(presetForProductType('future-product')).toBe('webapp-golden-path');
  });

  it('expands a preset back to its product types', () => {
    expect(productTypesForPreset('webapp-golden-path')).toHaveLength(6);
    expect(productTypesForPreset('storefront')).toEqual(['storefront']);
  });
});
