import { useCallback, useState } from 'react';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { TransferAuth, TransferResult } from '@pocketly/core-contract';
import { core } from '../../core';
import type { RootStackParamList } from '../../navigation';
import { showResult, type Payment } from './payment';

type Navigation = NativeStackNavigationProp<RootStackParamList>;

/**
 * Sends the reviewed attempt (FR-TRF-04..09, FR-QR-04) and moves to the result once there is one.
 * While it runs, `sending` is true (the processing screen, FR-TRF-06); a second tap joins the same
 * call in the core anyway (FR-TRF-05). An answer still in DRAFT (not authorized) comes back to
 * the caller, which explains it. The result replaces the flow in the back stack, so Back can't
 * reopen a sent payment (product §7.3 rule 3).
 */
export function useConfirmTransfer(payment: Payment, navigation: Navigation) {
  const [sending, setSending] = useState(false);

  const confirm = useCallback(
    async (auth?: TransferAuth): Promise<TransferResult | undefined> => {
      setSending(true);
      try {
        const result = await core.confirmTransfer(payment.review.id, auth);
        if (result.state === 'DRAFT') {
          setSending(false);
          return result;
        }
        showResult(navigation, payment, result);
        return result;
      } catch (e) {
        setSending(false);
        throw e;
      }
    },
    [navigation, payment],
  );

  return { sending, confirm };
}
