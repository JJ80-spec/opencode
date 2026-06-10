import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { LLM } from "../../src"
import { Auth, LLMClient } from "../../src/route"
import * as AnthropicMessages from "../../src/protocols/anthropic-messages"
import { it } from "../lib/effect"
import { fixedResponse } from "../lib/http"
import { sseEvents } from "../lib/sse"

// Verifies the ACV GATEWAY PATCH in src/protocols/anthropic-messages.ts: our
// internal ACV LLM gateway replays the entire Anthropic SSE sequence twice
// (same message id, two full message_start -> message_stop cycles). The parser
// must process the first cycle and fully suppress the duplicate one.
const model = AnthropicMessages.route
  .with({ endpoint: { baseURL: "https://api.anthropic.test/v1/" }, auth: Auth.header("x-api-key", "test") })
  .model({ id: "claude-sonnet-4-5" })

const request = LLM.request({
  id: "req_dedup",
  model,
  prompt: "Say hello.",
  cache: "none",
  generation: { maxTokens: 20, temperature: 0 },
})

const cycle = [
  { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
  { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Hello" } },
  { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "!" } },
  { type: "content_block_stop", index: 0 },
  { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 2 } },
  { type: "message_stop" },
]

describe("ACV gateway compat — duplicate SSE stream", () => {
  it.effect("processes only the first cycle when the gateway replays the whole stream", () =>
    Effect.gen(function* () {
      const start = { type: "message_start", message: { id: "msg_dup_1", usage: { input_tokens: 5 } } }
      // Same message id emitted twice — the gateway's duplicated stream.
      const body = sseEvents(start, ...cycle, start, ...cycle)
      const response = yield* LLMClient.generate(request).pipe(Effect.provide(fixedResponse(body)))

      // Text is not doubled, and there is exactly one finish event.
      expect(response.text).toBe("Hello!")
      expect(response.events.filter((event) => event.type === "finish")).toHaveLength(1)
    }),
  )

  it.effect("processes a normal single-cycle stream unchanged", () =>
    Effect.gen(function* () {
      const start = { type: "message_start", message: { id: "msg_single_1", usage: { input_tokens: 5 } } }
      const body = sseEvents(start, ...cycle)
      const response = yield* LLMClient.generate(request).pipe(Effect.provide(fixedResponse(body)))

      expect(response.text).toBe("Hello!")
      expect(response.events.filter((event) => event.type === "finish")).toHaveLength(1)
    }),
  )
})
