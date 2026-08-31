/** Scratch probe used while writing the findings doc; kept because it
 * documents exactly how a Compartment's globalThis is shaped. */
import { makeHost } from './harness.ts'

const host = makeHost()
const p = await host.load({
  source: `
  exports.ownKeys = () => Object.keys(globalThis).sort();
  exports.viaFunction = () => Object.keys(Function('return globalThis')()).sort();
  exports.sameObject = () => Function('return globalThis')() === globalThis;
  exports.allNames = () => Object.getOwnPropertyNames(globalThis).sort();
  exports.hardenDesc = () => {
    const d = Object.getOwnPropertyDescriptor(globalThis, 'harden');
    return d ? 'enumerable=' + d.enumerable + ' writable=' + d.writable : 'none';
  };
  exports.typeofHarden = () => typeof harden;
  exports.frozen = () => Object.isFrozen(globalThis);
`,
})
for (const k of p.exports) {
  console.log(k.padEnd(14), '->', JSON.stringify(await p.call(k)))
}
await host.shutdown()
