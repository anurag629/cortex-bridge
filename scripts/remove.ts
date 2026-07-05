// Full teardown. `bun run remove` strips the Cortex Bridge hooks from every
// agent and deletes its config, leaving the rest of each agent's own settings
// intact. Pass -y to skip the confirmation (useful in scripts).
//
//   bun run remove        # asks once, then removes everything
//   bun run remove -y     # no prompt
import * as p from "@clack/prompts"
import { AGENTS, removeAllConfig, runInstaller } from "./wizard"

const yes = process.argv.includes("-y") || process.argv.includes("--yes")

p.intro("Cortex Bridge removal")

if (!yes && process.stdout.isTTY) {
  const go = await p.confirm({
    message: "Remove Cortex Bridge from every agent and delete its config?",
    initialValue: true,
  })
  if (p.isCancel(go) || !go) {
    p.cancel("Nothing changed.")
    process.exit(0)
  }
}

const s = p.spinner()
for (const agent of AGENTS) {
  s.start(`Removing ${agent.label}`)
  const r = await runInstaller(agent, { uninstall: true })
  s.stop(r.ok ? `Removed ${agent.label}` : `${agent.label}: nothing to remove`)
}

const removed = removeAllConfig()
p.log.success(removed.length ? `Deleted ${removed.join(", ")}` : "No config files found")

p.outro("Clean. Cortex Bridge is fully removed.")
