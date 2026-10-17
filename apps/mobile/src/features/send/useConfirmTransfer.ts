import { useCallback, useState } from 'react';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { TransferAuth, TransferResult, TransferReview } from '@pocketly/core-contract';
import { core } from '../../core';
import type { RootStackParamList } from '../../navigation';

type Navigation = NativeStackNavigationProp<RootStackParamList>;

/**
 * Sends the reviewed attempt (FR-TRF-04..09) and moves to the result once there is one. While
 * it runs, `sending` is true (the processing screen, FR-TRF-06); a second tap joins the same
 * call in the core anyway (FR-TRF-05). An answer still in DRAFT (not authorized) comes back to
 * the caller, which explains it. The result replaces the flow in the back stack, so Back can't
 * reopen a sent transfer (product §7.3 rule 3).
 */
export function useConfirmTransfer(review: TransferReview, navigation: Navigation) {
  const [sending, setSending] = useState(false);

  const confirm = useCallback(
    async (auth?: TransferAuth): Promise<TransferResult | undefined> => {
      setSending(true);
      try {
        const result = await core.confirmTransfer(review.id, auth);
        if (result.state === 'DRAFT') {
          setSending(false);
          return result;
        }
        showResult(navigation, review, result);
        return result;
      } catch (e) {
        setSending(false);
        throw e;
      }
    },
    [navigation, review],
  );

  return { sending, confirm };
}

export function showResult(navigation: Navigation, review: TransferReview, result: TransferResult): void {
  navigation.reset({ index: 1, routes: [{ name: 'Tabs' }, { name: 'SendResult', params: { review, result } }] });
}
