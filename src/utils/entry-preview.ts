export type EntryTransactionType = 'CASH_IN' | 'CASH_OUT' | 'E_LOAD' | 'TV_LOAD';

export type EntryFeeSettings = {
  cash_step_amount?: string | null;
  cash_fee_per_step?: string | null;
  eload_threshold?: string | null;
  eload_fee_low?: string | null;
  eload_fee_high?: string | null;
  tvload_fee?: string | null;
};

export type EntryPreviewInput = {
  type: EntryTransactionType;
  amount: number;
  fee: number;
  channelLabel: string;
  isDebt: boolean;
  deductFee: boolean;
};

export type EntryPreviewRow = {
  label: string;
  value: string;
};

const formatMoney = (value: number) =>
  `₱${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export function calculateSuggestedEntryFee(
  type: EntryTransactionType,
  amount: number,
  settings?: EntryFeeSettings | null
) {
  if (amount <= 0) return 0;

  const cashStep = Number.parseFloat(settings?.cash_step_amount || '500');
  const cashFee = Number.parseFloat(settings?.cash_fee_per_step || '10');
  const eloadThreshold = Number.parseFloat(settings?.eload_threshold || '99');
  const eloadFeeLow = Number.parseFloat(settings?.eload_fee_low || '5');
  const eloadFeeHigh = Number.parseFloat(settings?.eload_fee_high || '10');
  const tvloadFee = Number.parseFloat(settings?.tvload_fee || '15');

  if (type === 'CASH_IN' || type === 'CASH_OUT') {
    return Math.ceil(amount / cashStep) * cashFee;
  }
  if (type === 'E_LOAD') {
    return amount < eloadThreshold ? eloadFeeLow : eloadFeeHigh;
  }
  return tvloadFee;
}

export function getEntryPreviewRows({
  type,
  amount,
  fee,
  channelLabel,
  isDebt,
  deductFee,
}: EntryPreviewInput): EntryPreviewRow[] {
  if (amount <= 0) return [];

  const deductApplies = deductFee && (type === 'CASH_IN' || type === 'CASH_OUT');
  const customerTotal = amount + (deductApplies ? 0 : fee);
  const payout = deductApplies ? amount - fee : amount;

  switch (type) {
    case 'CASH_IN':
      return [
        { label: isDebt ? 'Debt added' : 'Customer pays', value: formatMoney(customerTotal) },
        { label: `${channelLabel} sent`, value: formatMoney(payout) },
      ];
    case 'CASH_OUT':
      return [
        { label: 'Cash handed out', value: formatMoney(payout) },
        { label: isDebt ? 'Debt added' : `${channelLabel} received`, value: formatMoney(customerTotal) },
      ];
    case 'E_LOAD':
    case 'TV_LOAD':
      return [
        { label: isDebt ? 'Debt added' : 'Customer pays', value: formatMoney(customerTotal) },
        { label: `${channelLabel} load sent`, value: formatMoney(amount) },
      ];
  }
}
