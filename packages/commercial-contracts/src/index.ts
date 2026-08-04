export type PublicPlanCatalogEntry = {
  planId: string;
  version: string;
  displayName: string;
  currency: 'JPY';
  recurringAmount: number;
  recurringInterval: 'month' | 'year' | 'none';
  includedCredits: number;
  entitlementIds: string[];
  active: boolean;
};

export type PublicCreditProduct = {
  productId: string;
  version: string;
  displayName: string;
  currency: 'JPY';
  amount: number;
  credits: number;
  active: boolean;
};

export type PublicCommercialCatalog = {
  catalogVersion: string;
  checksum: string;
  publishedAt: string;
  plans: PublicPlanCatalogEntry[];
  creditProducts: PublicCreditProduct[];
};

export function validatePublicCatalog(catalog: PublicCommercialCatalog): string[] {
  const errors: string[] = [];
  if (!catalog.catalogVersion) errors.push('catalogVersion');
  if (!catalog.checksum) errors.push('checksum');
  if (!Number.isFinite(Date.parse(catalog.publishedAt))) errors.push('publishedAt');
  if (catalog.plans.some((plan) => plan.recurringAmount < 0 || plan.includedCredits < 0)) errors.push('plans');
  if (catalog.creditProducts.some((product) => product.amount <= 0 || product.credits <= 0)) errors.push('creditProducts');
  return errors;
}
