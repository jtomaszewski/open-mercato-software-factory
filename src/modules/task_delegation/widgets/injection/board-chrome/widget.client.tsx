'use client'
import { HIDE_OWNER_IRRELEVANT_CARD_CHROME } from '../../../components/staffChrome'

/**
 * The board card's share of the staff chrome we hide, mounted once in the board toolbar rather than
 * once per card — the card spots render per task, and one identical rule per card is waste the
 * browser would have to cascade away. Renders nothing visible; see `components/staffChrome.ts` for
 * what it hides and why that is brittle.
 */
export default function BoardChrome() {
  return <style>{HIDE_OWNER_IRRELEVANT_CARD_CHROME}</style>
}
