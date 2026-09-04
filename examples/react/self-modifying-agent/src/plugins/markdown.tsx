import { createPlugin } from '@tanstack/compose'
import { slotsKey } from '@tanstack/react-compose'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { chatMessageSlot } from '../slots'
import type { ReactNode } from 'react'
import type { ChatMessageProps } from '../slots'

const Markdown = ({ text }: { text: string }): ReactNode => (
  <div className="message message-assistant" data-testid="markdown">
    <span className="who">agent</span>
    <div className="message-content">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        skipHtml
        components={{
          a: ({ node, ...props }) => {
            void node
            return <a {...props} target="_blank" rel="noreferrer" />
          },
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  </div>
)

/**
 * Markdown for what the agent says. The message list renders assistant text as
 * plain paragraphs; this plugin fills the same two **keys** of the `chat.message`
 * slot with a later fill, and the latest fill for a key wins. Disable it and the
 * plain renderers are back, with the list untouched either way.
 */
export const markdownPlugin = createPlugin({
  name: 'markdown',
  deps: [slotsKey],
  setup(instance) {
    const slots = instance.context.get(slotsKey)
    const fills: Record<string, (props: ChatMessageProps) => ReactNode> = {
      assistant: ({ entry }) =>
        entry.kind === 'assistant' && entry.text ? (
          <Markdown text={entry.text} />
        ) : null,
      chunk: ({ streamedText }) =>
        streamedText ? <Markdown text={streamedText} /> : null,
    }
    for (const [key, render] of Object.entries(fills)) {
      instance.cleanup(
        slots.fill(chatMessageSlot, { key, order: 10, render }),
        `fill(chat.message/${key})`,
      )
    }
  },
})
