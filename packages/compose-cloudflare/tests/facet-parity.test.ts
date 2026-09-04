import { env, runInDurableObject } from 'cloudflare:test'
import { describe } from 'vitest'
import {
  runInstanceContract,
  sourceArm,
} from '../../compose/tests/helpers/instance-contract'
import type { ContractArm } from '../../compose/tests/helpers/instance-contract'
import type { Host } from '@tanstack/compose'
import type { FacetTestObject } from '../dev/facet-test-object'

let current: Host | undefined
let scopeId = 0

const delegated: Host = {
  name: 'facet',
  start: (request) => {
    if (!current) throw new Error('facet parity ran outside its DO scope')
    return current.start(request)
  },
}

const arm: ContractArm = sourceArm('facet', {
  facet: delegated,
})
arm.scope = async (work) => {
  scopeId += 1
  const object = (
    env as unknown as {
      FACET_TEST: DurableObjectNamespace<FacetTestObject>
    }
  ).FACET_TEST.getByName(`parity-${scopeId}`)
  return await runInDurableObject(object, async (instance) => {
    current = instance.facetHost()
    try {
      return await work()
    } finally {
      current = undefined
    }
  })
}

describe('facet-host parity with the kernel contract', () => {
  runInstanceContract(arm)
})
