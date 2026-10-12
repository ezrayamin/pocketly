import { runContractSuite } from '@pocketly/core-contract/src/testing/contractSuite';
import { testCore } from '../testing/testCore';

runContractSuite('core-js', () => testCore());
