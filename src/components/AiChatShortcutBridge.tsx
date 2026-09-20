'use client'

import * as React from 'react'

// The installed assistant keeps "minimized" in its own dock state (localStorage,
// owned by DockableChat) while open/close lives in the command-palette state. The
// two never talk, so once the chat is minimized to the dot:
//   - ⌘J reads the chat as open, "closes" it and drops the conversation, and
//   - the header AI button (`om:open-ai-chat`) only re-opens an invisible panel,
// leaving a click on the dot as the sole way back. This bridge restores the panel
// the same way that click does, and turns ⌘J into a minimize toggle so the
// shortcut never discards the conversation. The explicit ✕ still closes and clears.

const AI_CHAT_SHORTCUT_KEY = 'j'
const OPEN_AI_CHAT_EVENT = 'om:open-ai-chat'

// AiDot renders a fixed, round launcher with this hard-coded label; the header
// trigger shares the label but is never `fixed`.
function findMinimizedChatDot(): HTMLButtonElement | null {
  const candidates = document.querySelectorAll<HTMLButtonElement>('button[aria-label="Open AI Assistant"]')
  for (const candidate of Array.from(candidates)) {
    if (candidate.classList.contains('fixed')) return candidate
  }
  return null
}

// The dock header pairs the minimize button with the dock-position buttons; other
// screens (the workflow editor) render a minimize icon without them.
function findChatMinimizeButton(): HTMLButtonElement | null {
  const icons = document.querySelectorAll<SVGElement>('svg.lucide-minimize-2')
  for (const icon of Array.from(icons)) {
    const button = icon.closest('button')
    const controls = button?.parentElement
    if (!button || !controls) continue
    if (controls.querySelector('svg.lucide-panel-bottom')) return button
  }
  return null
}

export function AiChatShortcutBridge() {
  React.useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.altKey || event.shiftKey) return
      if (event.key.toLowerCase() !== AI_CHAT_SHORTCUT_KEY) return

      const target = findMinimizedChatDot() ?? findChatMinimizeButton()
      // Chat is not on screen at all - let the assistant open it as usual.
      if (!target) return

      event.preventDefault()
      // Runs in the capture phase, so this keeps the assistant's own window
      // listener from closing the chat and wiping the messages.
      event.stopPropagation()
      target.click()
    }

    const handleOpenRequest = () => {
      findMinimizedChatDot()?.click()
    }

    window.addEventListener('keydown', handleKeyDown, true)
    window.addEventListener(OPEN_AI_CHAT_EVENT, handleOpenRequest)
    return () => {
      window.removeEventListener('keydown', handleKeyDown, true)
      window.removeEventListener(OPEN_AI_CHAT_EVENT, handleOpenRequest)
    }
  }, [])

  return null
}
