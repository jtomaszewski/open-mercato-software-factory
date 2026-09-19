/**
 * Who the delegatable agent is. Separate from `demoSetup` because provisioning it is a demo
 * concern, but reading and renaming it is not: `renameAgent` runs against production databases.
 */

/**
 * The agent definition id. An identifier, frozen: the orchestrator's `factory.deliver` process
 * binding, the `start-factory` subscriber, the generated agent email and the seeded rows all key
 * on it (SPEC-008, *Design* → out of scope).
 */
export const FACTORY_AGENT_ID = 'factory'

/**
 * The agent's job title, stored as its principal's `auth.User.name` and read straight from there
 * by the picker, the card badge, the drawer, audit entries and the MCP tools (SPEC-008). This is
 * the name people read; the id above is what the machine matches on.
 */
export const FACTORY_AGENT_DISPLAY_NAME = 'Software Engineer'
