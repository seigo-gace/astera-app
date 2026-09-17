import {
  COMMERCIAL_CATALOG_CANONICAL,
  CREDIT_PRODUCTS,
  PLAN_ANNUAL_JPY,
  PLAN_INCLUDED_CREDITS,
  PLAN_MONTHLY_JPY,
  STORAGE_PACKS,
  annualMonthlyEquivalent,
  formatCreditsAmount,
  formatYenAnnual,
  formatYenMonthly,
  formatYenPack,
} from '../../platform/commercial-catalog-canonical';

const freeIncluded = PLAN_INCLUDED_CREDITS.free ?? 10000;
const freeBonus = COMMERCIAL_CATALOG_CANONICAL.plans.find((plan) => plan.plan_id === 'free')?.free_signup_bonus_credits ?? 10000;

function paidPlanCreditValue(planId: string, locale: 'ja-JP' | 'en-US'): string {
  return formatCreditsAmount(PLAN_INCLUDED_CREDITS[planId] ?? 0, locale);
}

function buildCredits(locale: 'ja' | 'en') {
  const numberLocale = locale === 'ja' ? 'ja-JP' : 'en-US';
  return CREDIT_PRODUCTS.map((product) => ({
    name: product.display_name,
    price: formatYenPack(product.amount, locale),
    creditValue: formatCreditsAmount(product.credits, numberLocale),
  }));
}

function buildStorage(locale: 'ja' | 'en') {
  const plus = locale === 'ja' ? '＋' : '+';
  return STORAGE_PACKS.map((pack) => ({
    name: pack.display_name.replace('+', plus),
    price: formatYenPack(pack.price_jpy, locale),
  }));
}

function buildPaidPlans(locale: 'ja' | 'en') {
  const numberLocale = locale === 'ja' ? 'ja-JP' : 'en-US';
  const paidIds = ['basic', 'pro', 'business', 'enterprise'] as const;
  const featureMap = {
    ja: {
      basic: [
        '基本機能',
        '高精度翻訳',
        '書類作成',
        'Private Mode',
        '外部Storage転送',
        'Astera Storage',
      ],
      pro: [
        '基本機能',
        '高精度翻訳',
        '書類作成',
        'Private Mode',
        '外部Storage転送',
        'Astera Storage',
        'Astera公式／個別書類テンプレート',
        'API',
      ],
      business: [
        '基本機能',
        '高精度翻訳',
        '書類作成',
        'Private Mode',
        '外部Storage転送',
        'Astera Storage',
        'Astera公式／個別書類テンプレート',
        'API',
      ],
      enterprise: [
        '基本機能',
        '高精度翻訳',
        '書類作成',
        'Private Mode',
        '外部Storage転送',
        'Astera Storage',
        'Astera公式／個別書類テンプレート',
        'API',
      ],
    },
    en: {
      basic: [
        'Core features',
        'High-accuracy translation',
        'Document creation',
        'Private Mode',
        'External storage transfer',
        'Astera Storage',
      ],
      pro: [
        'Core features',
        'High-accuracy translation',
        'Document creation',
        'Private Mode',
        'External storage transfer',
        'Astera Storage',
        'Astera official / custom document templates',
        'API',
      ],
      business: [
        'Core features',
        'High-accuracy translation',
        'Document creation',
        'Private Mode',
        'External storage transfer',
        'Astera Storage',
        'Astera official / custom document templates',
        'API',
      ],
      enterprise: [
        'Core features',
        'High-accuracy translation',
        'Document creation',
        'Private Mode',
        'External storage transfer',
        'Astera Storage',
        'Astera official / custom document templates',
        'API',
      ],
    },
  } as const;

  return paidIds.map((planId) => {
    const meta = COMMERCIAL_CATALOG_CANONICAL.plans.find((plan) => plan.plan_id === planId);
    return {
      id: planId,
      name: meta?.display_name ?? planId,
      monthlyPrice: formatYenMonthly(PLAN_MONTHLY_JPY[planId] ?? 0, locale),
      annualPrice: formatYenAnnual(PLAN_ANNUAL_JPY[planId] ?? 0, locale),
      annualMonthlyEquivalent: annualMonthlyEquivalent(planId, locale),
      creditValue: paidPlanCreditValue(planId, numberLocale),
      features: [...featureMap[locale][planId]],
    };
  });
}

export const PLAN_CREDIT_TEXT = {
  ja: {
    pageTitle: 'プラン / クレジット',
    planSectionTitle: 'プラン',
    creditSectionTitle: '追加クレジット',
    storageSectionTitle: '追加ストレージ',
    storageSectionDescription: '何度でも購入でき合算されます。',
    monthlyCredit: '月次Credit',
    grantedCredit: '付与Credit',
    includedFeatures: '利用できる機能',
    selectedPlanLabel: '契約中',
    billingMonthly: '月額',
    billingAnnual: '年額',
    annualSaving: '2か月分お得',
    monthlyEquivalent: '月換算',
    monthlyGrant: 'Creditは毎月付与',
    plans: [
      {
        id: 'free',
        name: 'Free',
        monthlyPrice: formatYenMonthly(0, 'ja'),
        annualPrice: formatYenAnnual(0, 'ja'),
        creditValue: `初回 ${formatCreditsAmount(freeIncluded + freeBonus, 'ja-JP')} / 以後 ${formatCreditsAmount(freeIncluded, 'ja-JP')}`,
        basicFeature: {
          label: '基本機能',
          columns: [
            {
              title: '用途選択',
              items: ['├レビュー', '├比較', '├検証', '├改善', '├調査', '├計画', '└検討'],
            },
            {
              items: ['目的整理', '前提・不足確認', '事実確認', 'リスク確認', '反対視点の確認', '選択肢の比較', '推奨案の整理'],
            },
          ],
        },
      },
      ...buildPaidPlans('ja'),
    ],
    credits: buildCredits('ja'),
    storage: buildStorage('ja'),
  },
  en: {
    pageTitle: 'Plan / Credit',
    planSectionTitle: 'Plans',
    creditSectionTitle: 'Additional Credit',
    storageSectionTitle: 'Additional Storage',
    storageSectionDescription: 'Purchase as many times as needed; capacities are combined.',
    monthlyCredit: 'Monthly credit',
    grantedCredit: 'Granted credit',
    includedFeatures: 'Included features',
    selectedPlanLabel: 'Current',
    billingMonthly: 'Monthly',
    billingAnnual: 'Annual',
    annualSaving: '2 months free',
    monthlyEquivalent: 'Monthly equivalent',
    monthlyGrant: 'Credits are granted monthly',
    plans: [
      {
        id: 'free',
        name: 'Free',
        monthlyPrice: formatYenMonthly(0, 'en'),
        annualPrice: formatYenAnnual(0, 'en'),
        creditValue: `${formatCreditsAmount(freeIncluded + freeBonus, 'en-US')} first month / ${formatCreditsAmount(freeIncluded, 'en-US')} after`,
        basicFeature: {
          label: 'Core features',
          columns: [
            {
              title: 'Use cases',
              items: ['├Review', '├Compare', '├Verify', '├Improve', '├Research', '├Plan', '└Consider'],
            },
            {
              items: ['Clarify purpose', 'Check missing context', 'Check facts', 'Check risks', 'Check opposing views', 'Compare options', 'Organize recommendations'],
            },
          ],
        },
      },
      ...buildPaidPlans('en'),
    ],
    credits: buildCredits('en'),
    storage: buildStorage('en'),
  },
} as const;
