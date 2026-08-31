import { describe } from 'vitest'
import {
  pluginArm,
  runInstanceContract,
  sourceArm,
} from '../../compose/tests/helpers/instance-contract'
import { testHost } from './helpers/host'

/**
 * The kernel's own parity suite, run with this host in place of the in-process
 * one. It is a third arm and no new assertions: what the kernel promises of an
 * instance it promises of one whose code is in an isolate. The control arm runs
 * alongside so a weakened assertion would fail here too.
 */
describe('a written plugin in a Dynamic Worker behaves as an ordinary instance', () => {
  runInstanceContract(pluginArm)
  runInstanceContract(
    sourceArm('cloudflare', { cloudflare: testHost({ callTimeoutMs: 2000 }) }),
  )
})
