import { runContractSuite } from '@pocketly/core-contract/src/testing/contractSuite';
import { JsCore } from '../src/jsCore';

runContractSuite('core-js', () => new JsCore());
