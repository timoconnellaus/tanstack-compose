import { createContextKey } from '@tanstack/compose'
import { assertType, describe, expectTypeOf, test } from 'vitest'
import {
  Slot,
  createSlot,
  createSlotRegistry,
  useContextKey,
} from '../src/index'
import type { AnySlot, Fill, PropsOf, SlotRegistry } from '../src/index'

interface Entry {
  kind: 'note' | 'warning'
  text: string
}

const toolbar = createSlot<{ busy: boolean }>('toolbar')
const banner = createSlot('banner', { cardinality: 'single' })
const message = createSlot<{ entry: Entry }>('message', {
  cardinality: 'keyed',
  key: (props) => props.entry.kind,
})

const registry: SlotRegistry = createSlotRegistry()

describe('a fill of a slot', () => {
  test('sees the slot props, with no cast', () => {
    registry.fill(toolbar, {
      render: (props) => {
        expectTypeOf(props).toEqualTypeOf<{ busy: boolean }>()
        return null
      },
    })

    registry.fill(message, {
      key: 'note',
      render: ({ entry }) => {
        expectTypeOf(entry).toEqualTypeOf<Entry>()
        return null
      },
    })
  })

  test('is refused when its renderer wants props the slot does not pass', () => {
    // @ts-expect-error the toolbar passes `busy`, not `entry`
    registry.fill(toolbar, { render: (props: { entry: Entry }) => props.entry })
  })

  test('needs a key exactly when the slot is keyed', () => {
    // @ts-expect-error a keyed slot's fill answers to a key
    registry.fill(message, { render: () => null })
    registry.fill(toolbar, { render: () => null })
  })

  test('carries the slot props in the fills read back', () => {
    const [first] = registry.fills(message)
    expectTypeOf(first?.render).toEqualTypeOf<
      Fill<{ entry: Entry }>['render'] | undefined
    >()
    expectTypeOf<PropsOf<typeof message>>().toEqualTypeOf<{ entry: Entry }>()
  })
})

describe('the Slot component', () => {
  test('demands the props its slot passes', () => {
    assertType(<Slot of={toolbar} props={{ busy: true }} />)
    // @ts-expect-error `busy` is a boolean
    assertType(<Slot of={toolbar} props={{ busy: 'yes' }} />)
    // @ts-expect-error the toolbar passes props, so they cannot be left out
    assertType(<Slot of={toolbar} />)
  })

  test('takes no props for a slot that passes none', () => {
    assertType(<Slot of={banner} />)
  })

  test('types the fill handed to a wrapper', () => {
    const entry: Entry = { kind: 'note', text: 'hi' }
    assertType(
      <Slot of={message} props={{ entry }}>
        {(rendered, fill) => {
          expectTypeOf(fill.id).toEqualTypeOf<string>()
          expectTypeOf(fill.key).toEqualTypeOf<string | undefined>()
          expectTypeOf(fill.render).toEqualTypeOf<
            Fill<{ entry: Entry }>['render']
          >()
          return rendered
        }}
      </Slot>,
    )
  })
})

describe('a slot resolved by name at runtime', () => {
  test('takes any component, because a written view builds its own', () => {
    const found: AnySlot | undefined = registry.slot('message')
    if (found) registry.fill(found, { key: 'note', render: () => null })
  })
})

describe('reading a context key', () => {
  const clock = createContextKey<{ label: string }>('clock')

  test('is optional unless the caller asks to suspend', () => {
    expectTypeOf(useContextKey(clock)).toEqualTypeOf<
      { label: string } | undefined
    >()
    expectTypeOf(useContextKey(clock, { suspend: true })).toEqualTypeOf<{
      label: string
    }>()
  })
})
