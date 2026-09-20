/** @jest-environment jsdom */
import * as React from 'react'
import { jest, afterEach, describe, test, expect } from '@jest/globals'
import { render } from '@testing-library/react'
import { AiChatShortcutBridge } from '../AiChatShortcutBridge'

// Stands in for the assistant's own window listener, which closes the chat and
// clears the conversation whenever it sees ⌘J while the chat counts as open.
function spyOnAssistantShortcut() {
  const handler = jest.fn()
  window.addEventListener('keydown', handler)
  return {
    handler,
    dispose: () => window.removeEventListener('keydown', handler),
  }
}

function pressCmdJ() {
  document.body.dispatchEvent(
    new KeyboardEvent('keydown', { key: 'j', metaKey: true, bubbles: true, cancelable: true })
  )
}

function renderMinimizedDot() {
  const dot = document.createElement('button')
  dot.setAttribute('aria-label', 'Open AI Assistant')
  dot.className = 'fixed z-sticky w-14 h-14 rounded-full'
  document.body.appendChild(dot)
  const clicked = jest.fn()
  dot.addEventListener('click', clicked)
  return clicked
}

function renderDockHeader() {
  const controls = document.createElement('div')
  controls.innerHTML = `
    <button><svg class="lucide lucide-panel-bottom"></svg></button>
    <button id="minimize"><svg class="lucide lucide-minimize-2"></svg></button>
    <button><svg class="lucide lucide-x"></svg></button>
  `
  document.body.appendChild(controls)
  const clicked = jest.fn()
  controls.querySelector('#minimize')!.addEventListener('click', clicked)
  return clicked
}

afterEach(() => {
  document.body.innerHTML = ''
})

describe('AiChatShortcutBridge', () => {
  test('Cmd+J restores a minimized chat instead of letting the assistant clear it', () => {
    const assistant = spyOnAssistantShortcut()
    const dotClicked = renderMinimizedDot()
    render(<AiChatShortcutBridge />)

    pressCmdJ()

    expect(dotClicked).toHaveBeenCalledTimes(1)
    expect(assistant.handler).not.toHaveBeenCalled()
    assistant.dispose()
  })

  test('Cmd+J minimizes an open chat rather than closing it', () => {
    const assistant = spyOnAssistantShortcut()
    const minimizeClicked = renderDockHeader()
    render(<AiChatShortcutBridge />)

    pressCmdJ()

    expect(minimizeClicked).toHaveBeenCalledTimes(1)
    expect(assistant.handler).not.toHaveBeenCalled()
    assistant.dispose()
  })

  test('Cmd+J still reaches the assistant when no chat is on screen', () => {
    const assistant = spyOnAssistantShortcut()
    render(<AiChatShortcutBridge />)

    pressCmdJ()

    expect(assistant.handler).toHaveBeenCalledTimes(1)
    assistant.dispose()
  })

  test('the header AI button restores a minimized chat', () => {
    const dotClicked = renderMinimizedDot()
    render(<AiChatShortcutBridge />)

    window.dispatchEvent(new CustomEvent('om:open-ai-chat'))

    expect(dotClicked).toHaveBeenCalledTimes(1)
  })

  test('a minimize icon outside the dock header is left alone', () => {
    const assistant = spyOnAssistantShortcut()
    const unrelated = document.createElement('div')
    unrelated.innerHTML = '<button><svg class="lucide lucide-minimize-2"></svg></button>'
    document.body.appendChild(unrelated)
    const clicked = jest.fn()
    unrelated.querySelector('button')!.addEventListener('click', clicked)
    render(<AiChatShortcutBridge />)

    pressCmdJ()

    expect(clicked).not.toHaveBeenCalled()
    expect(assistant.handler).toHaveBeenCalledTimes(1)
    assistant.dispose()
  })
})
