import { useInstances, usePluginList } from '@tanstack/react-compose'
import { useMemo, useState } from 'react'
import { selectedStubs } from '../written'
import { useApp, useComposeWriter } from './app-frame'
import type { ReactNode } from 'react'

const messageOf = (error: unknown): string =>
  typeof error === 'object' && error !== null && 'message' in error
    ? String(error.message)
    : String(error)

/** The shell panel for inspecting and editing the running plugin list. */
export function PluginPanel(): ReactNode {
  const app = useApp()
  const writer = useComposeWriter()
  const entries = usePluginList()
  const instances = useInstances()
  const snapshots = useMemo(
    () => new Map(instances.map((instance) => [instance.id, instance])),
    [instances],
  )
  const [id, setId] = useState('')
  const [source, setSource] = useState('')
  const [view, setView] = useState('')
  const [grants, setGrants] = useState<Array<string>>([])
  const [problem, setProblem] = useState<string>()

  const run = async (operation: () => Promise<void>): Promise<void> => {
    try {
      setProblem(undefined)
      await operation()
    } catch (error) {
      setProblem(messageOf(error))
    }
  }

  return (
    <aside className="plugin-panel" data-testid="plugin-panel">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Live client</p>
          <h2>Plugin panel</h2>
        </div>
        <span className="count">{entries.length}</span>
      </div>

      <div className="plugin-list">
        {entries.map((entry) => {
          const snapshot = snapshots.get(entry.id)
          const enabled = entry.enabled !== false
          const status = enabled ? (snapshot?.status ?? 'pending') : 'disabled'
          return (
            <article
              className="plugin-row"
              data-testid={`plugin-${entry.id}`}
              key={entry.id}
            >
              <div className="plugin-line">
                <code>{entry.id}</code>
                <span className={`status status-${status}`}>{status}</span>
              </div>
              {snapshot?.missing.length ? (
                <p className="detail">Missing: {snapshot.missing.join(', ')}</p>
              ) : null}
              {snapshot?.error !== undefined ? (
                <p className="error">{messageOf(snapshot.error)}</p>
              ) : null}
              <div className="button-row">
                <button
                  type="button"
                  disabled={enabled}
                  onClick={() =>
                    void run(() => writer.setEnabled(entry.id, true))
                  }
                >
                  Enable
                </button>
                <button
                  type="button"
                  disabled={!enabled}
                  onClick={() =>
                    void run(() => writer.setEnabled(entry.id, false))
                  }
                >
                  Disable
                </button>
                <button
                  type="button"
                  onClick={() => void run(() => writer.remove(entry.id))}
                >
                  Remove
                </button>
              </div>
            </article>
          )
        })}
      </div>

      <form
        className="paste-form"
        onSubmit={(event) => {
          event.preventDefault()
          void run(async () => {
            if (id.trim() === '') throw new Error('an id is required')
            if (source.trim() === '') throw new Error('source is required')
            await writer.add({
              id: id.trim(),
              source,
              ...(view.trim() === '' ? {} : { view }),
              stubs: selectedStubs(grants, app.grants),
            })
          })
        }}
      >
        <h3>Paste source</h3>
        <label>
          Id
          <input
            aria-label="Plugin id"
            value={id}
            onChange={(event) => setId(event.target.value)}
          />
        </label>
        <label>
          Source
          <textarea
            aria-label="Plugin source"
            rows={8}
            value={source}
            onChange={(event) => setSource(event.target.value)}
          />
        </label>
        <label>
          View (optional)
          <textarea
            aria-label="Plugin view"
            rows={8}
            value={view}
            onChange={(event) => setView(event.target.value)}
          />
        </label>
        <label>
          Grants
          <select
            aria-label="Plugin grants"
            multiple
            value={grants}
            onChange={(event) =>
              setGrants(
                [...event.currentTarget.selectedOptions].map(
                  (option) => option.value,
                ),
              )
            }
          >
            {Object.keys(app.grants).map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </label>
        <button type="submit">Add</button>
        {problem === undefined ? null : <p className="error">{problem}</p>}
      </form>
    </aside>
  )
}
