import { describe, expect, it } from "bun:test"
import { Provider } from "../../src/provider/provider"

// Builds a fake event-stream Response from raw SSE text, runs it through the
// ACV gateway cleaner, and returns the cleaned SSE text.
async function clean(sse: string, contentType = "text/event-stream"): Promise<string> {
  const body = new ReadableStream<Uint8Array>({
    start(ctrl) {
      ctrl.enqueue(new TextEncoder().encode(sse))
      ctrl.close()
    },
  })
  const res = new Response(body, { headers: { "content-type": contentType } })
  const out = Provider.cleanAnthropicGatewaySSE(res)
  return await new Response(out.body).text()
}

const start = (id: string) =>
  `event: message_start\ndata: ${JSON.stringify({ type: "message_start", message: { id, usage: { input_tokens: 5 } } })}`
const toolBlock = `event: content_block_start\ndata: ${JSON.stringify({
  type: "content_block_start",
  index: 1,
  content_block: { type: "tool_use", id: "toolu_1", name: "read", input: {}, caller: null },
})}`
const delta = `event: content_block_delta\ndata: ${JSON.stringify({ type: "content_block_delta", index: 1, delta: { type: "input_json_delta", partial_json: "{}" } })}`
const stop = `event: message_stop\ndata: ${JSON.stringify({ type: "message_stop" })}`

const cycle = (id: string) => [start(id), toolBlock, delta, stop].join("\n\n") + "\n\n"

describe("ACV gateway SSE cleaner — caller:null", () => {
  it("strips null content_block fields so the SDK parser accepts the event", async () => {
    const out = await clean(cycle("msg_1"))
    const blockLine = out.split("\n").find((l) => l.startsWith("data:") && l.includes("content_block_start"))!
    const parsed = JSON.parse(blockLine.slice(5))
    expect("caller" in parsed.content_block).toBe(false)
    expect(parsed.content_block.id).toBe("toolu_1")
    expect(parsed.content_block.name).toBe("read")
  })

  it("leaves non-null fields intact", async () => {
    const out = await clean(cycle("msg_1"))
    expect(out).toContain('"name":"read"')
    expect(out).toContain('"id":"toolu_1"')
    expect(out).not.toContain('"caller"')
  })

  it("still cleans when the gateway mislabels SSE as application/x-ndjson", async () => {
    // The ACV gateway serves real SSE bytes under an application/x-ndjson
    // content-type. The cleaner must process it regardless of the label.
    const out = await clean(cycle("msg_1"), "application/x-ndjson")
    expect(out).not.toContain('"caller"')
    expect(out).toContain('"name":"read"')
  })

  it("passes through a non-streaming JSON body untouched", async () => {
    const json = '{"type":"error","error":{"message":"boom"}}'
    const out = await clean(json, "application/json")
    expect(out).toBe(json)
  })
})

describe("ACV gateway SSE cleaner — duplicate stream", () => {
  it("drops a replayed cycle with the same message id", async () => {
    const out = await clean(cycle("msg_dup") + cycle("msg_dup"))
    const starts = out.split("\n").filter((l) => l.includes('"type":"message_start"'))
    const stops = out.split("\n").filter((l) => l.includes('"type":"message_stop"'))
    expect(starts).toHaveLength(1)
    expect(stops).toHaveLength(1)
  })

  it("keeps two distinct message ids", async () => {
    const out = await clean(cycle("msg_a") + cycle("msg_b"))
    const starts = out.split("\n").filter((l) => l.includes('"type":"message_start"'))
    expect(starts).toHaveLength(2)
  })
})
