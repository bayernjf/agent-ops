import { z } from 'zod';

// ② 收敛层：webapp 交付的对外接口从"7 类 productType"收敛为 preset。
//
// 迁移方案 §3 把内核任务的能力描述定为 task.recipe + preset，而不再把
// 每一种产品形态当作第一选择对象。这里定义 preset 的对外形状：
//   - webapp-golden-path：聚合 6 类 webapp 模板（web-app / landing-page /
//     browser-extension / desktop / mobile / api-tool），generator 实现全部保留；
//   - storefront：独立站模板（同一 commerce-os 电商内核的独立站前台），
//     不再是 productType 列表里的普通一项，而是与 golden-path 平级的 preset。
//
// 保留 productTypeSchema 的 7 值不变（方案 B：不物理删除 generator 实现），
// preset 只是对外收敛后的第一层选择。内核 task.recipe 的取值约定为 preset id
// 或具体 productType，两者都合法。

export const presetIdSchema = z.enum(['webapp-golden-path', 'storefront']);
export type PresetId = z.infer<typeof presetIdSchema>;

export const PRESET_PRODUCT_TYPES: Record<PresetId, readonly string[]> = {
  'webapp-golden-path': ['web-app', 'landing-page', 'browser-extension', 'desktop', 'mobile', 'api-tool'],
  storefront: ['storefront'],
};

/** 把任意 productType 归到它所属的 preset；未知类型一律落入 golden-path。 */
export function presetForProductType(productType: string): PresetId {
  return productType === 'storefront' ? 'storefront' : 'webapp-golden-path';
}

export function productTypesForPreset(preset: PresetId): readonly string[] {
  return PRESET_PRODUCT_TYPES[preset];
}
