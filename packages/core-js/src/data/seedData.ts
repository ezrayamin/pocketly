import type {
  Category,
  Counterparty,
  DatasetConfig,
  ErrorCode,
  Transaction,
  TransactionStatus,
  TransactionType,
} from '@pocketly/core-contract';
import { SeededRandom } from './random';

/**
 * FR-FAKE-01 dataset generator. Mirrors shared/.../data/fake/SeedData.kt draw-for-draw:
 * every entry consumes exactly 8 random numbers in the same order, whatever branch it takes.
 */

export const WALLET_ID = 'w-main';
export const DAILY_LIMIT = 500_000;
export const OPENING_BALANCE = 1_000_000;

const MINUTE = 60_000;
const WINDOW_MINUTES = 60 * 24 * 60;

export const CONTACTS: readonly Counterparty[] = [
  'Andi Pratama',
  'Budi Santoso',
  'Citra Lestari',
  'Dewi Anggraini',
  'Eko Saputra',
  'Fajar Nugroho',
  'Gita Permata',
  'Hadi Wijaya',
  'Intan Maharani',
  'Joko Susilo',
].map((name, i) => {
  const n = String(i + 1).padStart(2, '0');
  return { kind: 'USER', id: `u-${n}`, name, phone: `+155500000${n}` };
});

const MERCHANTS: readonly { counterparty: Counterparty; category: Category }[] = (
  [
    ['Corner Coffee', 'FOOD'],
    ['Noodle House', 'FOOD'],
    ['Metro Transit', 'TRANSPORT'],
    ['QuickRide', 'TRANSPORT'],
    ['Fresh Mart', 'SHOPPING'],
    ['Style Outlet', 'SHOPPING'],
    ['City Power', 'BILLS'],
    ['Net Fiber', 'BILLS'],
    ['Star Cinema', 'ENTERTAINMENT'],
    ['Game Arcade', 'ENTERTAINMENT'],
  ] as const
).map(([name, category], i) => ({
  counterparty: { kind: 'MERCHANT', id: `m-${String(i + 1).padStart(2, '0')}`, name },
  category,
}));

const PAYMENT_METHODS: readonly Counterparty[] = [
  { kind: 'PAYMENT_METHOD', id: 'pm-bank', name: 'Bank transfer' },
  { kind: 'PAYMENT_METHOD', id: 'pm-card', name: 'Card' },
];

const NOTES = ['Lunch', 'Rent share', 'Thanks!', 'Groceries', 'Birthday gift', 'Dinner split'];
const FAILURE_REASONS: readonly ErrorCode[] = ['INSUFFICIENT_FUNDS', 'SERVER_ERROR', 'RECIPIENT_NOT_FOUND'];

function txId(i: number): string {
  return `tx-${String(i).padStart(6, '0')}`;
}

function pickType(roll: number): TransactionType {
  if (roll < 45) return 'QR_PAYMENT';
  if (roll < 70) return 'TRANSFER_OUT';
  if (roll < 88) return 'TRANSFER_IN';
  return 'TOP_UP';
}

function pickStatus(roll: number): TransactionStatus {
  if (roll < 90) return 'SUCCESS';
  if (roll < 95) return 'FAILED';
  if (roll < 98) return 'PENDING';
  return 'REVERSED';
}

/** `now` is the backend clock at seeding time (config.nowMillis when frozen). */
export function generateTransactions(config: DatasetConfig, now: number): Transaction[] {
  const rng = new SeededRandom(config.seed);
  const out: Transaction[] = [];

  const openingAt = now - (WINDOW_MINUTES + 24 * 60) * MINUTE;
  out.push({
    id: txId(0),
    idempotencyKey: `seed-${config.seed}-0`,
    type: 'TOP_UP',
    category: 'TOP_UP',
    amount: OPENING_BALANCE,
    counterparty: PAYMENT_METHODS[0],
    note: 'Opening balance',
    status: 'SUCCESS',
    createdAt: openingAt,
    updatedAt: openingAt,
  });

  for (let i = 1; i < config.transactionCount; i++) {
    const minutesAgo = rng.nextInt(WINDOW_MINUTES) + 1;
    const typeRoll = rng.nextInt(100);
    const amountRoll = rng.nextInt(1_000_000);
    const statusRoll = rng.nextInt(100);
    const failureRoll = rng.nextInt(FAILURE_REASONS.length);
    const counterpartyRoll = rng.nextInt(1000);
    const noteRoll = rng.nextInt(4);
    const notePick = rng.nextInt(NOTES.length);

    const type = pickType(typeRoll);
    const status = pickStatus(statusRoll);
    const createdAt = now - minutesAgo * MINUTE;

    let amount: number;
    let category: Category;
    let counterparty: Counterparty;
    switch (type) {
      case 'QR_PAYMENT': {
        const merchant = MERCHANTS[counterpartyRoll % MERCHANTS.length];
        amount = 100 + (amountRoll % 15_000);
        category = merchant.category;
        counterparty = merchant.counterparty;
        break;
      }
      case 'TRANSFER_OUT':
        amount = 500 + (amountRoll % 50_000);
        category = 'TRANSFER';
        counterparty = CONTACTS[counterpartyRoll % CONTACTS.length];
        break;
      case 'TRANSFER_IN':
        amount = 500 + (amountRoll % 60_000);
        category = 'TRANSFER';
        counterparty = CONTACTS[counterpartyRoll % CONTACTS.length];
        break;
      case 'TOP_UP':
        amount = (1 + (amountRoll % 20)) * 5_000;
        category = 'TOP_UP';
        counterparty = PAYMENT_METHODS[counterpartyRoll % PAYMENT_METHODS.length];
        break;
    }

    const tx: Transaction = {
      id: txId(i),
      idempotencyKey: `seed-${config.seed}-${i}`,
      type,
      category,
      amount,
      counterparty,
      status,
      createdAt,
      updatedAt: createdAt,
    };
    if ((type === 'TRANSFER_OUT' || type === 'TRANSFER_IN') && noteRoll === 0) {
      tx.note = NOTES[notePick];
    }
    if (status === 'FAILED') {
      tx.failureReason = FAILURE_REASONS[failureRoll];
    }
    out.push(tx);
  }
  return out;
}
