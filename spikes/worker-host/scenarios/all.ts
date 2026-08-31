/** The eight scenarios. Runtime-agnostic: no Node/Bun/browser API in here. */

import { assert, assertEqual, assertRejects, type Scenario } from './harness.ts'

export const scenarios: Array<Scenario> = [
  // -------------------------------------------------------------------------
  {
    name: '1. plain call round-trip (args, return, throw, structured clone)',
    run: async (host) => {
      const p = await host.load({
        source: `
          exports.add = (a, b) => a + b;
          exports.echo = (v) => v;
          exports.boom = () => { throw new RangeError('plugin exploded'); };
          exports.slowAdd = async (a, b) => a + b;
        `,
      })
      assertEqual(await p.call('add', 2, 3), 5, 'add')
      assertEqual(await p.call('slowAdd', 2, 3), 5, 'async export')
      assertEqual(
        await p.call('echo', { a: [1, 2], b: { c: true } }),
        { a: [1, 2], b: { c: true } },
        'nested object survives clone',
      )
      // Map/Set/Date are structured-clonable; JSON is not the wire format.
      const m = (await p.call('echo', new Map([['k', 1]]))) as Map<
        string,
        number
      >
      assert(m instanceof Map && m.get('k') === 1, 'Map survives clone')
      const d = (await p.call('echo', new Date(0))) as Date
      assert(d instanceof Date && d.getTime() === 0, 'Date survives clone')

      const err = await assertRejects(p.call('boom'), 'boom')
      assert(err.includes('plugin exploded'), `error message crosses: ${err}`)

      const missing = await assertRejects(p.call('nope'), 'missing')
      assert(missing.includes('no such export'), `unknown export: ${missing}`)

      // A function argument is NOT clonable — this must fail loudly, not
      // silently drop. It throws on the host side before the post.
      let cloneFailed = false
      try {
        await p.call('echo', () => 1)
      } catch {
        cloneFailed = true
      }
      assert(cloneFailed, 'function argument is rejected by structured clone')

      await p.unload()
      return [
        `exports seen by host: ${JSON.stringify(p.exports)}`,
        'Map/Set/Date cross the bridge; functions do not (DataCloneError)',
      ]
    },
  },

  // -------------------------------------------------------------------------
  {
    name: '2. capability denial (fetch / process / Function / import / prototype pollution)',
    run: async (host) => {
      const probes: Record<string, string> = {
        fetch: `typeof fetch`,
        process: `typeof globalThis.process`,
        bun: `typeof globalThis.Bun`,
        deno: `typeof globalThis.Deno`,
        setTimeout: `typeof setTimeout`,
        XMLHttpRequest: `typeof globalThis.XMLHttpRequest`,
        importScripts: `typeof globalThis.importScripts`,
        postMessage: `typeof globalThis.postMessage`,
        require: `typeof globalThis.require`,
        WebSocket: `typeof globalThis.WebSocket`,
      }
      const src = Object.entries(probes)
        .map(([k, expr]) => `  out[${JSON.stringify(k)}] = ${expr};`)
        .join('\n')

      const p = await host.load({
        source: `
          exports.probe = () => { const out = {};\n${src}\n return out; };

          exports.functionCtor = () => {
            // The classic escape: reach the Function constructor off any
            // function object and evaluate in the outer realm.
            return (function(){}).constructor('return this')();
          };
          // Surprise: the compartment global "Function" is NOT the tamed
          // throwing stub -- it is the compartment's own evaluator. It works.
          // What matters is that what it produces is still confined.
          exports.functionThis = () => Function('return this')();
          exports.functionGlobalThis = () =>
            Object.keys(Function('return globalThis')()).sort();
          exports.functionReachFetch = () => Function('return typeof fetch')();
          // Indirect eval: still the compartment's own evaluator, so "this"
          // at its top level is the compartment globalThis, not the worker's.
          // (A direct eval call cannot even be written -- see below.)
          exports.evalEscape = () => Object.keys((0, eval)('this')).sort();
          // ...and returning that object outright is a clone failure, not a leak.
          exports.returnGlobalThis = () => (0, eval)('this');
          exports.pollute = () => {
            Array.prototype.pwned = 1;
            return 'polluted';
          };
          exports.pollutePrototypeOf = () => {
            Object.prototype.pwned = 1;
            return 'polluted';
          };
          exports.readGlobalThis = () => Object.keys(globalThis).sort();
          // SES puts these on every compartment global itself, as
          // NON-enumerable properties, so they never show in Object.keys.
          exports.sesProvided = () => ['harden','lockdown','Compartment','eval','Function']
            .filter((k) => k in globalThis);
          exports.globalFrozen = () => Object.isFrozen(globalThis);
          // A plugin can build a child compartment. It can only endow it with
          // what it already holds, so this is no escalation -- but it is a
          // surface, and nested compartments share this thread's CPU.
          exports.nestedCompartment = () =>
            new Compartment({ globals: { x: 1 }, __options__: true })
              .evaluate('typeof fetch');
          exports.checkPollution = () => ([].pwned ?? null);
        `,
      })

      const seen = (await p.call('probe')) as Record<string, string>
      for (const [k, v] of Object.entries(seen)) {
        assertEqual(v, 'undefined', `${k} must not be reachable`)
      }

      // Function constructor: lockdown() replaces %FunctionPrototype%.constructor
      // with a throwing stub (ses/src/tame-function-constructors.js).
      const fc = await assertRejects(p.call('functionCtor'), 'fc')
      // Function(...) inside a compartment compiles in the compartment's own
      // scope, in strict mode: "this" at the top of the produced function is
      // undefined, and its globalThis is the compartment's.
      assertEqual(
        await p.call('functionThis'),
        undefined,
        'Function this is undefined',
      )
      assertEqual(
        await p.call('functionGlobalThis'),
        ['context', 'exports', 'log', 'tools'],
        'Function("return globalThis") yields the COMPARTMENT global',
      )
      assertEqual(
        await p.call('functionReachFetch'),
        'undefined',
        'code built with Function() still cannot see fetch',
      )

      // eval() inside a Compartment is the *compartment's* evaluator, so it
      // does not escape. An INDIRECT eval runs sloppy, so its top-level "this"
      // is an object -- but it is the compartment's globalThis, not the
      // worker's, so it carries no authority.
      assertEqual(
        await p.call('evalEscape'),
        ['context', 'exports', 'log', 'tools'],
        'indirect eval "this" is the compartment global',
      )
      // Returning it must fail as a clone error, not leak endowment functions.
      const cloneBack = await assertRejects(
        p.call('returnGlobalThis'),
        'cloneBack',
      )
      assert(
        cloneBack.includes('cannot cross the worker boundary'),
        `non-clonable return is reported, not hung: ${cloneBack}`,
      )

      const pollute = await assertRejects(p.call('pollute'), 'pollute')
      const polluteObj = await assertRejects(
        p.call('pollutePrototypeOf'),
        'polluteObj',
      )
      assertEqual(await p.call('checkPollution'), null, 'Array.prototype clean')

      const keys = (await p.call('readGlobalThis')) as Array<string>
      // The only *own enumerable* globals are the ones we injected.
      assertEqual(
        keys,
        ['context', 'exports', 'log', 'tools'],
        'compartment globalThis own enumerable keys are exactly our endowments',
      )
      const sesProvided = (await p.call('sesProvided')) as Array<string>
      assertEqual(
        sesProvided,
        ['harden', 'lockdown', 'Compartment', 'eval', 'Function'],
        'ses adds these to every compartment global, non-enumerably',
      )
      assertEqual(
        await p.call('globalFrozen'),
        false,
        'compartment globalThis is extensible (plugin may add its own globals)',
      )
      // A nested compartment inherits no authority its parent lacks.
      assertEqual(
        await p.call('nestedCompartment'),
        'undefined',
        'a plugin-made child Compartment still cannot see fetch',
      )

      await p.unload()

      // Bonus: SES refuses to *compile* source containing a possible direct
      // eval expression (ses/src/transforms.js rejectSomeDirectEvalExpressions).
      // So this plugin never loads at all — denial happens before evaluation.
      const directEval = await assertRejects(
        host.load({ source: `exports.go = () => eval('this');` }),
        'directEval',
      )
      assert(
        directEval.includes('SES_EVAL_REJECTED') ||
          directEval.includes('direct eval'),
        `direct eval rejected at load: ${directEval}`,
      )

      // Same for dynamic import and `import.meta`: censored at compile time,
      // so a plugin cannot even *mention* the module loader in its source.
      const dynImport = await assertRejects(
        host.load({ source: `exports.go = async () => import('node:fs');` }),
        'dynImport',
      )
      const importKeyword = await assertRejects(
        host.load({ source: `exports.go = () => import.meta;` }),
        'importMeta',
      )

      return [
        `unreachable: ${Object.keys(probes).join(', ')}`,
        `direct eval('...') in source -> ${directEval.split('\n')[0]!.slice(0, 80)}`,
        `import('node:fs') in source -> ${dynImport.split('\n')[0]!.slice(0, 80)}`,
        `import.meta in source -> ${importKeyword.split('\n')[0]!.slice(0, 80)}`,
        `(function(){}).constructor -> ${fc.slice(0, 70)}`,
        "Function('return this')() -> undefined (compartment evaluator, strict mode)",
        "Function('return globalThis')() -> the compartment global, not the worker's",
        `Array.prototype.pwned = 1 -> ${pollute.slice(0, 70)}`,
        `Object.prototype.pwned = 1 -> ${polluteObj.slice(0, 70)}`,
        `compartment globalThis own enumerable keys: ${keys.join(', ')}`,
        `ses adds non-enumerably: ${sesProvided.join(', ')} -- a plugin CAN nest a Compartment`,
        'compartment globalThis is NOT frozen: a plugin may set its own globals',
        'indirect eval runs sloppy: its "this" is the compartment global (harmless, but not clonable)',
      ]
    },
  },

  // -------------------------------------------------------------------------
  {
    name: '3. runaway while(true) killed by wall-clock timeout; host stays usable',
    run: async (host) => {
      const runaway = await host.load({
        source: `exports.spin = () => { while (true) {} };`,
        timeoutMs: 300,
      })
      const t = performance.now()
      const msg = await assertRejects(runaway.call('spin'), 'spin')
      const killMs = performance.now() - t
      assert(msg.includes('300ms budget'), `timeout reported: ${msg}`)
      assert(runaway.dead, 'plugin marked dead')
      assert(killMs < 2000, `killed promptly (${killMs.toFixed(0)}ms)`)

      // Further calls fail fast rather than hanging.
      const after = await assertRejects(runaway.call('spin'), 'after')
      assert(after.includes('gone'), `dead plugin rejects fast: ${after}`)

      // The *host* is still usable: load a second plugin and call it.
      const good = await host.load({
        source: `exports.ok = () => 'still here';`,
      })
      assertEqual(await good.call('ok'), 'still here', 'host survives the kill')
      await good.unload()

      return [
        `while(true) terminated after ${killMs.toFixed(0)}ms (budget 300ms)`,
        'a second plugin loaded and answered on the same host afterwards',
      ]
    },
  },

  // -------------------------------------------------------------------------
  {
    name: '4. teardown quiescence — unload settles only once the worker is gone',
    run: async (host) => {
      const p = await host.load({
        source: `
          exports.spin = () => { while (true) {} };
          exports.ok = () => 1;
        `,
        timeoutMs: 5000,
      })
      assertEqual(await p.call('ok'), 1, 'alive before unload')

      // Start work that will never finish, then unload underneath it.
      // NOTE the eager `.catch`: `unload()` rejects every in-flight call, and
      // several event-loop turns pass inside `worker.terminate()` before the
      // caller gets to `await` the promise. Node's unhandled-rejection
      // detector fires in that window and kills the process. Any caller that
      // holds a call promise across an `await unload()` must attach its
      // handler first. This is inherent to "teardown rejects in-flight work".
      const inflight = p.call('spin').then(
        (v) => ({ ok: true, v }) as const,
        (e: Error) => ({ ok: false, e }) as const,
      )
      const t = performance.now()
      await p.unload()
      const unloadMs = performance.now() - t

      const settled = await inflight
      assert(!settled.ok, 'in-flight call rejected on unload')
      const msg = settled.ok ? '' : settled.e.message
      assert(msg.includes('gone'), `in-flight call rejected on unload: ${msg}`)
      assert(p.dead, 'dead after unload')

      // Unload is idempotent and stays fast.
      await p.unload()
      await p.unload()

      // Nothing arrives after teardown: give the loop a beat and confirm we
      // did not get an unhandled rejection or a late message.
      await new Promise((r) => setTimeout(r, 50))

      return [
        `unload() of a spinning worker settled in ${unloadMs.toFixed(0)}ms`,
        'in-flight call rejected, unload idempotent, no late messages',
      ]
    },
  },

  // -------------------------------------------------------------------------
  {
    name: '5. two plugins are isolated from each other',
    run: async (host) => {
      const a = await host.load({
        source: `
          globalThis.secret = 'from-A';
          exports.setPrototypePollution = () => { try { Array.prototype.x = 1 } catch (e) { return e.name } };
          exports.read = () => globalThis.secret ?? null;
        `,
      })
      const b = await host.load({
        source: `exports.read = () => globalThis.secret ?? null;`,
      })

      assertEqual(await a.call('read'), 'from-A', 'A sees its own global')
      assertEqual(await b.call('read'), null, 'B does not see A global')

      // Even a *successful* mutation in A cannot reach B: separate threads,
      // separate realms, separate primordials.
      await a.call('setPrototypePollution')
      assertEqual(await b.call('read'), null, 'B still clean')

      // Killing A does not touch B.
      await a.unload()
      assertEqual(await b.call('read'), null, 'B alive after A unloaded')
      assert(a.dead && !b.dead, 'only A is dead')
      await b.unload()

      return [
        'a global set in plugin A is invisible in plugin B',
        'unloading A leaves B running',
      ]
    },
  },

  // -------------------------------------------------------------------------
  {
    name: '6. bidirectional: tools.register + callTool, and host->plugin->host',
    run: async (host) => {
      const logs: Array<unknown> = []
      const p = await host.load({
        source: `
          tools.register('shout', async (s) => {
            await log('tool ran: ' + s);
            const suffix = await context.get('suffix');
            return String(s).toUpperCase() + suffix;
          });
          exports.viaContext = async (k) => context.get(k);
          exports.peek = (k) => context.peek(k);
        `,
        context: { suffix: '!!', greeting: 'hi' },
        stubs: {
          log: (m) => {
            logs.push(m)
          },
          contextGet: (k) => ({ suffix: '!!', greeting: 'hi' })[k],
        },
      })

      assertEqual(p.tools, ['shout'], 'tool registered during load')
      // Host calls a function the plugin registered; that function calls back
      // into the host twice before answering. Full duplex.
      assertEqual(await p.callTool('shout', 'hey'), 'HEY!!', 'tool round trip')
      assertEqual(logs, ['tool ran: hey'], 'log stub received the message')
      assertEqual(await p.call('viaContext', 'greeting'), 'hi', 'context.get')
      assertEqual(await p.call('peek', 'suffix'), '!!', 'context.peek (sync)')

      // A host stub that throws surfaces as a rejection inside the plugin.
      const p2 = await host.load({
        source: `exports.go = async () => { try { await context.get('x') } catch (e) { return 'caught: ' + e.message } };`,
        stubs: {
          contextGet: () => {
            throw new Error('denied by policy')
          },
        },
      })
      assertEqual(
        await p2.call('go'),
        'caught: denied by policy',
        'host stub rejection is catchable in the plugin',
      )

      await p.unload()
      await p2.unload()
      return [
        'plugin -> host stub -> plugin -> host result works in one call',
        'host stub errors become catchable rejections inside the compartment',
      ]
    },
  },

  // -------------------------------------------------------------------------
  {
    name: '7. injected async stub in a loop — per-call latency',
    run: async (host) => {
      const N = 1000
      const p = await host.load({
        source: `
          exports.hammer = async (n) => {
            let acc = 0;
            for (let i = 0; i < n; i++) acc += await context.get('one');
            return acc;
          };
        `,
        timeoutMs: 30000,
        stubs: { contextGet: () => 1 },
      })
      const t = performance.now()
      const total = await p.call('hammer', N)
      const elapsed = performance.now() - t
      assertEqual(total, N, 'all stub calls returned')
      await p.unload()
      return [
        `${N} plugin->host->plugin stub calls in ${elapsed.toFixed(0)}ms`,
        `= ${((elapsed / N) * 1000).toFixed(1)}us per stub call (mean)`,
      ]
    },
  },

  // -------------------------------------------------------------------------
  {
    name: '8. resource abuse other than CPU: allocation and message flooding',
    run: async (host) => {
      // A plugin that allocates without bound. `lockdown()` does nothing here;
      // the worker boundary is what contains it. On a thread with no heap cap
      // this may still OOM the *process* — see the findings doc.
      const p = await host.load({
        source: `
          exports.alloc = (mb) => {
            const chunks = [];
            for (let i = 0; i < mb; i++) chunks.push(new Uint8Array(1024 * 1024));
            return chunks.length;
          };
        `,
        timeoutMs: 5000,
      })
      assertEqual(await p.call('alloc', 64), 64, '64MB allocated inside worker')
      await p.unload()

      // A plugin that never stops talking to the host is bounded by the same
      // wall-clock budget as any other call.
      const flood = await host.load({
        source: `exports.flood = async () => { for(;;) { await log('x') } };`,
        timeoutMs: 400,
        stubs: { log: () => {} },
      })
      const msg = await assertRejects(flood.call('flood'), 'flood')
      assert(msg.includes('400ms budget'), `flood killed: ${msg}`)

      return [
        'a plugin CAN allocate freely inside its worker — ses does not bound memory',
        'an unbounded plugin->host call loop is still killed by the call budget',
      ]
    },
  },
]
