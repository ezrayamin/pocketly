import { createBench } from '@pocketly/core-js-bench';
import { runContractSuite } from '@pocketly/core-contract/src/testing/contractSuite';
import { testCore } from '../testing/testCore';

runContractSuite('core-js', () => {
  const core = testCore();
  return {
    core,
    bench: createBench(core),
    resetDataWithExtras: (config, extraTransactions) => core['reset']({ ...config, extraTransactions }),
  };
});
